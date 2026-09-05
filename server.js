const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.get('/', (req, res) => res.redirect('/game.html'));
app.use(express.static(__dirname));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
const rooms = {};

// ========== 新增：快速匹配队列 ==========
// 按角色分别排队，支持多人同时等待自动配对
const matchQueue = {
  accountant: [],  // 等待中的账房先生
  shopkeeper: []   // 等待中的店堂伙计
};

// 自动配对逻辑：两边队列都有人时，自动凑成一局双人游戏
function tryMatch() {
  // 只要两边都有等待的玩家，就持续配对
  while (matchQueue.accountant.length && matchQueue.shopkeeper.length) {
    // 各取出队首的一名玩家
    const accSocket = matchQueue.accountant.shift();
    const shopSocket = matchQueue.shopkeeper.shift();

    // 生成不重复的4位房间号
    let roomId;
    do {
      roomId = Math.floor(1000 + Math.random() * 9000).toString();
    } while (rooms[roomId]);

    // 初始化房间，完全沿用原有房间数据结构，兼容所有现有逻辑
    rooms[roomId] = {
      hostId: accSocket.id,
      hostRole: 'accountant',
      guestId: shopSocket.id,
      guestRole: 'shopkeeper',
      offer: null,
      answer: null,
      candidates: []
    };

    // 双方加入 Socket 房间
    accSocket.join(roomId);
    shopSocket.join(roomId);

    // 分别通知双方匹配成功
    accSocket.emit('match-success', {
      roomId: roomId,
      role: 'accountant',
      peerRole: 'shopkeeper'
    });
    shopSocket.emit('match-success', {
      roomId: roomId,
      role: 'shopkeeper',
      peerRole: 'accountant'
    });
  }
}
// ======================================

io.on('connection', (socket) => {
  // ========== 新增：快速匹配相关事件 ==========
  // 玩家加入匹配队列
  socket.on('join-match', (role) => {
    // 角色合法性校验
    if (role !== 'accountant' && role !== 'shopkeeper') return;
    // 防止同一个连接重复入队
    if (matchQueue[role].some(s => s.id === socket.id)) return;

    matchQueue[role].push(socket);

    // 向玩家反馈当前排队状态
    const peerRole = role === 'accountant' ? 'shopkeeper' : 'accountant';
    socket.emit('queue-update', {
      yourRole: role,
      yourRoleWaitNum: matchQueue[role].length,
      peerRoleWaitNum: matchQueue[peerRole].length
    });

    // 加入后立刻尝试配对
    tryMatch();
  });

  // 玩家取消匹配，退出队列
  socket.on('cancel-match', (role) => {
    if (!matchQueue[role]) return;
    const idx = matchQueue[role].findIndex(s => s.id === socket.id);
    if (idx !== -1) {
      matchQueue[role].splice(idx, 1);
    }
  });
  // ============================================

  // 创建房间（原有功能完整保留）
  socket.on('create-room', (role) => {
    let roomId;
    do {
      roomId = Math.floor(1000 + Math.random() * 9000).toString();
    } while (rooms[roomId]);
    rooms[roomId] = {
      hostId: socket.id,
      hostRole: role,
      guestId: null,
      guestRole: null,
      offer: null,
      answer: null,
      candidates: []
    };
    socket.join(roomId);
    socket.emit('room-created', roomId);
  });

  // 加入房间（原有功能完整保留）
  socket.on('join-room', (roomId, role) => {
    const room = rooms[roomId];
    if (!room) {
      return socket.emit('error', '房间不存在');
    }
    // 严格双人上限
    if (room.guestId) {
      return socket.emit('error', '房间已满');
    }
    // 角色互斥校验
    if (room.hostRole === role) {
      return socket.emit('error', '该角色已被选择，请换另一个角色');
    }
    room.guestId = socket.id;
    room.guestRole = role;
    socket.join(roomId);
    socket.emit('room-joined', room.offer, room.candidates);
    socket.to(room.hostId).emit('guest-joined', role);
  });

  // 转发 WebRTC 连接信息（原有功能完整保留）
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

  // 游戏/聊天消息统一转发（替代WebRTC数据通道）（原有功能完整保留）
  socket.on('send-game-data', (roomId, data) => {
    if (!rooms[roomId]) return;
    socket.to(roomId).emit('game-data-received', data);
  });

  // 优化断线清理：客人掉线只移除客人，房主掉线才销毁房间
  socket.on('disconnect', () => {
    // ========== 新增：断线时从匹配队列移除 ==========
    ['accountant', 'shopkeeper'].forEach(role => {
      const idx = matchQueue[role].findIndex(s => s.id === socket.id);
      if (idx !== -1) matchQueue[role].splice(idx, 1);
    });
    // ============================================

    for (const roomId in rooms) {
      const room = rooms[roomId];
      
      // 房主断线：销毁整个房间
      if (room.hostId === socket.id) {
        socket.to(roomId).emit('peer-left');
        delete rooms[roomId];
        break;
      }
      
      // 客人断线：清空客人信息，保留房间给房主
      if (room.guestId === socket.id) {
        socket.to(room.hostId).emit('peer-left');
        room.guestId = null;
        room.guestRole = null;
        room.offer = null;
        room.answer = null;
        room.candidates = [];
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('游戏服务已启动，端口：' + PORT);
  console.log('电脑本地访问：http://localhost:' + PORT + '/game.html');
});
