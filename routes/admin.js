const router = require("express").Router();
const db = require("../DB");
const auth = require("../middleware/auth");

const adminAuth = (req, res, next) => {
  if (req.user?.role !== "admin") return res.status(403).json({ error: "Admin access only." });
  next();
};
router.use(auth, adminAuth);

// GET /api/admin/stats
router.get("/stats", async (req, res) => {
  try {
    const stats = await db.query(`
      SELECT
        (SELECT COUNT(*) FROM users) as total_users,
        (SELECT COUNT(*) FROM users WHERE created_at >= NOW() - INTERVAL '7 days') as new_users_week,
        (SELECT COUNT(*) FROM vendors WHERE is_verified=true) as active_vendors,
        (SELECT COUNT(*) FROM venues WHERE is_live=true) as live_venues,
        (SELECT COUNT(*) FROM events WHERE is_live=true AND event_date >= CURRENT_DATE) as upcoming_events,
        (SELECT COUNT(*) FROM bookings WHERE status='confirmed') as total_bookings,
        (SELECT SUM(total_amount) FROM bookings WHERE status='confirmed') as total_gmv,
        (SELECT COUNT(*) FROM bookings WHERE created_at >= NOW() - INTERVAL '24 hours') as bookings_today
    `);
    res.json(stats.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/vendors
router.get("/vendors", async (req, res) => {
  try {
    const result = await db.query(
      `SELECT vn.*, COUNT(v.id) as venue_count FROM vendors vn
       LEFT JOIN venues v ON v.vendor_id=vn.id
       GROUP BY vn.id ORDER BY vn.created_at DESC`
    );
    res.json({ vendors: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/admin/vendors/:id/verify
router.patch("/vendors/:id/verify", async (req, res) => {
  try {
    await db.query("UPDATE vendors SET is_verified=true WHERE id=$1", [req.params.id]);
    res.json({ success: true, message: "Vendor verified successfully." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/venues
router.get("/venues", async (req, res) => {
  try {
    const result = await db.query(
      `SELECT v.*, vn.business_name FROM venues v
       JOIN vendors vn ON v.vendor_id=vn.id
       ORDER BY v.created_at DESC`
    );
    res.json({ venues: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/admin/venues/:id/toggle
router.patch("/venues/:id/toggle", async (req, res) => {
  try {
    const result = await db.query(
      `UPDATE venues SET is_live=NOT is_live WHERE id=$1 RETURNING is_live, name`,
      [req.params.id]
    );
    const { is_live, name } = result.rows[0];
    res.json({ success: true, is_live, message: `${name} is now ${is_live ? "live" : "offline"}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/events/pending
router.get("/events/pending", async (req, res) => {
  try {
    const result = await db.query(
      `SELECT e.*, v.name as venue_name FROM events e
       JOIN venues v ON e.venue_id=v.id
       WHERE e.is_live=false ORDER BY e.created_at DESC`
    );
    res.json({ events: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/admin/events/:id/approve
router.patch("/events/:id/approve", async (req, res) => {
  try {
    await db.query("UPDATE events SET is_live=true WHERE id=$1", [req.params.id]);
    res.json({ success: true, message: "Event is now live." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/users
router.get("/users", async (req, res) => {
  try {
    const { search, limit = 50, offset = 0 } = req.query;
    let query = `SELECT id,full_name,email,phone,cpp_points,cpp_tier,wallet_balance,created_at FROM users WHERE is_active=true`;
    const params = [];
    if (search) { query += ` AND (full_name ILIKE $1 OR email ILIKE $1 OR phone ILIKE $1)`; params.push(`%${search}%`); }
    query += ` ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;
    const result = await db.query(query, params);
    res.json({ users: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;