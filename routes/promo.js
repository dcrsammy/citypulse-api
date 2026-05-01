const router = require("express").Router();
const db     = require("../db");
const auth   = require("../middleware/auth");

// POST /api/promo/validate
router.post("/validate", auth, async (req, res) => {
  try {
    const { code, order_amount, venue_id } = req.body;
    if (!code) return res.status(400).json({ error: "Code is required." });

    const result = await db.query(
      `SELECT * FROM promo_codes
       WHERE code = $1
         AND is_active = true
         AND (valid_from IS NULL OR valid_from <= NOW())
         AND (valid_until IS NULL OR valid_until >= NOW())
         AND (max_uses IS NULL OR uses_count < max_uses)
         AND (venue_id IS NULL OR venue_id = $2)`,
      [code.toUpperCase(), venue_id || null]
    );

    if (!result.rows[0])
      return res.status(400).json({ error: "Invalid or expired promo code." });

    const promo = result.rows[0];

    // Check per-user usage
    if (promo.per_user_limit) {
      const used = await db.query(
        "SELECT COUNT(*) FROM food_orders WHERE user_id=$1 AND promo_code=$2",
        [req.user.id, code.toUpperCase()]
      );
      if (parseInt(used.rows[0].count) >= promo.per_user_limit)
        return res.status(400).json({ error: "You have already used this promo code." });
    }

    const amount = parseFloat(order_amount || 0);
    if (amount < parseFloat(promo.min_order_amount || 0))
      return res.status(400).json({ error: `Minimum order for this code is ₦${Number(promo.min_order_amount).toLocaleString()}.` });

    let discount = 0;
    if (promo.discount_type === "percentage") {
      discount = (amount * parseFloat(promo.discount_value)) / 100;
      if (promo.max_discount) discount = Math.min(discount, parseFloat(promo.max_discount));
    } else {
      discount = parseFloat(promo.discount_value);
    }
    discount = Math.round(discount);

    res.json({
      code:            promo.code,
      discount_type:   promo.discount_type,
      discount_value:  promo.discount_value,
      discount_amount: discount,
      description:     promo.description,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
