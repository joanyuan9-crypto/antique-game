'use strict';
const express = require('express');
const http = require('node:http');
const { randomUUID, randomInt } = require('node:crypto');
const { Server } = require('socket.io');
const Engine = require('./public/engine');

function createGameServer({ graceMs = 60000 } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.get('/', (_req, res) => res.redirect('/game.html'));
  app.get('/game.html', (_req, res) => res.sendFile(require('node:path').join(__dirname, 'game.html')));
  app.get('/health', (_req, res) => res.json({status:'ok'}));
  app.use(express.static(require('node:path').join(__dirname, 'public')));
  const server = http.createServer(app);
  const io = new Server(server, { maxHttpBufferSize: 16384 });
  let closing = false;
  const rooms = new Map();
  const queues = new Map();
  const roles = ['accountant', 'shopkeeper'];
  const valid = c => c && roles.includes(c.role) && [1,2].includes(c.level) && Object.hasOwn(Engine.difficulties, c.difficulty);
  const getQueue = c => {
    const key = `${c.level}:${c.difficulty}`;
    if (!queues.has(key)) queues.set(key, {accountant:[], shopkeeper:[]});
    return queues.get(key);
  };
  function publishQueues() {
    for (const q of queues.values()) for (const role of roles) {
      q[role] = q[role].filter(s => s.connected);
      for (const s of q[role]) s.emit('queue-state', {same:q[role].length, peer:q[roles.find(r => r !== role)].length});
    }
  }
  function removeQueue(socket) {
    for (const q of queues.values()) for (const role of roles) q[role] = q[role].filter(s => s !== socket);
    publishQueues();
  }
  function member(socket) {
    const room = rooms.get(socket.data.roomId);
    const seat = room?.seats.find(s => s.socketId === socket.id);
    return {room, seat};
  }
  function publish(room) {
    for (const seat of room.seats) {
      if (!seat.socketId) continue;
      io.to(seat.socketId).emit('room-state', {
        id:room.id, round:room.round, token:seat.token, role:seat.role, level:room.level, difficulty:room.difficulty,
        players:room.seats.map(s => ({role:s.role, connected:!!s.socketId})),
        restart:room.restart, messages:room.messages,
        game:room.game ? Engine.view(room.game, seat.role) : null
      });
    }
  }
  function destroy(room, reason) {
    rooms.delete(room.id);
    for (const seat of room.seats) {
      clearTimeout(seat.timer);
      if (seat.socketId) {
        const s = io.sockets.sockets.get(seat.socketId);
        if (s) { s.data.roomId = null; s.emit('room-ended', {reason}); }
      }
    }
  }
  function detach(socket, intentional = false) {
    removeQueue(socket);
    if (closing) return;
    const {room, seat} = member(socket);
    if (!room || !seat) return;
    socket.data.roomId = null;
    if (intentional) return destroy(room, '伙伴离开了房间，可以重新组队或进入单人练习。');
    seat.socketId = null;
    room.restart = null;
    seat.timer = setTimeout(() => destroy(room, '伙伴未能在一分钟内重连，房间已结束。'), graceMs);
    publish(room);
  }
  function makeRoom(config) {
    let id;
    do { id = String(randomInt(1000,10000)); } while (rooms.has(id));
    const room = {id, level:config.level, difficulty:config.difficulty, seats:[], game:null, round:null, restart:null, messages:[]};
    rooms.set(id, room);
    return room;
  }
  function addSeat(room, socket, role) {
    removeQueue(socket);
    room.seats.push({role, socketId:socket.id, token:randomUUID(), timer:null});
    socket.data.roomId = room.id;
    if (room.seats.length === 2) startRound(room);
  }
  function startRound(room) {
    room.game = Engine.createGame(room.level, room.difficulty);
    room.round = randomUUID(); room.restart = null; room.messages = [];
  }
  io.on('connection', socket => {
    function event(name, handler) {
      socket.on(name, (payload, ack) => {
        const reply = typeof ack === 'function' ? ack : () => {};
        // Cheap per-connection burst limit; normal typing and play remain below it.
        const now = Date.now();
        if (!socket.data.bucket || now - socket.data.bucket.time > 1000) socket.data.bucket = {time:now, count:0};
        if (++socket.data.bucket.count > 40) return reply({error:'操作太快，请稍后再试。'});
        try { handler(payload, reply); } catch (error) { console.error(name, error.message); reply({error:'操作未完成，请重试。'}); }
      });
    }
    event('room-create', (config, reply) => {
      if (!valid(config)) return reply({error:'请选择关卡、难度和角色。'});
      if (member(socket).room) return reply({error:'你已经在房间中。'});
      if (rooms.size >= 8000) return reply({error:'房间暂满，请稍后再试。'});
      const room = makeRoom(config); addSeat(room, socket, config.role); publish(room); reply({ok:true});
    });
    event('room-join', (data, reply) => {
      if (!data || !/^\d{4}$/.test(data.id) || !roles.includes(data.role)) return reply({error:'请输入四位数字房间号，并选择角色。'});
      if (member(socket).room) return reply({error:'你已经在房间中。'});
      const room = rooms.get(data.id);
      if (!room) return reply({error:'房间不存在或已结束，请核对房间号。'});
      if (room.seats.length >= 2) return reply({error:'房间已满。'});
      if (room.seats.some(s => s.role === data.role)) return reply({error:'该角色已被伙伴选择，请换另一个角色。'});
      addSeat(room, socket, data.role); publish(room); reply({ok:true});
    });
    event('room-resume', (data, reply) => {
      if (member(socket).room) return reply({error:'你已在房间中。'});
      const room = data && rooms.get(data.id);
      const seat = room?.seats.find(s => s.token === data.token);
      if (!seat || seat.socketId) return reply({error:'无法恢复房间，请重新组队。'});
      clearTimeout(seat.timer); seat.socketId = socket.id; socket.data.roomId = room.id;
      publish(room); reply({ok:true});
    });
    event('match-join', (config, reply) => {
      if (!valid(config)) return reply({error:'请选择关卡、难度和角色。'});
      if (member(socket).room) return reply({error:'请先离开当前房间。'});
      removeQueue(socket);
      const q = getQueue(config); const peerRole = roles.find(r => r !== config.role);
      const peer = q[peerRole].shift();
      if (peer?.connected) {
        const room = makeRoom(config); addSeat(room, peer, peerRole); addSeat(room, socket, config.role); publish(room);
      } else { q[config.role].push(socket); publishQueues(); }
      reply({ok:true});
    });
    event('match-cancel', (_data, reply) => {removeQueue(socket); reply({ok:true});});
    event('room-leave', (_data, reply) => {detach(socket, true); reply({ok:true});});
    event('game-action', (data, reply) => {
      const {room, seat} = member(socket);
      if (!room?.game || !seat) return reply({error:'请先加入游戏。'});
      if (!room.seats.every(s => s.socketId)) return reply({error:'等待伙伴重连后继续。'});
      if (!data || data.round !== room.round || data.revision !== room.game.revision) return reply({error:'局面已更新，请重试。'});
      if (!data.action || (seat.role !== 'shopkeeper' && data.action.type !== 'hint')) return reply({error:'请由操作机关的伙伴摆放古物。'});
      const result = Engine.act(room.game, data.action);
      if (result.changed) publish(room);
      reply(result);
    });
    event('restart-request', (_data, reply) => {
      const {room, seat} = member(socket);
      if (!room?.game || !room.seats.every(s => s.socketId)) return reply({error:'等待伙伴就绪后再开一局。'});
      if (room.game.status !== 'playing') startRound(room);
      else room.restart = seat.role;
      publish(room); reply({ok:true});
    });
    event('restart-respond', (data, reply) => {
      const {room, seat} = member(socket);
      if (!room?.restart || room.restart === seat.role) return reply({error:'没有待确认的重开请求。'});
      if (data?.accept === true) startRound(room); else room.restart = null;
      publish(room); reply({ok:true});
    });
    event('chat', (data, reply) => {
      const {room, seat} = member(socket);
      if (!room || !seat || typeof data?.text !== 'string') return reply({error:'消息未发送。'});
      const text = data.text.trim().slice(0,300);
      if (!text) return reply({ok:true});
      room.messages.push({id:randomUUID(), role:seat.role, text});
      if (room.messages.length > 80) room.messages.shift();
      publish(room); reply({ok:true});
    });
    socket.on('disconnect', () => detach(socket));
  });
  return {app, server, io, rooms, queues, close: async () => {
    closing = true;
    for (const room of rooms.values()) for (const seat of room.seats) clearTimeout(seat.timer);
    await new Promise(resolve => io.close(resolve));
  }};
}
if (require.main === module) {
  const {server} = createGameServer();
  server.listen(process.env.PORT || 3000, () => console.log('老古董服务已启动'));
}
module.exports = {createGameServer};
