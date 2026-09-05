const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.static(__dirname));
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const rooms = {};

io.on('connection', (socket) => {
  // 创建房间
  socket.on('create-room', (role) => {
    let roomId;
    do {
      roomId = Math.floor(1000 + Math.random() * 9000).toString();
    } while (rooms[roomId]);
    rooms[roomId] = { hostId: socket.id, hostRole: role, guestId: null, offer: null, answer: null, candidates: [] };
    socket.join(roomId);
    socket.emit('room-created', roomId);
  });

  // 加入房间
  socket.on('join-room', (roomId, role) => {
    const room = rooms[roomId];
    if (!room) return socket.emit('error', '房间不存在');
    if (room.guestId) return socket.emit('error', '房间已满');
    room.guestId = socket.id;
    socket.join(roomId);
    socket.emit('room-joined', room.offer, room.candidates);
    socket.to(room.hostId).emit('guest-joined', role);
  });

  // 转发连接信息
  socket.on('send-offer', (roomId, sdp) => {
    if (!rooms[roomId]) return;
    rooms[roomId].offer = sdp;
    socket.to(roomId).emit('offer-received', sdp);
  });
  socket.on('send-answer', (roomId, sdp) => {
    if (!rooms[roomId]) return;
    rooms[roomId].answer = sdp;
    socket.to(roomId).emit('answer-received', sdp);
  });
  socket.on('send-candidate', (roomId, candidate) => {
    if (!rooms[roomId]) return;
    rooms[roomId].candidates.push(candidate);
    socket.to(roomId).emit('candidate-received', candidate);
  });

  // 断开清理
  socket.on('disconnect', () => {
    for (const roomId in rooms) {
      const room = rooms[roomId];
      if (room.hostId === socket.id || room.guestId === socket.id) {
        socket.to(roomId).emit('peer-left');
        delete rooms[roomId];
      }
    }
  });
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log('游戏服务已启动，端口：' + PORT);
  console.log('电脑本地访问：http://localhost:3000/game.html');
});
