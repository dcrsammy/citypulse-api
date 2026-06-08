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

// POST /api/rewards/redeem-wallet — 1000 CPP = ₦1,000 wallet credit
router.post("/redeem-wallet", auth, async (req, res) => {
  const client = await db.pool.connect();
  try {
    const { cpp_amount } = req.body; // must be multiple of 1000
    if (!cpp_amount || cpp_amount < 1000 || cpp_amount % 1000 !== 0)
      return res.status(400).json({ error: 'Minimum redemption is 1,000 CPP. Must be in multiples of 1,000.' });

    const userRes = await client.query('SELECT cpp_points, wallet_balance FROM users WHERE id=$1', [req.user.id]);
    const user = userRes.rows[0];
    if (user.cpp_points < cpp_amount)
      return res.status(400).json({ error: `Insufficient CPP. You have ${user.cpp_points} CPP.` });

    const naira_credit = cpp_amount; // 1 CPP = ₦1

    // Check daily redemption limit (max 5000 CPP per day)
    const todayRedemptions = await client.query(
      "SELECT COALESCE(SUM(ABS(amount)),0) as total FROM cpp_transactions WHERE user_id=$1 AND type='redeem' AND created_at > NOW() - INTERVAL '24 hours'",
      [req.user.id]
    );
    const todayTotal = parseInt(todayRedemptions.rows[0].total || 0);
    if (todayTotal + cpp_amount > 5000)
      return res.status(400).json({ error: `Daily redemption limit is 5,000 CPP. You have redeemed ${todayTotal} CPP today.` });

    // Check daily redemption limit (max 5000 CPP per day)
    const todayRedemptions = await client.query(
      "SELECT COALESCE(SUM(ABS(amount)),0) as total FROM cpp_transactions WHERE user_id=$1 AND type='redeem' AND created_at > NOW() - INTERVAL '24 hours'",
      [req.user.id]
    );
    const todayTotal = parseInt(todayRedemptions.rows[0].total || 0);
    if (todayTotal + cpp_amount > 5000)
      return res.status(400).json({ error: `Daily redemption limit is 5,000 CPP. You have redeemed ${todayTotal} CPP today.` });

    await client.query('BEGIN');
    await client.query(
      'UPDATE users SET cpp_points=cpp_points-$1, wallet_balance=wallet_balance+$2 WHERE id=$3',
      [cpp_amount, naira_credit, req.user.id]
    );
    await client.query(
      `INSERT INTO cpp_transactions (user_id,type,amount,description) VALUES ($1,'redeem',$2,'Redeemed for wallet credit')`,
      [req.user.id, -cpp_amount]
    );
    await client.query(
`INSERT INTO wallet_transactions (user_id,type,amount,balance_after,description,status)
       SELECT $1,'cpp_redemption',$2, wallet_balance,'CPP Points Redemption','completed'
       FROM users WHERE id=$1`,
      [req.user.id, naira_credit]
    );
    await client.query('COMMIT');

    const updated = await client.query('SELECT cpp_points, wallet_balance FROM users WHERE id=$1', [req.user.id]);
    res.json({
      success: true,
      cpp_deducted: cpp_amount,
      naira_credited: naira_credit,
      new_cpp_balance: updated.rows[0].cpp_points,
      new_wallet_balance: updated.rows[0].wallet_balance
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

module.exports = router;