const ADMIN_EMAILS = ['admin@citypulse.ng'];
const router  = require("express").Router();
const bcrypt  = require("bcryptjs");
const jwt     = require("jsonwebtoken");
const db      = require("../db");

// POST /api/auth/register — user registration
router.post("/register", async (req, res) => {
  try {
    const { full_name, email, phone, password, referral_code } = req.body;
    if (!full_name || !email || !phone || !password)
      return res.status(400).json({ error: "All fields required." });

    const exists = await db.query(
      "SELECT id FROM users WHERE email=$1 OR phone=$2", [email, phone]
    );
    if (exists.rows.length)
      return res.status(409).json({ error: "Email or phone already registered." });

    const hash = await bcrypt.hash(password, 12);
    const refCode = full_name.split(" ")[0].toUpperCase() + Math.floor(Math.random() * 9000 + 1000);

    let referredBy = null;
    if (referral_code) {
      const ref = await db.query("SELECT id FROM users WHERE referral_code=$1", [referral_code]);
      if (ref.rows.length) referredBy = ref.rows[0].id;
    }

    const result = await db.query(
      `INSERT INTO users (full_name, email, phone, password_hash, referral_code, referred_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, full_name, email, phone, cpp_points, cpp_tier`,
      [full_name, email, phone, hash, refCode, referredBy]
    );
    const user = result.rows[0];

    // Award referrer 200 CPP
    if (referredBy) {
      await db.query("UPDATE users SET cpp_points=cpp_points+200 WHERE id=$1", [referredBy]);
      await db.query(
        `INSERT INTO cpp_transactions (user_id,type,amount,description)
         VALUES ($1,'referral',200,'Referral bonus')`, [referredBy]
      );
    }

    const role = ADMIN_EMAILS.includes(user.email) ? "admin" : "user";
    const token = jwt.sign({ id: user.id, role }, process.env.JWT_SECRET, { expiresIn: "30d" });
    res.status(201).json({ token, user });
  } catch (err) {
    console.error("Register error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/login — user login
router.post("/login", async (req, res) => {
  try {
    const { email, phone, password } = req.body;
    const identifier = email || phone;
    if (!identifier || !password)
      return res.status(400).json({ error: "Credentials required." });

    const result = await db.query(
      "SELECT * FROM users WHERE email=$1 OR phone=$1", [identifier]
    );
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash)))
      return res.status(401).json({ error: "Invalid credentials." });

    const role = ADMIN_EMAILS.includes(user.email) ? "admin" : "user";
    const token = jwt.sign({ id: user.id, role }, process.env.JWT_SECRET, { expiresIn: "30d" });
    const { password_hash, ...safe } = user;
    res.json({ token, user: safe });
  } catch (err) {
    console.error("Login error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/vendor/register
router.post('/vendor/register', async (req, res) => {
  try {
    const { business_name, email, phone, password, owner_full_name, cac_number, business_address, owner_bvn } = req.body;
    if (!business_name || !email || !password)
      return res.status(400).json({ error: 'Business name, email and password are required.' });

    const exists = await db.query('SELECT id FROM vendors WHERE email=$1', [email]);
    if (exists.rows[0]) return res.status(409).json({ error: 'Email already registered.' });

    const password_hash = await bcrypt.hash(password, 12);

    const result = await db.query(
      `INSERT INTO vendors (business_name, email, phone, password_hash, is_verified, owner_full_name, cac_number, business_address, owner_bvn, kyc_status, kyc_submitted_at)
       VALUES ($1,$2,$3,$4,false,$5,$6,$7,$8,'pending',NOW()) RETURNING *`,
      [business_name.trim(), email.trim().toLowerCase(), phone || null, password_hash, owner_full_name || null, cac_number || null, business_address || null, owner_bvn || null]
    );
    const vendor = result.rows[0];
    const token = jwt.sign({ id: vendor.id, role: 'vendor' }, process.env.JWT_SECRET, { expiresIn: '30d' });
    const { password_hash: _, ...safe } = vendor;
    res.status(201).json({ token, vendor: safe });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
module.exports = router;
// POST /api/auth/vendor/login
router.post('/vendor/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const result = await db.query('SELECT * FROM vendors WHERE email=$1', [email]);
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

// PATCH /api/auth/profile
router.patch('/profile', auth, async (req, res) => {
  try {
    const { full_name, phone } = req.body;
    const result = await db.query(
      'UPDATE users SET full_name=$1, phone=$2, updated_at=NOW() WHERE id=$3 RETURNING *',
      [full_name, phone || null, req.user.id]
    );
    const { password_hash: _, ...safe } = result.rows[0];
    res.json({ user: safe });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
