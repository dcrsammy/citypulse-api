
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
      "SELECT id FROM saved_venues WHERE user_id=$1 AND venue_id=$2",
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

// GET /api/venues/search-all — search venues + events + properties
router.get("/search-all", async (req, res) => {
  try {
    const { q, city = 'Lagos' } = req.query;
    if (!q) return res.json({ venues: [], events: [], properties: [] });

    const [venuesRes, eventsRes, propsRes] = await Promise.all([
      db.query(`SELECT id, name, category, neighbourhood, avg_rating, cover_image, 'venue' as type
        FROM venues WHERE is_live=true AND (name ILIKE $1 OR category ILIKE $1 OR neighbourhood ILIKE $1) LIMIT 5`,
        [`%${q}%`]),
      db.query(`SELECT id, title as name, category, address as neighbourhood, cover_image, 'event' as type, event_date
        FROM events WHERE is_live=true AND status='approved' AND (title ILIKE $1 OR category ILIKE $1 OR description ILIKE $1) LIMIT 5`,
        [`%${q}%`]),
      db.query(`SELECT id, name, type as category, neighbourhood, cover_image, 'property' as type, base_price_per_night
        FROM properties WHERE is_live=true AND status='approved' AND (name ILIKE $1 OR neighbourhood ILIKE $1) LIMIT 5`,
        [`%${q}%`])
    ]);

    res.json({
      venues: venuesRes.rows,
      events: eventsRes.rows,
      properties: propsRes.rows
    });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
function sanitize(str) {
  if (!str) return str;
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

