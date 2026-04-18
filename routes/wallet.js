const router = require("express").Router();
const db = require("../db");
const auth = require("../middleware/auth");

// GET /api/wallet/balance
router.get("/balance", auth, async (req, res) => {
  try {
    const result = await db.query("SELECT wallet_balance FROM users WHERE id=$1", [req.user.id]);
    const history = await db.query(
      "SELECT * FROM wallet_transactions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20", [req.user.id]
    );
    res.json({ balance: result.rows[0].wallet_balance, history: history.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/wallet/withdraw
router.post("/withdraw", auth, async (req, res) => {
  try {
    const { amount } = req.body;
    const user = await db.query("SELECT wallet_balance FROM users WHERE id=$1", [req.user.id]);
    if (user.rows[0].wallet_balance < amount)
      return res.status(400).json({ error: "Insufficient balance." });
    if (amount < 1000)
      return res.status(400).json({ error: "Minimum withdrawal is ₦1,000." });
    await db.query("UPDATE users SET wallet_balance=wallet_balance-$1 WHERE id=$2", [amount, req.user.id]);
    await db.query(
      `INSERT INTO wallet_transactions (user_id,type,amount,balance_after,description,status)
       VALUES ($1,'withdrawal',$2,(SELECT wallet_balance FROM users WHERE id=$1),'Withdrawal to bank account','pending')`,
      [req.user.id, amount]
    );
    res.json({ success: true, message: "Withdrawal initiated. Arrives within 24 hours." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;