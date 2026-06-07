const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');

// POST /api/disputes
router.post('/', auth, async (req, res) => {
  try {
    const { type, reference_id, description } = req.body;
    if (!type || !description) return res.status(400).json({ error: 'Type and description required.' });
    await db.query(
      `INSERT INTO disputes (user_id, type, reference_id, description, status)
       VALUES ($1,$2,$3,$4,'open')`,
      [req.user.id, type, reference_id || null, description]
    );
    res.json({ message: 'Dispute submitted successfully.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/disputes/my
router.get('/my', auth, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM disputes WHERE user_id=$1 ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json({ disputes: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
// POST /api/disputes/:id/refund — admin triggers refund
router.post('/:id/refund', async (req, res) => {
  try {
    const { refund_amount, refund_type } = req.body;
    const dispute = await db.query('SELECT * FROM disputes WHERE id=$1', [req.params.id]);
    if (!dispute.rows[0]) return res.status(404).json({ error: 'Dispute not found.' });
    
    const d = dispute.rows[0];
    
    if (refund_type === 'wallet') {
      // Refund to wallet
      await db.query('UPDATE users SET wallet_balance = wallet_balance + $1 WHERE id=$2', 
        [refund_amount, d.user_id]);
      await db.query(
        "INSERT INTO wallet_transactions (user_id,type,amount,balance_after,description,status) SELECT $1,'refund',$2,wallet_balance,'Dispute refund','completed' FROM users WHERE id=$1",
        [d.user_id, refund_amount]
      );
      await db.query(
        "UPDATE disputes SET status='resolved', admin_notes=$1, resolved_at=NOW() WHERE id=$2",
        [`Refunded ₦${refund_amount} to wallet`, req.params.id]
      );
      res.json({ message: `₦${refund_amount} refunded to user wallet.` });
    } else {
      res.status(400).json({ error: 'Invalid refund type.' });
    }
  } catch(err) { res.status(500).json({ error: err.message }); }
});
