const express   = require('express');
const http      = require('http');
const socketIo  = require('socket.io');
const cors      = require('cors');
const path      = require('path');

const app    = express();
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

/* ── helpers ── */

// Remove a socket from the waiting queue (deduplicated)
const removeFromQueue = (socketId) => {
  waitingUsers = waitingUsers.filter(id => id !== socketId);
};

// Clean up an active pair, optionally notifying the partner
const cleanupPair = (socketId, notifyPartner = true) => {
  const partnerId = activePairs.get(socketId);
  if (!partnerId) return;

  activePairs.delete(socketId);
  activePairs.delete(partnerId);

  if (notifyPartner) {
    io.sockets.sockets.get(partnerId)?.emit('chat-ended');
  }
};

// Find next valid (still-connected) partner from the waiting queue
const dequeueValidPartner = () => {
  while (waitingUsers.length > 0) {
    const candidateId = waitingUsers.shift();
    if (io.sockets.sockets.get(candidateId)) {
      return candidateId; // still connected
    }
    // else: stale socket, skip and try next
    console.log(`Skipped stale socket in queue: ${candidateId}`);
  }
  return null;
};

/* ── socket events ── */
io.on('connection', (socket) => {
  console.log('New user connected:', socket.id);

  socket.on('start-chat', () => {
    // If already paired, cleanly end the existing chat first
    if (activePairs.has(socket.id)) {
      console.log(`${socket.id} called start-chat while paired — cleaning up old pair`);
      cleanupPair(socket.id, true);
    }

    // Remove from queue if already waiting (prevent duplicates)
    removeFromQueue(socket.id);

    const partnerId = dequeueValidPartner();

    if (partnerId) {
      const partnerSocket = io.sockets.sockets.get(partnerId);

      activePairs.set(socket.id, partnerId);
      activePairs.set(partnerId, socket.id);

      socket.emit('chat-started', { partnerId });
      partnerSocket.emit('chat-started', { partnerId: socket.id });

      console.log(`Paired: ${socket.id} ↔ ${partnerId}`);
    } else {
      waitingUsers.push(socket.id);
      socket.emit('waiting');
      console.log(`Waiting: ${socket.id} (queue length: ${waitingUsers.length})`);
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
    const msgId   = payload.msgId || null;

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

    // ✓ grey — message delivered to partner's socket
    if (msgId) socket.emit('message-delivered', { msgId });
  });

  socket.on('message-seen', ({ msgId }) => {
    if (!msgId) return;
    const partnerId = activePairs.get(socket.id);
    if (partnerId) {
      io.sockets.sockets.get(partnerId)?.emit('message-seen', { msgId });
    }
  });

  socket.on('end-chat', () => {
    cleanupPair(socket.id, true);
    removeFromQueue(socket.id);
    console.log(`${socket.id} ended chat`);
  });

  socket.on('disconnect', () => {
    cleanupPair(socket.id, true);
    removeFromQueue(socket.id);
    console.log(`Disconnected: ${socket.id} (queue length: ${waitingUsers.length})`);
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT} [${isProduction ? 'production' : 'development'}]`);
});