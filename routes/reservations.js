const router = require("express").Router();
const db     = require("../db");
const auth   = require("../middleware/auth");

// POST /api/reservations — make a reservation (with optional pre-order)
router.post("/", auth, async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const {
      venue_id,
      reservation_date,
      arrival_time,
      party_size,
      special_requests,
      pre_order_items, // array of { menu_item_id, quantity, special_notes }
    } = req.body;

    if (!venue_id || !reservation_date || !arrival_time || !party_size)
      return res.status(400).json({ error: "venue_id, date, arrival_time and party_size are required." });
    // Check seat availability
    const venueData = await db.query('SELECT total_seats FROM venues WHERE id=$1', [venue_id]);
    const totalSeats = venueData.rows[0]?.total_seats;
    if (totalSeats) {
      const booked = await db.query(
        'SELECT COALESCE(SUM(party_size),0) as total FROM reservations WHERE venue_id=$1 AND reservation_date=$2 AND arrival_time=$3 AND status NOT IN ('cancelled')',
        [venue_id, reservation_date, arrival_time]
      );
      const bookedSeats = parseInt(booked.rows[0].total);
      if (bookedSeats + parseInt(party_size) > totalSeats)
        return res.status(400).json({ error: 'Sorry, not enough seats available for this time. Please choose a different time.' });
    }


    const hasPreOrder = pre_order_items && pre_order_items.length > 0;
    const qrCode = "CPR-" + Date.now() + "-" + Math.random().toString(36).substring(2, 7).toUpperCase();

    // Create reservation
    const reservation = await client.query(
      `INSERT INTO reservations
         (user_id, venue_id, reservation_date, arrival_time, party_size, special_requests, pre_order, qr_code)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.user.id, venue_id, reservation_date, arrival_time, party_size, special_requests || null, hasPreOrder, qrCode]
    );
    const res_id = reservation.rows[0].id;

    // Add pre-order items if any
    let preOrderTotal = 0;
    if (hasPreOrder) {
      for (const item of pre_order_items) {
        const menuItem = await client.query(
          "SELECT price, name, prep_time_mins FROM menu_items WHERE id=$1", [item.menu_item_id]
        );
        if (!menuItem.rows.length) continue;
        const unitPrice = menuItem.rows[0].price;
        preOrderTotal += unitPrice * item.quantity;
        await client.query(
          `INSERT INTO pre_order_items (reservation_id, menu_item_id, quantity, unit_price, special_notes)
           VALUES ($1,$2,$3,$4,$5)`,
          [res_id, item.menu_item_id, item.quantity, unitPrice, item.special_notes || null]
        );
      }
    }

    // Award CPP
    const cpp = hasPreOrder ? 20 : 10;
    await client.query("UPDATE users SET cpp_points=cpp_points+$1 WHERE id=$2", [cpp, req.user.id]);
    await client.query(
      `INSERT INTO cpp_transactions (user_id, type, amount, description)
       VALUES ($1,'earn',$2,'Reservation reward')`,
      [req.user.id, cpp]
    );

    await client.query("COMMIT");

    // Get venue details for response
    const venue = await db.query("SELECT name, address FROM venues WHERE id=$1", [venue_id]);

    res.status(201).json({
      reservation: reservation.rows[0],
      pre_order_total: preOrderTotal,
      cpp_earned: cpp,
      venue: venue.rows[0],
      message: hasPreOrder
        ? `Reservation confirmed! Your food will be ready when you arrive at ${arrival_time}.`
        : `Table reserved for ${party_size} at ${arrival_time}. See you then!`,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// GET /api/reservations — user's reservations
router.get("/", auth, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT r.*, v.name as venue_name, v.address, v.cover_image,
              json_agg(
                json_build_object(
                  'item_id', poi.menu_item_id,
                  'name', mi.name,
                  'quantity', poi.quantity,
                  'price', poi.unit_price,
                  'notes', poi.special_notes
                )
              ) FILTER (WHERE poi.id IS NOT NULL) as pre_order
       FROM reservations r
       JOIN venues v ON r.venue_id = v.id
       LEFT JOIN pre_order_items poi ON poi.reservation_id = r.id
       LEFT JOIN menu_items mi ON mi.id = poi.menu_item_id
       WHERE r.user_id = $1
       GROUP BY r.id, v.name, v.address, v.cover_image
       ORDER BY r.reservation_date DESC, r.arrival_time DESC`,
      [req.user.id]
    );
    res.json({ reservations: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/reservations/venue/:venueId — vendor sees their reservations
router.get("/venue/:venueId", auth, async (req, res) => {
  try {
    const { date } = req.query;
    let query = `SELECT r.*, u.full_name, u.phone,
                        json_agg(
                          json_build_object(
                            'name', mi.name,
                            'quantity', poi.quantity,
                            'notes', poi.special_notes,
                            'prep_time', mi.prep_time_mins
                          )
                        ) FILTER (WHERE poi.id IS NOT NULL) as pre_order_items
                 FROM reservations r
                 JOIN users u ON r.user_id = u.id
                 LEFT JOIN pre_order_items poi ON poi.reservation_id = r.id
                 LEFT JOIN menu_items mi ON mi.id = poi.menu_item_id
                 WHERE r.venue_id = $1`;
    const params = [req.params.venueId];
    if (date) { query += ` AND r.reservation_date = $2`; params.push(date); }
    query += ` GROUP BY r.id, u.full_name, u.phone ORDER BY r.arrival_time ASC`;
    const result = await db.query(query, params);
    res.json({ reservations: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/reservations/:id/status — vendor confirms or cancels
router.patch("/:id/status", auth, async (req, res) => {
  try {
    const { status } = req.body; // confirmed, cancelled, completed, no_show
    const result = await db.query(
      `UPDATE reservations SET status=$1 WHERE id=$2 RETURNING *`,
      [status, req.params.id]
    );
    res.json({ reservation: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/reservations/:id/cancel — user cancels
router.patch("/:id/cancel", auth, async (req, res) => {
  try {
    const result = await db.query(
      `UPDATE reservations SET status='cancelled' WHERE id=$1 AND user_id=$2 AND status='pending' RETURNING *`,
      [req.params.id, req.user.id]
    );
    if (!result.rows.length) return res.status(400).json({ error: "Cannot cancel this reservation." });
    res.json({ reservation: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;