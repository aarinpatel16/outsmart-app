// ============================================================
// server.js — Outsmart the System backend (Postgres + Excel)
// npm i express pg bcrypt jsonwebtoken cors dotenv xlsx
// ============================================================
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// -------------------- ENV --------------------
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  console.error("Missing JWT_SECRET in .env — login will be insecure. Add it now.");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function ensureDatabaseSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS lessons (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      category TEXT NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    ALTER TABLE lesson_logs
    ADD COLUMN IF NOT EXISTS lesson_id INTEGER
  `);
}

// -------------------- LOGGING --------------------
app.use((req, res, next) => {
  console.log(`[REQ] ${req.method} ${req.path}`);
  next();
});

ensureDatabaseSchema()
  .then(() => console.log("[INIT] database schema ready"))
  .catch((err) => console.error("[INIT] failed to ensure database schema", err));

// -------------------- CATEGORY NORMALIZATION --------------------
// Your frontend sends: fin | eq | lead | din
// DB stores: Financial Literacy | Emotional Intelligence | Leadership | Dinner Talk
const CAT_MAP = {
  fin: "Financial Literacy",
  eq: "Emotional Intelligence",
  lead: "Leadership",
  din: "Dinner Talk",
};
const CATEGORIES = Object.values(CAT_MAP);

function normalizeCategory(input) {
  if (!input) return null;
  const v = String(input).trim();
  if (CAT_MAP[v]) return CAT_MAP[v];
  // allow already-full category names
  if (CATEGORIES.includes(v)) return v;
  return null;
}

// -------------------- AUTH --------------------
function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    JWT_SECRET || "insecure_dev_secret_change_me",
    { expiresIn: "14d" }
  );
}

function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "No token" });

  try {
    req.user = jwt.verify(token, JWT_SECRET || "insecure_dev_secret_change_me");
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

function adminOnly(req, res, next) {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({ error: "Admins only" });
  }
  next();
}

// -------------------- STATS --------------------
async function computeStats(userId) {
  const { rows: logs } = await pool.query(
    `SELECT category, created_at
     FROM lesson_logs
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [userId]
  );

  const total_logs = logs.length;

  // category counts
  const category_counts = {};
  for (const c of CATEGORIES) category_counts[c] = 0;
  for (const l of logs) {
    if (category_counts[l.category] !== undefined) category_counts[l.category]++;
  }

  const categories_completed = Object.values(category_counts).filter((n) => n > 0).length;

  // streak (count consecutive days with >=1 log)
  // We compute based on dates (local server time)
  const daysSet = new Set(
    logs.map((l) => {
      const d = new Date(l.created_at);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
        d.getDate()
      ).padStart(2, "0")}`;
    })
  );

  let streak_days = 0;
  {
    const today = new Date();
    // count backwards from today
    for (let i = 0; i < 3650; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
        d.getDate()
      ).padStart(2, "0")}`;
      if (daysSet.has(key)) streak_days++;
      else break;
    }
  }

  // Level: starts at 1, increases by 1 each time they complete all 4 categories (in any order)
  let level = 1;
  {
    const { rows: asc } = await pool.query(
      `SELECT category
       FROM lesson_logs
       WHERE user_id = $1
       ORDER BY created_at ASC`,
      [userId]
    );
    let seen = new Set();
    for (const r of asc) {
      seen.add(r.category);
      if (CATEGORIES.every((c) => seen.has(c))) {
        level++;
        seen = new Set();
      }
    }
  }

  // Badges (simple + readable)
  const badges = [];
  const push = (id, name, emoji) => badges.push({ id, name, emoji });

  if (total_logs >= 1) push("first_log", "First Entry", "🌱");
  if (total_logs >= 5) push("five_logs", "Getting Started", "⭐");
  if (total_logs >= 10) push("ten_logs", "In the Groove", "🔥");
  if (categories_completed === 4) push("all_four", "All Four Skills", "🏆");
  if (streak_days >= 3) push("streak_3", "3-Day Streak", "⚡");
  if (level >= 2) push("level_up", "Level Up", "🚀");

  return {
    total_logs,
    category_counts,
    categories_completed,
    streak_days,
    level,
    badges,
  };
}

// -------------------- EXCEL EXPORT --------------------
// Writes to student_logs.xlsx in the same folder as server.js
const EXCEL_PATH = process.env.EXCEL_PATH || path.join(__dirname, "student_logs.xlsx");
const EXCEL_SHEET = "Logs";

function ensureWorkbook() {
  if (fs.existsSync(EXCEL_PATH)) {
    return XLSX.readFile(EXCEL_PATH);
  }
  const wb = XLSX.utils.book_new();
  const headers = [[
    "timestamp_iso",
    "student_id",
    "student_name",
    "student_email",
    "category",
    "title",
    "notes",
    "mood",
    "level"
  ]];
  const ws = XLSX.utils.aoa_to_sheet(headers);
  XLSX.utils.book_append_sheet(wb, ws, EXCEL_SHEET);
  XLSX.writeFile(wb, EXCEL_PATH);
  return wb;
}

function appendRowToExcel(rowObj) {
  try {
    const wb = ensureWorkbook();
    const ws = wb.Sheets[EXCEL_SHEET] || wb.Sheets[wb.SheetNames[0]];
    const existing = XLSX.utils.sheet_to_json(ws, { header: 1 });
    existing.push([
      rowObj.timestamp_iso,
      rowObj.student_id,
      rowObj.student_name,
      rowObj.student_email,
      rowObj.category,
      rowObj.title,
      rowObj.notes,
      rowObj.mood,
      rowObj.level,
    ]);
    const newWs = XLSX.utils.aoa_to_sheet(existing);

    // replace sheet
    wb.Sheets[EXCEL_SHEET] = newWs;
    if (!wb.SheetNames.includes(EXCEL_SHEET)) wb.SheetNames.push(EXCEL_SHEET);

    XLSX.writeFile(wb, EXCEL_PATH);
    console.log(`[Excel] appended row -> ${EXCEL_PATH}`);
  } catch (e) {
    console.error("[Excel] Failed to append:", e.message);
  }
}

// -------------------- ROUTES --------------------
app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Serve index.html if it exists next to server.js
app.get("/", (req, res) => {
  const p = path.join(__dirname, "index.html");
  if (fs.existsSync(p)) return res.sendFile(p);
  res.status(404).send("index.html not found next to server.js");
});

// -------- AUTH --------

// Student register
app.post("/auth/student/register", async (req, res, next) => {
  return res.status(403).json({ error: "Account creation is managed by the owner in admin mode." });
});

// Parent register (requires childEmail to link)
app.post("/auth/parent/register", async (req, res, next) => {
  return res.status(403).json({ error: "Account creation is managed by the owner in admin mode." });
});

// Login (student or parent)
app.post("/auth/login", async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "email and password required" });

    const { rows } = await pool.query(
      `SELECT id, name, email, role, theme, password_hash
       FROM users
       WHERE LOWER(email) = LOWER($1)`,
      [String(email).trim()]
    );

    const u = rows[0];
    if (!u) return res.status(401).json({ error: "Invalid credentials" });

    const ok = await bcrypt.compare(password, u.password_hash);
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });

    const user = { id: u.id, name: u.name, email: u.email, role: u.role, theme: u.theme };
    const token = signToken(user);

    let stats = null;
    if (user.role === "student") stats = await computeStats(user.id);

    res.json({ token, user, stats });
  } catch (e) {
    next(e);
  }
});

// Current user
app.get("/me", auth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, email, role, theme FROM users WHERE id = $1`,
      [req.user.id]
    );
    const user = rows[0];
    if (!user) return res.status(404).json({ error: "User not found" });

    let stats = null;
    if (user.role === "student") stats = await computeStats(user.id);

    res.json({ user, stats });
  } catch (e) {
    next(e);
  }
});

app.put("/me/theme", auth, async (req, res, next) => {
  try {
    const { theme } = req.body;

    if (!theme) {
      return res.status(400).json({ error: "Theme is required." });
    }

    await pool.query(
      `UPDATE users SET theme = $1 WHERE id = $2`,
      [theme, req.user.id]
    );

    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

app.get("/leaderboard", auth, async (req, res, next) => {
  try {
    if (req.user.role !== "student") {
      return res.status(403).json({ error: "Students only" });
    }

    const { rows: students } = await pool.query(
      `SELECT id, name, email
       FROM users
       WHERE role = 'student'
       ORDER BY LOWER(name), id`
    );

    const leaderboard = await Promise.all(
      students.map(async (student) => {
        const stats = await computeStats(student.id);
        return {
          id: student.id,
          name: student.name,
          email: student.email,
          total_logs: stats.total_logs,
          level: stats.level,
          categories_completed: stats.categories_completed,
          streak_days: stats.streak_days,
        };
      })
    );

    res.json({ leaderboard });
  } catch (e) {
    next(e);
  }
});

// -------- ADMIN --------
app.get("/admin/test", auth, adminOnly, async (req, res) => {
  res.json({
    ok: true,
    message: "Admin mode is working",
    user: req.user
  });
});

app.get("/admin/users", auth, adminOnly, async (req, res, next) => {
  try {
    const overviewResult = await pool.query(
      `SELECT
         COUNT(*)::int AS total_users,
         COUNT(*) FILTER (WHERE role = 'student')::int AS total_students,
         COUNT(*) FILTER (WHERE role = 'parent')::int AS total_parents,
         COUNT(*) FILTER (WHERE role = 'admin')::int AS total_admins
       FROM users`
    );

    const usersResult = await pool.query(
      `SELECT
         u.id,
         u.name,
         u.email,
         u.role,
         u.theme,
         u.created_at,
         COUNT(ll.id)::int AS total_logs,
         COUNT(DISTINCT ll.category)::int AS categories_completed,
         MAX(ll.created_at) AS last_activity
       FROM users u
       LEFT JOIN lesson_logs ll ON ll.user_id = u.id
       GROUP BY u.id
       ORDER BY
         CASE u.role
           WHEN 'admin' THEN 1
           WHEN 'parent' THEN 2
           ELSE 3
         END,
         LOWER(u.name),
         LOWER(u.email)`
    );

    const logsResult = await pool.query(
      `SELECT
         ll.id,
         ll.user_id,
         ll.category,
         ll.title,
         ll.notes,
         COALESCE(
           ls.name,
           NULLIF(BTRIM(SPLIT_PART(SPLIT_PART(ll.notes, 'Selected Lesson: ', 2), E'\n', 1)), ''),
           'Unknown'
         ) AS lesson_name,
         ll.created_at,
         u.name AS user_name,
         u.email AS user_email,
         u.role AS user_role
       FROM lesson_logs ll
       LEFT JOIN lessons ls ON ls.id = ll.lesson_id
       JOIN users u ON u.id = ll.user_id
       ORDER BY ll.created_at DESC
       LIMIT 250`
    );

    const categoryBreakdownResult = await pool.query(
      `SELECT
         ll.category AS name,
         COUNT(*)::int AS count
       FROM lesson_logs ll
       GROUP BY ll.category
       ORDER BY COUNT(*) DESC, ll.category ASC`
    );

    const lessonBreakdownResult = await pool.query(
      `SELECT
         COALESCE(
           ls.name,
           NULLIF(BTRIM(SPLIT_PART(SPLIT_PART(ll.notes, 'Selected Lesson: ', 2), E'\n', 1)), ''),
           'Unknown'
         ) AS name,
         COUNT(*)::int AS count
       FROM lesson_logs ll
       LEFT JOIN lessons ls ON ls.id = ll.lesson_id
       GROUP BY 1
       ORDER BY COUNT(*) DESC, 1 ASC`
    );

    res.json({
      overview: overviewResult.rows[0],
      users: usersResult.rows,
      recentLogs: logsResult.rows,
      categoryBreakdown: categoryBreakdownResult.rows,
      lessonBreakdown: lessonBreakdownResult.rows,
    });
  } catch (e) {
    next(e);
  }
});

app.post("/admin/students", auth, adminOnly, async (req, res, next) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: "Name, email, and password are required." });
    }
    if (String(password).length < 4) {
      return res.status(400).json({ error: "Password must be at least 4 characters." });
    }

    const hash = await bcrypt.hash(String(password), 10);

    const { rows } = await pool.query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ($1, $2, $3, 'student')
       RETURNING id, name, email, role, theme, created_at`,
      [String(name).trim(), String(email).trim().toLowerCase(), hash]
    );

    res.status(201).json({ user: rows[0] });
  } catch (e) {
    if (String(e.message || "").toLowerCase().includes("duplicate")) {
      return res.status(400).json({ error: "Email already exists" });
    }
    next(e);
  }
});

app.delete("/admin/users/:id", auth, adminOnly, async (req, res, next) => {
  try {
    const userId = Number(req.params.id);

    if (!userId) {
      return res.status(400).json({ error: "A valid user id is required." });
    }

    if (Number(req.user.id) === userId) {
      return res.status(400).json({ error: "You cannot remove the admin account you are currently using." });
    }

    const { rows } = await pool.query(
      `DELETE FROM users
       WHERE id = $1
         AND role <> 'admin'
       RETURNING id, name, email, role`,
      [userId]
    );

    if (!rows[0]) {
      return res.status(404).json({ error: "User not found or cannot be removed." });
    }

    res.json({ ok: true, user: rows[0] });
  } catch (e) {
    next(e);
  }
});

app.post("/admin/reset-data", auth, adminOnly, async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const logsResult = await client.query(
      `DELETE FROM lesson_logs
       WHERE user_id IN (
         SELECT id FROM users WHERE role <> 'admin'
       )
       RETURNING id`
    );

    const usersResult = await client.query(
      `DELETE FROM users
       WHERE role <> 'admin'
       RETURNING id`
    );

    await client.query("COMMIT");
    res.json({
      ok: true,
      deleted_logs: logsResult.rowCount || 0,
      deleted_users: usersResult.rowCount || 0,
    });
  } catch (e) {
    await client.query("ROLLBACK");
    next(e);
  } finally {
    client.release();
  }
});

app.get("/admin/lessons", auth, adminOnly, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM lessons ORDER BY category, name`
    );
    res.json({ lessons: rows });
  } catch (e) {
    next(e);
  }
});

app.post("/admin/lessons", auth, adminOnly, async (req, res, next) => {
  try {
    const { name, category } = req.body;

    if (!name || !category) {
      return res.status(400).json({ error: "Lesson name and category are required." });
    }

    const { rows } = await pool.query(
      `INSERT INTO lessons (name, category)
       VALUES ($1, $2)
       RETURNING *`,
      [String(name).trim(), String(category).trim()]
    );

    res.status(201).json({ lesson: rows[0] });
  } catch (e) {
    if (e.code === "23505") {
      return res.status(400).json({ error: "That lesson name already exists." });
    }
    next(e);
  }
});

app.get("/lessons", auth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM lessons
       WHERE is_active = TRUE
       ORDER BY category, name`
    );
    res.json({ lessons: rows });
  } catch (e) {
    next(e);
  }
});

// -------- LOGS --------

// Create log (student only)
app.post("/logs", auth, async (req, res, next) => {
  try {
    if (req.user.role !== "student") {
      return res.status(403).json({ error: "Only students can submit logs" });
    }

    const catNorm = normalizeCategory(req.body.category);
    const title = (req.body.title || "").trim();
    const notes = (req.body.notes || "").trim();
    const mood = (req.body.mood || "").trim();
    const lessonId = req.body.lessonId ? Number(req.body.lessonId) : null;
  

    if (!catNorm) return res.status(400).json({ error: "Invalid category" });
    if (!title) return res.status(400).json({ error: "title required" });

    const { rows: [log] } = await pool.query(
      `INSERT INTO lesson_logs (user_id, category, title, notes, mood, lesson_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [req.user.id, catNorm, title, notes, mood, lessonId]
    );

    const stats = await computeStats(req.user.id);

    // Excel append (non-blocking-ish)
    // (We still await user lookup; Excel write is fast. If you want truly fire-and-forget, remove awaits.)
    const { rows: [student] } = await pool.query(
      `SELECT name, email FROM users WHERE id = $1`,
      [req.user.id]
    );

    appendRowToExcel({
      timestamp_iso: new Date(log.created_at).toISOString(),
      student_id: req.user.id,
      student_name: student?.name || "",
      student_email: student?.email || "",
      category: log.category,
      title: log.title,
      notes: log.notes || "",
      mood: log.mood || "",
      level: stats.level,
    });

    res.status(201).json({ log, stats });
  } catch (e) {
    next(e);
  }
});

// Get student logs + stats
app.get("/logs", auth, async (req, res, next) => {
  try {
    if (req.user.role !== "student") return res.status(403).json({ error: "Students only" });

    const { rows: logs } = await pool.query(
      `SELECT * FROM lesson_logs WHERE user_id = $1 ORDER BY created_at DESC`,
      [req.user.id]
    );

    const stats = await computeStats(req.user.id);
    res.json({ logs, stats });
  } catch (e) {
    next(e);
  }
});

// Parent: list children (+ stats)
app.get("/parent/children", auth, async (req, res, next) => {
  try {
    if (req.user.role !== "parent") return res.status(403).json({ error: "Parents only" });

    const { rows: children } = await pool.query(
      `SELECT u.id, u.name, u.email
       FROM users u
       JOIN parent_children pc ON pc.student_id = u.id
       WHERE pc.parent_id = $1`,
      [req.user.id]
    );

    const withStats = await Promise.all(
      children.map(async (c) => ({ ...c, stats: await computeStats(c.id) }))
    );

    res.json({ children: withStats });
  } catch (e) {
    next(e);
  }
});

// Parent: get child logs (must be linked)
app.get("/parent/logs", auth, async (req, res, next) => {
  try {
    if (req.user.role !== "parent") return res.status(403).json({ error: "Parents only" });

    const studentId = Number(req.query.studentId);
    if (!studentId) return res.status(400).json({ error: "studentId required" });

    const { rows: link } = await pool.query(
      `SELECT 1 FROM parent_children WHERE parent_id = $1 AND student_id = $2`,
      [req.user.id, studentId]
    );
    if (!link[0]) return res.status(403).json({ error: "Not your child" });

    const { rows: logs } = await pool.query(
      `SELECT * FROM lesson_logs WHERE user_id = $1 ORDER BY created_at DESC`,
      [studentId]
    );

    const stats = await computeStats(studentId);
    res.json({ logs, stats });
  } catch (e) {
    next(e);
  }
});

// -------------------- ERROR HANDLER --------------------
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || "Internal server error" });
});

// -------------------- START --------------------
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`[Excel] export path: ${EXCEL_PATH}`);
});
