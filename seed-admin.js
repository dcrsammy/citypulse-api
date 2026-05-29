require("dotenv").config();
const bcrypt = require('bcryptjs');
const db = require('./db');

async function seedAdmin() {
  try {
    console.log('Creating admins table...');
    await db.query(`
      CREATE TABLE IF NOT EXISTS admins (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) UNIQUE NOT NULL,
        name VARCHAR(255),
        password_hash VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Table created');

    console.log('Hashing password...');
    const password_hash = await bcrypt.hash('demo1234', 12);
    console.log('✅ Password hashed');

    console.log('Inserting admin user...');
    await db.query(
      `INSERT INTO admins (email, name, password_hash) VALUES ($1, $2, $3) 
       ON CONFLICT (email) DO UPDATE SET password_hash=$3`,
      ['admin@citypulse.ng', 'Admin', password_hash]
    );
    console.log('✅ Admin user created: admin@citypulse.ng / demo1234');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

seedAdmin();
