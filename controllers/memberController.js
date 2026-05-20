const { getPool } = require("../config/db");

const getMembers = async (req, res) => {
    try {
        const pool = getPool();

        const result = await pool.request().query(`
            SELECT * FROM members
            ORDER BY member_id DESC
        `);

        res.json({
            success: true,
            data: result.recordset
        });

    } catch (error) {
        res.json({
            success: false,
            error: error.message
        });
    }
};

const addMember = async (req, res) => {
    try {
        res.json({
            success: true,
            message: "Add Member API Working"
        });
    } catch (error) {
        res.json({
            success: false,
            error: error.message
        });
    }
};

module.exports = {
    getMembers,
    addMember
};