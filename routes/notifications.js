const router = require("express").Router();
const db = require("../db");
const auth = require("../middleware/auth");

// GET /api/notifications
router.get("/", auth, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50`,
      [req.user.id]
    );
    const unread = await db.query(
      `SELECT COUNT(*) FROM notifications WHERE user_id=$1 AND is_read=false`,
      [req.user.id]
    );
    res.json({ notifications: result.rows, unread_count: parseInt(unread.rows[0].count) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/notifications/read-all
router.patch("/read-all", auth, async (req, res) => {
  try {
    await db.query(`UPDATE notifications SET is_read=true WHERE user_id=$1`, [req.user.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/notifications/fcm-token
router.post("/fcm-token", auth, async (req, res) => {
  try {
    const { token } = req.body;
    await db.query("UPDATE users SET fcm_token=$1 WHERE id=$2", [token, req.user.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;