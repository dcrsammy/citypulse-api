const router = require("express").Router();
const db = require("../db");
const auth = require("../middleware/auth");

// GET /api/venues - Public: List all active restaurants
router.get("/", async (req, res) => {
  try {
    console.log("Fetching all active venues...");
    const result = await db.query(
      `SELECT id, name, category, cover_image, address, latitude, longitude, 
              avg_rating, avg_prep_time_mins, is_live, delivery_zone_km
       FROM venues 
       WHERE is_live = true AND is_verified = true
       ORDER BY avg_rating DESC`
    );
    console.log("Found venues:", result.rows.length);
    res.json({ venues: result.rows });
  } catch (err) {
    console.error("Venues error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/venues/:id - Get single venue
router.get("/:id", async (req, res) => {
  try {
    const result = await db.query(
      `SELECT * FROM venues WHERE id=$1`,
      [req.params.id]
    );
    res.json(result.rows[0] || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/venues/:id - Update venue (requires auth)
router.patch("/:id", auth, async (req, res) => {
  try {
    const { is_open, min_order_amount, delivery_zone_km } = req.body;
    const result = await db.query(
      "UPDATE venues SET is_open=$1, min_order_amount=$2, delivery_zone_km=$3 WHERE id=$4 RETURNING *",
      [is_open, min_order_amount, delivery_zone_km, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
