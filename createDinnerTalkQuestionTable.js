require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("render.com")
    ? { rejectUnauthorized: false }
    : false,
});

async function run() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dinner_talk_questions (
      id SERIAL PRIMARY KEY,
      question_text TEXT NOT NULL UNIQUE,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  console.log("dinner_talk_questions table created successfully");
  process.exit();
}

run();