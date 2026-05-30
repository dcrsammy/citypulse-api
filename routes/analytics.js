const router = require("express").Router();
const db = require("../db");
const auth = require("../middleware/auth");

// GET /api/analytics/vendor - Vendor analytics
router.get("/vendor", auth, async (req, res) => {
  try {
    // Get vendor's venues
    const venues = await db.query("SELECT id FROM venues WHERE vendor_id=$1", [req.user.id]);
    const venueIds = venues.rows.map(v => v.id);

    if (venueIds.length === 0) {
      return res.json({ stats: { total_revenue: 0, total_orders: 0, avg_order_value: 0, top_items: [] } });
    }

    // Revenue & order count
    const stats = await db.query(
      `SELECT 
        SUM(total_amount) as total_revenue,
        COUNT(*) as total_orders,
        AVG(total_amount) as avg_order_value
       FROM food_orders 
       WHERE venue_id = ANY($1)`,
      [venueIds]
    );

    // Top items
    const topItems = await db.query(
      `SELECT foi.name, COUNT(*) as qty, SUM(foi.subtotal) as revenue
       FROM food_order_items foi
       JOIN food_orders fo ON foi.order_id = fo.id
       WHERE fo.venue_id = ANY($1)
       GROUP BY foi.name
       ORDER BY qty DESC LIMIT 5`,
      [venueIds]
    );

    res.json({
      stats: stats.rows[0],
      topItems: topItems.rows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
