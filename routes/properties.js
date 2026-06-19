const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const jwt = require('jsonwebtoken');

// GET /api/properties — list properties
router.get('/', async (req, res) => {
  try {
    const { type, neighbourhood, min_price, max_price, guests, limit = 20, offset = 0 } = req.query;
    let where = [`p.is_live = true`, `p.status = 'approved'`];
    let params = [];
    let idx = 1;
    if (type) { where.push(`p.type = $${idx++}`); params.push(type); }
    if (neighbourhood) { where.push(`p.neighbourhood ILIKE $${idx++}`); params.push(`%${neighbourhood}%`); }
    if (min_price) { where.push(`p.base_price_per_night >= $${idx++}`); params.push(min_price); }
    if (max_price) { where.push(`p.base_price_per_night <= $${idx++}`); params.push(max_price); }
    if (guests) { where.push(`p.max_guests >= $${idx++}`); params.push(guests); }
    params.push(limit, offset);
    const result = await db.query(`
      SELECT p.*,
        p.amenities,
        COUNT(pb.id) FILTER (WHERE pb.booking_status = 'confirmed') as total_bookings
      FROM properties p

      LEFT JOIN property_bookings pb ON pb.property_id = p.id
      WHERE ${where.join(' AND ')}
      GROUP BY p.id
      ORDER BY p.is_featured DESC, p.avg_rating DESC
      LIMIT $${idx++} OFFSET $${idx++}
    `, params);
    res.json({ properties: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/properties/my/bookings — user bookings
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

// GET /api/properties/:id — single property
router.get('/my', auth, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT p.*, COUNT(pb.id) as total_bookings, 
        COALESCE(SUM(pb.total_amount) FILTER (WHERE pb.payment_status='paid'), 0) as total_revenue
       FROM properties p
       LEFT JOIN property_bookings pb ON pb.property_id = p.id
       WHERE p.host_id = $1
       GROUP BY p.id ORDER BY p.created_at DESC`,
      [req.user.id]
    );
    res.json({ properties: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT p.*,
        p.amenities,
        json_agg(DISTINCT jsonb_build_object(
          'id', pr.id, 'name', pr.name, 'description', pr.description,
          'price_per_night', pr.price_per_night, 'max_guests', pr.max_guests,
          'quantity', pr.quantity, 'amenities', pr.amenities, 'images', pr.images
        )) FILTER (WHERE pr.id IS NOT NULL) as rooms
      FROM properties p

      LEFT JOIN property_rooms pr ON pr.property_id = p.id
      WHERE p.id = $1
      GROUP BY p.id
    `, [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Property not found.' });
    const reviews = await db.query(`
      SELECT pr.*, u.full_name, u.avatar_url FROM property_reviews pr
      JOIN users u ON pr.user_id = u.id
      WHERE pr.property_id = $1 ORDER BY pr.created_at DESC LIMIT 10
    `, [req.params.id]);
    const booked = await db.query(`
      SELECT check_in_date, check_out_date FROM property_bookings
      WHERE property_id = $1 AND booking_status NOT IN ('cancelled')
    `, [req.params.id]);
    res.json({ property: result.rows[0], reviews: reviews.rows, booked_ranges: booked.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/properties/:id/book — book property
router.post('/:id/book', auth, async (req, res) => {
  const client = await db.pool.connect();
  try {
    const { check_in_date, check_out_date, guests, room_id, payment_method, special_requests } = req.body;
    const propRes = await client.query('SELECT * FROM properties WHERE id=$1', [req.params.id]);
    const property = propRes.rows[0];
    if (!property) return res.status(404).json({ error: 'Property not found.' });
    const checkIn = new Date(check_in_date);
    const checkOut = new Date(check_out_date);
    const nights = Math.ceil((checkOut - checkIn) / (1000 * 60 * 60 * 24));
    if (nights < 1) return res.status(400).json({ error: 'Check-out must be after check-in.' });
    const today = new Date(); today.setHours(0,0,0,0);
    if (checkIn < today) return res.status(400).json({ error: 'Check-in date cannot be in the past.' });
    const isWeekend = checkIn.getDay() === 5 || checkIn.getDay() === 6;
    const nightlyRate = isWeekend && property.weekend_price ? property.weekend_price : property.base_price_per_night;
    const base_amount = nightlyRate * nights;
    const service_fee = Math.round(base_amount * 0.08);
    const total_amount = base_amount + service_fee;
    const conflict = await client.query(`
      SELECT id FROM property_bookings
      WHERE property_id=$1 AND booking_status NOT IN ('cancelled')
      AND check_in_date < $2 AND check_out_date > $3
    `, [req.params.id, check_out_date, check_in_date]);
    if (conflict.rows.length > 0) return res.status(400).json({ error: 'Property not available for these dates.' });
    await client.query('BEGIN');
    if (payment_method === 'wallet') {
      const userRes = await client.query('SELECT wallet_balance FROM users WHERE id=$1', [req.user.id]);
      if (parseFloat(userRes.rows[0].wallet_balance) < total_amount) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Insufficient wallet balance.' });
      }
      await client.query('UPDATE users SET wallet_balance = wallet_balance - $1 WHERE id=$2', [total_amount, req.user.id]);
    }
    const bookingRef = 'CPSTAY-' + Date.now().toString(36).toUpperCase().slice(-6);
    const qr_code = bookingRef;
    const bookingRes = await client.query(`
      INSERT INTO property_bookings (property_id, room_id, user_id, check_in_date, check_out_date, nights, guests,
        base_amount, service_fee, total_amount, payment_method, payment_status, booking_status, qr_code, special_requests, cancellation_policy)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *
    `, [req.params.id, room_id||null, req.user.id, check_in_date, check_out_date, nights, guests||1,
        base_amount, service_fee, total_amount, payment_method,
        payment_method==='wallet'?'paid':'pending',
        payment_method==='wallet'?'confirmed':'pending',
        qr_code, special_requests||null, property.cancellation_policy]);
    const cpp = Math.floor(total_amount / 1000) * 10;
    if (cpp > 0) await client.query('UPDATE users SET cpp_points = cpp_points + $1 WHERE id=$2', [cpp, req.user.id]);
    await client.query('COMMIT');
    res.json({ booking: bookingRes.rows[0], cpp_earned: cpp });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

// POST /api/properties/confirm-payment
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

// PATCH /api/properties/:id/cancel
router.patch('/:id/cancel', auth, async (req, res) => {
  const client = await db.pool.connect();
  try {
    const { reason } = req.body;
    await client.query('BEGIN');
    
    const bookingRes = await client.query(
      'SELECT * FROM property_bookings WHERE id=$1 AND user_id=$2',
      [req.params.id, req.user.id]
    );
    if (!bookingRes.rows[0]) return res.status(404).json({ error: 'Booking not found.' });
    const booking = bookingRes.rows[0];
    
    if (booking.booking_status === 'cancelled')
      return res.status(400).json({ error: 'Booking already cancelled.' });

    // Calculate refund based on cancellation policy
    const daysToCheckIn = Math.ceil((new Date(booking.check_in_date) - new Date()) / (1000 * 60 * 60 * 24));
    let refundPercent = 0;
    const policy = booking.cancellation_policy || 'moderate';
    
    if (policy === 'flexible') {
      refundPercent = daysToCheckIn >= 1 ? 100 : 0;
    } else if (policy === 'moderate') {
      refundPercent = daysToCheckIn >= 5 ? 100 : daysToCheckIn >= 1 ? 50 : 0;
    } else if (policy === 'strict') {
      refundPercent = daysToCheckIn >= 14 ? 100 : daysToCheckIn >= 7 ? 50 : 0;
    }

    const refundAmount = parseFloat(booking.total_amount) * (refundPercent / 100);

    // Cancel booking
    await client.query(
      "UPDATE property_bookings SET booking_status='cancelled', cancelled_at=NOW(), cancellation_reason=$1 WHERE id=$2",
      [reason||null, req.params.id]
    );

    // Process refund if applicable
    if (refundAmount > 0 && booking.payment_status === 'paid') {
      await client.query(
        'UPDATE users SET wallet_balance = wallet_balance + $1 WHERE id=$2',
        [refundAmount, req.user.id]
      );
      await client.query(
        "INSERT INTO wallet_transactions (user_id,type,amount,balance_after,description,status) SELECT $1,'refund',$2,wallet_balance,'Booking cancellation refund','completed' FROM users WHERE id=$1",
        [req.user.id, refundAmount]
      );
    }

    await client.query('COMMIT');
    res.json({ 
      message: refundAmount > 0 ? `Booking cancelled. ₦${refundAmount.toLocaleString()} refunded to your wallet.` : 'Booking cancelled. No refund applicable.',
      refund_amount: refundAmount,
      refund_percent: refundPercent
    });
  } catch (err) { 
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message }); 
  } finally { client.release(); }
});

// POST /api/properties/:id/review
router.post('/:id/review', auth, async (req, res) => {
  try {
    const { booking_id, overall_rating, cleanliness_rating, accuracy_rating, location_rating, review_text } = req.body;
    const result = await db.query(`
      INSERT INTO property_reviews (property_id, booking_id, user_id, overall_rating, cleanliness_rating, accuracy_rating, location_rating, review_text)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *
    `, [req.params.id, booking_id, req.user.id, overall_rating, cleanliness_rating, accuracy_rating, location_rating, review_text]);
    await db.query(`
      UPDATE properties SET
        avg_rating = (SELECT AVG(overall_rating) FROM property_reviews WHERE property_id=$1),
        review_count = (SELECT COUNT(*) FROM property_reviews WHERE property_id=$1)
      WHERE id=$1
    `, [req.params.id]);
    res.json({ review: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/properties/my — vendor's own properties

// POST /api/properties — create property (hosts only)
router.post('/', auth, async (req, res) => {
  try {
    const vendor = await db.query('SELECT business_types FROM vendors WHERE id=$1', [req.user.id]);
    if (!vendor.rows[0] || !vendor.rows[0].business_types?.includes('property')) {
      return res.status(403).json({ error: 'Property host account required.' });
    }
    const { type, name, description, address, neighbourhood, bedrooms, bathrooms, max_guests,
      base_price_per_night, weekend_price, min_stay_nights, check_in_time, check_out_time,
      cancellation_policy, house_rules, cover_image, images, amenities, rooms } = req.body;
    const result = await db.query(
      `INSERT INTO properties (host_id, type, name, description, address, neighbourhood,
        bedrooms, bathrooms, max_guests, base_price_per_night, weekend_price, min_stay_nights,
        check_in_time, check_out_time, cancellation_policy, house_rules, cover_image, images, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'pending') RETURNING *`,
      [req.user.id, type, name, description, address, neighbourhood, bedrooms||1, bathrooms||1,
       max_guests||2, base_price_per_night, weekend_price||null, min_stay_nights||1,
       check_in_time||'14:00', check_out_time||'11:00', cancellation_policy||'moderate',
       house_rules||null, cover_image||null, images||null]
    );
    // Add amenities
    if (amenities && amenities.length > 0) {
      await db.query('UPDATE properties SET amenities = $1 WHERE id = $2', [amenities, result.rows[0].id]);
    }
    // Add room types
    if (rooms && rooms.length > 0) {
      for (const room of rooms) {
        if (room.name && room.price_per_night) {
          await db.query(
            'INSERT INTO property_rooms (property_id, name, description, price_per_night, max_guests, quantity) VALUES ($1,$2,$3,$4,$5,$6)',
            [result.rows[0].id, room.name, room.description||null, room.price_per_night, room.max_guests||2, room.quantity||1]
          );
        }
      }
    }
    res.json({ property: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/properties/admin/all
router.get('/admin/all', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required.' });
    const result = await db.query(`
      SELECT p.*, v.business_name as host_name
      FROM properties p LEFT JOIN vendors v ON p.host_id = v.id
      ORDER BY p.created_at DESC
    `);
    res.json({ properties: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/properties/:id — update property details / images (host only)
router.patch('/:id', auth, async (req, res) => {
  try {
    const ownerCheck = await db.query('SELECT id FROM properties WHERE id=$1 AND host_id=$2', [req.params.id, req.user.id]);
    if (!ownerCheck.rows[0]) return res.status(403).json({ error: 'Not your property.' });

    const allowed = ['name', 'description', 'address', 'neighbourhood', 'base_price_per_night',
      'weekend_price', 'min_stay_nights', 'check_in_time', 'check_out_time', 'cancellation_policy',
      'house_rules', 'cover_image', 'images', 'amenities', 'max_guests', 'bedrooms', 'bathrooms'];

    const fields = [];
    const values = [];
    let idx = 1;
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        fields.push(`${key} = $${idx++}`);
        values.push(req.body[key]);
      }
    }
    if (fields.length === 0) return res.status(400).json({ error: 'No valid fields to update.' });

    values.push(req.params.id);
    const result = await db.query(
      `UPDATE properties SET ${fields.join(', ')}, updated_at=NOW() WHERE id=$${idx} RETURNING *`,
      values
    );
    res.json({ property: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/properties/host/bookings — all bookings for host's properties
router.get('/host/bookings', auth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT pb.*, p.name as property_name, p.address,
        u.full_name as guest_name, u.phone as guest_phone, u.email as guest_email
      FROM property_bookings pb
      JOIN properties p ON pb.property_id = p.id
      JOIN users u ON pb.user_id = u.id
      WHERE p.host_id = $1
      ORDER BY pb.created_at DESC
    `, [req.user.id]);
    res.json({ bookings: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
