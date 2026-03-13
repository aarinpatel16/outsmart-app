require("dotenv").config();

const bcrypt = require("bcrypt");
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function createAdmin() {
  const name = "Admin";
  const email = "OTSadmin";
  const password = "OTS1234";

  const hash = await bcrypt.hash(password, 10);

  const updated = await pool.query(
    `
    UPDATE users
    SET name = $1,
        email = $2,
        password_hash = $3,
        role = 'admin'
    WHERE LOWER(email) = LOWER($2)
    `,
    [name, email, hash]
  );

  if (updated.rowCount === 0) {
    await pool.query(
      `
      INSERT INTO users (name, email, password_hash, role)
      VALUES ($1, $2, $3, 'admin')
      `,
      [name, email, hash]
    );
  }

  console.log("Admin credentials are set: username OTSadmin / password OTS1234");
  process.exit();
}

createAdmin();
