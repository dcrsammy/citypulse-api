const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const router = express.Router();
const auth = require('../middleware/auth');

// POST /api/auth/pre-register - send OTP without creating account
router.post('/pre-register', async (req, res) => {
  try {
    const { full_name, email, phone, password } = req.body;
    if (full_name.trim().length === 0 || email.trim().length === 0 || phone.trim().length === 0 || password.trim().length === 0)
      return res.status(400).json({ error: 'All fields are required.' });
    if (password.length < 8)
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    const exists = await db.query('SELECT id FROM users WHERE email=$1', [email.trim().toLowerCase()]);
    if (exists.rows[0]) return res.status(409).json({ error: 'Email already registered.' });
    const code = Math.random().toString().slice(2, 8);
    const expires = new Date(Date.now() + 10 * 60000);
    await db.query(`
      INSERT INTO pending_registrations (email, full_name, phone, password, code, expires_at)
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (email) DO UPDATE SET full_name=$2, phone=$3, password=$4, code=$5, expires_at=$6
    `, [email.trim().toLowerCase(), full_name, phone, password, code, expires]);
    const { sendEmail, templates } = require('../services/email');
    await sendEmail(email, 'Verify your CityPulse email', templates.verification(email, code));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/verify-and-create - verify OTP then create account
router.post('/verify-and-create', async (req, res) => {
  try {
    const { email, code } = req.body;
    const result = await db.query('SELECT * FROM pending_registrations WHERE email=$1', [email.trim().toLowerCase()]);
    const pending = result.rows[0];
    if (!pending) return res.status(400).json({ error: 'No pending registration found.' });
    if (pending.code !== code) return res.status(400).json({ error: 'Invalid code.' });
    if (new Date() > new Date(pending.expires_at)) return res.status(400).json({ error: 'Code expired. Please register again.' });
    const password_hash = await bcrypt.hash(pending.password, 12);
    const userResult = await db.query(
      'INSERT INTO users (full_name, email, phone, password_hash, email_verified) VALUES ($1,$2,$3,$4,true) RETURNING id, email, full_name, phone',
      [pending.full_name, pending.email, pending.phone, password_hash]
    );
    const user = userResult.rows[0];
    const token = jwt.sign({ id: user.id, role: 'consumer' }, process.env.JWT_SECRET, { expiresIn: '30d' });
    await db.query('UPDATE users SET active_token=$1, last_login_at=NOW() WHERE id=$2', [token, user.id]);
    await db.query('DELETE FROM pending_registrations WHERE email=$1', [pending.email]);
    res.status(201).json({ token, user: { ...user, email_verified: true } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { full_name, email, password, phone } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required.' });
    const exists = await db.query('SELECT id FROM users WHERE email=$1', [email.trim().toLowerCase()]);
    if (exists.rows[0]) return res.status(409).json({ error: 'Email already registered.' });
    const password_hash = await bcrypt.hash(password, 12);
    const result = await db.query(
      `INSERT INTO users (full_name, email, phone, password_hash, email_verified) VALUES ($1,$2,$3,$4,false) RETURNING id, email, full_name, phone`,
      [full_name || null, email.trim().toLowerCase(), phone || null, password_hash]
    );
    const user = result.rows[0];
    const token = jwt.sign({ id: user.id, role: 'consumer' }, process.env.JWT_SECRET, { expiresIn: '30d' });
    const deviceInfo = req.headers['user-agent']?.slice(0,100) || 'unknown';
    await db.query(
      'UPDATE users SET active_token=$1, last_login_at=NOW(), last_login_device=$2 WHERE id=$3',
      [token, deviceInfo, user.id]
    );
    res.status(201).json({ token, user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const result = await db.query('SELECT * FROM users WHERE email=$1', [email.trim().toLowerCase()]);
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: 'Invalid credentials.' });
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Invalid credentials.' });
    const token = jwt.sign({ id: user.id, role: 'consumer' }, process.env.JWT_SECRET, { expiresIn: '30d' });
    const deviceInfo = req.headers['user-agent']?.slice(0, 100) || 'unknown';
    await db.query(
      'UPDATE users SET active_token=$1, last_login_at=NOW(), last_login_device=$2 WHERE id=$3',
      [token, deviceInfo, user.id]
    );
    const { password_hash: _, ...safe } = user;
    res.json({ token, user: safe });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/google
router.post('/google', async (req, res) => {
  try {
    const { email, name, picture } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required.' });
    let result = await db.query('SELECT * FROM users WHERE email=$1', [email.toLowerCase()]);
    let user = result.rows[0];
    if (!user) {
      const newUser = await db.query(
        'INSERT INTO users (full_name, email, password_hash, email_verified, avatar_url) VALUES ($1,$2,$3,true,$4) RETURNING *',
        [name, email.toLowerCase(), 'GOOGLE_AUTH_' + Date.now(), picture || null]
      );
      user = newUser.rows[0];
    }
    const token = jwt.sign({ id: user.id, role: 'consumer' }, process.env.JWT_SECRET, { expiresIn: '30d' });
    await db.query('UPDATE users SET active_token=$1, last_login_at=NOW() WHERE id=$2', [token, user.id]);
    const { password_hash: _, ...safe } = user;
    res.json({ token, user: { ...safe, email_verified: true } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;