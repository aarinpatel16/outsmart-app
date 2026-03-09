require("dotenv").config();

const bcrypt = require("bcrypt");
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

async function createAdmin() {
  const name = "Admin";
  const email = "OTSadmin";
  const password = "OTS1234";

  const hash = await bcrypt.hash(password, 10);

  await pool.query(
    `
    INSERT INTO users (name, email, password_hash, role)
    VALUES ($1, $2, $3, 'admin')
    `,
    [name, email, hash]
  );

  console.log("✅ Admin created successfully");
  process.exit();
}

createAdmin();