const router = require("express").Router();
const db     = require("../db");
const auth   = require("../middleware/auth");

// GET /api/services/:venueId — get all services for a venue
router.get("/:venueId", async (req, res) => {
  try {
    const services = await db.query(
      `SELECT s.*,
              COALESCE(
                json_agg(
                  json_build_object(
                    'id', ss.id,
                    'date', ss.slot_date,
                    'start', ss.start_time,
                    'end', ss.end_time,
                    'available', ss.capacity - ss.booked,
                    'capacity', ss.capacity
                  ) ORDER BY ss.slot_date, ss.start_time
                ) FILTER (WHERE ss.id IS NOT NULL AND ss.is_available=true AND ss.slot_date >= CURRENT_DATE),
                '[]'
              ) as slots
       FROM services s
       LEFT JOIN service_slots ss ON ss.service_id = s.id
       WHERE s.venue_id=$1 AND s.is_available=true
       GROUP BY s.id
       ORDER BY s.name ASC`,
      [req.params.venueId]
    );
    res.json({ services: services.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/services — vendor adds a service
router.post("/", auth, async (req, res) => {
  try {
    const { venue_id, name, description, price, duration_mins, max_capacity, service_type } = req.body;
    if (!venue_id || !name || !price)
      return res.status(400).json({ error: "venue_id, name and price are required." });
    const result = await db.query(
      `INSERT INTO services (venue_id, name, description, price, duration_mins, max_capacity, service_type)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [venue_id, name, description || null, price, duration_mins || null, max_capacity || 1, service_type || 'activity']
    );
    res.status(201).json({ service: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/services/slots — vendor adds available time slots
router.post("/slots", auth, async (req, res) => {
  try {
    const { service_id, venue_id, slot_date, start_time, end_time, capacity } = req.body;
    if (!service_id || !slot_date || !start_time || !end_time)
      return res.status(400).json({ error: "service_id, slot_date, start_time and end_time are required." });
    const result = await db.query(
      `INSERT INTO service_slots (service_id, venue_id, slot_date, start_time, end_time, capacity)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [service_id, venue_id, slot_date, start_time, end_time, capacity || 1]
    );
    res.status(201).json({ slot: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/services/book — user books a service slot
router.post("/book", auth, async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const { service_id, slot_id, venue_id, quantity, payment_method, special_notes } = req.body;

    // Check slot availability
    const slot = await client.query(
      "SELECT * FROM service_slots WHERE id=$1 AND is_available=true", [slot_id]
    );
    if (!slot.rows.length) throw new Error("Slot not available.");
    const s = slot.rows[0];
    if (s.capacity - s.booked < quantity) throw new Error("Not enough slots available.");

    // Get service price
    const service = await client.query("SELECT * FROM services WHERE id=$1", [service_id]);
    if (!service.rows.length) throw new Error("Service not found.");
    const total = service.rows[0].price * quantity;

    // Deduct wallet if needed
    if (payment_method === "wallet") {
      const user = await client.query("SELECT wallet_balance FROM users WHERE id=$1", [req.user.id]);
      if (user.rows[0].wallet_balance < total) throw new Error("Insufficient wallet balance.");
      await client.query("UPDATE users SET wallet_balance=wallet_balance-$1 WHERE id=$2", [total, req.user.id]);
    }

    // Reserve the slot
    await client.query(
      "UPDATE service_slots SET booked=booked+$1 WHERE id=$2", [quantity, slot_id]
    );

    const qrCode = "CPS-" + Date.now() + "-" + Math.random().toString(36).substring(2, 7).toUpperCase();
    const cpp = Math.floor(total / 1000) * 10;

    const booking = await client.query(
      `INSERT INTO service_bookings
         (user_id, service_id, slot_id, venue_id, quantity, total_amount, payment_method, status, qr_code, special_notes, cpp_earned)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'confirmed',$8,$9,$10) RETURNING *`,
      [req.user.id, service_id, slot_id, venue_id, quantity, total, payment_method, qrCode, special_notes || null, cpp]
    );

    // Award CPP
    await client.query("UPDATE users SET cpp_points=cpp_points+$1 WHERE id=$2", [cpp, req.user.id]);

    await client.query("COMMIT");
    res.status(201).json({
      booking: booking.rows[0],
      cpp_earned: cpp,
      message: `Booking confirmed! Show your QR code at ${service.rows[0].name}.`,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

// GET /api/services/bookings/mine — user's service bookings
router.get("/bookings/mine", auth, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT sb.*, s.name as service_name, s.duration_mins,
              v.name as venue_name, v.address,
              ss.slot_date, ss.start_time, ss.end_time
       FROM service_bookings sb
       JOIN services s ON sb.service_id = s.id
       JOIN venues v ON sb.venue_id = v.id
       JOIN service_slots ss ON sb.slot_id = ss.id
       WHERE sb.user_id = $1
       ORDER BY ss.slot_date DESC, ss.start_time DESC`,
      [req.user.id]
    );
    res.json({ bookings: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/services/bookings/venue/:venueId — vendor sees their service bookings
router.get("/bookings/venue/:venueId", auth, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT sb.*, s.name as service_name,
              u.full_name, u.phone,
              ss.slot_date, ss.start_time, ss.end_time
       FROM service_bookings sb
       JOIN services s ON sb.service_id = s.id
       JOIN users u ON sb.user_id = u.id
       JOIN service_slots ss ON sb.slot_id = ss.id
       WHERE sb.venue_id = $1
       ORDER BY ss.slot_date ASC, ss.start_time ASC`,
      [req.params.venueId]
    );
    res.json({ bookings: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;