const router = require("express").Router();
const db = require("../db");
const auth = require("../middleware/auth");

// GET /api/vendor/me - Get current vendor's profile
router.get("/me", auth, async (req, res) => {
  try {
    const result = await db.query(
      "SELECT id, business_name, owner_full_name, email, kyc_status, is_verified FROM vendors WHERE id=$1",
      [req.user.id]
    );
    
    if (!result.rows[0]) {
      return res.status(404).json({ error: "Vendor not found" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
