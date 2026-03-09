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
    ALTER TABLE dinner_talk_questions
    ADD COLUMN IF NOT EXISTS lesson_id INTEGER REFERENCES lessons(id) ON DELETE CASCADE;
  `);

  console.log("lesson_id added to dinner_talk_questions successfully");
  process.exit();
}

run();