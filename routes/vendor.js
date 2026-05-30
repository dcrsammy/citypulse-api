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
      "SELECT id, business_name, owner_full_name, email, kyc_status, is_verified FROM vendors WHERE id=$1",
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

module.exports = router;

// PATCH /api/vendor/venue/:id - Update venue (vendor auth)
router.patch("/venue/:id", auth, async (req, res) => {
  try {
    const { cover_image, price_range, description, is_open } = req.body;
    const result = await db.query(
      `UPDATE venues SET 
        cover_image = COALESCE($1, cover_image),
        price_range = COALESCE($2, price_range),
        description = COALESCE($3, description),
        is_open = COALESCE($4, is_open)
       WHERE id=$5 AND vendor_id=$6 RETURNING *`,
      [cover_image, price_range, description, is_open, req.params.id, req.user.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: "Venue not found" });
    res.json({ venue: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
