

    res.json({ menu, total_items: items.rowCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/menu/vendor/all - Get ALL items (including unavailable) for vendor
router.get("/vendor/all/:venueId", auth, async (req, res) => {
  try {
    const cats = await db.query(
      `SELECT * FROM menu_categories WHERE venue_id=$1 ORDER BY sort_order ASC`,
      [req.params.venueId]
    );

    const items = await db.query(
      `SELECT * FROM menu_items WHERE venue_id=$1 ORDER BY is_popular DESC, name ASC`,
      [req.params.venueId]
    );

    res.json({ categories: cats.rows, items: items.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/menu/category — vendor adds category
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

// PATCH /api/menu/category/:id - Update category
router.patch("/category/:id", auth, async (req, res) => {
  try {
    const { name, description, sort_order } = req.body;
    const result = await db.query(
      `UPDATE menu_categories SET name=$1, description=$2, sort_order=$3 
       WHERE id=$4 RETURNING *`,
      [name, description, sort_order, req.params.id]
    );
    res.json({ category: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/menu/category/:id
router.delete("/category/:id", auth, async (req, res) => {
  try {
    // First delete items in this category
    await db.query("DELETE FROM menu_items WHERE category_id=$1", [req.params.id]);
    await db.query("DELETE FROM menu_categories WHERE id=$1", [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/menu/item — add item
router.post("/item", auth, async (req, res) => {
  try {
    const { venue_id, category_id, name, description, price, prep_time_mins, dietary_tags, is_popular, image_url } = req.body;
    if (!venue_id || !name || !price)
      return res.status(400).json({ error: "venue_id, name and price are required." });
    if (parseFloat(price) < 0)
      return res.status(400).json({ error: "Price cannot be negative." });
    if (parseFloat(price) > 1000000)
      return res.status(400).json({ error: "Price cannot exceed ₦1,000,000." });
    
    const result = await db.query(
      `INSERT INTO menu_items (venue_id, category_id, name, description, price, prep_time_mins, dietary_tags, is_popular, image_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [venue_id, category_id || null, sanitize(name), sanitize(description) || null, price, prep_time_mins || 15, dietary_tags || [], is_popular || false, image_url || null]
    );
    res.status(201).json({ item: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/menu/item/:id — update item
router.patch("/item/:id", auth, async (req, res) => {
  try {
    const { name, description, price, is_available, is_popular, prep_time_mins, category_id, image_url } = req.body;
    const result = await db.query(
      `UPDATE menu_items SET
         name=COALESCE($1, name), 
         description=COALESCE($2, description), 
         price=COALESCE($3, price),
         is_available=COALESCE($4, is_available), 
         is_popular=COALESCE($5, is_popular), 
         prep_time_mins=COALESCE($6, prep_time_mins),
         category_id=COALESCE($7, category_id),
         image_url=COALESCE($8, image_url)
       WHERE id=$9 RETURNING *`,
      [name, description, price, is_available, is_popular, prep_time_mins, category_id, image_url, req.params.id]
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

// POST /api/menu/bulk-import - Bulk import from text
router.post("/bulk-import", auth, async (req, res) => {
  try {
    const { venue_id, text } = req.body;
    if (!venue_id || !text) return res.status(400).json({ error: "venue_id and text required" });

    const lines = text.split('\n').filter(l => l.trim());
    let currentCategoryId = null;
    let importedCount = 0;
    let categoriesAdded = 0;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Check if line is a category (no comma)
      if (!trimmed.includes(',')) {
        const catRes = await db.query(
          `INSERT INTO menu_categories (venue_id, name, sort_order) 
           VALUES ($1, $2, $3) RETURNING id`,
          [venue_id, trimmed, categoriesAdded]
        );
        currentCategoryId = catRes.rows[0].id;
        categoriesAdded++;
      } else {
        // It's an item: name, price, description?
        const parts = trimmed.split(',').map(p => p.trim());
        const name = parts[0];
        const price = parseFloat(parts[1]) || 0;
        const description = parts[2] || null;

        await db.query(
          `INSERT INTO menu_items (venue_id, category_id, name, price, description)
           VALUES ($1, $2, $3, $4, $5)`,
          [venue_id, currentCategoryId, name, price, description]
        );
        importedCount++;
      }
    }

    res.json({ 
      success: true,
      categoriesAdded,
      itemsImported: importedCount 
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
function sanitize(str) {
  if (!str) return str;
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

