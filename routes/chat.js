const router = require('express').Router();
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
cloudinary.config({ cloud_name: process.env.CLOUDINARY_CLOUD_NAME, api_key: process.env.CLOUDINARY_API_KEY, api_secret: process.env.CLOUDINARY_API_SECRET });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const axios = require('axios');

async function sendPushNotification(toToken, title, body, data = {}) {
  if (!toToken || !toToken.startsWith('ExponentPushToken')) return;
  try {
    await axios.post('https://exp.host/--/api/v2/push/send', {
      to: toToken,
      title,
      body,
      data,
      sound: 'default',
      badge: 1,
    }, { headers: { 'Content-Type': 'application/json' } });
  } catch (e) { console.log('Push error:', e.message); }
}
const db = require('../db');
const auth = require('../middleware/auth');
const { db: firebase } = require('../services/firebase');


// ── FRIENDS ──────────────────────────────────────────────

// GET /api/chat/users/search?q=username
router.get('/users/search', auth, async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 2) return res.json({ users: [] });
    const result = await db.query(
      `SELECT id, full_name, username, citypulse_id, avatar_url, neighbourhood
       FROM users
       WHERE (username ILIKE $1 OR citypulse_id ILIKE $1 OR full_name ILIKE $1)
       AND id != $2
       AND is_active = true
       LIMIT 10`,
      [`%${q}%`, req.user.id]
    );
    res.json({ users: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/chat/friends/request
router.post('/friends/request', auth, async (req, res) => {
  try {
    const { addressee_id } = req.body;
    const existing = await db.query(
      `SELECT * FROM friendships WHERE (requester_id=$1 AND addressee_id=$2) OR (requester_id=$2 AND addressee_id=$1)`,
      [req.user.id, addressee_id]
    );
    if (existing.rows[0]) return res.status(400).json({ error: 'Friend request already exists.' });
    const result = await db.query(
      `INSERT INTO friendships (requester_id, addressee_id, status) VALUES ($1,$2,'pending') RETURNING *`,
      [req.user.id, addressee_id]
    );
    // Notify the addressee
    await db.query(
      `INSERT INTO user_notifications (user_id, type, title, body, data)
       VALUES ($1, 'friend_request', 'New Friend Request', $2, $3)`,
      [addressee_id, `${req.user.full_name || 'Someone'} wants to be your friend`, JSON.stringify({ friendship_id: result.rows[0].id, requester_id: req.user.id })]
    );
    try { const adr = await db.query("SELECT fcm_token FROM users WHERE id=$1", [addressee_id]); if (adr.rows[0] && adr.rows[0].fcm_token) await sendPushNotification(adr.rows[0].fcm_token, "New Friend Request", (req.user.full_name || "Someone") + " wants to be your friend", { type: "friend_request" }); } catch(pe) { console.log("friend push err:", pe.message); }
    res.json({ friendship: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/chat/friends/:id/accept
router.patch('/friends/:id/accept', auth, async (req, res) => {
  try {
    const result = await db.query(
      `UPDATE friendships SET status='accepted', updated_at=NOW()
       WHERE id=$1 AND addressee_id=$2 RETURNING *`,
      [req.params.id, req.user.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Request not found.' });
    res.json({ friendship: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/chat/friends/:id/decline
router.patch('/friends/:id/decline', auth, async (req, res) => {
  try {
    await db.query(
      `UPDATE friendships SET status='declined', updated_at=NOW() WHERE id=$1 AND addressee_id=$2`,
      [req.params.id, req.user.id]
    );
    res.json({ message: 'Request declined.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/chat/friends/:id
router.delete('/friends/:id', auth, async (req, res) => {
  try {
    await db.query(
      `DELETE FROM friendships WHERE id=$1 AND (requester_id=$2 OR addressee_id=$2)`,
      [req.params.id, req.user.id]
    );
    res.json({ message: 'Friend removed.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/chat/friends — get all accepted friends
router.get('/friends', auth, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT f.id as friendship_id, f.status, f.created_at,
        CASE WHEN f.requester_id=$1 THEN u2.id ELSE u1.id END as friend_id,
        CASE WHEN f.requester_id=$1 THEN u2.full_name ELSE u1.full_name END as full_name,
        CASE WHEN f.requester_id=$1 THEN u2.username ELSE u1.username END as username,
        CASE WHEN f.requester_id=$1 THEN u2.avatar_url ELSE u1.avatar_url END as avatar_url,
        CASE WHEN f.requester_id=$1 THEN u2.citypulse_id ELSE u1.citypulse_id END as citypulse_id
       FROM friendships f
       JOIN users u1 ON f.requester_id = u1.id
       JOIN users u2 ON f.addressee_id = u2.id
       WHERE (f.requester_id=$1 OR f.addressee_id=$1) AND f.status='accepted'
       ORDER BY f.updated_at DESC`,
      [req.user.id]
    );
    res.json({ friends: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/chat/friends/requests — pending requests
router.get('/friends/requests', auth, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT f.id as friendship_id, f.created_at,
        u.id as requester_id, u.full_name, u.username, u.avatar_url, u.citypulse_id
       FROM friendships f
       JOIN users u ON f.requester_id = u.id
       WHERE f.addressee_id=$1 AND f.status='pending'
       ORDER BY f.created_at DESC`,
      [req.user.id]
    );
    res.json({ requests: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── SOCIAL CHAT ──────────────────────────────────────────

// GET /api/chat/social/:friend_id — get or create chat with friend
router.get('/social/:friend_id', auth, async (req, res) => {
  try {
    const { friend_id } = req.params;
    const ids = [req.user.id, friend_id].sort();
    const chatId = `social_${ids[0]}_${ids[1]}`;

    // Get last messages from Firebase
    const chatRef = firebase.ref(`chats/${chatId}/messages`);
    const snapshot = await chatRef.orderByChild('timestamp').limitToLast(50).once('value');
    const messages = [];
    snapshot.forEach(child => {
      const msg = child.val();
      // Filter out expired messages (12hrs)
      if (!msg.is_saved && msg.expires_at && msg.expires_at < Date.now()) return;
      messages.push({ id: child.key, ...msg });
    });

    res.json({ chat_id: chatId, messages: messages.reverse() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/chat/social/:friend_id/send — send message
router.post('/social/:friend_id/send', auth, async (req, res) => {
  try {
    const { friend_id } = req.params;
    const { text, type = 'text', card_data } = req.body;
    const ids = [req.user.id, friend_id].sort();
    const chatId = `social_${ids[0]}_${ids[1]}`;

    const expires_at = Date.now() + (12 * 60 * 60 * 1000); // 12 hours

    const message = {
      text: text || null,
      type,
      card_data: card_data || null,
      sender_id: req.user.id,
      timestamp: Date.now(),
      expires_at,
      is_saved: false,
      is_read: false,
    };

    const msgRef = await firebase.ref(`chats/${chatId}/messages`).push(message);

    // Send push notification to friend
    try {
      const friendData = await db.query('SELECT fcm_token, full_name FROM users WHERE id=$1', [friend_id]);
      const friend = friendData.rows[0];
      if (friend?.fcm_token) {
        const senderData = await db.query('SELECT full_name FROM users WHERE id=$1', [req.user.id]);
        const senderName = senderData.rows[0]?.full_name || 'Someone';
        await sendPushNotification(friend.fcm_token, senderName, text || 'Shared something with you', { type: 'chat', chat_id: chatId, sender_id: req.user.id });
      }
    } catch (e) { console.log('Push notification error:', e.message); }

    // Update last message
    await firebase.ref(`chats/${chatId}/metadata`).update({
      last_message: text || `Shared a ${type}`,
      last_sender: req.user.id,
      updated_at: Date.now(),
      participants: { [req.user.id]: true, [friend_id]: true }
    });

    // Update user chat lists
    await firebase.ref(`users/${req.user.id}/chats/${chatId}`).set(Date.now());
    await firebase.ref(`users/${friend_id}/chats/${chatId}`).set(Date.now());

    res.json({ message_id: msgRef.key, chat_id: chatId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/chat/social/message/:chat_id/:message_id/save — save a message
router.patch('/social/message/:chat_id/:message_id/save', auth, async (req, res) => {
  try {
    await firebase.ref(`chats/${req.params.chat_id}/messages/${req.params.message_id}`).update({
      is_saved: true,
      expires_at: null
    });
    res.json({ message: 'Message saved!' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/chat/conversations — get all user conversations
router.get('/conversations', auth, async (req, res) => {
  try {
    const snapshot = await firebase.ref(`users/${req.user.id}/chats`).once('value');
    const chatIds = [];
    snapshot.forEach(child => chatIds.push({ chat_id: child.key, updated_at: child.val() }));
    chatIds.sort((a, b) => b.updated_at - a.updated_at);

    const conversations = [];
    for (const { chat_id } of chatIds.slice(0, 20)) {
      const metaSnap = await firebase.ref(`chats/${chat_id}/metadata`).once('value');
      const meta = metaSnap.val();
      if (meta) conversations.push({ chat_id, ...meta });
    }

    res.json({ conversations });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── CONTEXTUAL CHAT ──────────────────────────────────────

// POST /api/chat/contextual — create contextual chat
router.post('/contextual', auth, async (req, res) => {
  try {
    const { type, context_id, participant_2, expires_hours = 24 } = req.body;
    const firebase_chat_id = `${type}_${context_id}`;
    const expires_at = new Date(Date.now() + expires_hours * 60 * 60 * 1000);

    const existing = await db.query(
      `SELECT * FROM contextual_chats WHERE firebase_chat_id=$1`,
      [firebase_chat_id]
    );
    if (existing.rows[0]) return res.json({ chat: existing.rows[0] });

    const result = await db.query(
      `INSERT INTO contextual_chats (type, context_id, participant_1, participant_2, firebase_chat_id, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [type, context_id, req.user.id, participant_2 || null, firebase_chat_id, expires_at]
    );

    // Initialize in Firebase
    await firebase.ref(`contextual/${firebase_chat_id}/metadata`).set({
      type, context_id,
      participant_1: req.user.id,
      participant_2: participant_2 || null,
      expires_at: expires_at.getTime(),
      created_at: Date.now()
    });

    res.json({ chat: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/chat/contextual/:firebase_chat_id — get contextual chat messages
router.get('/contextual/:firebase_chat_id', auth, async (req, res) => {
  try {
    const snapshot = await firebase.ref(`contextual/${req.params.firebase_chat_id}/messages`)
      .orderByChild('timestamp').limitToLast(100).once('value');
    const messages = [];
    snapshot.forEach(child => messages.push({ id: child.key, ...child.val() }));
    res.json({ messages: messages.reverse() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/chat/contextual/:firebase_chat_id/send
router.post('/contextual/:firebase_chat_id/send', auth, async (req, res) => {
  try {
    const { text, type = 'text' } = req.body;
    const message = {
      text, type,
      sender_id: req.user.id,
      timestamp: Date.now(),
    };
    const msgRef = await firebase.ref(`contextual/${req.params.firebase_chat_id}/messages`).push(message);
    await firebase.ref(`contextual/${req.params.firebase_chat_id}/metadata`).update({
      last_message: text,
      last_sender: req.user.id,
      updated_at: Date.now()
    });
    res.json({ message_id: msgRef.key });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PRESENCE & NOTIFICATIONS ─────────────────────────────

// PATCH /api/chat/presence — update online status
router.patch('/presence', auth, async (req, res) => {
  try {
    const { status } = req.body; // online, offline, away
    await firebase.ref(`presence/${req.user.id}`).set({
      status,
      last_seen: Date.now()
    });
    res.json({ message: 'Presence updated.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/chat/notifications — get unread notifications
router.get('/notifications', auth, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT * FROM user_notifications WHERE user_id=$1 AND is_read=false ORDER BY created_at DESC LIMIT 20`,
      [req.user.id]
    );
    res.json({ notifications: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/chat/notifications/read — mark all as read
router.patch('/notifications/read', auth, async (req, res) => {
  try {
    await db.query(`UPDATE user_notifications SET is_read=true WHERE user_id=$1`, [req.user.id]);
    res.json({ message: 'All notifications marked as read.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/chat/upload-image
router.post('/upload-image', require('../middleware/auth'), upload.single('file'), async (req, res) => {
  try {
    // Convert to base64 data URL for simple storage
    const base64 = req.file.buffer.toString('base64');
    const mimeType = req.file.mimetype;
    const dataUrl = 'data:' + mimeType + ';base64,' + base64;
    res.json({ url: dataUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
