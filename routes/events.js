
// Sanitize HTML to prevent XSS
function sanitize(str) {
  if (!str) return str;
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\/g, '&#x2F;');
}
const router = require("express").Router();
const db = require("../db");
const auth = require("../middleware/auth");
const jwt = require("jsonwebtoken");

// GET /api/events — list all upcoming events
router.get("/", async (req, res) => {
  try {
    const { category, date, free, limit = 20, offset = 0 } = req.query;
    let query = `
      SELECT e.*, 
        COALESCE(eo.business_name, v.name) as organizer_name,
        v.name as venue_name, v.neighbourhood, v.address, v.latitude, v.longitude,
        json_agg(
          json_build_object(
            'id', t.id, 'name', t.name, 'price', t.price,
            'early_bird_price', t.early_bird_price,
            'early_bird_deadline', t.early_bird_deadline,
            'available', t.quantity_total - t.quantity_sold,
            'quantity_total', t.quantity_total
          )
        ) FILTER (WHERE t.id IS NOT NULL) as ticket_types
      FROM events e
      LEFT JOIN vendors eo ON e.organizer_id = eo.id
      LEFT JOIN venues v ON e.venue_id = v.id
      LEFT JOIN event_ticket_types t ON t.event_id = e.id
      WHERE e.status = 'approved' AND e.event_date >= CURRENT_DATE`;

    const params = [];
    let i = 1;
    if (category) { query += ` AND e.category=$${i++}`; params.push(category); }
    if (date) { query += ` AND e.event_date=$${i++}`; params.push(date); }
    if (free === "true") { query += ` AND e.is_free=true`; }

    query += ` GROUP BY e.id, eo.business_name, v.name, v.neighbourhood, v.address, v.latitude, v.longitude, v.city
               ORDER BY e.is_featured DESC, e.event_date ASC
               LIMIT $${i} OFFSET $${i+1}`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await db.query(query, params);
    res.json({ events: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});





// GET /api/events/:id — single event detail

router.get("/mytickets", auth, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT et.*, 
        tt.name as ticket_type, tt.price,
        e.title as event_title, e.event_date, e.start_time,
        e.cover_image, e.address,
        COALESCE(v.name, e.address) as venue_name
       FROM event_tickets et
       JOIN event_ticket_types tt ON et.ticket_type_id = tt.id
       JOIN events e ON et.event_id = e.id
       LEFT JOIN venues v ON e.venue_id = v.id
       WHERE et.user_id = $1
       ORDER BY e.event_date DESC`,
      [req.user.id]
    );
    res.json({ tickets: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/organizer/myevents", auth, async (req, res) => {
  try {
    const vendorId = req.user.role === 'vendor' ? req.user.id : null;
    const organizerId = req.user.role === 'organizer' ? req.user.id : null;

    const result = await db.query(
      `SELECT e.*,
        json_agg(json_build_object('id',t.id,'name',t.name,'price',t.price,'sold',t.quantity_sold,'total',t.quantity_total)) 
        FILTER (WHERE t.id IS NOT NULL) as ticket_types,
        COALESCE(SUM(ep.total_amount),0) as total_revenue,
        COALESCE(SUM(ep.quantity),0) as total_tickets_sold
       FROM events e
       LEFT JOIN event_ticket_types t ON t.event_id = e.id
       LEFT JOIN event_purchases ep ON ep.event_id = e.id AND ep.payment_status='paid'
       WHERE ($1::uuid IS NULL OR e.vendor_id=$1) AND ($2::uuid IS NULL OR e.organizer_id=$2)
       GROUP BY e.id
       ORDER BY e.event_date DESC`,
      [vendorId, organizerId]
    );
    res.json({ events: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const result = await db.query(
      `SELECT e.*,
        COALESCE(eo.business_name, v.name) as organizer_name,
        NULL as organizer_bio, NULL as organizer_image,
        v.name as venue_name, v.address, v.neighbourhood, v.latitude, v.longitude,
        json_agg(
          DISTINCT jsonb_build_object(
            'id', t.id, 'name', t.name, 'description', t.description,
            'price', t.price, 'early_bird_price', t.early_bird_price,
            'early_bird_deadline', t.early_bird_deadline,
            'available', t.quantity_total - t.quantity_sold,
            'quantity_total', t.quantity_total,
            'max_per_person', t.max_per_person,
            'perks', t.perks
          )
        ) FILTER (WHERE t.id IS NOT NULL) as ticket_types
       FROM events e
       LEFT JOIN vendors eo ON e.organizer_id = eo.id
       LEFT JOIN venues v ON e.venue_id = v.id
       LEFT JOIN event_ticket_types t ON t.event_id = e.id
       WHERE e.id=$1
       GROUP BY e.id, eo.business_name, v.name, v.address, v.neighbourhood, v.latitude, v.longitude`,
      [req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: "Event not found." });
    res.json({ event: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/events — create event (organizer or vendor)
router.post("/", auth, async (req, res) => {
  try {
    const {
      title, description, category, event_date, start_time, end_time,
      venue_id, address, latitude, longitude, cover_image, images,
      is_free, max_capacity, ticket_types
    } = req.body;

    if (!title || !event_date || !start_time || !category)
      return res.status(400).json({ error: "Title, date, start time and category are required." });

    // Determine organizer
    let organizer_id = null;
    if (req.user.role === 'organizer') organizer_id = req.user.id;

    const eventRes = await db.query(
      `INSERT INTO events (organizer_id, venue_id, vendor_id, title, name, description, category,
        event_date, start_time, end_time, address, latitude, longitude,
        cover_image, images, is_free, is_live, status, max_capacity, total_capacity)
       VALUES ($1,$2,$3,$4,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,false,'pending',$16,$16)
       RETURNING *`,
      [organizer_id, venue_id || null, req.user.role === 'vendor' ? req.user.id : null,
       sanitize(title), sanitize(description) || null, category, event_date, start_time, end_time || null,
       address || null, latitude || null, longitude || null,
       cover_image || null, images || null, is_free || false,
       max_capacity || null]
    );
    const event = eventRes.rows[0];

    // Create ticket types
    if (ticket_types && ticket_types.length > 0) {
      for (const tt of ticket_types) {
        await db.query(
          `INSERT INTO event_ticket_types (event_id, name, description, price, early_bird_price, early_bird_deadline, quantity_total, max_per_person, perks)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [event.id, tt.name, tt.description || null, tt.price || 0,
           tt.early_bird_price || null, tt.early_bird_deadline || null,
           tt.quantity_total, tt.max_per_person || 6, tt.perks || null]
        );
      }
    }

    res.status(201).json({ event, message: "Event submitted for review!" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/events/:id/purchase — buy tickets
router.post("/:id/purchase", auth, async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const { ticket_type_id, quantity, payment_method } = req.body;

    if (!ticket_type_id || !quantity || quantity < 1)
      return res.status(400).json({ error: "Ticket type and quantity required." });

    // Get ticket type
    const ttRes = await client.query(
      "SELECT * FROM event_ticket_types WHERE id=$1",
      [ticket_type_id]
    );
    const tt = ttRes.rows[0];
    if (!tt) return res.status(404).json({ error: "Ticket type not found." });

    // Check availability
    const available = tt.quantity_total - tt.quantity_sold;
    if (quantity > available)
      return res.status(400).json({ error: `Only ${available} tickets left.` });

    if (quantity > tt.max_per_person)
      return res.status(400).json({ error: `Max ${tt.max_per_person} tickets per person.` });

    // Calculate price (early bird if applicable)
    let unit_price = parseFloat(tt.price);
    if (tt.early_bird_price && tt.early_bird_deadline && new Date() < new Date(tt.early_bird_deadline)) {
      unit_price = parseFloat(tt.early_bird_price);
    }

    const total_amount = unit_price * quantity;
    const platform_fee = tt.price === 0 ? 0 : parseFloat((total_amount * 0.05).toFixed(2));

    // Handle wallet payment
    if (payment_method === 'wallet') {
      const userRes = await client.query("SELECT wallet_balance FROM users WHERE id=$1", [req.user.id]);
      if (parseFloat(userRes.rows[0].wallet_balance) < total_amount)
        return res.status(400).json({ error: "Insufficient wallet balance." });
      await client.query("UPDATE users SET wallet_balance = wallet_balance - $1 WHERE id=$2", [total_amount, req.user.id]);
    }

    // Create purchase
    const purchaseRes = await client.query(
      `INSERT INTO event_purchases (event_id, ticket_type_id, user_id, quantity, unit_price, total_amount, platform_fee, payment_method, payment_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [req.params.id, ticket_type_id, req.user.id, quantity, unit_price, total_amount, platform_fee, payment_method || 'wallet', payment_method === 'wallet' ? 'paid' : 'pending']
    );
    const purchase = purchaseRes.rows[0];

    // Generate individual tickets with signed QR codes
    const tickets = [];
    for (let i = 0; i < quantity; i++) {
      const ticketId = (await client.query("SELECT gen_random_uuid() as id")).rows[0].id;
      const qrPayload = jwt.sign(
        { event_id: req.params.id, ticket_id: ticketId, purchase_id: purchase.id, user_id: req.user.id },
        process.env.JWT_SECRET,
        { expiresIn: '365d' }
      );
      const ticketRes = await client.query(
        `INSERT INTO event_tickets (id, purchase_id, event_id, user_id, ticket_type_id, qr_code)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [ticketId, purchase.id, req.params.id, req.user.id, ticket_type_id, qrPayload]
      );
      tickets.push(ticketRes.rows[0]);
    }

    // Update quantity sold
    await client.query(
      "UPDATE event_ticket_types SET quantity_sold = quantity_sold + $1 WHERE id=$2",
      [quantity, ticket_type_id]
    );

    // CPP points
    const cpp = Math.floor(total_amount / 1000) * 10;
    if (cpp > 0) await client.query("UPDATE users SET cpp_points = cpp_points + $1 WHERE id=$2", [cpp, req.user.id]);

    await client.query("COMMIT");
    res.status(201).json({ purchase, tickets, cpp_earned: cpp, message: `${quantity} ticket(s) confirmed!` });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// POST /api/events/verify-ticket — scan QR at door
router.post("/verify-ticket", auth, async (req, res) => {
  try {
    const { qr_code } = req.body;
    if (!qr_code) return res.status(400).json({ error: "QR code required." });

    // Verify JWT signature
    let decoded;
    try {
      decoded = jwt.verify(qr_code, process.env.JWT_SECRET);
    } catch (e) {
      return res.status(400).json({ valid: false, error: "Invalid or tampered ticket." });
    }

    // Check ticket in DB
    const ticketRes = await db.query(
      `SELECT et.*, u.full_name, u.email,
        tt.name as ticket_type, e.title as event_title, e.event_date
       FROM event_tickets et
       JOIN users u ON et.user_id = u.id
       JOIN event_ticket_types tt ON et.ticket_type_id = tt.id
       JOIN events e ON et.event_id = e.id
       WHERE et.id=$1`,
      [decoded.ticket_id]
    );
    const ticket = ticketRes.rows[0];
    if (!ticket) return res.status(404).json({ valid: false, error: "Ticket not found." });
    if (ticket.status === 'used') return res.status(400).json({ valid: false, error: "Ticket already used.", used_at: ticket.used_at });

    // Mark as used
    await db.query("UPDATE event_tickets SET status='used', used_at=NOW() WHERE id=$1", [decoded.ticket_id]);

    res.json({
      valid: true,
      ticket_type: ticket.ticket_type,
      event_title: ticket.event_title,
      event_date: ticket.event_date,
      holder_name: ticket.full_name,
      message: "✅ Valid ticket. Entry granted!"
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/events/mytickets — user's tickets

// GET /api/events/organizer/myevents


// POST /api/events/confirm-payment — confirm Paystack payment for tickets
router.post("/confirm-payment", auth, async (req, res) => {
  const client = await db.pool.connect();
  try {
    const { reference, event_id, ticket_type_id, quantity } = req.body;
    const axios = require('axios');
    const verify = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` } }
    );
    const txn = verify.data.data;
    if (txn.status !== 'success') return res.status(400).json({ error: 'Payment not successful.' });
    await client.query("BEGIN");
    const total_amount = txn.amount / 100;
    const platform_fee = total_amount * 0.05;
    const unit_price = total_amount / quantity;
    const purchaseRes = await client.query(
      `INSERT INTO event_purchases (event_id, ticket_type_id, user_id, quantity, unit_price, total_amount, platform_fee, payment_method, payment_status, payment_ref)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'paystack','paid',$8) RETURNING *`,
      [event_id, ticket_type_id, req.user.id, quantity, unit_price, total_amount, platform_fee, reference]
    );
    const purchase = purchaseRes.rows[0];
    const tickets = [];
    for (let i = 0; i < quantity; i++) {
      const ticketId = (await client.query("SELECT gen_random_uuid() as id")).rows[0].id;
      const qrPayload = jwt.sign(
        { event_id, ticket_id: ticketId, purchase_id: purchase.id, user_id: req.user.id },
        process.env.JWT_SECRET, { expiresIn: '365d' }
      );
      const ticketRes = await client.query(
        `INSERT INTO event_tickets (id, purchase_id, event_id, user_id, ticket_type_id, qr_code)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [ticketId, purchase.id, event_id, req.user.id, ticket_type_id, qrPayload]
      );
      tickets.push(ticketRes.rows[0]);
    }
    await client.query("UPDATE event_ticket_types SET quantity_sold = quantity_sold + $1 WHERE id=$2", [quantity, ticket_type_id]);
    const cpp = Math.floor(total_amount / 1000) * 10;
    if (cpp > 0) await client.query("UPDATE users SET cpp_points = cpp_points + $1 WHERE id=$2", [cpp, req.user.id]);
    await client.query("COMMIT");
    res.json({ tickets, cpp_earned: cpp });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;

// PATCH /api/events/:id — update event (vendor/organizer)
router.patch("/:id", auth, async (req, res) => {
  try {
    const { title, description, category, event_date, start_time, end_time, cover_image, is_free, max_capacity, address } = req.body;
    const result = await db.query(
      `UPDATE events SET
        title = COALESCE($1, title),
        name = COALESCE($1, name),
        description = COALESCE($2, description),
        category = COALESCE($3, category),
        event_date = COALESCE($4, event_date),
        start_time = COALESCE($5, start_time),
        end_time = COALESCE($6, end_time),
        cover_image = COALESCE($7, cover_image),
        is_free = COALESCE($8, is_free),
        max_capacity = COALESCE($9, max_capacity),
        address = COALESCE($10, address),
        status = 'pending',
        updated_at = NOW()
       WHERE id=$11 AND (vendor_id=$12 OR organizer_id=$12)
       RETURNING *`,
      [title, description, category, event_date, start_time, end_time,
       cover_image, is_free, max_capacity, address, req.params.id, req.user.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: "Event not found" });
    res.json({ event: result.rows[0], message: "Event updated! Pending re-approval." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
