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

    const token = jwt.sign({ id: user.id, role: "user" }, process.env.JWT_SECRET, { expiresIn: "30d" });
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

    const token = jwt.sign({ id: user.id, role: "user" }, process.env.JWT_SECRET, { expiresIn: "30d" });
    const { password_hash, ...safe } = user;
    res.json({ token, user: safe });
  } catch (err) {
    console.error("Login error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/vendor/register — vendor self-registration
router.post("/vendor/register", async (req, res) => {
  try {
    const { business_name, email, phone, password } = req.body;
    if (!business_name || !email || !phone || !password)
      return res.status(400).json({ error: "All fields required." });

    const exists = await db.query("SELECT id FROM vendors WHERE email=$1", [email]);
    if (exists.rows.length)
      return res.status(409).json({ error: "A vendor account with this email already exists." });

    const hash = await bcrypt.hash(password, 12);
    const result = await db.query(
      `INSERT INTO vendors (business_name, email, phone, password_hash, is_verified)
       VALUES ($1,$2,$3,$4,false) RETURNING id, business_name, email, phone`,
      [business_name, email, phone, hash]
    );

    res.status(201).json({
      success: true,
      message: "Registration submitted! Our team will verify your account within 24 hours. You will receive a WhatsApp confirmation.",
      vendor: result.rows[0],
    });
  } catch (err) {
    console.error("Vendor register error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/vendor/login — vendor login
router.post("/vendor/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: "Email and password required." });

    const result = await db.query("SELECT * FROM vendors WHERE email=$1", [email]);
    const vendor = result.rows[0];
    if (!vendor || !(await bcrypt.compare(password, vendor.password_hash)))
      return res.status(401).json({ error: "Invalid credentials." });

    if (!vendor.is_verified)
      return res.status(403).json({ error: "Your account is pending verification. Our team will contact you within 24 hours." });

    const token = jwt.sign({ id: vendor.id, role: "vendor" }, process.env.JWT_SECRET, { expiresIn: "30d" });
    const { password_hash, ...safe } = vendor;
    res.json({ token, vendor: safe });
  } catch (err) {
    console.error("Vendor login error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/auth/me — get current user
router.get("/me", require("../middleware/auth"), async (req, res) => {
  try {
    if (req.user.role === "vendor") {
      const result = await db.query(
        "SELECT id, business_name, email, phone, is_verified, available_payout, created_at FROM vendors WHERE id=$1",
        [req.user.id]
      );
      return res.json(result.rows[0]);
    }
    const result = await db.query(
      `SELECT id, full_name, email, phone, avatar_url, neighbourhood, city,
              diaspora_mode, wallet_balance, cpp_points, cpp_tier, referral_code, created_at
       FROM users WHERE id=$1`, [req.user.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/test-db — test database connection
router.get("/test-db", async (req, res) => {
  try {
    const result = await db.query("SELECT COUNT(*) as user_count FROM users");
    res.json({ connected: true, user_count: result.rows[0].user_count });
  } catch (err) {
    res.status(500).json({ connected: false, error: err.message });
  }
});

module.exports = router;