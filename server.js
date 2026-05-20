const express = require("express");
const cors = require("cors");
const cron = require("node-cron");
const ZKLib = require("node-zklib");
const sql = require("mssql");
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
// DATABASE CONFIG
// ======================================================
const dbConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE || "km_fitness_club",
  port: parseInt(process.env.DB_PORT || "1433"),

  options: {
    encrypt: false,
    trustServerCertificate: true,
  },
};

let pool;

async function connectDB() {
  try {
    pool = await sql.connect(dbConfig);
    console.log("✅ SQL Connected");
  } catch (err) {
    console.log("❌ DB Error:", err.message);
  }
}

// ======================================================
// BIOMETRIC CONFIG
// ======================================================
const DEVICE_IP = process.env.DEVICE_IP || "192.168.0.201";
const DEVICE_PORT = parseInt(process.env.DEVICE_PORT || "4370");

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

      console.log(`⚠️ User Not Found In Device: ${userId}`);

      return false;
    }

    console.log("📌 Found Device User:", foundUser);

    // ==================================================
    // METHOD 1 - deleteUser
    // ==================================================
    if (typeof zk.deleteUser === "function") {

      try {

        await zk.deleteUser(foundUser.uid);

        console.log(`🚫 USER DELETED: ${userId}`);

        return true;

      } catch (e) {

        console.log("deleteUser failed:", e.message);
      }
    }

    // ==================================================
    // METHOD 2 - SSR_DeleteEnrollData
    // ==================================================
    if (typeof zk.executeCmd === "function") {

      try {

        // COMMAND 18 = DELETE USER
        await zk.executeCmd(18, Buffer.from([foundUser.uid]));

        console.log(`🚫 USER REMOVED USING COMMAND: ${userId}`);

        return true;

      } catch (e) {

        console.log("executeCmd failed:", e.message);
      }
    }

    // ==================================================
    // METHOD 3 - OVERWRITE USER
    // ==================================================
    if (typeof zk.setUser === "function") {

      try {

        await zk.setUser(
          foundUser.uid,
          String(userId),
          "EXPIRED_USER_BLOCKED",
          "",
          0
        );

        console.log(`🚫 USER OVERWRITTEN: ${userId}`);

        return true;

      } catch (e) {

        console.log("setUser fallback failed:", e.message);
      }
    }

    console.log("⚠️ No working remove method");

    return false;

  } catch (err) {

    console.log("❌ Remove User Error:", err.message);

    return false;
  }
}

// ======================================================
// ENABLE USER IN DEVICE
// ======================================================
async function enableUserInDevice(
  zk,
  userId,
  fullName
) {
  try {

    const uid = parseInt(userId);

    if (typeof zk.setUser !== "function") {

      console.log("❌ setUser method not found");

      return false;
    }

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

    console.log("❌ Enable User Error:", err.message);

    return false;
  }
}

// ======================================================
// GET MEMBERS
// ======================================================
app.get("/api/members", async (req, res) => {
  try {

    const result = await pool.request().query(`
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

        ISNULL(total_fee,0) as total_fee,
        ISNULL(paid_amount,0) as paid_amount,
        ISNULL(remaining_amount,0) as remaining_amount,

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
      data: result.recordset || [],
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
    const safePaidAmount = Number(paid_amount || 0);

    const remainingAmount =
      safeTotalFee - safePaidAmount;

    let paymentStatus = "Pending";

    if (safePaidAmount >= safeTotalFee) {
      paymentStatus = "Active";
    } else {
      paymentStatus = "Partial";
    }

    await pool.request()

      .input("user_id", sql.VarChar(50), safe(user_id))
      .input("full_name", sql.VarChar(150), safe(full_name, "Unknown"))
      .input("phone", sql.VarChar(20), safe(phone, ""))
      .input("email", sql.VarChar(100), safe(email, ""))
      .input("address", sql.VarChar(300), safe(address, ""))

      .input("membership_type", sql.VarChar(50), safe(membership_type, "Normal"))

      .input("start_date", sql.Date, safe(start_date, new Date()))
      .input("expiry_date", sql.Date, safe(expiry_date, new Date()))

      .input("total_fee", sql.Decimal(10,2), safeTotalFee)
      .input("paid_amount", sql.Decimal(10,2), safePaidAmount)
      .input("remaining_amount", sql.Decimal(10,2), remainingAmount)

      .input("payment_method", sql.VarChar(50), safe(payment_method, "Cash"))
      .input("payment_status", sql.VarChar(50), paymentStatus)

      .query(`
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
          remaining_amount,
          payment_method,
          payment_status
        )
        VALUES (
          @user_id,
          @full_name,
          @phone,
          @email,
          @address,
          @membership_type,
          @start_date,
          @expiry_date,
          @total_fee,
          @paid_amount,
          @remaining_amount,
          @payment_method,
          @payment_status
        )
      `);

    // ENABLE DEVICE ACCESS
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
    const safePaidAmount = Number(paid_amount || 0);

    const remainingAmount =
      safeTotalFee - safePaidAmount;

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

    // GET MEMBER
    const memberResult = await pool.request()
      .input("id", sql.Int, id)
      .query(`
        SELECT *
        FROM members
        WHERE member_id = @id
      `);

    if (memberResult.recordset.length === 0) {

      return res.status(404).json({
        success: false,
        message: "Member Not Found",
      });
    }

    const member = memberResult.recordset[0];

    // UPDATE DATABASE
    await pool.request()

      .input("id", sql.Int, id)

      .input("full_name", sql.VarChar(150), safe(full_name, "Unknown"))
      .input("phone", sql.VarChar(20), safe(phone, ""))
      .input("email", sql.VarChar(100), safe(email, ""))
      .input("address", sql.VarChar(300), safe(address, ""))

      .input("membership_type", sql.VarChar(50), safe(membership_type, "Normal"))

      .input("start_date", sql.Date, safe(start_date, new Date()))
      .input("expiry_date", sql.Date, safe(expiry_date, new Date()))

      .input("total_fee", sql.Decimal(10,2), safeTotalFee)
      .input("paid_amount", sql.Decimal(10,2), safePaidAmount)
      .input("remaining_amount", sql.Decimal(10,2), remainingAmount)

      .input("payment_method", sql.VarChar(50), safe(payment_method, "Cash"))
      .input("payment_status", sql.VarChar(50), finalStatus)

      .query(`
        UPDATE members
        SET
          full_name = @full_name,
          phone = @phone,
          email = @email,
          address = @address,
          membership_type = @membership_type,
          start_date = @start_date,
          expiry_date = @expiry_date,
          total_fee = @total_fee,
          paid_amount = @paid_amount,
          remaining_amount = @remaining_amount,
          payment_method = @payment_method,
          payment_status = @payment_status,
          updated_at = GETDATE()
        WHERE member_id = @id
      `);

    // DEVICE CONTROL
    const zk = await connectDevice();

    if (zk) {

      if (finalStatus === "Expired") {

        await removeUserFromDevice(
          zk,
          member.user_id
        );

        console.log(`🔴 ACCESS BLOCKED: ${member.full_name}`);

      } else {

        await enableUserInDevice(
          zk,
          member.user_id,
          full_name || member.full_name
        );

        console.log(`🟢 ACCESS ALLOWED: ${member.full_name}`);
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
// AUTO CHECK EXPIRED MEMBERS
// ======================================================
async function checkExpiredMembers() {
  try {

    console.log("\n🔄 Checking expired members...");

    const expired = await pool.request().query(`
      SELECT *
      FROM members
      WHERE expiry_date < CAST(GETDATE() AS DATE)
      AND payment_status != 'Expired'
    `);

    const list = expired.recordset || [];

    console.log(`📥 Expired Members Found: ${list.length}`);

    if (list.length === 0) return;

    const zk = await connectDevice();

    for (const member of list) {

      try {

        await pool.request()
          .input("id", sql.Int, member.member_id)
          .query(`
            UPDATE members
            SET payment_status = 'Expired'
            WHERE member_id = @id
          `);

        console.log(`🔴 Marked Expired: ${member.full_name}`);

        if (zk) {

          await removeUserFromDevice(
            zk,
            member.user_id
          );

          console.log(`🚫 ACCESS REMOVED: ${member.full_name}`);
        }

      } catch (e) {

        console.log("⚠️ Expiry Error:", e.message);
      }
    }

    if (zk) {
      await zk.disconnect();
    }

  } catch (err) {

    console.log("❌ Expiry Cron Error:", err.message);
  }
}

// ======================================================
// ATTENDANCE SYNC
// ======================================================
async function syncAttendance() {
  try {

    const zk = await connectDevice();

    if (!zk) return;

    const attendances = await zk.getAttendances();

    const logs = attendances?.data || [];

    console.log(`📥 Attendance found: ${logs.length}`);

    for (const log of logs) {

      try {

        const userId = safe(log.userId);

        if (!userId) continue;

        const exists = await pool.request()
          .input("user_id", sql.VarChar(50), userId)
          .input("punch_time", sql.DateTime, log.timestamp)
          .query(`
            SELECT attendance_id
            FROM attendance_logs
            WHERE user_id = @user_id
            AND punch_time = @punch_time
          `);

        if (exists.recordset.length === 0) {

          await pool.request()

            .input("user_id", sql.VarChar(50), userId)
            .input("punch_time", sql.DateTime, log.timestamp)

            .query(`
              INSERT INTO attendance_logs (
                user_id,
                punch_time
              )
              VALUES (
                @user_id,
                @punch_time
              )
            `);
        }

      } catch (e) {

        console.log("⚠️ Attendance Error:", e.message);
      }
    }

    await zk.disconnect();

    console.log("✅ Attendance Sync Done");

  } catch (err) {

    console.log("❌ Attendance Sync Error:", err.message);
  }
}

// ======================================================
// MANUAL ROUTES
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

  console.log("🚀 Server Started On Port:", PORT);

  await connectDB();

  await checkExpiredMembers();
});