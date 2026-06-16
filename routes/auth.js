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
    // Store pending registration in DB temp table
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
    if (!pending) return res.status(400).json({ error: "No pending registration found." });
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
// POST /api/auth/forgot-password - send reset code
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required.' });
    const result = await db.query('SELECT id, full_name FROM users WHERE email=$1', [email.trim().toLowerCase()]);
    const user = result.rows[0];
    if (!user) return res.status(404).json({ error: 'No account found with that email.' });
    const code = Math.random().toString().slice(2, 8);
    const expires = new Date(Date.now() + 10 * 60000);
    await db.query('UPDATE users SET verification_code=$1, verification_expires=$2 WHERE id=$3', [code, expires, user.id]);
    const { sendEmail } = require('../services/email');
    await sendEmail(email, 'Reset your CityPulse password', `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#080810;">
        <div style="background:#080810;padding:32px;text-align:center;border-bottom:1px solid #222;">
          <h1 style="color:#FF3366;margin:0;font-size:28px;">CityPulse</h1>
        </div>
        <div style="padding:40px 32px;">
          <h2 style="color:#fff;font-size:22px;margin:0 0 8px;">Reset your password</h2>
          <p style="color:#A8A5A0;font-size:14px;margin:0 0 32px;">Hi ${user.full_name}, use this code to reset your password.</p>
          <div style="background:#0F0F1A;border:1px solid #FF3366;border-radius:16px;padding:32px;text-align:center;">
            <p style="color:#A8A5A0;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:2px;margin:0 0 12px;">Reset code</p>
            <p style="color:#FF3366;font-size:48px;font-weight:800;margin:0;letter-spacing:12px;">${code}</p>
            <p style="color:#5E5C5A;font-size:12px;margin:12px 0 0;">Expires in 10 minutes</p>
          </div>
        </div>
      </div>
    `);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/reset-password - verify code and set new password
router.post('/reset-password', async (req, res) => {
  try {
    const { email, code, password } = req.body;
    if (!email || !code || !password) return res.status(400).json({ error: 'All fields required.' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    const result = await db.query('SELECT * FROM users WHERE email=$1', [email.trim().toLowerCase()]);
    const user = result.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found.' });
    if (user.verification_code !== code) return res.status(400).json({ error: 'Invalid code.' });
    if (new Date() > new Date(user.verification_expires)) return res.status(400).json({ error: 'Code expired.' });
    const password_hash = await bcrypt.hash(password, 12);
    await db.query('UPDATE users SET password_hash=$1, verification_code=NULL, verification_expires=NULL WHERE id=$2', [password_hash, user.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
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
// POST /api/auth/google - Google Sign In
router.post('/google', async (req, res) => {
  try {
    const { idToken } = req.body;
    if (!idToken) return res.status(400).json({ error: 'ID token required.' });
    const { OAuth2Client } = require('google-auth-library');
    const client = new OAuth2Client('1015273845520-4fv4c82onq329cokcmkva4i4q4telhbn.apps.googleusercontent.com');
    const ticket = await client.verifyIdToken({
      idToken,
      audience: '1015273845520-4fv4c82onq329cokcmkva4i4q4telhbn.apps.googleusercontent.com',
    });
    const payload = ticket.getPayload();
    const { email, name, picture, sub: googleId } = payload;
    // Find or create user
    let result = await db.query('SELECT * FROM users WHERE email=$1', [email.toLowerCase()]);
    let user = result.rows[0];
    if (!user) {
      const newUser = await db.query(
        'INSERT INTO users (full_name, email, password_hash, email_verified, avatar_url) VALUES ($1,$2,$3,true,$4) RETURNING *',
        [name, email.toLowerCase(), 'GOOGLE_AUTH_' + googleId, picture || null]
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