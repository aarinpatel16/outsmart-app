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
    ALTER TABLE lesson_logs
    ADD COLUMN IF NOT EXISTS dinner_talk_question_id INTEGER REFERENCES dinner_talk_questions(id) ON DELETE SET NULL;
  `);

  console.log("dinner_talk_question_id column added successfully");
  process.exit();
}

run();