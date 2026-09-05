const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

// ========== 初始化服务 ==========
const app = express();
app.use(cors());
app.use(express.static(__dirname));
app.get('/', (req, res) => res.redirect('/game.html'));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

// ========== 全局状态 ==========
/** 房间集合：key=房间号, value=房间数据 */
const rooms = {};
/** 快速匹配队列：按角色分别排队 */
const matchQueue = {
  accountant: [],
  shopkeeper: []
};

// ========== 工具函数 ==========
/** 生成不重复的4位房间号 */
function generateRoomId() {
  let roomId;
  do {
    roomId = Math.floor(1000 + Math.random() * 9000).toString();
  } while (rooms[roomId]);
  return roomId;
}

/**
 * 尝试自动配对
 * 两边队列都有人时，按先到先得原则凑成一局
 */
function tryMatch() {
  while (matchQueue.accountant.length && matchQueue.shopkeeper.length) {
    const accSocket = matchQueue.accountant.shift();
    const shopSocket = matchQueue.shopkeeper.shift();
    const roomId = generateRoomId();

    // 初始化房间数据，完全兼容原有结构
    rooms[roomId] = {
      hostId: accSocket.id,
      hostRole: 'accountant',
      guestId: shopSocket.id,
      guestRole: 'shopkeeper',
      offer: null,
      answer: null,
      candidates: []
    };

    // 双方加入房间
    accSocket.join(roomId);
    shopSocket.join(roomId);

    // 通知匹配结果
    accSocket.emit('match-success', {
      roomId,
      role: 'accountant',
      peerRole: 'shopkeeper'
    });
    shopSocket.emit('match-success', {
      roomId,
      role: 'shopkeeper',
      peerRole: 'accountant'
    });
  }
}

/**
 * 从匹配队列中移除指定连接
 * @param {string} socketId 连接ID
 */
function removeFromMatchQueue(socketId) {
  ['accountant', 'shopkeeper'].forEach(role => {
    const idx = matchQueue[role].findIndex(s => s.id === socketId);
    if (idx !== -1) {
      matchQueue[role].splice(idx, 1);
    }
  });
}

// ========== Socket 连接处理 ==========
io.on('connection', (socket) => {

  // ------------------------------
  // 1. 快速匹配相关
  // ------------------------------
  socket.on('join-match', (role) => {
    // 角色合法性校验
    if (role !== 'accountant' && role !== 'shopkeeper') return;
    // 防止重复入队
    if (matchQueue[role].some(s => s.id === socket.id)) return;

    matchQueue[role].push(socket);

    // 反馈当前排队状态
    const peerRole = role === 'accountant' ? 'shopkeeper' : 'accountant';
    socket.emit('queue-update', {
      yourRole: role,
      yourRoleWaitNum: matchQueue[role].length,
      peerRoleWaitNum: matchQueue[peerRole].length
    });

    // 立即尝试配对
    tryMatch();
  });

  socket.on('cancel-match', (role) => {
    if (!matchQueue[role]) return;
    removeFromMatchQueue(socket.id);
  });

  // ------------------------------
  // 2. 房间操作相关
  // ------------------------------
  socket.on('create-room', (role) => {
    const roomId = generateRoomId();

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

  socket.on('join-room', (roomId, role) => {
    const room = rooms[roomId];

    if (!room) {
      return socket.emit('error', '房间不存在');
    }
    if (room.guestId) {
      return socket.emit('error', '房间已满');
    }
    if (room.hostRole === role) {
      return socket.emit('error', '该角色已被选择，请换另一个角色');
    }

    room.guestId = socket.id;
    room.guestRole = role;
    socket.join(roomId);

    socket.emit('room-joined', room.offer, room.candidates);
    socket.to(room.hostId).emit('guest-joined', role);
  });

  // ------------------------------
  // 3. WebRTC 信令转发
  // ------------------------------
  socket.on('send-offer', (roomId, sdp) => {
    const room = rooms[roomId];
    if (!room) return;
    room.offer = sdp;
    socket.to(roomId).emit('offer-received', sdp);
  });

  socket.on('send-answer', (roomId, sdp) => {
    const room = rooms[roomId];
    if (!room) return;
    room.answer = sdp;
    socket.to(roomId).emit('answer-received', sdp);
  });

  socket.on('send-candidate', (roomId, candidate) => {
    const room = rooms[roomId];
    if (!room) return;
    room.candidates.push(candidate);
    socket.to(roomId).emit('candidate-received', candidate);
  });

  // ------------------------------
  // 4. 游戏/聊天消息统一转发
  // ------------------------------
  socket.on('send-game-data', (roomId, data) => {
    const room = rooms[roomId];
    if (!room) return;
    socket.to(roomId).emit('game-data-received', data);
  });

  // ------------------------------
  // 5. 断线清理
  // ------------------------------
  socket.on('disconnect', () => {
    // 从匹配队列移除
    removeFromMatchQueue(socket.id);

    // 遍历房间处理
    for (const roomId of Object.keys(rooms)) {
      const room = rooms[roomId];

      // 房主断线：销毁房间，通知对方
      if (room.hostId === socket.id) {
        socket.to(roomId).emit('peer-left');
        delete rooms[roomId];
        break;
      }

      // 客人断线：清空客人信息，保留房间
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

// ========== 启动服务 ==========
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`游戏服务已启动，端口：${PORT}`);
  console.log(`本地访问地址：http://localhost:${PORT}/game.html`);
});
