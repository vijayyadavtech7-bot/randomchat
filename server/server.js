const express  = require('express');
const http     = require('http');
const socketIo = require('socket.io');
const cors     = require('cors');
const path     = require('path');

const app    = express();
const server = http.createServer(app);

const isProduction = process.env.NODE_ENV === 'production';

const io = socketIo(server, {
  cors: {
    origin: isProduction ? process.env.CLIENT_URL || '*' : 'http://localhost:3000',
    methods: ['GET', 'POST'],
  },
  transports: ['websocket', 'polling'],
  // Detect dead connections faster
  pingTimeout:  20000,
  pingInterval: 10000,
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

// Set instead of array: O(1) add/delete/has, no duplicate risk
const waitingUsers = new Set();
const activePairs  = new Map();

// Grace period timers: if socket disconnects briefly, heal silently
const disconnectTimers = new Map();
const DISCONNECT_GRACE_MS = 3000;

// Rate limit: track last start-chat time per socket
const lastStartChat = new Map();
const START_CHAT_COOLDOWN_MS = 1000;

/* ── helpers ── */

const removeFromQueue = (socketId) => waitingUsers.delete(socketId);

const getPairPartner = (socketId) => {
  const partnerId = activePairs.get(socketId);
  if (!partnerId) return null;
  return { id: partnerId, socket: io.sockets.sockets.get(partnerId) || null };
};

const cleanupPair = (socketId, notifyPartner = true) => {
  const partnerId = activePairs.get(socketId);
  if (!partnerId) return;
  activePairs.delete(socketId);
  activePairs.delete(partnerId);
  if (notifyPartner) {
    io.sockets.sockets.get(partnerId)?.emit('chat-ended');
  }
  console.log(`Pair cleaned: ${socketId} ↔ ${partnerId}`);
};

// Dequeue next valid (still-connected) socket
const dequeueValidPartner = () => {
  for (const candidateId of waitingUsers) {
    waitingUsers.delete(candidateId);
    if (io.sockets.sockets.get(candidateId)) {
      return candidateId;
    }
    console.log(`Skipped stale socket: ${candidateId}`);
  }
  return null;
};

/* ── socket events ── */
io.on('connection', (socket) => {
  console.log(`Connected: ${socket.id}`);

  // Cancel any pending grace-period disconnect for this socket
  if (disconnectTimers.has(socket.id)) {
    clearTimeout(disconnectTimers.get(socket.id));
    disconnectTimers.delete(socket.id);
    console.log(`Reconnected within grace period: ${socket.id}`);
  }

  socket.on('start-chat', () => {
    // Rate limit: ignore if called too fast
    const now = Date.now();
    const last = lastStartChat.get(socket.id) || 0;
    if (now - last < START_CHAT_COOLDOWN_MS) {
      console.log(`Rate limited start-chat: ${socket.id}`);
      return;
    }
    lastStartChat.set(socket.id, now);

    // If already paired, end existing chat cleanly first
    if (activePairs.has(socket.id)) {
      console.log(`${socket.id} re-queued while paired — ending old chat`);
      cleanupPair(socket.id, true);
    }

    // Remove from queue if already waiting (prevent double-queue)
    removeFromQueue(socket.id);

    const partnerId = dequeueValidPartner();

    if (partnerId) {
      const partnerSocket = io.sockets.sockets.get(partnerId);
      activePairs.set(socket.id, partnerId);
      activePairs.set(partnerId, socket.id);
      socket.emit('chat-started');
      partnerSocket.emit('chat-started');
      console.log(`Paired: ${socket.id} ↔ ${partnerId}`);
    } else {
      waitingUsers.add(socket.id);
      socket.emit('waiting');
      console.log(`Waiting: ${socket.id} (queue: ${waitingUsers.size})`);
    }
  });

  socket.on('typing', () => {
    const partner = getPairPartner(socket.id);
    partner?.socket?.emit('partner-typing');
  });

  socket.on('send-message', (data) => {
    const partner = getPairPartner(socket.id);
    if (!partner?.socket) return;

    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    let payload = data;
    while (payload && typeof payload.message === 'object' && payload.message !== null) {
      payload = payload.message;
    }

    const isVoice = payload.isVoice === true;
    const msgId   = payload.msgId || null;

    if (isVoice) {
      partner.socket.emit('receive-message', {
        audioData: payload.audioData,
        isVoice: true,
        duration: payload.duration,
        msgId,
        timestamp,
      });
    } else {
      const messageText = typeof payload.message === 'string'
        ? payload.message
        : typeof payload === 'string'
          ? payload
          : String(payload.message || '');

      partner.socket.emit('receive-message', {
        message: messageText,
        isVoice: false,
        msgId,
        timestamp,
      });
    }

    if (msgId) socket.emit('message-delivered', { msgId });
  });

  socket.on('message-seen', ({ msgId }) => {
    if (!msgId) return;
    const partner = getPairPartner(socket.id);
    partner?.socket?.emit('message-seen', { msgId });
  });

  socket.on('end-chat', () => {
    // Intentional end — notify partner immediately, no grace period
    cleanupPair(socket.id, true);
    removeFromQueue(socket.id);
    console.log(`End-chat: ${socket.id}`);
  });

  socket.on('disconnect', (reason) => {
    console.log(`Disconnecting: ${socket.id} (${reason})`);

    const partnerId = activePairs.get(socket.id);

    if (partnerId) {
      // Unexpected disconnect — give grace period before ending chat.
      // Notify partner connection is unstable during that time.
      io.sockets.sockets.get(partnerId)?.emit('partner-reconnecting');

      const timer = setTimeout(() => {
        disconnectTimers.delete(socket.id);
        if (!io.sockets.sockets.get(socket.id)) {
          cleanupPair(socket.id, true);
          removeFromQueue(socket.id);
          lastStartChat.delete(socket.id);
          console.log(`Grace period expired, chat ended: ${socket.id}`);
        }
      }, DISCONNECT_GRACE_MS);

      disconnectTimers.set(socket.id, timer);
    } else {
      removeFromQueue(socket.id);
      lastStartChat.delete(socket.id);
    }

    console.log(`Queue size: ${waitingUsers.size}`);
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT} [${isProduction ? 'production' : 'development'}]`);
});