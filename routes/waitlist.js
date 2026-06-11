const express = require('express');
const router = express.Router();
const db = require('../db');

db.query(`
  CREATE TABLE IF NOT EXISTS waitlist (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    type VARCHAR(20) DEFAULT 'user',
    business_name VARCHAR(255),
    business_type VARCHAR(100),
    location VARCHAR(255),
    phone VARCHAR(50),
    referral_code VARCHAR(20),
    created_at TIMESTAMPTZ DEFAULT NOW()
  )
`).catch(err => console.error('Waitlist table error:', err.message));

router.post('/', async (req, res) => {
  const { email, type, businessName, businessType, location, phone, ref } = req.body;
  try {
    await db.query(
      `INSERT INTO waitlist (email, type, business_name, business_type, location, phone, referral_code)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [email, type||'user', businessName||null, businessType||null, location||null, phone||null, ref||null]
    );
    res.status(201).json({ success: true });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already registered' });
    res.status(500).json({ error: err.message });
  }
});

router.get('/count', async (req, res) => {
  try {
    const result = await db.query('SELECT COUNT(*) FROM waitlist');
    res.json({ count: result.rows[0].count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
