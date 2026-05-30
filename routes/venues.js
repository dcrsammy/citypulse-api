const router = require("express").Router();
const db = require("../db");
const auth = require("../middleware/auth");

// GET /api/venues - Public: List all restaurants
router.get("/", async (req, res) => {
  try {
    const result = await db.query("SELECT * FROM venues");
    res.json({ venues: result.rows });
  } catch (err) {
    console.error("Error fetching venues:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/venues/:id
router.get("/:id", async (req, res) => {
  try {
    const result = await db.query("SELECT * FROM venues WHERE id=$1", [req.params.id]);
    res.json(result.rows[0] || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/venues/:id
router.patch("/:id", auth, async (req, res) => {
  try {
    const { is_open } = req.body;
    const result = await db.query(
      "UPDATE venues SET is_open=$1 WHERE id=$2 RETURNING *",
      [is_open, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
