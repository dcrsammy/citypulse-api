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