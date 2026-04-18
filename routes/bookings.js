const router = require("express").Router();
const db = require("../DB");
const auth = require("../middleware/auth");

// POST /api/bookings
router.post("/", auth, async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const { venue_id, event_id, tier_id, quantity = 1, payment_method, booking_type } = req.body;

    if (tier_id) {
      const tier = await client.query(
        "SELECT * FROM ticket_tiers WHERE id=$1 AND is_active=true", [tier_id]
      );
      if (!tier.rows.length) throw new Error("Ticket tier not found.");
      const t = tier.rows[0];
      if (t.quantity - t.sold < quantity) throw new Error("Not enough tickets available.");
      await client.query("UPDATE ticket_tiers SET sold=sold+$1 WHERE id=$2", [quantity, tier_id]);
    }

    const tierRes = tier_id ? await client.query("SELECT price FROM ticket_tiers WHERE id=$1", [tier_id]) : null;
    const unitPrice = tierRes?.rows[0]?.price || 0;
    const total = unitPrice * quantity;

    if (payment_method === "wallet") {
      const user = await client.query("SELECT wallet_balance FROM users WHERE id=$1", [req.user.id]);
      if (user.rows[0].wallet_balance < total) throw new Error("Insufficient wallet balance.");
      await client.query("UPDATE users SET wallet_balance=wallet_balance-$1 WHERE id=$2", [total, req.user.id]);
      await client.query(
        `INSERT INTO wallet_transactions (user_id,type,amount,balance_after,description)
         VALUES ($1,'payment',$2,(SELECT wallet_balance FROM users WHERE id=$1),'Booking payment')`,
        [req.user.id, total]
      );
    }

    const qrCode = "CP-" + Date.now() + "-" + Math.random().toString(36).substring(2, 8).toUpperCase();
    const cppEarned = Math.floor(total / 1000) * 10;

    const booking = await client.query(
      `INSERT INTO bookings
       (user_id,venue_id,event_id,tier_id,booking_type,quantity,unit_price,total_amount,payment_method,status,qr_code,cpp_earned)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'confirmed',$10,$11)
       RETURNING *`,
      [req.user.id, venue_id, event_id || null, tier_id || null, booking_type, quantity, unitPrice, total, payment_method, qrCode, cppEarned]
    );

    await client.query("UPDATE users SET cpp_points=cpp_points+$1 WHERE id=$2", [cppEarned, req.user.id]);
    await client.query(
      `INSERT INTO cpp_transactions (user_id,type,amount,description,booking_id)
       VALUES ($1,'earn',$2,'Booking reward',$3)`,
      [req.user.id, cppEarned, booking.rows[0].id]
    );

    const userCpp = await client.query("SELECT cpp_points FROM users WHERE id=$1", [req.user.id]);
    const pts = userCpp.rows[0].cpp_points;
    const tier = pts >= 2000 ? "Elite" : pts >= 1000 ? "Insider" : pts >= 500 ? "Local" : "Explorer";
    await client.query("UPDATE users SET cpp_tier=$1 WHERE id=$2", [tier, req.user.id]);

    await client.query("COMMIT");
    res.status(201).json({ booking: booking.rows[0], cpp_earned: cppEarned });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

// GET /api/bookings
router.get("/", auth, async (req, res) => {
  try {
    const { status } = req.query;
    let query = `SELECT b.*, v.name as venue_name, v.address, v.cover_image,
                        e.name as event_name, e.event_date
                 FROM bookings b
                 LEFT JOIN venues v ON b.venue_id=v.id
                 LEFT JOIN events e ON b.event_id=e.id
                 WHERE b.user_id=$1`;
    const params = [req.user.id];
    if (status) { query += ` AND b.status=$2`; params.push(status); }
    query += ` ORDER BY b.created_at DESC`;
    const result = await db.query(query, params);
    res.json({ bookings: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/bookings/:id/cancel
router.patch("/:id/cancel", auth, async (req, res) => {
  try {
    const result = await db.query(
      `UPDATE bookings SET status='cancelled' WHERE id=$1 AND user_id=$2 AND status='pending' RETURNING *`,
      [req.params.id, req.user.id]
    );
    if (!result.rows.length) return res.status(400).json({ error: "Cannot cancel this booking." });
    res.json({ booking: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;