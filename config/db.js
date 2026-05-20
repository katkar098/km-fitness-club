const sql = require("mssql");
require("dotenv").config();

const dbConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE,
  port: parseInt(process.env.DB_PORT),

  options: {
    encrypt: false,
    trustServerCertificate: true,
  },
};

let pool = null;

// Connect DB
const connectDB = async () => {
  try {
    pool = await sql.connect(dbConfig);
    console.log("✅ SQL Server Connected Successfully");
    return pool;
  } catch (error) {
    console.log("❌ FULL DB ERROR:");
    console.log(error.message);
  }
};

// Get DB Pool
const getPool = () => {
  if (!pool) {
    throw new Error("Database not connected yet");
  }
  return pool;
};

module.exports = {
  sql,
  connectDB,
  getPool,
};