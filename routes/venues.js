const router = require("express").Router();
const db = require("../db");
const auth = require("../middleware/auth");

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
      query += ` AND (
        LOWER(name) LIKE LOWER($${paramCount}) OR 
        LOWER(description) LIKE LOWER($${paramCount}) OR
        LOWER(address) LIKE LOWER($${paramCount}) OR
        LOWER(neighbourhood) LIKE LOWER($${paramCount})
      )`;
      params.push(`%${search}%`);
    }

    if (sort === 'newest') {
      query += ` ORDER BY created_at DESC`;
    } else if (sort === 'price_asc') {
      query += ` ORDER BY price_range ASC`;
    } else {
      query += ` ORDER BY avg_rating DESC`;
    }

    paramCount++;
    query += ` LIMIT $${paramCount}`;
    params.push(parseInt(limit));

    const result = await db.query(query, params);
    res.json({ venues: result.rows });
  } catch (err) {
    console.error("Error fetching venues:", err.message);
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

// PATCH /api/venues/:id
router.patch("/:id", auth, async (req, res) => {
  try {
    const { is_open } = req.body;
    const result = await db.query(
      "UPDATE venues SET is_open=$1 WHERE id=$2 RETURNING *",
      [is_open, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
