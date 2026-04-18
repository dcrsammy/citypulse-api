const router = require("express").Router();
const db = require("../db");
const auth = require("../middleware/auth");

// GET /api/venues
router.get("/", async (req, res) => {
  try {
    const { city = "Lagos", category, neighbourhood, search, limit = 20, offset = 0 } = req.query;
    let query = `SELECT v.*, vn.business_name as vendor_name
                 FROM venues v
                 JOIN vendors vn ON v.vendor_id = vn.id
                 WHERE v.is_live=true AND v.city=$1`;
    const params = [city];
    let i = 2;
    if (category) { query += ` AND v.category=$${i++}`; params.push(category); }
    if (neighbourhood) { query += ` AND v.neighbourhood=$${i++}`; params.push(neighbourhood); }
    if (search) { query += ` AND (v.name ILIKE $${i} OR v.description ILIKE $${i})`; params.push(`%${search}%`); i++; }
    query += ` ORDER BY v.is_featured DESC, v.avg_rating DESC LIMIT $${i} OFFSET $${i + 1}`;
    params.push(limit, offset);
    const result = await db.query(query, params);
    res.json({ venues: result.rows, count: result.rowCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/venues/:id
router.get("/:id", async (req, res) => {
  try {
    const result = await db.query(
      `SELECT v.*, vn.business_name as vendor_name, vn.phone as vendor_phone
       FROM venues v JOIN vendors vn ON v.vendor_id=vn.id
       WHERE v.id=$1 AND v.is_live=true`, [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Venue not found." });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/venues/:id/save
router.post("/:id/save", auth, async (req, res) => {
  try {
    const exists = await db.query(
      "SELECT 1 FROM saved_venues WHERE user_id=$1 AND venue_id=$2",
      [req.user.id, req.params.id]
    );
    if (exists.rows.length) {
      await db.query("DELETE FROM saved_venues WHERE user_id=$1 AND venue_id=$2", [req.user.id, req.params.id]);
      res.json({ saved: false });
    } else {
      await db.query("INSERT INTO saved_venues (user_id, venue_id) VALUES ($1,$2)", [req.user.id, req.params.id]);
      res.json({ saved: true });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;