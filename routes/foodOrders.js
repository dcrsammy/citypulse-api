const { sendPush } = require("../services/notifications");
const router = require("express").Router();
const db     = require("../db");
const auth   = require("../middleware/auth");

router.use(auth);

const sendPush = async (fcmToken, title, body, data = {}) => {
  if (!fcmToken || !process.env.FIREBASE_PROJECT_ID) return;
  try {
    const axios = require('axios');
    const { GoogleAuth } = require('google-auth-library');
    const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/firebase.messaging'] });
    const token = await auth.getAccessToken();
    await axios.post(
      `https://fcm.googleapis.com/v1/projects/${process.env.FIREBASE_PROJECT_ID}/messages:send`,
      { message: { token: fcmToken, notification: { title, body }, data } },
      { headers: { Authorization: `Bearer ${token}` } }
    );
  } catch (e) { console.log('FCM error:', e.message); }
};


// POST /api/food-orders — place a new food order
router.post("/", async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");

    const {
      venue_id, order_type, delivery_address,
      special_requests, items, subtotal,
      delivery_fee, total_amount, payment_method,
      promo_code, discount_amount,
    } = req.body;

    if (!venue_id || !order_type || !items?.length)
      return res.status(400).json({ error: "venue_id, order_type and items are required." });

    // Get venue for commission calc
    const venueRes = await client.query("SELECT commission_rate, cpp_earn_rate FROM venues WHERE id=$1", [venue_id]);
    const venue    = venueRes.rows[0];
    if (!venue) return res.status(404).json({ error: "Venue not found." });

    const commissionRate = venue.commission_rate || 25;
    const platformFee    = parseFloat(((subtotal * commissionRate) / 100).toFixed(2));
    const cppEarned      = Math.floor((total_amount / 1000) * (venue.cpp_earn_rate || 10));

    // Create the order
    const orderRes = await client.query(
      `INSERT INTO food_orders
         (user_id, venue_id, order_type, delivery_address, special_requests,
          subtotal, delivery_fee, platform_fee, total_amount,
          payment_method, payment_status, order_status, cpp_earned)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending','pending',$11)
       RETURNING *`,
      [
        req.user.id, venue_id, order_type,
        delivery_address || null, special_requests || null,
        parseFloat(subtotal || 0), parseFloat(delivery_fee || 0),
        platformFee, parseFloat(total_amount),
        payment_method || "paystack", cppEarned,
      ]
    );
    const order = orderRes.rows[0];

    // Insert order items
    for (const item of items) {
      await client.query(
        `INSERT INTO food_order_items
           (order_id, menu_item_id, name, quantity, unit_price, subtotal, special_notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          order.id, item.menu_item_id || null,
          item.name, item.quantity,
          parseFloat(item.unit_price), parseFloat(item.subtotal),
          item.special_notes || null,
        ]
      );
    }

    // Wallet payment — deduct immediately
    if (payment_method === "wallet") {
      const userRes = await client.query("SELECT wallet_balance FROM users WHERE id=$1", [req.user.id]);
      const balance = parseFloat(userRes.rows[0]?.wallet_balance || 0);
      if (balance < parseFloat(total_amount))
        throw new Error("Insufficient wallet balance.");

      await client.query(
        "UPDATE users SET wallet_balance=wallet_balance-$1 WHERE id=$2",
        [total_amount, req.user.id]
      );
      await client.query(
        `INSERT INTO wallet_transactions
           (user_id,type,amount,balance_after,description,status)
         VALUES ($1,'debit',$2,(SELECT wallet_balance FROM users WHERE id=$1),$3,'completed')`,
        [req.user.id, total_amount, `Food order at venue`]
      );
      await client.query(
        "UPDATE food_orders SET payment_status='paid', order_status='confirmed' WHERE id=$1",
        [order.id]
      );
      order.payment_status = "paid";
      order.order_status   = "confirmed";

      // Award CPP
      if (cppEarned > 0) {
        await client.query("UPDATE users SET cpp_points=cpp_points+$1 WHERE id=$2", [cppEarned, req.user.id]);
        await client.query(
          `INSERT INTO cpp_transactions (user_id,type,amount,description,order_id)
           VALUES ($1,'earn',$2,$3,$4)`,
          [req.user.id, cppEarned, `Earned from food order`, order.id]
        );
      }
    }

    await client.query("COMMIT");
    res.status(201).json({ order, message: "Order placed successfully." });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// GET /api/food-orders — user's order history
router.get("/", async (req, res) => {
  try {
    const orders = await db.query(
      `SELECT fo.*, v.name as venue_name, v.cover_image as venue_image,
              json_agg(json_build_object(
                'name', foi.name, 'quantity', foi.quantity,
                'unit_price', foi.unit_price, 'subtotal', foi.subtotal
              )) as items
       FROM food_orders fo
       JOIN venues v ON fo.venue_id = v.id
       LEFT JOIN food_order_items foi ON foi.order_id = fo.id
       WHERE fo.user_id = $1
       GROUP BY fo.id, v.name, v.cover_image
       ORDER BY fo.created_at DESC`,
      [req.user.id]
    );
    res.json({ orders: orders.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/food-orders/:id — single order detail
router.get("/:id", async (req, res) => {
  try {
    const order = await db.query(
      `SELECT fo.*, v.name as venue_name, v.address as venue_address,
              v.avg_prep_time_mins, v.phone as venue_phone
       FROM food_orders fo
       JOIN venues v ON fo.venue_id = v.id
       WHERE fo.id=$1 AND fo.user_id=$2`,
      [req.params.id, req.user.id]
    );
    if (!order.rows[0]) return res.status(404).json({ error: "Order not found." });

    const items = await db.query(
      "SELECT * FROM food_order_items WHERE order_id=$1",
      [req.params.id]
    );
    res.json({ order: { ...order.rows[0], items: items.rows } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/food-orders/:id/status — vendor updates order status
router.patch("/:id/status", async (req, res) => {
  try {
    const { status } = req.body;
    const allowed = ["confirmed", "preparing", "ready", "on_the_way", "completed", "cancelled"];
    if (!allowed.includes(status))
      return res.status(400).json({ error: "Invalid status." });

    const result = await db.query(
      "UPDATE food_orders SET order_status=$1, updated_at=NOW() WHERE id=$2 RETURNING *",
      [status, req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: "Order not found." });

    // Send push notification to consumer
    const order = result.rows[0];
    const statusMessages = {
      confirmed:  { title: "Order Confirmed! 👍", body: "Your order has been accepted and will be prepared soon." },
      preparing:  { title: "Being Prepared 👨‍🍳", body: "Your food is being prepared right now!" },
      ready:      { title: "Order Ready! 🔔", body: "Your order is ready. Come pick it up or it will be brought to you." },
      on_the_way: { title: "On The Way! 🛵", body: "Your order is on its way to you." },
      completed:  { title: "Order Completed ✅", body: "Enjoy your meal! Leave a review to earn bonus CPP points." },
      cancelled:  { title: "Order Cancelled", body: "Your order has been cancelled. Contact support if this is unexpected." },
    };
    const msg = statusMessages[status];
    if (msg) {
      await sendPush(order.user_id, msg.title, msg.body, { type: "order_update", order_id: order.id, status });
    }

    // Award CPP on completion (paystack payments)
    if (status === "completed") {
      const order = result.rows[0];
      if (order.cpp_earned > 0 && order.payment_method !== "wallet") {
        await db.query("UPDATE users SET cpp_points=cpp_points+$1 WHERE id=$2", [order.cpp_earned, order.user_id]);
        await db.query(
          `INSERT INTO cpp_transactions (user_id,type,amount,description,order_id)
           VALUES ($1,'earn',$2,'Earned from food order',$3)`,
          [order.user_id, order.cpp_earned, order.id]
        );
      }
    }

    const updatedOrder = result.rows[0];

    // Send push notification to consumer
    try {
      const userRes = await db.query('SELECT fcm_token, full_name FROM users WHERE id=', [updatedOrder.user_id]);
      const user = userRes.rows[0];
      if (user && user.fcm_token) {
        const statusMessages = {
          confirmed:  'Your order has been confirmed!',
          preparing:  'The kitchen is preparing your order.',
          ready:      'Your order is ready!',
          on_the_way: 'Your order is on the way!',
          completed:  'Order complete. Enjoy your meal!',
          cancelled:  'Your order has been cancelled.',
        };
        const msg = statusMessages[status];
        if (msg) await sendPush(user.fcm_token, 'CityPulse Order Update', msg, { order_id: updatedOrder.id, status });
      }
    } catch (pushErr) { console.error('Push error:', pushErr.message); }

    res.json({ order: updatedOrder });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
