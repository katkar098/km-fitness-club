const express = require("express");
const cors = require("cors");
const cron = require("node-cron");
const ZKLib = require("node-zklib");
const { Pool } = require("pg");
const dotenv = require("dotenv");

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

// ======================================================
// SAFE VALUE
// ======================================================
function safe(value, defaultValue = null) {
  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }
  return value;
}

// ======================================================
// POSTGRESQL CONNECTION
// ======================================================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,

  ssl: {
    rejectUnauthorized: false,
  },
});

async function connectDB() {
  try {

    const client = await pool.connect();

    console.log("✅ PostgreSQL Connected");

    client.release();

  } catch (err) {

    console.log("❌ DB Error:", err.message);
  }
}

// ======================================================
// BIOMETRIC CONFIG
// ======================================================
const DEVICE_IP = process.env.DEVICE_IP || "192.168.0.201";

const DEVICE_PORT = parseInt(
  process.env.DEVICE_PORT || "4370"
);

// ======================================================
// CONNECT DEVICE
// ======================================================
async function connectDevice() {

  try {

    const zk = new ZKLib(
      DEVICE_IP,
      DEVICE_PORT,
      10000,
      4000
    );

    await zk.createSocket();

    console.log("✅ Biometric Connected");

    return zk;

  } catch (err) {

    console.log("❌ Device Error:", err.message);

    return null;
  }
}

// ======================================================
// GET ALL DEVICE USERS
// ======================================================
async function getAllDeviceUsers(zk) {

  try {

    const users = await zk.getUsers();

    return users?.data || [];

  } catch (err) {

    console.log("❌ Get Users Error:", err.message);

    return [];
  }
}

// ======================================================
// REMOVE USER FROM DEVICE
// ======================================================
async function removeUserFromDevice(zk, userId) {

  try {

    const uid = parseInt(userId);

    const users = await getAllDeviceUsers(zk);

    const foundUser = users.find(
      (u) =>
        String(u.userId) === String(userId) ||
        String(u.userid) === String(userId) ||
        Number(u.uid) === uid
    );

    if (!foundUser) {

      console.log(`⚠️ User Not Found: ${userId}`);

      return false;
    }

    if (typeof zk.deleteUser === "function") {

      try {

        await zk.deleteUser(foundUser.uid);

        console.log(`🚫 USER DELETED: ${userId}`);

        return true;

      } catch (e) {

        console.log("deleteUser failed:", e.message);
      }
    }

    if (typeof zk.executeCmd === "function") {

      try {

        await zk.executeCmd(
          18,
          Buffer.from([foundUser.uid])
        );

        console.log(`🚫 USER REMOVED: ${userId}`);

        return true;

      } catch (e) {

        console.log("executeCmd failed:", e.message);
      }
    }

    if (typeof zk.setUser === "function") {

      try {

        await zk.setUser(
          foundUser.uid,
          String(userId),
          "EXPIRED_USER_BLOCKED",
          "",
          0
        );

        console.log(`🚫 USER BLOCKED: ${userId}`);

        return true;

      } catch (e) {

        console.log("setUser failed:", e.message);
      }
    }

    return false;

  } catch (err) {

    console.log("❌ Remove Error:", err.message);

    return false;
  }
}

// ======================================================
// ENABLE USER
// ======================================================
async function enableUserInDevice(
  zk,
  userId,
  fullName
) {

  try {

    const uid = parseInt(userId);

    await zk.setUser(
      uid,
      String(userId),
      fullName || "Member",
      "",
      0
    );

    console.log(`✅ USER ENABLED: ${fullName}`);

    return true;

  } catch (err) {

    console.log("❌ Enable Error:", err.message);

    return false;
  }
}

// ======================================================
// GET MEMBERS
// ======================================================
app.get("/api/members", async (req, res) => {

  try {

    const result = await pool.query(`
      SELECT
        member_id,
        member_id as id,
        user_id,
        full_name,
        phone,
        email,
        address,
        membership_type,
        joining_date,
        start_date,
        expiry_date,

        COALESCE(total_fee,0) as total_fee,
        COALESCE(paid_amount,0) as paid_amount,
        COALESCE(remaining_amount,0) as remaining_amount,

        payment_method,
        payment_status,
        status,
        created_at,
        updated_at

      FROM members

      ORDER BY member_id DESC
    `);

    res.json({
      success: true,
      data: result.rows,
    });

  } catch (err) {

    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

// ======================================================
// ADD MEMBER
// ======================================================
app.post("/api/members", async (req, res) => {

  try {

    const {
      user_id,
      full_name,
      phone,
      email,
      address,
      membership_type,
      start_date,
      expiry_date,
      total_fee,
      paid_amount,
      payment_method,
    } = req.body;

    const safeTotalFee = Number(total_fee || 0);

    const safePaidAmount = Number(
      paid_amount || 0
    );

    let paymentStatus = "Pending";

    if (safePaidAmount >= safeTotalFee) {
      paymentStatus = "Active";
    } else {
      paymentStatus = "Partial";
    }

    await pool.query(
      `
      INSERT INTO members (
        user_id,
        full_name,
        phone,
        email,
        address,
        membership_type,
        start_date,
        expiry_date,
        total_fee,
        paid_amount,
        payment_method,
        payment_status
      )
      VALUES (
        $1,$2,$3,$4,$5,
        $6,$7,$8,$9,$10,
        $11,$12
      )
      `,
      [
        safe(user_id),
        safe(full_name, "Unknown"),
        safe(phone, ""),
        safe(email, ""),
        safe(address, ""),
        safe(membership_type, "Normal"),
        safe(start_date, new Date()),
        safe(expiry_date, new Date()),
        safeTotalFee,
        safePaidAmount,
        safe(payment_method, "Cash"),
        paymentStatus,
      ]
    );

    const zk = await connectDevice();

    if (zk) {

      await enableUserInDevice(
        zk,
        user_id,
        full_name
      );

      await zk.disconnect();
    }

    res.json({
      success: true,
      message: "Member Added Successfully",
    });

  } catch (err) {

    console.log(err);

    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

// ======================================================
// UPDATE MEMBER
// ======================================================
app.put("/api/members/:id", async (req, res) => {

  try {

    const id = req.params.id;

    const {
      full_name,
      phone,
      email,
      address,
      membership_type,
      start_date,
      expiry_date,
      total_fee,
      paid_amount,
      payment_method,
    } = req.body;

    const safeTotalFee = Number(total_fee || 0);

    const safePaidAmount = Number(
      paid_amount || 0
    );

    const today = new Date();

    const expiry = new Date(expiry_date);

    let finalStatus = "Pending";

    if (expiry < today) {
      finalStatus = "Expired";
    }
    else if (safePaidAmount < safeTotalFee) {
      finalStatus = "Partial";
    }
    else {
      finalStatus = "Active";
    }

    const memberResult = await pool.query(
      `
      SELECT *
      FROM members
      WHERE member_id = $1
      `,
      [id]
    );

    if (memberResult.rows.length === 0) {

      return res.status(404).json({
        success: false,
        message: "Member Not Found",
      });
    }

    const member = memberResult.rows[0];

    await pool.query(
      `
      UPDATE members
      SET
        full_name = $1,
        phone = $2,
        email = $3,
        address = $4,
        membership_type = $5,
        start_date = $6,
        expiry_date = $7,
        total_fee = $8,
        paid_amount = $9,
        payment_method = $10,
        payment_status = $11,
        updated_at = CURRENT_TIMESTAMP
      WHERE member_id = $12
      `,
      [
        safe(full_name),
        safe(phone),
        safe(email),
        safe(address),
        safe(membership_type),
        safe(start_date),
        safe(expiry_date),
        safeTotalFee,
        safePaidAmount,
        safe(payment_method),
        finalStatus,
        id,
      ]
    );

    const zk = await connectDevice();

    if (zk) {

      if (finalStatus === "Expired") {

        await removeUserFromDevice(
          zk,
          member.user_id
        );

      } else {

        await enableUserInDevice(
          zk,
          member.user_id,
          full_name || member.full_name
        );
      }

      await zk.disconnect();
    }

    res.json({
      success: true,
      message: "Member Updated Successfully",
      status: finalStatus,
    });

  } catch (err) {

    console.log(err);

    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

// ======================================================
// CHECK EXPIRED MEMBERS
// ======================================================
async function checkExpiredMembers() {

  try {

    console.log("🔄 Checking Expired Members");

    const expired = await pool.query(`
      SELECT *
      FROM members
      WHERE expiry_date < CURRENT_DATE
      AND payment_status != 'Expired'
    `);

    const list = expired.rows;

    if (list.length === 0) return;

    const zk = await connectDevice();

    for (const member of list) {

      await pool.query(
        `
        UPDATE members
        SET payment_status = 'Expired'
        WHERE member_id = $1
        `,
        [member.member_id]
      );

      console.log(
        `🔴 Expired: ${member.full_name}`
      );

      if (zk) {

        await removeUserFromDevice(
          zk,
          member.user_id
        );
      }
    }

    if (zk) {
      await zk.disconnect();
    }

  } catch (err) {

    console.log("❌ Expiry Error:", err.message);
  }
}

// ======================================================
// ATTENDANCE SYNC
// ======================================================
async function syncAttendance() {

  try {

    const zk = await connectDevice();

    if (!zk) return;

    const attendances =
      await zk.getAttendances();

    const logs = attendances?.data || [];

    console.log(
      `📥 Attendance Found: ${logs.length}`
    );

    for (const log of logs) {

      try {

        const userId = safe(log.userId);

        if (!userId) continue;

        const exists = await pool.query(
          `
          SELECT attendance_id
          FROM attendance_logs
          WHERE user_id = $1
          AND punch_time = $2
          `,
          [userId, log.timestamp]
        );

        if (exists.rows.length === 0) {

          await pool.query(
            `
            INSERT INTO attendance_logs (
              user_id,
              punch_time
            )
            VALUES ($1,$2)
            `,
            [userId, log.timestamp]
          );
        }

      } catch (e) {

        console.log(
          "⚠️ Attendance Error:",
          e.message
        );
      }
    }

    await zk.disconnect();

    console.log("✅ Attendance Sync Done");

  } catch (err) {

    console.log(
      "❌ Attendance Sync Error:",
      err.message
    );
  }
}

// ======================================================
// ROUTES
// ======================================================
app.get("/sync-attendance", async (req, res) => {

  await syncAttendance();

  res.json({
    success: true,
  });
});

app.get("/check-expired", async (req, res) => {

  await checkExpiredMembers();

  res.json({
    success: true,
  });
});

// ======================================================
// CRON JOBS
// ======================================================
cron.schedule("*/2 * * * *", async () => {
  await checkExpiredMembers();
});

cron.schedule("*/5 * * * *", async () => {
  await syncAttendance();
});

// ======================================================
// START SERVER
// ======================================================
const PORT = process.env.PORT || 5000;

app.listen(PORT, async () => {

  console.log(
    `🚀 Server Started On Port ${PORT}`
  );

  await connectDB();

  await checkExpiredMembers();
});