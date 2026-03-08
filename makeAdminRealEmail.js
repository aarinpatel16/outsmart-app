require("dotenv").config();

const bcrypt = require("bcrypt");
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function updateAdmin() {
  const oldEmail = "OTSadmin";
  const newName = "OTS Admin";
  const newEmail = "otsadmin@app.com";
  const newPassword = "OTS1234";

  const hash = await bcrypt.hash(newPassword, 10);

  await pool.query(
    `
    UPDATE users
    SET name = $1,
        email = $2,
        password_hash = $3,
        role = 'admin'
    WHERE email = $4
    `,
    [newName, newEmail, hash, oldEmail]
  );

  console.log("Admin updated successfully");
  process.exit();
}

updateAdmin();