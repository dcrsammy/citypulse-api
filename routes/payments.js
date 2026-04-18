const router = require("express").Router();
const axios = require("axios");
const crypto = require("crypto");
const db = require("../db");
const auth = require("../middleware/auth");

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;
const headers = { Authorization: `Bearer ${PAYSTACK_SECRET}` };

// POST /api/payments/initialize
router.post("/initialize", auth, async (req, res) => {
  try {
    const { amount, type, booking_id, venue_id, event_id } = req.body;
    const user = await db.query("SELECT email, full_name FROM users WHERE id=$1", [req.user.id]);
    const u = user.rows[0];
    const response = await axios.post(
      "https://api.paystack.co/transaction/initialize",
      {
        amount: Math.round(amount * 100),
        email: u.email,
        metadata: { user_id: req.user.id, type, booking_id, venue_id, event_id, full_name: u.full_name },
        currency: "NGN",
        callback_url: process.env.PAYSTACK_CALLBACK_URL,
      },
      { headers }
    );
    res.json(response.data.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/payments/verify/:reference
router.post("/verify/:reference", auth, async (req, res) => {
  try {
    const response = await axios.get(
      `https://api.paystack.co/transaction/verify/${req.params.reference}`,
      { headers }
    );
    const data = response.data.data;
    if (data.status !== "success")
      return res.status(400).json({ verified: false, error: "Payment not successful." });
    res.json({ verified: true, amount: data.amount / 100, reference: data.reference });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/payments/webhook
router.post("/webhook", async (req, res) => {
  try {
    const hash = crypto
      .createHmac("sha512", PAYSTACK_SECRET)
      .update(JSON.stringify(req.body))
      .digest("hex");
    if (hash !== req.headers["x-paystack-signature"])
      return res.status(401).send("Unauthorized");

    const { event, data } = req.body;
    if (event === "charge.success") {
      const { reference, amount, metadata } = data;
      const amountNGN = amount / 100;
      if (metadata?.type === "wallet_topup") {
        await db.query("UPDATE users SET wallet_balance=wallet_balance+$1 WHERE id=$2",
          [amountNGN, metadata.user_id]);
        await db.query(
          `INSERT INTO wallet_transactions (user_id,type,amount,balance_after,description,payment_ref,status)
           VALUES ($1,'topup',$2,(SELECT wallet_balance FROM users WHERE id=$1),'Wallet top-up via Paystack',$3,'completed')`,
          [metadata.user_id, amountNGN, reference]
        );
      }
    }
    res.sendStatus(200);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/payments/banks
router.get("/banks", async (req, res) => {
  try {
    const response = await axios.get("https://api.paystack.co/bank?currency=NGN", { headers });
    res.json({ banks: response.data.data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;