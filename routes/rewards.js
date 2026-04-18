const router = require("express").Router();
const db = require("../db");
const auth = require("../middleware/auth");

// GET /api/rewards/summary
router.get("/summary", auth, async (req, res) => {
  try {
    const user = await db.query(
      "SELECT cpp_points, cpp_tier, wallet_balance FROM users WHERE id=$1", [req.user.id]
    );
    const history = await db.query(
      `SELECT * FROM cpp_transactions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20`, [req.user.id]
    );
    res.json({ ...user.rows[0], history: history.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/rewards/redeem
router.post("/redeem", auth, async (req, res) => {
  try {
    const { cpp_cost } = req.body;
    const user = await db.query("SELECT cpp_points FROM users WHERE id=$1", [req.user.id]);
    if (user.rows[0].cpp_points < cpp_cost)
      return res.status(400).json({ error: "Insufficient CPP points." });
    await db.query("UPDATE users SET cpp_points=cpp_points-$1 WHERE id=$2", [cpp_cost, req.user.id]);
    await db.query(
      `INSERT INTO cpp_transactions (user_id,type,amount,description) VALUES ($1,'redeem',$2,'Offer redeemed')`,
      [req.user.id, -cpp_cost]
    );
    res.json({ success: true, cpp_deducted: cpp_cost });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;