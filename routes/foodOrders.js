const { notifyOrderStatus } = require("../services/notifications");
const { notifyNewOrder } = require("../services/notifications");
const { createSystemChat } = require("../services/systemChat");
const dbPg = require("../db");
const { db: firebase } = require("../services/firebase");
const router = require("express").Router();
const db     = require("../db");
const auth   = require("../middleware/auth");

router.use(auth);

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

    const venueRes = await client.query("SELECT commission_rate, cpp_earn_rate FROM venues WHERE id=$1", [venue_id]);
    const venue    = venueRes.rows[0];
    if (!venue) return res.status(404).json({ error: "Venue not found." });

    const commissionRate = venue.commission_rate || 25;
    const platformFee    = parseFloat(((subtotal * commissionRate) / 100).toFixed(2));
    const cppEarned      = Math.floor((total_amount / 1000) * (venue.cpp_earn_rate || 10));
    const verification_pin = Math.floor(100000 + Math.random() * 900000).toString();

    const orderRes = await client.query(
      `INSERT INTO food_orders
         (user_id, venue_id, order_type, delivery_address, special_requests,
          subtotal, delivery_fee, platform_fee, total_amount,
          payment_method, payment_status, order_status, cpp_earned, verification_pin)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending','pending',$11,$12)
       RETURNING *`,
      [
        req.user.id, venue_id, order_type,
        delivery_address || null, special_requests || null,
        parseFloat(subtotal || 0), parseFloat(delivery_fee || 0),
        platformFee, parseFloat(total_amount),
        payment_method || "paystack", cppEarned, verification_pin,
      ]
    );
    const order = orderRes.rows[0];

    // Handle wallet payment immediately
    if (payment_method === 'wallet') {
      const userRes = await client.query('SELECT wallet_balance FROM users WHERE id=$1', [req.user.id]);
      const walletBalance = parseFloat(userRes.rows[0]?.wallet_balance || 0);
      if (walletBalance < parseFloat(total_amount)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Insufficient wallet balance.' });
      }
      await client.query('UPDATE users SET wallet_balance = wallet_balance - $1 WHERE id=$2', [parseFloat(total_amount), req.user.id]);
      await client.query("UPDATE food_orders SET payment_status='paid', order_status='confirmed' WHERE id=$1", [order.id]);
      // Credit CPP points for wallet payment
      if (cppEarned > 0) {
        await client.query(
          "UPDATE users SET cpp_points = cpp_points + $1 WHERE id=$2",
          [cppEarned, req.user.id]
        );
        await client.query(
          "INSERT INTO cpp_transactions (user_id, type, amount, description) VALUES ($1,'earn',$2,'Food order CPP')",
          [req.user.id, cppEarned]
        );
      }
    }


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

    if (promo_code) {
      await client.query(
        `INSERT INTO promo_usage (user_id, promo_code) VALUES ($1, $2)`,
        [req.user.id, promo_code]
      );
    }

    await client.query("COMMIT");

    const customerRes = await client.query("SELECT full_name FROM users WHERE id=$1", [req.user.id]);
    const customer = customerRes.rows[0];
    
    if (customer) {
      notifyNewOrder(venue_id, order.id, customer.full_name, total_amount).catch(err => 
        console.error('Email notification failed:', err.message)
      );
    }

    // Create system chat thread between customer and vendor
    try {
      const vendorRes = await dbPg.query("SELECT vendor_id, name FROM venues WHERE id=$1", [venue_id]);
      const vinfo = vendorRes.rows[0];
      if (vinfo) {
        createSystemChat({
          customerId: req.user.id,
          vendorUserId: vinfo.vendor_id,
          contextType: "order",
          contextId: order.id,
          contextLabel: "Order #" + order.id.slice(-6).toUpperCase(),
          systemMessage: "🍽️ Order placed at " + vinfo.name + " — ₦" + Number(total_amount).toLocaleString(),
        }).catch(e => console.error("System chat error:", e.message));
      }
    } catch (sce) { console.error("System chat setup error:", sce.message); }
    // Real-time signal to vendor dashboard
    try {
      const vRes = await dbPg.query("SELECT vendor_id FROM venues WHERE id=$1", [venue_id]);
      const vid = vRes.rows[0] && vRes.rows[0].vendor_id;
      if (vid) {
        await firebase.ref("vendor_live/" + vid + "/orders_updated").set(Date.now());
      }
    } catch (fre) { console.error("Firebase signal error:", fre.message); }

    res.status(201).json({ order, message: "Order placed successfully." });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

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

router.patch("/:id/status", async (req, res) => {
  try {
    const { status } = req.body;
    const allowed = ['confirmed', 'preparing', 'ready', 'completed', 'cancelled'];
    if (!allowed.includes(status))
      return res.status(400).json({ error: 'Invalid status' });

    const result = await db.query(
      "UPDATE food_orders SET order_status=$1, updated_at=NOW() WHERE id=$2 RETURNING *",
      [status, req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: "Order not found." });
    const order = result.rows[0];
    notifyOrderStatus(order.id, status).catch(e => console.error("Notify error:", e.message));
    try {
      const vRes = await dbPg.query("SELECT vendor_id FROM venues WHERE id=$1", [order.venue_id]);
      const vid = vRes.rows[0] && vRes.rows[0].vendor_id;
      if (vid) await firebase.ref("vendor_live/" + vid + "/orders_updated").set(Date.now());
    } catch (fre) { console.error("Firebase signal error:", fre.message); }

    res.json({ order });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});




router.post("/:id/reorder", auth, async (req, res) => {
  try {
    const originalOrder = await db.query(
      "SELECT * FROM food_orders WHERE id=$1 AND user_id=$2",
      [req.params.id, req.user.id]
    );

    if (!originalOrder.rows[0]) {
      return res.status(404).json({ error: "Order not found" });
    }

    const order = originalOrder.rows[0];

    // Get original order items
    const items = await db.query(
      "SELECT menu_item_id, name, quantity, unit_price FROM food_order_items WHERE order_id=$1",
      [req.params.id]
    );

    // Return items for editing - don't create order yet!
    res.json({ 
      success: true,
      venue_id: order.venue_id,
      order_type: order.order_type,
      items: items.rows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/:id/cancel", auth, async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const orderRes = await client.query(
      "SELECT * FROM food_orders WHERE id=$1 AND user_id=$2",
      [req.params.id, req.user.id]
    );
    if (!orderRes.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Order not found" });
    }
    const order = orderRes.rows[0];
    const cancellable = ["pending", "confirmed"].includes(order.order_status);
    if (!cancellable) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Cannot cancel - order already being prepared" });
    }
    await client.query(
      "UPDATE food_orders SET order_status='cancelled', updated_at=NOW() WHERE id=$1",
      [order.id]
    );
    if (order.payment_status === "paid") {
      await client.query(
        "UPDATE users SET wallet_balance = wallet_balance + $1 WHERE id=$2",
        [order.total_amount, req.user.id]
      );
    }
    await client.query("COMMIT");
    res.json({
      success: true,
      message: order.payment_status === "paid" ? "Order cancelled. Refund added to wallet." : "Order cancelled.",
      refunded: order.payment_status === "paid"
    });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
