const router = require("express").Router();
const db = require("../db");
const auth = require("../middleware/auth");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

// POST /api/vendor/login
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }

    const result = await db.query(
      "SELECT id, email, password_hash, business_name, kyc_status FROM vendors WHERE email=$1",
      [email]
    );

    if (!result.rows[0]) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const vendor = result.rows[0];
    const isValid = await bcrypt.compare(password, vendor.password_hash);

    if (!isValid) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign(
      { id: vendor.id, email: vendor.email, role: "vendor" },
      process.env.JWT_SECRET || "default_secret",
      { expiresIn: "30d" }
    );

    res.json({
      token,
      vendor: {
        id: vendor.id,
        email: vendor.email,
        business_name: vendor.business_name,
        kyc_status: vendor.kyc_status
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/vendor/me - Get current vendor's profile
router.get("/me", auth, async (req, res) => {
  try {
    const result = await db.query(
      "SELECT id, business_name, owner_full_name, email, kyc_status, is_verified, business_types, is_property_host, is_event_organizer, phone, payout_bank, payout_account, payout_account_name, payout_bank_name, available_payout FROM vendors WHERE id=$1",
      [req.user.id]
    );
    
    if (!result.rows[0]) {
      return res.status(404).json({ error: "Vendor not found" });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/vendor/orders - Get vendor's orders WITH ITEMS
router.get("/orders", auth, async (req, res) => {
  try {
    // Get vendor's venue(s)
    const venuesResult = await db.query(
      "SELECT id FROM venues WHERE vendor_id=$1",
      [req.user.id]
    );
    
    const venueIds = venuesResult.rows.map(v => v.id);
    
    if (venueIds.length === 0) {
      return res.json({ orders: [] });
    }

    // Get orders with items
    const result = await db.query(
      `SELECT 
        fo.id, fo.user_id, fo.venue_id, fo.total_amount, fo.order_status, 
        fo.order_type, fo.special_requests, fo.delivery_address, fo.created_at,
        u.full_name,
        json_agg(json_build_object(
          'name', foi.name, 
          'quantity', foi.quantity,
          'unit_price', foi.unit_price, 
          'subtotal', foi.subtotal,
          'special_notes', foi.special_notes
        )) as items
       FROM food_orders fo
       LEFT JOIN users u ON fo.user_id = u.id
       LEFT JOIN food_order_items foi ON fo.id = foi.order_id
       WHERE fo.venue_id = ANY($1)
       GROUP BY fo.id, u.full_name
       ORDER BY fo.created_at DESC`,
      [venueIds]
    );

    res.json({ orders: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/vendor/venues - Get vendor's venues
router.get("/venues", auth, async (req, res) => {
  try {
    const result = await db.query(
      "SELECT * FROM venues WHERE vendor_id=$1",
      [req.user.id]
    );
    res.json({ venues: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});



// PATCH /api/vendor/venue/:id - Update venue (vendor auth)
router.patch("/venue/:id", auth, async (req, res) => {
  try {
    const { cover_image, price_range, description, images, slideshow_interval, name, phone, min_order_amount, avg_prep_time_mins, accepts_dinein, accepts_pickup, accepts_delivery } = req.body;
    // Convert JS array to PostgreSQL array format
    const imagesArray = images && images.length > 0 ? images : null;
    const result = await db.query(
      "UPDATE venues SET cover_image=COALESCE($1,cover_image), price_range=COALESCE($2,price_range), description=COALESCE($3,description), images=COALESCE($4::text[],images), slideshow_interval=COALESCE($5,slideshow_interval), name=COALESCE($6,name), phone=COALESCE($7,phone), min_order_amount=COALESCE($8,min_order_amount), avg_prep_time_mins=COALESCE($9,avg_prep_time_mins), accepts_dinein=COALESCE($10,accepts_dinein), accepts_pickup=COALESCE($11,accepts_pickup), accepts_delivery=COALESCE($12,accepts_delivery) WHERE id=$13 AND vendor_id=$14 RETURNING *",
      [cover_image, price_range, description, imagesArray, slideshow_interval, name, phone, min_order_amount, avg_prep_time_mins, accepts_dinein, accepts_pickup, accepts_delivery, req.params.id, req.user.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: "Venue not found" });
    res.json({ venue: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/vendor/venues - Create new venue
router.post("/venues", auth, async (req, res) => {
  try {
    const { name, description, address, neighbourhood, city, phone, price_range, category, venue_type, accepts_dinein, accepts_pickup, accepts_delivery, avg_prep_time_mins } = req.body;
    
    if (!name || !address) return res.status(400).json({ error: "Name and address are required" });

    // Generate slug
    const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '-') + '-' + Math.random().toString(36).substring(2, 7);

    const result = await db.query(
      "INSERT INTO venues (vendor_id, name, slug, description, address, neighbourhood, city, phone, price_range, category, venue_type, accepts_dinein, accepts_pickup, accepts_delivery, avg_prep_time_mins, is_live, is_verified) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,false,false) RETURNING *",
      [req.user.id, name, slug, description || null, address, neighbourhood || null, city || 'Lagos', phone || null, price_range || 2, category || 'restaurant', venue_type || 'restaurant', accepts_dinein ?? true, accepts_pickup ?? true, accepts_delivery ?? false, avg_prep_time_mins || 20]
    );

    res.status(201).json({ venue: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/vendor/payout - Get payout info and balance
router.get("/payout", auth, async (req, res) => {
  try {
    const vendor = await db.query(
      "SELECT payout_bank, payout_account, payout_account_name FROM vendors WHERE id=$1",
      [req.user.id]
    );

    // Calculate available balance (total sales - 25% commission)
    const venuesRes = await db.query("SELECT id FROM venues WHERE vendor_id=$1", [req.user.id]);
    const venueIds = venuesRes.rows.map(v => v.id);
    
    let available_balance = 0;
    if (venueIds.length > 0) {
      const balanceRes = await db.query(
        "SELECT COALESCE(SUM(total_amount - platform_fee), 0) as balance FROM food_orders WHERE venue_id = ANY($1) AND payment_status='paid' AND payout_status IS DISTINCT FROM 'paid'",
        [venueIds]
      );
      available_balance = parseFloat(balanceRes.rows[0].balance) || 0;
    }

    res.json({
      ...vendor.rows[0],
      available_balance
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/vendor/payout/bank - Update bank details
router.patch("/payout/bank", auth, async (req, res) => {
  try {
    const { bank_code, account_number, account_name, bank_name } = req.body;
    if (!bank_code || !account_number || !account_name) {
      return res.status(400).json({ error: "Bank code, account number and account name are required" });
    }
    await db.query(
      "UPDATE vendors SET payout_bank=$1, payout_account=$2, payout_account_name=$3, payout_bank_name=$4 WHERE id=$5",
      [bank_code, account_number, account_name, bank_name || null, req.user.id]
    );
    res.json({ message: "Bank details updated!" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/vendor/payout/request - Request payout
router.post("/payout/request", auth, async (req, res) => {
  const axios = require('axios');
  try {
    const vendor = await db.query(
      "SELECT * FROM vendors WHERE id=$1",
      [req.user.id]
    );
    const v = vendor.rows[0];

    if (!v.payout_bank || !v.payout_account) {
      return res.status(400).json({ error: "Please add your bank details first" });
    }

    // Calculate available balance
    const venuesRes = await db.query("SELECT id FROM venues WHERE vendor_id=$1", [req.user.id]);
    const venueIds = venuesRes.rows.map(venue => venue.id);
    
    if (venueIds.length === 0) {
      return res.status(400).json({ error: "No venues found" });
    }

    const balanceRes = await db.query(
      "SELECT COALESCE(SUM(total_amount - platform_fee), 0) as balance FROM food_orders WHERE venue_id = ANY($1) AND payment_status='paid' AND payout_status IS DISTINCT FROM 'paid'",
      [venueIds]
    );
    const amount = parseFloat(balanceRes.rows[0].balance) || 0;

    if (amount < 1000) {
      return res.status(400).json({ error: "Minimum payout is ₦1,000. Current balance: ₦" + amount.toLocaleString() });
    }

    const headers = {
      Authorization: "Bearer " + process.env.PAYSTACK_SECRET_KEY,
      "Content-Type": "application/json"
    };

    // Create transfer recipient
    const recipientRes = await axios.post(
      "https://api.paystack.co/transferrecipient",
      { type: "nuban", name: v.payout_account_name, account_number: v.payout_account, bank_code: v.payout_bank, currency: "NGN" },
      { headers }
    );
    const recipient_code = recipientRes.data.data.recipient_code;

    // Initiate transfer
    const transferRes = await axios.post(
      "https://api.paystack.co/transfer",
      { source: "balance", amount: Math.round(amount * 100), recipient: recipient_code, reason: "CityPulse vendor payout" },
      { headers }
    );

    if (transferRes.data.data.status === "success" || transferRes.data.data.status === "pending") {
      // Mark orders as paid out
      await db.query(
        "UPDATE food_orders SET payout_status='paid' WHERE venue_id = ANY($1) AND payment_status='paid' AND payout_status IS DISTINCT FROM 'paid'",
        [venueIds]
      );

      res.json({
        success: true,
        message: "₦" + amount.toLocaleString() + " payout initiated! Arrives in 1-2 minutes.",
        amount,
        transfer_status: transferRes.data.data.status
      });
    } else {
      res.status(400).json({ error: "Transfer failed. Please try again." });
    }
  } catch (err) {
    res.status(500).json({ error: err.response?.data?.message || err.message });
  }
});

// PATCH /api/vendor/me - Update vendor profile
router.patch("/me", auth, async (req, res) => {
  try {
    const { business_name, phone } = req.body;
    const result = await db.query(
      `UPDATE vendors SET
        business_name = COALESCE($1, business_name),
        phone = COALESCE($2, phone)
       WHERE id=$3 RETURNING id, business_name, email, phone, is_verified, business_types`,
      [business_name || null, phone || null, req.user.id]
    );
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/vendor/dashboard — role-aware summary
router.get("/dashboard", auth, async (req, res) => {
  try {
    const vendorRes = await db.query(
      "SELECT business_types, is_property_host, is_event_organizer FROM vendors WHERE id=$1",
      [req.user.id]
    );
    if (!vendorRes.rows[0]) return res.status(404).json({ error: "Vendor not found." });
    const { business_types = [], is_property_host, is_event_organizer } = vendorRes.rows[0];

    const dashboard = { business_types };

    // Food/restaurant stats
    if (business_types.includes("restaurant") || business_types.includes("bar") || business_types.includes("cafe")) {
      const venuesRes = await db.query("SELECT id FROM venues WHERE vendor_id=$1", [req.user.id]);
      const venueIds = venuesRes.rows.map(v => v.id);
      if (venueIds.length > 0) {
        const stats = await db.query(`
          SELECT
            COUNT(*) FILTER (WHERE payment_status='paid') as total_orders,
            COALESCE(SUM(total_amount) FILTER (WHERE payment_status='paid'), 0) as total_revenue,
            COUNT(*) FILTER (WHERE order_status='pending') as pending_orders,
            COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days' AND payment_status='paid') as orders_this_week
          FROM food_orders WHERE venue_id = ANY($1)
        `, [venueIds]);
        dashboard.food = stats.rows[0];
        dashboard.venues = venuesRes.rows.length;
      }
    }

    // Property/hotel stats
    if (is_property_host || business_types.includes("property")) {
      const stats = await db.query(`
        SELECT
          COUNT(p.id) as total_properties,
          COUNT(pb.id) FILTER (WHERE pb.booking_status='confirmed') as active_bookings,
          COALESCE(SUM(pb.total_amount) FILTER (WHERE pb.payment_status='paid'), 0) as total_revenue,
          COUNT(pb.id) FILTER (WHERE pb.booking_status='pending') as pending_bookings
        FROM properties p
        LEFT JOIN property_bookings pb ON pb.property_id = p.id
        WHERE p.host_id = $1
      `, [req.user.id]);
      dashboard.properties = stats.rows[0];
    }

    // Events stats
    if (is_event_organizer || business_types.includes("events")) {
      const stats = await db.query(`
        SELECT
          COUNT(e.id) as total_events,
          COUNT(ep.id) FILTER (WHERE ep.payment_status='paid') as tickets_sold,
          COALESCE(SUM(ep.total_amount) FILTER (WHERE ep.payment_status='paid'), 0) as total_revenue,
          COUNT(e.id) FILTER (WHERE e.is_live=true) as live_events
        FROM events e
        LEFT JOIN event_purchases ep ON ep.event_id = e.id
        WHERE e.vendor_id = $1
      `, [req.user.id]);
      dashboard.events = stats.rows[0];
    }

    res.json(dashboard);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/vendor/scan-ticket — verify event ticket
router.post("/scan-ticket", auth, async (req, res) => {
  try {
    const { qr_code } = req.body;
    if (!qr_code) return res.status(400).json({ error: "QR code required." });
    const result = await db.query(`
      SELECT et.*, e.title as event_title, e.event_date,
        u.full_name as guest_name, tt.name as ticket_type
      FROM event_tickets et
      JOIN events e ON et.event_id = e.id
      JOIN users u ON et.user_id = u.id
      JOIN event_ticket_types tt ON et.ticket_type_id = tt.id
      WHERE et.qr_code = $1
    `, [qr_code]);
    if (!result.rows[0]) return res.status(404).json({ error: "Invalid ticket." });
    const ticket = result.rows[0];
    if (ticket.is_used) return res.status(400).json({ error: "Ticket already used.", ticket });
    // Mark as used
    await db.query("UPDATE event_tickets SET is_used=true, used_at=NOW() WHERE id=$1", [ticket.id]);
    res.json({ valid: true, message: "Ticket verified!", ticket });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// POST /api/vendor/scan-order — mark food order as picked up
router.post("/scan-order", auth, async (req, res) => {
  try {
    const { qr_code } = req.body;
    if (!qr_code) return res.status(400).json({ error: "QR code required." });
    const result = await db.query(
      "SELECT * FROM food_orders WHERE qr_code=$1", [qr_code]
    );
    if (!result.rows[0]) return res.status(404).json({ error: "Invalid QR code." });
    const order = result.rows[0];
    if (order.order_status === 'completed') return res.status(400).json({ error: "Order already completed.", order });
    await db.query(
      "UPDATE food_orders SET order_status='completed', picked_up_at=NOW() WHERE id=$1",
      [order.id]
    );
    res.json({ valid: true, message: "Order marked as completed!", order });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/vendor/property-bookings/:id/cancel — cancel property booking
router.patch("/property-bookings/:id/cancel", auth, async (req, res) => {
  try {
    const { reason } = req.body;
    await db.query(
      "UPDATE property_bookings SET booking_status='cancelled', cancellation_reason=$1, cancelled_at=NOW() WHERE id=$2",
      [reason || 'Cancelled by host', req.params.id]
    );
    res.json({ message: "Booking cancelled." });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
