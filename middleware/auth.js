const jwt = require("jsonwebtoken");
const db = require("../db");

module.exports = async (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Access denied. No token." });
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;

    // Single device login check for consumers only
    if (decoded.role === 'consumer') {
      const result = await db.query(
        'SELECT active_token FROM users WHERE id=$1',
        [decoded.id]
      );
      if (result.rows[0] && result.rows[0].active_token && result.rows[0].active_token !== token) {
        return res.status(401).json({ 
          error: 'Session expired. Your account was logged in on another device.',
          code: 'DEVICE_CONFLICT'
        });
      }
    }

    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid token." });
  }
};
