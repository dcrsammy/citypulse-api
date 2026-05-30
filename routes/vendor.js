const router = require("express").Router();
const db = require("../db");
const auth = require("../middleware/auth");

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

module.exports = router;

// GET /api/vendor/orders - Get vendor's orders
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

    // Get orders for those venues
    const result = await db.query(
      `SELECT fo.id, fo.user_id, fo.total_amount, fo.order_status, fo.created_at, u.full_name
       FROM food_orders fo
       LEFT JOIN users u ON fo.user_id = u.id
       WHERE fo.venue_id = ANY($1)
       ORDER BY fo.created_at DESC`,
      [venueIds]
    );

    res.json({ orders: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
