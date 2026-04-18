const router = require("express").Router();
const db = require("../DB");

// GET /api/events
router.get("/", async (req, res) => {
  try {
    const { city = "Lagos", category, date, free, limit = 20, offset = 0 } = req.query;
    let query = `SELECT e.*, v.name as venue_name, v.neighbourhood, v.address,
                        json_agg(json_build_object('id',t.id,'name',t.name,'price',t.price,'available',t.quantity-t.sold)) as tiers
                 FROM events e
                 JOIN venues v ON e.venue_id=v.id
                 LEFT JOIN ticket_tiers t ON t.event_id=e.id AND t.is_active=true
                 WHERE e.is_live=true AND v.city=$1 AND e.event_date >= CURRENT_DATE`;
    const params = [city];
    let i = 2;
    if (category) { query += ` AND e.category=$${i++}`; params.push(category); }
    if (date) { query += ` AND e.event_date=$${i++}`; params.push(date); }
    if (free === "true") { query += ` AND e.is_free=true`; }
    query += ` GROUP BY e.id, v.name, v.neighbourhood, v.address
               ORDER BY e.is_featured DESC, e.event_date ASC
               LIMIT $${i} OFFSET $${i + 1}`;
    params.push(limit, offset);
    const result = await db.query(query, params);
    res.json({ events: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/events/:id
router.get("/:id", async (req, res) => {
  try {
    const result = await db.query(
      `SELECT e.*, v.name as venue_name, v.address, v.neighbourhood, v.latitude, v.longitude,
              json_agg(json_build_object('id',t.id,'name',t.name,'description',t.description,
              'price',t.price,'available',t.quantity-t.sold)) as tiers
       FROM events e
       JOIN venues v ON e.venue_id=v.id
       LEFT JOIN ticket_tiers t ON t.event_id=e.id
       WHERE e.id=$1 GROUP BY e.id, v.name, v.address, v.neighbourhood, v.latitude, v.longitude`,
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Event not found." });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;