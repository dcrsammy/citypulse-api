const jwt = require("jsonwebtoken");
const db = require("../db");

module.exports = async (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Access denied. No token." });
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;

    // Single device login + suspension check for consumers
    if (decoded.role === 'consumer') {
      const result = await db.query(
        'SELECT active_token, is_suspended FROM users WHERE id=$1',
        [decoded.id]
      );
      const user = result.rows[0];
      if (user?.is_suspended) {
        return res.status(403).json({ 
          error: 'Your account has been suspended. Contact support.',
          code: 'ACCOUNT_SUSPENDED'
        });
      }
      if (user?.active_token && user.active_token !== token) {
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
