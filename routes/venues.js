const router = require("express").Router();
const db = require("../db");
const auth = require("../middleware/auth");

// GET /api/venues/:id
router.get("/:id", async (req, res) => {
  try {
    const result = await db.query("SELECT * FROM venues WHERE id=$1", [req.params.id]);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/venues/:id - Update venue
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
