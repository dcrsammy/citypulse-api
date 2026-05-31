const router = require("express").Router();
const db = require("../db");
const auth = require("../middleware/auth");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

// POST /api/admin/login - Public endpoint
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Email and password required." });
    
    const result = await db.query("SELECT * FROM admins WHERE email=$1", [email.toLowerCase().trim()]);
    const admin = result.rows[0];
    if (!admin) return res.status(401).json({ error: "Invalid credentials." });
    
    const match = await bcrypt.compare(password, admin.password_hash);
    if (!match) return res.status(401).json({ error: "Invalid credentials." });
    
    const token = jwt.sign({ id: admin.id, role: "admin" }, process.env.JWT_SECRET, { expiresIn: "30d" });
    res.json({ token, admin: { id: admin.id, email: admin.email, name: admin.name } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const adminAuth = (req, res, next) => {
  if (req.user?.role !== "admin") return res.status(403).json({ error: "Admin access only." });
  next();
};

router.use(auth, adminAuth);

router.get("/stats", async (req, res) => {
  try {
    const pending = await db.query("SELECT COUNT(*) as count FROM venues WHERE is_live=false");
    const kyc = await db.query("SELECT COUNT(*) as count FROM vendors WHERE kyc_status='pending'");
    const stats = await db.query(`
      SELECT
        (SELECT COUNT(*) FROM users) as total_users,
        (SELECT COUNT(*) FROM vendors WHERE is_verified=true) as active_vendors,
        (SELECT COUNT(*) FROM venues WHERE is_live=true) as live_venues
    `);
    res.json({
      total_users: stats.rows[0].total_users,
      active_vendors: stats.rows[0].active_vendors,
      live_venues: stats.rows[0].live_venues,
      pending_approval: pending.rows[0].count,
      kyc_pending: kyc.rows[0].count
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/vendors/pending-kyc", async (req, res) => {
  try {
    const result = await db.query("SELECT * FROM vendors WHERE kyc_status='pending' ORDER BY kyc_submitted_at DESC");
    res.json({ vendors: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/venues/pending", async (req, res) => {
  try {
    const result = await db.query(`
      SELECT v.*, vn.business_name as vendor_name FROM venues v
      LEFT JOIN vendors vn ON v.vendor_id=vn.id
      WHERE v.is_live=false ORDER BY v.created_at DESC
    `);
    res.json({ venues: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch("/venues/:id/approve", async (req, res) => {
  try {
    await db.query("UPDATE venues SET is_live=true WHERE id=$1", [req.params.id]);
    res.json({ message: "Venue approved!" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch("/venues/:id/reject", async (req, res) => {
  try {
    await db.query("DELETE FROM venues WHERE id=$1", [req.params.id]);
    res.json({ message: "Venue rejected." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/vendors", async (req, res) => {
  try {
    const result = await db.query(`
      SELECT vn.*, COUNT(v.id) as venue_count FROM vendors vn
      LEFT JOIN venues v ON v.vendor_id=vn.id
      GROUP BY vn.id ORDER BY vn.created_at DESC
    `);
    res.json({ vendors: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch("/vendors/:id/kyc-approve", async (req, res) => {
  try {
    await db.query("UPDATE vendors SET kyc_status='approved' WHERE id=$1", [req.params.id]);
    res.json({ message: "KYC approved!" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch("/vendors/:id/kyc-reject", async (req, res) => {
  try {
    await db.query("UPDATE vendors SET kyc_status='rejected' WHERE id=$1", [req.params.id]);
    res.json({ message: "KYC rejected." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/venues", async (req, res) => {
  try {
    const result = await db.query(`
      SELECT v.*, vn.business_name as vendor_name FROM venues v
      LEFT JOIN vendors vn ON v.vendor_id=vn.id
      ORDER BY v.created_at DESC
    `);
    res.json({ venues: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/users", async (req, res) => {
  try {
    const result = await db.query("SELECT * FROM users ORDER BY created_at DESC");
    res.json({ users: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/disputes", async (req, res) => {
  try {
    const result = await db.query("SELECT * FROM food_orders WHERE disputed=true ORDER BY created_at DESC");
    res.json({ disputes: result.rows || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Approve venue
router.patch("/venues/:id/approve", async (req, res) => {
  try {
    await db.query("UPDATE venues SET is_live=true, is_verified=true WHERE id=$1", [req.params.id]);
    res.json({ message: "Venue approved and live!" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reject venue
router.patch("/venues/:id/reject", async (req, res) => {
  try {
    await db.query("UPDATE venues SET is_live=false, is_verified=false WHERE id=$1", [req.params.id]);
    res.json({ message: "Venue rejected." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all orders
router.get("/orders", async (req, res) => {
  try {
    const result = await db.query(`
      SELECT fo.*, u.full_name, v.name as venue_name 
      FROM food_orders fo
      JOIN users u ON fo.user_id = u.id
      JOIN venues v ON fo.venue_id = v.id
      ORDER BY fo.created_at DESC
      LIMIT 100
    `);
    res.json({ orders: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all reservations
router.get("/reservations", async (req, res) => {
  try {
    const result = await db.query(`
      SELECT r.*, u.full_name, v.name as venue_name
      FROM reservations r
      JOIN users u ON r.user_id = u.id
      JOIN venues v ON r.venue_id = v.id
      ORDER BY r.created_at DESC
      LIMIT 100
    `);
    res.json({ reservations: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Verify vendor
router.patch("/vendors/:id/verify", async (req, res) => {
  try {
    await db.query("UPDATE vendors SET is_verified=true, kyc_status='approved' WHERE id=$1", [req.params.id]);
    res.json({ message: "Vendor verified!" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
