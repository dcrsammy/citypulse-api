const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const router = express.Router();
const auth = require('../middleware/auth');

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
    // Single device: store active token, invalidate previous
    const deviceInfo = req.headers['user-agent']?.slice(0,100) || 'unknown';
    const prevToken = await db.query('SELECT active_token, email, full_name FROM users WHERE id=$1', [user.id]);
    const hadPrevSession = prevToken.rows[0]?.active_token && prevToken.rows[0].active_token !== token;
    
    await db.query(
      'UPDATE users SET active_token=$1, last_login_at=NOW(), last_login_device=$2 WHERE id=$3',
      [token, deviceInfo, user.id]
    );

    // Send alert email if another session was active
    if (hadPrevSession) {
      try {
        const { Resend } = require('resend');
        const resend = new Resend(process.env.RESEND_API_KEY);
        await resend.emails.send({
          from: 'CityPulse <security@city-pulse.live>',
          to: user.email,
          subject: '⚠️ New Login to Your CityPulse Account',
          html: `<h2>New Login Detected</h2>
            <p>Hi ${user.full_name},</p>
            <p>Your CityPulse account was just logged into from a new device.</p>
            <p><strong>Time:</strong> ${new Date().toLocaleString('en-NG')}</p>
            <p>If this was you, ignore this email. If not, please contact us immediately at support@city-pulse.live</p>
          `
        });
      } catch(e) { console.log('Login alert email failed:', e.message); }
    }
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

// POST /api/auth/send-verification
router.post('/send-verification', require('../middleware/auth'), async (req, res) => {
  try {
    const userId = req.user.id;
    const code = Math.random().toString().slice(2, 8);
    const expires = new Date(Date.now() + 10 * 60000);
    await db.query('UPDATE users SET verification_code=$1, verification_expires=$2 WHERE id=$3', [code, expires, userId]);
    const user = await db.query('SELECT email FROM users WHERE id=$1', [userId]);
    const { sendEmail, templates } = require('../services/email');
    await sendEmail(user.rows[0].email, 'Verify your CityPulse email', templates.verification(user.rows[0].email, code));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/verify-email
router.post('/verify-email', require('../middleware/auth'), async (req, res) => {
  try {
    const { code } = req.body;
    const userId = req.user.id;
    const user = await db.query('SELECT * FROM users WHERE id=$1', [userId]);
    const userData = user.rows[0];
    if (!userData.verification_code || userData.verification_code !== code) {
      return res.status(400).json({ error: 'Invalid code.' });
    }
    if (new Date() > userData.verification_expires) {
      return res.status(400).json({ error: 'Code expired.' });
    }
    await db.query('UPDATE users SET email_verified=true, verification_code=NULL WHERE id=$1', [userId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/vendor/register
router.post('/vendor/register', async (req, res) => {
  try {
    const { business_name, email, phone, password, owner_full_name, cac_number, business_address, owner_bvn, business_types = ['restaurant'] } = req.body;
    if (!business_name || !email || !password)
      return res.status(400).json({ error: 'Business name, email and password are required.' });
    const exists = await db.query('SELECT id FROM vendors WHERE email=$1', [email.trim().toLowerCase()]);
    if (exists.rows[0]) return res.status(409).json({ error: 'Email already registered.' });

    // Try to geocode the address
    let latitude = null;
    let longitude = null;
    let address_verified = false;
    let kyc_status = 'pending';

    if (business_address) {
      try {
        const geoQuery = encodeURIComponent(business_address + ', Lagos, Nigeria');
        const geoRes = await fetch(`https://nominatim.openstreetmap.org/search?q=${geoQuery}&format=json&limit=1`, {
          headers: { 'User-Agent': 'CityPulse/1.0' }
        });
        const geoData = await geoRes.json();
        if (geoData && geoData[0]) {
          latitude = parseFloat(geoData[0].lat);
          longitude = parseFloat(geoData[0].lon);
          address_verified = true;
        }
      } catch (geoErr) {
        console.error('Geocoding error:', geoErr.message);
      }
    }

    const password_hash = await bcrypt.hash(password, 12);
    const result = await db.query(
      `INSERT INTO vendors (business_name, email, phone, password_hash, is_verified, business_types, is_property_host, is_event_organizer)
       VALUES ($1,$2,$3,$4,false,$5,$6,$7) RETURNING *`,
      [business_name.trim(), email.trim().toLowerCase(), phone || null, password_hash, business_types, business_types.includes('property'), business_types.includes('events')]
    );
    const vendor = result.rows[0];
    // Insert KYC data into vendor_kyc table
    await db.query(
      `INSERT INTO vendor_kyc (vendor_id, cac_number, owner_full_name, owner_bvn, business_address, kyc_status, kyc_submitted_at, latitude, longitude, address_verified)
       VALUES ($1,$2,$3,$4,$5,$6,NOW(),$7,$8,$9)`,
      [vendor.id, cac_number || null, owner_full_name || null, owner_bvn || null, business_address || null, kyc_status, latitude, longitude, address_verified]
    );
    const token = jwt.sign({ id: vendor.id, role: 'vendor' }, process.env.JWT_SECRET, { expiresIn: '30d' });
    const { password_hash: _, ...safe } = vendor;
    res.status(201).json({ 
      token, 
      vendor: safe,
      address_verified,
      message: address_verified 
        ? 'Registration successful! Your address was verified.' 
        : 'Registration successful! Your address could not be verified automatically and will be reviewed by our team.'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/vendor/login
router.post('/vendor/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const result = await db.query('SELECT * FROM vendors WHERE email=$1', [email.trim().toLowerCase()]);
    const vendor = result.rows[0];
    if (!vendor) return res.status(401).json({ error: 'Invalid credentials.' });
    const match = await bcrypt.compare(password, vendor.password_hash);
    if (!match) return res.status(401).json({ error: 'Invalid credentials.' });
    const token = jwt.sign({ id: vendor.id, role: 'vendor' }, process.env.JWT_SECRET, { expiresIn: '30d' });
    const { password_hash: _, ...safe } = vendor;
    res.json({ token, vendor: safe });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/auth/profile — combined update
router.patch('/profile', auth, async (req, res) => {
  try {
    const { full_name, phone, username, bio } = req.body;
    if (username) {
      const existing = await db.query('SELECT id FROM users WHERE username=$1 AND id!=$2', [username, req.user.id]);
      if (existing.rows[0]) return res.status(400).json({ error: 'Username already taken.' });
    }
    const result = await db.query(
      `UPDATE users SET
        full_name = COALESCE($1, full_name),
        phone = COALESCE($2, phone),
        username = COALESCE($3, username),
        bio = COALESCE($4, bio),
        updated_at = NOW()
       WHERE id=$5
       RETURNING id, full_name, email, phone, username, bio, citypulse_id, avatar_url, wallet_balance, cpp_points, cpp_tier, neighbourhood, city`,
      [full_name || null, phone || null, username || null, bio || null, req.user.id]
    );
    res.json({ user: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/auth/me
router.get('/me', require('../middleware/auth'), async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM users WHERE id=$1', [req.user.id]);
    const { password_hash: _, ...safe } = result.rows[0];
    res.json(safe);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/auth/addresses
router.get('/addresses', auth, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM user_addresses WHERE user_id=$1 ORDER BY is_default DESC, created_at DESC',
      [req.user.id]
    );
    res.json({ addresses: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/auth/addresses
router.post('/addresses', auth, async (req, res) => {
  try {
    const { label, address, lat, lng, is_default } = req.body;
    if (!address) return res.status(400).json({ error: 'Address is required.' });
    if (is_default) {
      await db.query('UPDATE user_addresses SET is_default=false WHERE user_id=$1', [req.user.id]);
    }
    const result = await db.query(
      'INSERT INTO user_addresses (user_id, label, address, lat, lng, is_default) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [req.user.id, label || 'home', address, lat || null, lng || null, is_default || false]
    );
    res.json({ address: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/auth/addresses/:id
router.delete('/addresses/:id', auth, async (req, res) => {
  try {
    await db.query('DELETE FROM user_addresses WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    res.json({ message: 'Address deleted.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;




// POST /api/waitlist
router.post('/waitlist', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required.' });
    await db.query(
      'INSERT INTO waitlist (email) VALUES ($1) ON CONFLICT (email) DO NOTHING',
      [email.toLowerCase().trim()]
    );
    res.json({ message: 'Added to waitlist!' });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// GET /api/waitlist/count
router.get('/waitlist/count', async (req, res) => {
  try {
    const result = await db.query('SELECT COUNT(*) as count FROM waitlist');
    res.json({ count: result.rows[0].count });
  } catch(err) { res.status(500).json({ error: err.message }); }
});
