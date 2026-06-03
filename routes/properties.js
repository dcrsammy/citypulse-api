const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const jwt = require('jsonwebtoken');

// ── LIST PROPERTIES ──────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { type, neighbourhood, min_price, max_price, guests, check_in, check_out, limit = 20, offset = 0 } = req.query;
    let where = [`p.is_live = true`, `p.status = 'approved'`];
    let params = [];
    let idx = 1;

    if (type) { where.push(`p.type = $${idx++}`); params.push(type); }
    if (neighbourhood) { where.push(`p.neighbourhood ILIKE $${idx++}`); params.push(`%${neighbourhood}%`); }
    if (min_price) { where.push(`p.base_price_per_night >= $${idx++}`); params.push(min_price); }
    if (max_price) { where.push(`p.base_price_per_night <= $${idx++}`); params.push(max_price); }
    if (guests) { where.push(`p.max_guests >= $${idx++}`); params.push(guests); }

    // Exclude booked dates
    if (check_in && check_out) {
      where.push(`p.id NOT IN (
        SELECT DISTINCT property_id FROM property_bookings
        WHERE booking_status NOT IN ('cancelled')
        AND check_in_date < $${idx++} AND check_out_date > $${idx++}
      )`);
      params.push(check_out, check_in);
    }

    params.push(limit, offset);
    const result = await db.query(`
      SELECT p.*,
        array_agg(DISTINCT pa.amenity) FILTER (WHERE pa.amenity IS NOT NULL) as amenities,
        COUNT(pb.id) FILTER (WHERE pb.booking_status = 'confirmed') as total_bookings
      FROM properties p
      LEFT JOIN property_amenities pa ON pa.property_id = p.id
      LEFT JOIN property_bookings pb ON pb.property_id = p.id
      WHERE ${where.join(' AND ')}
      GROUP BY p.id
      ORDER BY p.is_featured DESC, p.avg_rating DESC
      LIMIT $${idx++} OFFSET $${idx++}
    `, params);

    res.json({ properties: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── SINGLE PROPERTY ──────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT p.*,
        array_agg(DISTINCT pa.amenity) FILTER (WHERE pa.amenity IS NOT NULL) as amenities,
        json_agg(DISTINCT jsonb_build_object(
          'id', pr.id, 'name', pr.name, 'description', pr.description,
          'price_per_night', pr.price_per_night, 'max_guests', pr.max_guests,
          'quantity', pr.quantity, 'amenities', pr.amenities, 'images', pr.images
        )) FILTER (WHERE pr.id IS NOT NULL) as rooms
      FROM properties p
      LEFT JOIN property_amenities pa ON pa.property_id = p.id
      LEFT JOIN property_rooms pr ON pr.property_id = p.id
      WHERE p.id = $1
      GROUP BY p.id
    `, [req.params.id]);

    if (!result.rows[0]) return res.status(404).json({ error: 'Property not found.' });

    // Get reviews
    const reviews = await db.query(`
      SELECT pr.*, u.full_name, u.avatar_url
      FROM property_reviews pr
      JOIN users u ON pr.user_id = u.id
      WHERE pr.property_id = $1
      ORDER BY pr.created_at DESC LIMIT 10
    `, [req.params.id]);

    // Get blocked dates
    const blocked = await db.query(`
      SELECT date FROM property_availability WHERE property_id = $1 AND is_blocked = true
    `, [req.params.id]);

    // Get booked dates
    const booked = await db.query(`
      SELECT check_in_date, check_out_date FROM property_bookings
      WHERE property_id = $1 AND booking_status NOT IN ('cancelled')
    `, [req.params.id]);

    res.json({
      property: result.rows[0],
      reviews: reviews.rows,
      blocked_dates: blocked.rows.map(r => r.date),
      booked_ranges: booked.rows
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── BOOK PROPERTY ──────────────────────────────────────
router.post('/:id/book', auth, async (req, res) => {
  const client = await db.pool.connect();
  try {
    const { check_in_date, check_out_date, guests, room_id, payment_method, special_requests } = req.body;

    const propRes = await client.query('SELECT * FROM properties WHERE id=$1', [req.params.id]);
    const property = propRes.rows[0];
    if (!property) return res.status(404).json({ error: 'Property not found.' });

    // Calculate nights and price
    const checkIn = new Date(check_in_date);
    const checkOut = new Date(check_out_date);
    const nights = Math.ceil((checkOut - checkIn) / (1000 * 60 * 60 * 24));
    if (nights < 1) return res.status(400).json({ error: 'Invalid dates.' });

    // Check if weekend
    const isWeekend = checkIn.getDay() === 5 || checkIn.getDay() === 6;
    const nightlyRate = isWeekend && property.weekend_price ? property.weekend_price : property.base_price_per_night;
    const base_amount = nightlyRate * nights;
    const service_fee = Math.round(base_amount * 0.08); // 8% service fee
    const total_amount = base_amount + service_fee;

    // Check availability
    const conflict = await client.query(`
      SELECT id FROM property_bookings
      WHERE property_id=$1 AND booking_status NOT IN ('cancelled')
      AND check_in_date < $2 AND check_out_date > $3
    `, [req.params.id, check_out_date, check_in_date]);
    if (conflict.rows.length > 0) return res.status(400).json({ error: 'Property not available for these dates.' });

    await client.query('BEGIN');

    // Handle wallet payment
    if (payment_method === 'wallet') {
      const userRes = await client.query('SELECT wallet_balance FROM users WHERE id=$1', [req.user.id]);
      if (parseFloat(userRes.rows[0].wallet_balance) < total_amount) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Insufficient wallet balance.' });
      }
      await client.query('UPDATE users SET wallet_balance = wallet_balance - $1 WHERE id=$2', [total_amount, req.user.id]);
    }

    // Generate QR
    const qr_code = jwt.sign(
      { property_id: req.params.id, user_id: req.user.id, check_in: check_in_date, check_out: check_out_date },
      process.env.JWT_SECRET, { expiresIn: '365d' }
    );

    const bookingRes = await client.query(`
      INSERT INTO property_bookings (
        property_id, room_id, user_id, check_in_date, check_out_date, nights, guests,
        base_amount, service_fee, total_amount, payment_method, payment_status,
        booking_status, qr_code, special_requests, cancellation_policy
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *
    `, [
      req.params.id, room_id || null, req.user.id, check_in_date, check_out_date,
      nights, guests, base_amount, service_fee, total_amount,
      payment_method, payment_method === 'wallet' ? 'paid' : 'pending',
      payment_method === 'wallet' ? 'confirmed' : 'pending',
      qr_code, special_requests || null, property.cancellation_policy
    ]);

    // CPP points
    const cpp = Math.floor(total_amount / 1000) * 10;
    if (cpp > 0) await client.query('UPDATE users SET cpp_points = cpp_points + $1 WHERE id=$2', [cpp, req.user.id]);

    await client.query('COMMIT');
    res.json({ booking: bookingRes.rows[0], cpp_earned: cpp });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

// ── MY BOOKINGS ──────────────────────────────────────────
router.get('/my/bookings', auth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT pb.*, p.name as property_name, p.cover_image, p.address, p.neighbourhood, p.type
      FROM property_bookings pb
      JOIN properties p ON pb.property_id = p.id
      WHERE pb.user_id = $1
      ORDER BY pb.created_at DESC
    `, [req.user.id]);
    res.json({ bookings: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── CONFIRM PAYSTACK PAYMENT ─────────────────────────────
router.post('/confirm-payment', auth, async (req, res) => {
  const client = await db.pool.connect();
  try {
    const { reference, booking_id } = req.body;
    const axios = require('axios');
    const verify = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` } }
    );
    if (verify.data.data.status !== 'success') return res.status(400).json({ error: 'Payment not successful.' });

    await client.query('BEGIN');
    await client.query(
      `UPDATE property_bookings SET payment_status='paid', booking_status='confirmed', payment_ref=$1 WHERE id=$2`,
      [reference, booking_id]
    );
    const bookingRes = await client.query('SELECT * FROM property_bookings WHERE id=$1', [booking_id]);
    const cpp = Math.floor(bookingRes.rows[0].total_amount / 1000) * 10;
    if (cpp > 0) await client.query('UPDATE users SET cpp_points = cpp_points + $1 WHERE id=$2', [cpp, req.user.id]);
    await client.query('COMMIT');
    res.json({ booking: bookingRes.rows[0], cpp_earned: cpp });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

// ── CANCEL BOOKING ───────────────────────────────────────
router.patch('/:id/cancel', auth, async (req, res) => {
  try {
    const { reason } = req.body;
    const result = await db.query(
      `UPDATE property_bookings SET booking_status='cancelled', cancelled_at=NOW(), cancellation_reason=$1
       WHERE id=$2 AND user_id=$3 RETURNING *`,
      [reason || null, req.params.id, req.user.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Booking not found.' });
    res.json({ booking: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── WRITE REVIEW ─────────────────────────────────────────
router.post('/:id/review', auth, async (req, res) => {
  try {
    const { booking_id, overall_rating, cleanliness_rating, accuracy_rating, location_rating, review_text } = req.body;
    const result = await db.query(`
      INSERT INTO property_reviews (property_id, booking_id, user_id, overall_rating, cleanliness_rating, accuracy_rating, location_rating, review_text)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *
    `, [req.params.id, booking_id, req.user.id, overall_rating, cleanliness_rating, accuracy_rating, location_rating, review_text]);

    // Update avg rating
    await db.query(`
      UPDATE properties SET
        avg_rating = (SELECT AVG(overall_rating) FROM property_reviews WHERE property_id=$1),
        review_count = (SELECT COUNT(*) FROM property_reviews WHERE property_id=$1)
      WHERE id=$1
    `, [req.params.id]);

    res.json({ review: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── ADMIN: GET ALL PROPERTIES ────────────────────────────
router.get('/admin/all', auth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT p.*, v.business_name as host_name
      FROM properties p
      LEFT JOIN vendors v ON p.host_id = v.id
      ORDER BY p.created_at DESC
    `);
    res.json({ properties: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
