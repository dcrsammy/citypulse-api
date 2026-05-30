const router = require("express").Router();
const db = require("../db");
const auth = require("../middleware/auth");

// GET /api/reviews?venue_id=xxx
router.get("/", async (req, res) => {
  try {
    const { venue_id } = req.query;
    const result = await db.query(
      "SELECT r.*, u.full_name FROM reviews r LEFT JOIN users u ON r.user_id = u.id WHERE r.venue_id=$1 ORDER BY r.created_at DESC",
      [venue_id]
    );
    res.json({ reviews: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/reviews/:id/reply - Reply to review
router.post("/:id/reply", auth, async (req, res) => {
  try {
    const { reply_text } = req.body;
    const result = await db.query(
      "UPDATE reviews SET vendor_reply=$1, vendor_reply_at=NOW() WHERE id=$2 RETURNING *",
      [reply_text, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
