const express = require("express");
const sql = require("mssql");
const { getPool } = require("../config/db");

const router = express.Router();

// Add member
router.post("/add-member", async (req, res) => {
  try {
    const pool = getPool();

    const { user_id, full_name } = req.body;

    await pool.request().query(`
      IF NOT EXISTS (SELECT 1 FROM members WHERE user_id='${user_id}')
      BEGIN
        INSERT INTO members (user_id, full_name, created_at)
        VALUES ('${user_id}', '${full_name}', GETDATE())
      END
    `);

    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

module.exports = router;