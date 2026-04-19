const router = require("express").Router();
const db     = require("../db");
const auth   = require("../middleware/auth");

// GET /api/menu/:venueId — get full menu for a venue
router.get("/:venueId", async (req, res) => {
  try {
    // Get categories
    const cats = await db.query(
      `SELECT * FROM menu_categories WHERE venue_id=$1 ORDER BY sort_order ASC`,
      [req.params.venueId]
    );
    // Get all items
    const items = await db.query(
      `SELECT * FROM menu_items WHERE venue_id=$1 AND is_available=true ORDER BY is_popular DESC, name ASC`,
      [req.params.venueId]
    );
    // Group items by category
    const menu = cats.rows.map(cat => ({
      ...cat,
      items: items.rows.filter(i => i.category_id === cat.id),
    }));
    // Also include uncategorised items
    const uncategorised = items.rows.filter(i => !i.category_id);
    if (uncategorised.length) {
      menu.push({ id: null, name: 'Other', items: uncategorised });
    }
    res.json({ menu, total_items: items.rowCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/menu/category — vendor adds a menu category
router.post("/category", auth, async (req, res) => {
  try {
    const { venue_id, name, description, sort_order } = req.body;
    const result = await db.query(
      `INSERT INTO menu_categories (venue_id, name, description, sort_order)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [venue_id, name, description || null, sort_order || 0]
    );
    res.status(201).json({ category: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/menu/item — vendor adds a menu item
router.post("/item", auth, async (req, res) => {
  try {
    const { venue_id, category_id, name, description, price, prep_time_mins, dietary_tags, is_popular } = req.body;
    if (!venue_id || !name || !price)
      return res.status(400).json({ error: "venue_id, name and price are required." });
    const result = await db.query(
      `INSERT INTO menu_items (venue_id, category_id, name, description, price, prep_time_mins, dietary_tags, is_popular)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [venue_id, category_id || null, name, description || null, price, prep_time_mins || 15, dietary_tags || [], is_popular || false]
    );
    res.status(201).json({ item: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/menu/item/:id — update a menu item
router.patch("/item/:id", auth, async (req, res) => {
  try {
    const { name, description, price, is_available, is_popular, prep_time_mins } = req.body;
    const result = await db.query(
      `UPDATE menu_items SET
         name=$1, description=$2, price=$3,
         is_available=$4, is_popular=$5, prep_time_mins=$6
       WHERE id=$7 RETURNING *`,
      [name, description, price, is_available, is_popular, prep_time_mins, req.params.id]
    );
    res.json({ item: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/menu/item/:id
router.delete("/item/:id", auth, async (req, res) => {
  try {
    await db.query("DELETE FROM menu_items WHERE id=$1", [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;