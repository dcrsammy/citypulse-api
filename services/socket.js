const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { db: firebase } = require('./firebase');
let io = null;
const userSockets = new Map(); // userId -> Set of socket ids
const activeFirebaseListeners = new Map(); // firebasePath -> listener ref
const lastKnownValues = new Map(); // firebasePath -> most recent snapshot value
function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: [
        'https://citypulse-vendor.netlify.app',
        'https://vendor.city-pulse.live',
        'https://city-pulse.live',
        'https://www.city-pulse.live',
        'http://localhost:3000',
        'http://localhost:5173',
        'http://localhost:8081',
      ],
      credentials: true,
    },
  });
  // Auth middleware: verify JWT on connection
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('No token provided'));
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.id;
      socket.userRole = decoded.role;
      next();
    } catch (err) {
      next(new Error('Invalid token'));
    }
  });
  io.on('connection', (socket) => {
    const userId = socket.userId;
    console.log('Socket connected:', userId, socket.id);
    if (!userSockets.has(userId)) userSockets.set(userId, new Set());
    userSockets.get(userId).add(socket.id);
    // Client subscribes to a specific Firebase path it's authorized for
    socket.on('subscribe', (payload) => {
      const { path } = payload || {};
      if (!path) return;
      if (!isAuthorizedForPath(userId, socket.userRole, path)) {
        socket.emit('error', { message: 'Not authorized for this path' });
        return;
      }
      subscribeToFirebasePath(path);
      socket.join(path); // socket.io room = firebase path
      // Replay the latest known value directly to this socket, in case the
      // shared Firebase listener was already running before this socket joined
      // (Firebase only re-fires 'value' on attach for the FIRST listener on a path).
      if (lastKnownValues.has(path)) {
        socket.emit('update', { path, value: lastKnownValues.get(path) });
      }
    });
    socket.on('unsubscribe', (payload) => {
      const { path } = payload || {};
      if (path) socket.leave(path);
    });
    socket.on('disconnect', () => {
      const set = userSockets.get(userId);
      if (set) {
        set.delete(socket.id);
        if (set.size === 0) userSockets.delete(userId);
      }
      console.log('Socket disconnected:', userId, socket.id);
    });
  });
  return io;
}
// Authorization check: does this user have the right to subscribe to this Firebase path?
function isAuthorizedForPath(userId, role, path) {
  // chats/{chatId}/... -> userId must be part of the chatId (social_ or system_ format includes both ids)
  if (path.startsWith('chats/')) {
    return path.includes(userId);
  }
  // vendor_live/{vendorId}/... -> userId must equal vendorId (vendor role)
  if (path.startsWith('vendor_live/')) {
    const parts = path.split('/');
    return parts[1] === userId;
  }
  // users/{userId}/chats -> must be own user id
  if (path.startsWith('users/')) {
    const parts = path.split('/');
    return parts[1] === userId;
  }
  return false;
}
// Set up a single shared Firebase listener per path, relay to all subscribed sockets via room
function subscribeToFirebasePath(path) {
  if (activeFirebaseListeners.has(path)) return; // already listening
  const dbRef = firebase.ref(path);
  const listener = dbRef.on('value', (snapshot) => {
    lastKnownValues.set(path, snapshot.val());
    io.to(path).emit('update', { path, value: snapshot.val() });
  });
  activeFirebaseListeners.set(path, { ref: dbRef, listener });
}
module.exports = { initSocket };
