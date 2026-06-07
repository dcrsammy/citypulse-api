const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 8000,
});

pool.on("error", (err) => console.error("Unexpected DB error", err));

// Warm the pool on startup to avoid cold-start 500s on first request
pool.query("SELECT 1").catch((err) => console.error("DB warm-up failed:", err.message));

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};