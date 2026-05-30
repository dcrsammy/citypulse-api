const router = require("express").Router();
const db = require("../db");
const auth = require("../middleware/auth");

// GET /api/venues/saved/list - MUST be before /:id routes
router.get("/saved/list", auth, async (req, res) => {
  try {
    const result = await db.query(
      "SELECT v.* FROM venues v JOIN saved_venues sv ON v.id = sv.venue_id WHERE sv.user_id=$1 ORDER BY sv.created_at DESC",
      [req.user.id]
    );
    res.json({ venues: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/venues - Public: List venues with search, filter, sort
router.get("/", async (req, res) => {
  try {
    const { search, category, price_range, sort, city, limit = 30 } = req.query;
    let query = `SELECT * FROM venues WHERE is_live = true`;
    const params = [];
    let paramCount = 0;

    if (city) {
      paramCount++;
      query += ` AND LOWER(city) = LOWER($${paramCount})`;
      params.push(city);
    }
    if (category && category !== 'all') {
      paramCount++;
      query += ` AND category = $${paramCount}`;
      params.push(category);
    }
    if (price_range) {
      paramCount++;
      query += ` AND price_range = $${paramCount}`;
      params.push(parseInt(price_range));
    }
    if (search) {
      paramCount++;
      query += ` AND (LOWER(name) LIKE LOWER($${paramCount}) OR LOWER(description) LIKE LOWER($${paramCount}) OR LOWER(address) LIKE LOWER($${paramCount}) OR LOWER(neighbourhood) LIKE LOWER($${paramCount}))`;
      params.push(`%${search}%`);
    }

    if (sort === 'newest') query += ` ORDER BY created_at DESC`;
    else if (sort === 'price_asc') query += ` ORDER BY price_range ASC`;
    else query += ` ORDER BY avg_rating DESC`;

    paramCount++;
    query += ` LIMIT $${paramCount}`;
    params.push(parseInt(limit));

    const result = await db.query(query, params);
    res.json({ venues: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/venues/:id
router.get("/:id", async (req, res) => {
  try {
    const result = await db.query("SELECT * FROM venues WHERE id=$1", [req.params.id]);
    res.json(result.rows[0] || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/venues/:id/saved - Check if venue is saved
router.get("/:id/saved", auth, async (req, res) => {
  try {
    const existing = await db.query(
      "SELECT user_id FROM saved_venues WHERE user_id=$1 AND venue_id=$2",
      [req.user.id, req.params.id]
    );
    res.json({ saved: !!existing.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/venues/:id/save - Toggle save/unsave
router.post("/:id/save", auth, async (req, res) => {
  try {
    const existing = await db.query(
      "SELECT id FROM saved_venues WHERE user_id=$1 AND venue_id=$2",
      [req.user.id, req.params.id]
    );
    if (existing.rows[0]) {
      await db.query("DELETE FROM saved_venues WHERE user_id=$1 AND venue_id=$2", [req.user.id, req.params.id]);
      res.json({ saved: false });
    } else {
      await db.query("INSERT INTO saved_venues (user_id, venue_id) VALUES ($1, $2)", [req.user.id, req.params.id]);
      res.json({ saved: true });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/venues/:id
router.patch("/:id", auth, async (req, res) => {
  try {
    const { is_open, cover_image, price_range, description } = req.body;
    const result = await db.query(
      "UPDATE venues SET is_open=COALESCE($1, is_open), cover_image=COALESCE($2, cover_image), price_range=COALESCE($3, price_range), description=COALESCE($4, description) WHERE id=$5 RETURNING *",
      [is_open, cover_image, price_range, description, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
