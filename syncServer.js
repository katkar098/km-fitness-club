// sync-agent/server.js
// eSSL Biometric → SQL Server Auto Sync Service

const express = require("express");
const cors = require("cors");
const cron = require("node-cron");
const ZKLib = require("node-zklib");
const sql = require("mssql");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

// =============================
// SQL SERVER CONFIG
// =============================

const dbConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE,
  port: Number(process.env.DB_PORT),
  options: {
    encrypt: false,
    trustServerCertificate: true,
  },
};

async function connectDB() {
  try {
    await sql.connect(dbConfig);
    console.log("SQL Server Connected Successfully");
  } catch (error) {
    console.log("DB Connection Error:", error.message);
  }
}

// =============================
// BIOMETRIC DEVICE CONFIG
// =============================

const DEVICE_IP = process.env.DEVICE_IP || "192.168.0.201";
const DEVICE_PORT = Number(process.env.DEVICE_PORT || 4370);

async function connectDevice() {
  const zkInstance = new ZKLib(
    DEVICE_IP,
    DEVICE_PORT,
    10000,
    4000
  );

  try {
    await zkInstance.createSocket();
    console.log("Biometric Device Connected");
    return zkInstance;
  } catch (error) {
    console.log("Device Connection Error:", error.message || error);
    return null;
  }
}

// =============================
// FETCH USERS FROM MACHINE
// =============================

async function syncUsers() {
  const device = await connectDevice();
  if (!device) return;

  try {
    const users = await device.getUsers();

    for (const user of users.data) {
      const userId = String(user.userId || "");
      const name = user.name || "Unknown";

      if (!userId) continue;

      await sql.query(`
        IF NOT EXISTS (
          SELECT 1 FROM members WHERE user_id = '${userId}'
        )
        BEGIN
          INSERT INTO members (
            user_id,
            name,
            payment_status,
            created_at
          )
          VALUES (
            '${userId}',
            '${name.replace(/'/g, "''")}',
            'Pending',
            GETDATE()
          )
        END
      `);
    }

    console.log("Users Synced Successfully");
    await device.disconnect();
  } catch (error) {
    console.log("User Sync Error:", error.message || error);
  }
}

// =============================
// FETCH ATTENDANCE LOGS
// =============================

async function syncAttendanceLogs() {
  const device = await connectDevice();
  if (!device) return;

  try {
    const logs = await device.getAttendances();

    for (const log of logs.data) {
      const userId = String(log.deviceUserId || "");
      const punchTime = log.recordTime;

      if (!userId || !punchTime) continue;

      await sql.query(`
        IF NOT EXISTS (
          SELECT 1 FROM attendance_logs
          WHERE user_id = '${userId}'
          AND punch_time = '${punchTime}'
        )
        BEGIN
          INSERT INTO attendance_logs (
            user_id,
            punch_time,
            created_at
          )
          VALUES (
            '${userId}',
            '${punchTime}',
            GETDATE()
          )
        END
      `);
    }

    console.log("Attendance Logs Synced Successfully");
    await device.disconnect();
  } catch (error) {
    console.log("Attendance Sync Error:", error.message || error);
  }
}

// =============================
// MANUAL TEST API
// =============================

app.get("/sync-users", async (req, res) => {
  await syncUsers();
  res.json({ success: true, message: "Users sync completed" });
});

app.get("/sync-attendance", async (req, res) => {
  await syncAttendanceLogs();
  res.json({ success: true, message: "Attendance sync completed" });
});

// =============================
// AUTO CRON JOB
// Every 2 Minutes
// =============================

cron.schedule("*/2 * * * *", async () => {
  console.log("Running Auto Sync...");
  await syncUsers();
  await syncAttendanceLogs();
});

// =============================
// START SERVER
// =============================

async function startServer() {
  await connectDB();

  app.listen(5001, () => {
    console.log("Sync Agent Running on Port 5001");
  });
}

startServer();
