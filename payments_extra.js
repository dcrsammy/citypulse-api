// Add these two routes to citypulse-api/routes/payments.js
// Paste BEFORE the module.exports = router line

// GET /api/payments/callback — Paystack redirects here after payment
router.get("/callback", async (req, res) => {
  try {
    const { reference } = req.query;
    if (!reference) return res.redirect("https://citypulse-api.up.railway.app?status=failed");

    // Verify payment with Paystack
    const response = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      { headers }
    );
    const data = response.data.data;

    if (data.status === "success") {
      // Update order if reference matches
      await db.query(
        `UPDATE food_orders 
         SET payment_status='paid', order_status='confirmed', payment_ref=$1, updated_at=NOW()
         WHERE payment_ref=$1 OR id=$2`,
        [reference, data.metadata?.order_id || null]
      );
      res.redirect(`https://appealing-solace-production.up.railway.app/api/payments/success?reference=${reference}`);
    } else {
      res.redirect(`https://appealing-solace-production.up.railway.app/api/payments/failed?reference=${reference}`);
    }
  } catch (err) {
    console.error("Callback error:", err.message);
    res.redirect("https://appealing-solace-production.up.railway.app/api/payments/failed");
  }
});

// POST /api/payments/webhook — Paystack sends payment events here
router.post("/webhook", async (req, res) => {
  try {
    const crypto = require("crypto");
    const hash = crypto
      .createHmac("sha512", process.env.PAYSTACK_SECRET_KEY)
      .update(JSON.stringify(req.body))
      .digest("hex");

    if (hash !== req.headers["x-paystack-signature"]) {
      return res.status(401).send("Invalid signature");
    }

    const { event, data } = req.body;

    if (event === "charge.success") {
      const reference = data.reference;
      const orderId   = data.metadata?.order_id;

      // Update order to paid
      const orderRes = await db.query(
        `UPDATE food_orders
         SET payment_status='paid', order_status='confirmed', payment_ref=$1, updated_at=NOW()
         WHERE id=$2 RETURNING *`,
        [reference, orderId]
      );

      const order = orderRes.rows[0];
      if (order && order.cpp_earned > 0) {
        await db.query(
          "UPDATE users SET cpp_points=cpp_points+$1 WHERE id=$2",
          [order.cpp_earned, order.user_id]
        );
      }

      console.log("Payment confirmed via webhook:", reference);
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("Webhook error:", err.message);
    res.sendStatus(500);
  }
});

// GET /api/payments/success — shown after successful payment redirect
router.get("/success", (req, res) => {
  res.json({ status: "success", message: "Payment successful. Return to the app.", reference: req.query.reference });
});

// GET /api/payments/failed — shown after failed payment redirect  
router.get("/failed", (req, res) => {
  res.json({ status: "failed", message: "Payment was not completed. Return to the app." });
});
