const router = require("express").Router();
const db = require("../db");
const auth = require("../middleware/auth");

// POST /api/reviews
router.post("/", auth, async (req, res) => {
  try {
    const { venue_id, booking_id, rating, atmosphere_rating, service_rating, value_rating, review_text, tags } = req.body;
    if (!venue_id || !rating) return res.status(400).json({ error: "venue_id and rating required." });

    const result = await db.query(
      `INSERT INTO reviews (user_id,venue_id,booking_id,rating,atmosphere_rating,service_rating,value_rating,review_text,tags)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [req.user.id, venue_id, booking_id || null, rating, atmosphere_rating || null, service_rating || null, value_rating || null, review_text || null, tags || []]
    );

    await db.query("UPDATE users SET cpp_points=cpp_points+50 WHERE id=$1", [req.user.id]);
    await db.query(
      `UPDATE venues SET
         avg_rating=(SELECT AVG(rating) FROM reviews WHERE venue_id=$1 AND is_approved=true),
         review_count=(SELECT COUNT(*) FROM reviews WHERE venue_id=$1 AND is_approved=true)
       WHERE id=$1`, [venue_id]
    );

    res.status(201).json({ review: result.rows[0], cpp_earned: 50 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/reviews/venue/:id
router.get("/venue/:id", async (req, res) => {
  try {
    const result = await db.query(
      `SELECT r.*, u.full_name, u.avatar_url
       FROM reviews r JOIN users u ON r.user_id=u.id
       WHERE r.venue_id=$1 AND r.is_approved=true
       ORDER BY r.created_at DESC LIMIT 20`,
      [req.params.id]
    );
    res.json({ reviews: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;