const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);

const isProduction = process.env.NODE_ENV === 'production';

const io = socketIo(server, {
  cors: {
    origin: isProduction ? process.env.CLIENT_URL || '*' : 'http://localhost:3000',
    methods: ['GET', 'POST'],
  },
  transports: ['websocket', 'polling'],
});

app.use(cors());
app.use(express.json());

if (isProduction) {
  app.use(express.static(path.join(__dirname, '../client/build')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/build', 'index.html'));
  });
}

const PORT = process.env.PORT || 5000;

let waitingUsers = [];
const activePairs = new Map();

io.on('connection', (socket) => {
  console.log('New user connected:', socket.id);

  socket.on('start-chat', () => {
    if (waitingUsers.length > 0) {
      const partnerId = waitingUsers.shift();
      const partnerSocket = io.sockets.sockets.get(partnerId);

      activePairs.set(socket.id, partnerId);
      activePairs.set(partnerId, socket.id);

      socket.emit('chat-started', { partnerId });
      partnerSocket.emit('chat-started', { partnerId: socket.id });

      console.log(`Paired: ${socket.id} ↔ ${partnerId}`);
    } else {
      waitingUsers.push(socket.id);
      socket.emit('waiting');
      console.log(`Waiting: ${socket.id}`);
    }
  });

  socket.on('typing', () => {
    const partnerId = activePairs.get(socket.id);
    if (partnerId) io.sockets.sockets.get(partnerId)?.emit('partner-typing');
  });

  socket.on('send-message', (data) => {
    const partnerId = activePairs.get(socket.id);
    if (!partnerId) return;

    const partnerSocket = io.sockets.sockets.get(partnerId);
    if (!partnerSocket) return;

    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // Unwrap nested objects (safety)
    let payload = data;
    while (payload && typeof payload.message === 'object' && payload.message !== null) {
      payload = payload.message;
    }

    const isVoice = payload.isVoice === true;
    const msgId   = payload.msgId || null;  // same key App.js uses

    if (isVoice) {
      partnerSocket.emit('receive-message', {
        audioData: payload.audioData,
        isVoice: true,
        duration: payload.duration,
        senderId: socket.id,
        msgId,
        timestamp,
      });
    } else {
      const messageText = typeof payload.message === 'string'
        ? payload.message
        : typeof payload === 'string'
          ? payload
          : String(payload.message || '');

      partnerSocket.emit('receive-message', {
        message: messageText,
        isVoice: false,
        senderId: socket.id,
        msgId,
        timestamp,
      });
    }

    // ✓✓ grey — message reached partner's socket = delivered
    if (msgId) socket.emit('message-delivered', { msgId });
  });

  /* ── Read receipts ──
     delivered: emitted above immediately after forwarding  → ✓✓ grey
     seen:      partner emits when they receive the message → ✓✓ blue  */
  socket.on('message-seen', ({ msgId }) => {
    if (!msgId) return;
    const partnerId = activePairs.get(socket.id);
    if (partnerId) {
      io.sockets.sockets.get(partnerId)?.emit('message-seen', { msgId });
    }
  });

  socket.on('end-chat', () => {
    const partnerId = activePairs.get(socket.id);
    if (partnerId) {
      activePairs.delete(socket.id);
      activePairs.delete(partnerId);
      io.sockets.sockets.get(partnerId)?.emit('chat-ended');
    }
    waitingUsers = waitingUsers.filter(id => id !== socket.id);
  });

  socket.on('disconnect', () => {
    const partnerId = activePairs.get(socket.id);
    if (partnerId) {
      activePairs.delete(socket.id);
      activePairs.delete(partnerId);
      io.sockets.sockets.get(partnerId)?.emit('chat-ended');
    }
    waitingUsers = waitingUsers.filter(id => id !== socket.id);
    console.log('User disconnected:', socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT} [${isProduction ? 'production' : 'development'}]`);
});