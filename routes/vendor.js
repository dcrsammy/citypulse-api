const router = require("express").Router();
const db = require("../db");
const auth = require("../middleware/auth");
const vendorAuth = require("../middleware/vendor");

router.use(auth, vendorAuth);

// GET /api/vendor/dashboard
router.get("/dashboard", async (req, res) => {
  try {
    const stats = await db.query(
      `SELECT
         COUNT(b.id) FILTER (WHERE b.created_at >= date_trunc('month', NOW())) as bookings_this_month,
         SUM(b.total_amount) FILTER (WHERE b.created_at >= date_trunc('month', NOW()) AND b.status='confirmed') as revenue_this_month,
         COUNT(b.id) FILTER (WHERE b.status='pending') as pending_bookings,
         (SELECT AVG(avg_rating) FROM venues WHERE vendor_id=$1) as avg_rating,
         (SELECT available_payout FROM vendors WHERE id=$1) as available_payout
       FROM bookings b
       JOIN venues v ON b.venue_id=v.id
       WHERE v.vendor_id=$1`, [req.user.id]
    );
    const recent = await db.query(
      `SELECT b.*, u.full_name, u.phone, v.name as venue_name
       FROM bookings b
       JOIN venues v ON b.venue_id=v.id
       JOIN users u ON b.user_id=u.id
       WHERE v.vendor_id=$1
       ORDER BY b.created_at DESC LIMIT 10`, [req.user.id]
    );
    res.json({ stats: stats.rows[0], recent_bookings: recent.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/vendor/venues
router.get("/venues", async (req, res) => {
  try {
    const result = await db.query("SELECT * FROM venues WHERE vendor_id=$1", [req.user.id]);
    res.json({ venues: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/vendor/events
router.post("/events", async (req, res) => {
  try {
    const { venue_id, name, description, category, event_date, start_time, end_time, is_free, tiers } = req.body;
    const event = await db.query(
      `INSERT INTO events (venue_id,vendor_id,name,description,category,event_date,start_time,end_time,is_free,is_live)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,false) RETURNING *`,
      [venue_id, req.user.id, name, description, category, event_date, start_time, end_time || null, is_free || false]
    );
    if (tiers?.length) {
      for (const t of tiers) {
        await db.query(
          "INSERT INTO ticket_tiers (event_id,name,description,price,quantity) VALUES ($1,$2,$3,$4,$5)",
          [event.rows[0].id, t.name, t.description || "", t.price, t.quantity]
        );
      }
    }
    res.status(201).json({ event: event.rows[0], message: "Event submitted for review." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/vendor/bookings
router.get("/bookings", async (req, res) => {
  try {
    const result = await db.query(
      `SELECT b.*, u.full_name, u.phone, v.name as venue_name
       FROM bookings b
       JOIN venues v ON b.venue_id=v.id
       JOIN users u ON b.user_id=u.id
       WHERE v.vendor_id=$1
       ORDER BY b.created_at DESC`, [req.user.id]
    );
    res.json({ bookings: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/vendor/bookings/:id
router.patch("/bookings/:id", async (req, res) => {
  try {
    const { action } = req.body;
    const status = action === "confirm" ? "confirmed" : "cancelled";
    const result = await db.query(
      `UPDATE bookings SET status=$1 WHERE id=$2 RETURNING *`, [status, req.params.id]
    );
    res.json({ booking: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;