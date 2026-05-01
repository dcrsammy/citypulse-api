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
    const result = await db.query("SELECT * FROM venues WHERE vendor_id=$1 ORDER BY created_at DESC", [req.user.id]);
    res.json({ venues: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/vendor/venues — vendor creates a new venue
router.post("/venues", async (req, res) => {
  try {
    const {
      name, category, description, phone, price_range,
      address, neighbourhood, city,
      accepts_dinein, accepts_pickup, accepts_delivery,
      delivery_fee, min_order_amount, avg_prep_time_mins,
    } = req.body;

    if (!name || !category || !address || !neighbourhood)
      return res.status(400).json({ error: "name, category, address and neighbourhood are required." });

    // Generate a URL-safe slug from name
    const baseSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    const slug     = `${baseSlug}-${Date.now().toString(36)}`;

    const result = await db.query(
      `INSERT INTO venues
         (vendor_id, name, slug, category, description, phone, price_range,
          address, neighbourhood, city,
          accepts_dinein, accepts_pickup, accepts_delivery,
          delivery_fee, min_order_amount, avg_prep_time_mins,
          is_live, commission_rate)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,false,25.00)
       RETURNING *`,
      [
        req.user.id, name, slug, category, description || null, phone || null, price_range || 2,
        address, neighbourhood, city || "Lagos",
        accepts_dinein !== false, accepts_pickup !== false, accepts_delivery === true,
        parseFloat(delivery_fee || 0), parseFloat(min_order_amount || 0), parseInt(avg_prep_time_mins || 20, 10),
      ]
    );

    res.status(201).json({
      venue: result.rows[0],
      message: "Venue submitted for review. It will go live within 24 hours.",
    });
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
// GET /api/vendor/food-orders — vendor sees all food orders for their venues
router.get("/food-orders", async (req, res) => {
  try {
    const orders = await db.query(
      `SELECT fo.*, 
              u.full_name as customer_name,
              u.phone as customer_phone,
              v.name as venue_name,
              json_agg(json_build_object(
                'name', foi.name,
                'quantity', foi.quantity,
                'unit_price', foi.unit_price,
                'subtotal', foi.subtotal,
                'special_notes', foi.special_notes
              ) ORDER BY foi.created_at) as items
       FROM food_orders fo
       JOIN venues v ON fo.venue_id = v.id
       JOIN users u ON fo.user_id = u.id
       LEFT JOIN food_order_items foi ON foi.order_id = fo.id
       WHERE v.vendor_id = $1
       GROUP BY fo.id, u.full_name, u.phone, v.name
       ORDER BY fo.created_at DESC`,
      [req.user.id]
    );
    res.json({ orders: orders.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/vendor/food-orders/:id — vendor updates order status
router.patch("/food-orders/:id", async (req, res) => {
  try {
    const { status } = req.body;
    const allowed = ["confirmed", "preparing", "ready", "on_the_way", "completed", "cancelled"];
    if (!allowed.includes(status))
      return res.status(400).json({ error: "Invalid status." });

    // Verify this order belongs to vendor's venue
    const check = await db.query(
      `SELECT fo.id FROM food_orders fo
       JOIN venues v ON fo.venue_id = v.id
       WHERE fo.id=$1 AND v.vendor_id=$2`,
      [req.params.id, req.user.id]
    );
    if (!check.rows[0])
      return res.status(403).json({ error: "Order not found or access denied." });

    const result = await db.query(
      "UPDATE food_orders SET order_status=$1, updated_at=NOW() WHERE id=$2 RETURNING *",
      [status, req.params.id]
    );
    res.json({ order: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/vendor/venues/:id — vendor edits their venue
router.patch("/venues/:id", async (req, res) => {
  try {
    const {
      name, description, phone, address, neighbourhood,
      price_range, total_seats, delivery_fee, min_order_amount,
      avg_prep_time_mins, accepts_dinein, accepts_pickup, accepts_delivery,
      cover_image, opening_hours,
    } = req.body;

    // Confirm venue belongs to this vendor
    const check = await db.query(
      "SELECT id FROM venues WHERE id=$1 AND vendor_id=$2",
      [req.params.id, req.user.id]
    );
    if (!check.rows[0]) return res.status(403).json({ error: "Venue not found." });

    const result = await db.query(
      `UPDATE venues SET
        name=$1, description=$2, phone=$3, address=$4, neighbourhood=$5,
        price_range=$6, total_seats=$7, delivery_fee=$8, min_order_amount=$9,
        avg_prep_time_mins=$10, accepts_dinein=$11, accepts_pickup=$12,
        accepts_delivery=$13, cover_image=$14, opening_hours=$15, updated_at=NOW()
       WHERE id=$16 RETURNING *`,
      [
        name, description || null, phone || null, address, neighbourhood,
        price_range || 2, total_seats || null,
        parseFloat(delivery_fee || 0), parseFloat(min_order_amount || 0),
        parseInt(avg_prep_time_mins || 20),
        accepts_dinein !== false, accepts_pickup !== false, accepts_delivery === true,
        cover_image || null, opening_hours ? JSON.stringify(opening_hours) : null,
        req.params.id,
      ]
    );
    res.json({ venue: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
