// db.js

const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,

  ssl: {
    rejectUnauthorized: false,
  },
});

// Connect DB
const connectDB = async () => {
  try {
    const client = await pool.connect();

    console.log("✅ PostgreSQL Connected Successfully");

    client.release();

  } catch (error) {
    console.log("❌ FULL DB ERROR:");
    console.log(error.message);
  }
};

// Query helper
const query = async (text, params) => {
  return await pool.query(text, params);
};

module.exports = {
  pool,
  connectDB,
  query,
};