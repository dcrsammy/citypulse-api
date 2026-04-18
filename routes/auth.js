const router = require("express").Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("../db");
const auth = require("../middleware/auth");

// POST /api/auth/register
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

    if (referredBy) {
      await db.query("UPDATE users SET cpp_points = cpp_points + 200 WHERE id=$1", [referredBy]);
      await db.query(
        `INSERT INTO cpp_transactions (user_id, type, amount, description)
         VALUES ($1,'referral',200,'Referral bonus')`, [referredBy]
      );
    }

    const token = jwt.sign({ id: user.id, role: "user" }, process.env.JWT_SECRET, { expiresIn: "30d" });
    res.status(201).json({ token, user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/login
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

    const token = jwt.sign({ id: user.id, role: "user" }, process.env.JWT_SECRET, { expiresIn: "30d" });
    const { password_hash, ...safe } = user;
    res.json({ token, user: safe });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/vendor/login
router.post("/vendor/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const result = await db.query("SELECT * FROM vendors WHERE email=$1", [email]);
    const vendor = result.rows[0];
    if (!vendor || !(await bcrypt.compare(password, vendor.password_hash)))
      return res.status(401).json({ error: "Invalid credentials." });

    const token = jwt.sign({ id: vendor.id, role: "vendor" }, process.env.JWT_SECRET, { expiresIn: "30d" });
    const { password_hash, ...safe } = vendor;
    res.json({ token, vendor: safe });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/auth/me
router.get("/me", auth, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id,full_name,email,phone,avatar_url,neighbourhood,city,
              diaspora_mode,wallet_balance,cpp_points,cpp_tier,referral_code,created_at
       FROM users WHERE id=$1`, [req.user.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;