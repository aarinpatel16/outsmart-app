const API = {
  _token: null,

  _headers() {
    const h = { "Content-Type": "application/json" };
    if (this._token) h["Authorization"] = `Bearer ${this._token}`;
    return h;
  },

  async _post(path, body) {
    const r = await fetch(path, {
      method: "POST",
      headers: this._headers(),
      body: JSON.stringify(body),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || "Request failed");
    return data;
  },

  async _get(path) {
    const r = await fetch(path, { headers: this._headers() });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || "Request failed");
    return data;
  },
  
  async _put(path, body) {
    const r = await fetch(path, {
      method: "PUT",
      headers: this._headers(),
      body: JSON.stringify(body),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || "Request failed");
    return data;
  },

  studentRegister(name, email, password) {
    return this._post("/auth/student/register", { name, email, password });
  },

  login(email, password) {
    return this._post("/auth/login", { email, password });
  },

  me() {
    return this._get("/me");
  },
  
  saveTheme(theme) {
    return this._put("/me/theme", { theme });
  },

  submitLog(category, title, notes, lessonId, dinnerTalkQuestionId) {
    return this._post("/logs", { category, title, notes, lessonId, dinnerTalkQuestionId });
  },

  getLogs() {
    return this._get("/logs");
  },

  getAdminTest() {
    return this._get("/admin/test");
  },

  getAdminLessons() {
    return this._get("/admin/lessons");
  },

  getAdminStudents() {
    return this._get("/admin/students");
  },

  getAdminStudentLogs(studentId) {
    return this._get(`/admin/students/${studentId}/logs`);
  },

  createAdminLesson(name, category) {
    return this._post("/admin/lessons", { name, category });
  },

  getLessons() {
    return this._get("/lessons");
  },

  getDinnerTalkQuestions(lessonId) {
    return this._get(`/lessons/${lessonId}/dinner-talk-questions`);
  },

  getAdminDinnerTalkQuestions() {
    return this._get("/admin/dinner-talk-questions");
  },

  createAdminDinnerTalkQuestion(questionText, lessonId) {
    return this._post("/admin/dinner-talk-questions", { question_text: questionText, lesson_id: lessonId });
  },
};

let currentUser = null;
let currentStats = null;
let selectedCatKey = null;
let _knownBadgeIds = [];

function $(id) { return document.getElementById(id); }

function showToast(msg) {
  const t = $("toast");
  if (!t) return alert(msg);
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove("show"), 2500);
}

function setText(id, value) {
  const el = $(id);
  if (el) el.textContent = String(value ?? "");
}

function initials(name) {
  const parts = String(name || "?").trim().split(/\s+/);
  return (parts[0]?.[0] || "?").toUpperCase() + (parts[1]?.[0] || "").toUpperCase();
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function openModal(id) {
  const el = $(id);
  if (el) el.classList.add("show");
}

function closeModal(id) {
  const el = $(id);
  if (el) el.classList.remove("show");
}

function logoutAll() {
  sessionStorage.removeItem("ots_token");
  API._token = null;
  currentUser = null;
  currentStats = null;
  showToast("Logged out");
  showScreen("screen-login");
}

function switchLoginMode(mode) {
  const tabSignin = $("tab-signin");
  const tabCreate = $("tab-create");
  if (tabSignin) tabSignin.classList.toggle("active", mode === "signin");
  if (tabCreate) tabCreate.classList.toggle("active", mode === "create");

  const signIn = $("mode-signin");
  const create = $("mode-create");
  if (signIn) signIn.style.display = (mode === "signin") ? "block" : "none";
  if (create) create.style.display = (mode === "create") ? "block" : "none";
}

function showScreen(screenId) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  const el = $(screenId);
  if (el) el.classList.add("active");

  const nav = $("bottom-nav");
  if (nav) nav.style.display = (screenId === "screen-login") ? "none" : "flex";

  const navMap = {
    "screen-dashboard": "nav-dash",
    "screen-log": "nav-log",
    "screen-badges": "nav-badges",
  };

  document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
  const navId = navMap[screenId];
  if (navId && $(navId)) $(navId).classList.add("active");

  if (screenId === "screen-dashboard") refreshDashboard();
  if (screenId === "screen-log") {
  setFormDateToday();
  loadStudentLessons();
  }
  if (screenId === "screen-badges") renderBadges();
}
async function restoreSession() {
  const saved = sessionStorage.getItem("ots_token");
  if (!saved) return;

  try {
    API._token = saved;
    const { user, stats } = await API.me();
    currentUser = user;
    currentStats = stats || null;

    if (user.theme) {
      await applyTheme(user.theme, false);
    }

    if (user.role === "admin") {
      showScreen("screen-admin");
      await loadAdminLessons();
      await loadAdminDinnerTalkQuestions();
      await loadAdminDinnerTalkLessonOptions();
      await loadAdminStudents();

    } else if (user.role === "student") {
      await refreshDashboard();
      showScreen("screen-dashboard");

    } else {
      sessionStorage.removeItem("ots_token");
      API._token = null;
    }

  } catch {
    sessionStorage.removeItem("ots_token");
    API._token = null;
  }
}

async function signIn() {
  try {
    const email = $("si-email")?.value?.trim();
    const password = $("si-pass")?.value;
    if (!email || !password) return showToast("Enter your email and password.");

    const { token, user, stats } = await API.login(email, password);

    API._token = token;
    sessionStorage.setItem("ots_token", token);
    currentUser = user;
    currentStats = stats;

    if (user.theme) {
      await applyTheme(user.theme, false);
    }

    showToast("Signed in!");

    if (user.role === "admin") {
      showScreen("screen-admin");
      await loadAdminLessons();
      await loadAdminDinnerTalkQuestions();
      await loadAdminDinnerTalkLessonOptions();
      await loadAdminStudents();
    } else {
      await refreshDashboard();
      showScreen("screen-dashboard");
    }
  } catch (e) {
    showToast(e.message);
  }
}

async function createAccount() {
  try {
    const name = $("ca-name")?.value?.trim();
    const email = $("ca-email")?.value?.trim();
    const password = $("ca-pass")?.value;

    if (!name || !email || !password) return showToast("Fill in name, email, and password.");
    if (password.length < 4) return showToast("Password must be at least 4 characters.");

    const { token, user, stats } = await API.studentRegister(name, email, password);
    API._token = token;
    sessionStorage.setItem("ots_token", token);
    currentUser = user;
    currentStats = stats;

    if (user.theme) {
      await applyTheme(user.theme, false);
    }

    showToast("Account created!");
    await refreshDashboard();
    showScreen("screen-dashboard");
  } catch (e) {
    showToast(e.message);
  }
}

function goLogCat(key) {
  selectCat(key);
  showScreen("screen-log");
}

function selectCat(key) {
  selectedCatKey = key;
  ["fin","eq","lead","din"].forEach(k => {
    const opt = $(`opt-${k}`);
    if (opt) opt.classList.toggle("selected", k === key);
  });

    loadStudentLessons();

    const dtqGroup = $("dinner-talk-question-group");
    if (dtqGroup) {
      dtqGroup.style.display = key === "din" ? "block" : "none";
    }

      const lessonLabelTitle = $("student-lesson-label-title");
      const intelLabel = $("form-intel-label");
      const intelField = $("form-intel");

      if (key === "din") {
        if (lessonLabelTitle) lessonLabelTitle.textContent = "Related Lesson";
        if (intelLabel) intelLabel.textContent = "Parent's Response";
        if (intelField) intelField.placeholder = "What did your parent say during the conversation?";
      } else {
        if (lessonLabelTitle) lessonLabelTitle.textContent = "Lesson";
        if (intelLabel) intelLabel.textContent = "What did you learn?";
        if (intelField) intelField.placeholder = "Drop the knowledge bomb here...";
      }

    if (key === "din") {
      loadDinnerTalkQuestions();
    } else {
      const hidden = $("student-dtq-dropdown");
      const label = $("student-dtq-label");
      const wrap = $("student-dtq-dropdown-wrap");
      const menu = $("student-dtq-menu");

      if (hidden) hidden.value = "";
      if (label) label.textContent = "Select a Dinner Talk question";
      if (wrap) wrap.classList.remove("open");
      if (menu) menu.innerHTML = "";
    }
}

function setFormDateToday() {
  const el = $("form-date");
  if (!el) return;
  el.textContent = new Date().toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric"
  });
}

async function submitLog() {
  try {
    if (!currentUser) return showToast("Sign in first.");
    if (!selectedCatKey) return showToast("Pick a category.");

    const lessonId = $("student-lesson-dropdown")?.value;
    if (!lessonId) return showToast("Pick a lesson.");

    const dinnerTalkQuestionId = $("student-dtq-dropdown")?.value;
    if (selectedCatKey === "din" && !dinnerTalkQuestionId) {
      return showToast("Pick a Dinner Talk question.");
    }

    const title = $("form-intel")?.value?.trim();
    const notes = $("form-action")?.value?.trim() || "";

    if (!title) return showToast("Write what you learned.");

    const { stats } = await API.submitLog(selectedCatKey, title, notes, lessonId, dinnerTalkQuestionId);
    currentStats = stats;

    if ($("form-intel")) $("form-intel").value = "";
    if ($("form-action")) $("form-action").value = "";
    if ($("student-dtq-dropdown")) $("student-dtq-dropdown").value = "";
    if ($("student-dtq-label")) $("student-dtq-label").textContent = "Select a Dinner Talk question";
    if ($("student-dtq-menu")) $("student-dtq-menu").innerHTML = "";
    if ($("student-dtq-dropdown-wrap")) $("student-dtq-dropdown-wrap").classList.remove("open");
    if ($("dinner-talk-question-group")) $("dinner-talk-question-group").style.display = "none";
    selectedCatKey = null;
    ["fin","eq","lead","din"].forEach(k => $(`opt-${k}`)?.classList.remove("selected"));
    if ($("student-lesson-label-title")) $("student-lesson-label-title").textContent = "Lesson";
    if ($("form-intel-label")) $("form-intel-label").textContent = "What did you learn?";
    if ($("form-intel")) $("form-intel").placeholder = "Drop the knowledge bomb here...";

    checkBadges(stats);
    openModal("modal-log-success");
    refreshDashboard();
  } catch (e) {
    showToast(e.message);
  }
}

function closeLogSuccess() {
  closeModal("modal-log-success");
  showScreen("screen-dashboard");
}
function toggleLessonDropdown() {
  const wrap = $("student-lesson-dropdown-wrap");
  if (!wrap) return;
  wrap.classList.toggle("open");
}

function toggleDinnerTalkQuestionDropdown() {
  const wrap = $("student-dtq-dropdown-wrap");
  if (!wrap) return;
  wrap.classList.toggle("open");
}

async function loadStudentLessons() {
  try {
    const { lessons } = await API.getLessons();

    const categoryMap = {
      fin: "Financial Literacy",
      eq: "Emotional Intelligence",
      lead: "Leadership",
      din: "Dinner Talk",
    };

    const selectedCategoryName = categoryMap[selectedCatKey];

    const menu = $("student-lesson-menu");
    const hiddenInput = $("student-lesson-dropdown");
    const label = $("student-lesson-label");
    const wrap = $("student-lesson-dropdown-wrap");

    if (!menu || !hiddenInput || !label || !wrap) return;

    hiddenInput.value = "";
    label.textContent = "Select a lesson";
    wrap.classList.remove("open");

    menu.innerHTML = "";

    let filteredLessons = [];

    if (selectedCatKey === "din") {
      filteredLessons = lessons.filter(
        (lesson) =>
          lesson.category === "Financial Literacy" ||
          lesson.category === "Emotional Intelligence"
      );
    } else {
      filteredLessons = lessons.filter(
        (lesson) => lesson.category === selectedCategoryName
      );
    }

    if (!filteredLessons.length) {
      menu.innerHTML = `<div class="custom-dropdown-item empty">No lessons in this category yet</div>`;
      return;
    }

    filteredLessons.forEach((lesson) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "custom-dropdown-item";
      btn.textContent = lesson.name;

      btn.onclick = () => {
        hiddenInput.value = lesson.id;
        label.textContent = lesson.name;

        document.querySelectorAll("#student-lesson-menu .custom-dropdown-item").forEach(el => {
          el.classList.remove("active");
        });
        btn.classList.add("active");

        wrap.classList.remove("open");

        if (selectedCatKey === "din") {
          loadDinnerTalkQuestions();
        }
      };

      menu.appendChild(btn);
    });
  } catch (e) {
    console.error("Failed to load student lessons:", e);
    showToast("Could not load lessons.");
  }
}

async function loadDinnerTalkQuestions() {
  try {
    const lessonId = $("student-lesson-dropdown")?.value;

    const menu = $("student-dtq-menu");
    const hiddenInput = $("student-dtq-dropdown");
    const label = $("student-dtq-label");
    const wrap = $("student-dtq-dropdown-wrap");

    if (!menu || !hiddenInput || !label || !wrap) return;

    hiddenInput.value = "";
    label.textContent = "Select a Dinner Talk question";
    wrap.classList.remove("open");
    menu.innerHTML = "";

    if (!lessonId) {
      menu.innerHTML = `<div class="custom-dropdown-item empty">Pick a related lesson first</div>`;
      return;
    }

    const { questions } = await API.getDinnerTalkQuestions(lessonId);

    if (!questions.length) {
      menu.innerHTML = `<div class="custom-dropdown-item empty">No Dinner Talk questions for this lesson yet</div>`;
      return;
    }

    questions.forEach((question) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "custom-dropdown-item";
      btn.textContent = question.question_text;

      btn.onclick = () => {
        hiddenInput.value = question.id;
        label.textContent = question.question_text;

        document.querySelectorAll("#student-dtq-menu .custom-dropdown-item").forEach(el => {
          el.classList.remove("active");
        });
        btn.classList.add("active");

        wrap.classList.remove("open");
      };

      menu.appendChild(btn);
    });
  } catch (e) {
    console.error("Failed to load Dinner Talk questions:", e);
    showToast("Could not load Dinner Talk questions.");
  }
}

function getRankName(level) {
  if (level >= 5) return "Mastermind";
  if (level >= 4) return "Operator";
  if (level >= 3) return "Strategist";
  if (level >= 2) return "Learner";
  return "Beginner";
}

function getRankSub(level) {
  if (level >= 5) return "You are operating at an elite level.";
  if (level >= 4) return "You are building real consistency and depth.";
  if (level >= 3) return "Your growth is becoming strategic.";
  if (level >= 2) return "You are gaining momentum.";
  return "Keep logging lessons to level up.";
}

function catCountFromStats(stats, key) {
  const map = {
    fin: "Financial Literacy",
    eq: "Emotional Intelligence",
    lead: "Leadership",
    din: "Dinner Talk",
  };
  return stats?.category_counts?.[map[key]] ?? 0;
}

async function refreshDashboard() {
  if (!currentUser || currentUser.role !== "student") return;

  try {
    const { logs, stats } = await API.getLogs();
    currentStats = stats;

    setText("dash-name", currentUser.name || "—");
    setText("h-level", stats.level || 1);

    const av = $("h-avatar");
    if (av) av.textContent = initials(currentUser.name);

    const fin = catCountFromStats(stats, "fin");
    const eq = catCountFromStats(stats, "eq");
    const lead = catCountFromStats(stats, "lead");
    const din = catCountFromStats(stats, "din");

    setText("count-fin", `${fin} logs`);
    setText("count-eq", `${eq} logs`);
    setText("count-lead", `${lead} logs`);
    setText("count-din", `${din} logs`);

    const cleared = [fin, eq, lead, din].filter(n => n > 0).length;
    setText("cats-cleared", cleared);

    const fill = $("progress-fill");
    if (fill) fill.style.width = `${Math.round((cleared / 4) * 100)}%`;

    $("card-fin")?.classList.toggle("cleared", fin > 0);
    $("card-eq")?.classList.toggle("cleared", eq > 0);
    $("card-lead")?.classList.toggle("cleared", lead > 0);
    $("card-din")?.classList.toggle("cleared", din > 0);

    const list = $("recent-logs");
    const total = logs?.length || 0;
    setText("total-count", `${total} entries`);

    if (list) {
      if (!total) {
        list.innerHTML = `
          <div class="empty-state">
            <div class="icon">📂</div>
            <p>Nothing here yet.</p>
            <p style="margin-top:8px;font-size:9px;">Tap the button below to add your first entry.</p>
          </div>`;
      } else {
        list.innerHTML = logs.slice(0, 10).map(l => {
          const c = String(l.category || "").toLowerCase();
          let color = "#63b3ed";
          if (c.includes("emotional")) color = "#b794f4";
          if (c.includes("leader")) color = "#fc814a";
          if (c.includes("dinner")) color = "#68d391";

          const date = new Date(l.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
          return `
            <div class="log-item" style="border-left-color:${color}">
              <div class="log-item-top">
                <div class="log-cat-tag">${escapeHtml(l.category)}</div>
                <div class="log-date">${date}</div>
              </div>
              <div class="log-intel">${escapeHtml(l.title)}</div>
              ${l.notes ? `<div class="log-action">${escapeHtml(l.notes)}</div>` : ""}
            </div>`;
        }).join("");
      }
    }
  } catch (e) {
    console.error("refreshDashboard:", e);
  }
}

const ALL_BADGES = [
  { id: "first_log", icon: "🌱", name: "First Entry", desc: "Submitted your very first lesson." },
  { id: "five_logs", icon: "⭐", name: "Getting Started", desc: "Submitted 5 total logs." },
  { id: "ten_logs", icon: "🔥", name: "In the Groove", desc: "Submitted 10 total logs." },
  { id: "twenty_five_logs", icon: "💪", name: "Committed", desc: "Submitted 25 total logs." },
  { id: "fifty_logs", icon: "🏆", name: "Machine", desc: "Submitted 50 total logs." },

  { id: "all_four", icon: "🎯", name: "All Four Skills", desc: "Logged at least one lesson in every category." },

  { id: "streak_3", icon: "⚡", name: "3-Day Streak", desc: "Logged lessons 3 days in a row." },
  { id: "streak_7", icon: "📅", name: "Week Streak", desc: "Logged lessons 7 days in a row." },
  { id: "streak_14", icon: "🚀", name: "2-Week Streak", desc: "Logged lessons 14 days in a row." },

  { id: "finance_5", icon: "💰", name: "Finance Builder", desc: "Logged 5 Financial Literacy lessons." },
  { id: "eq_5", icon: "🧠", name: "EQ Builder", desc: "Logged 5 Emotional Intelligence lessons." },
  { id: "lead_5", icon: "⚡", name: "Leadership Builder", desc: "Logged 5 Leadership lessons." },
  { id: "din_5", icon: "🗣️", name: "Dinner Talk Builder", desc: "Logged 5 Dinner Talk lessons." },

  { id: "level_2", icon: "⬆️", name: "Level 2", desc: "Reached Level 2." },
  { id: "level_3", icon: "🏅", name: "Level 3", desc: "Reached Level 3." },
  { id: "level_5", icon: "👑", name: "Level 5", desc: "Reached Level 5." },
];

function renderBadges() {
  const grid = $("badges-grid");
  if (!grid) return;

  if (!currentStats) {
    grid.innerHTML = `<div style="grid-column:span 2;text-align:center;padding:40px 0;font-size:13px;color:rgba(255,255,255,0.25);">Sign in to see your badges.</div>`;
    return;
  }

  const earnedIds = new Set((currentStats.badges ?? []).map(b => b.id));

  setText("rank-name", getRankName(currentStats.level || 1));
  setText("rank-sub", getRankSub(currentStats.level || 1));

  grid.innerHTML = ALL_BADGES.map(b => {
    const unlocked = earnedIds.has(b.id);
    return `
      <div class="badge-card ${unlocked ? "unlocked" : "locked"}">
        ${unlocked ? '<div class="badge-unlocked-tag">Unlocked</div>' : ""}
        <span class="badge-icon">${b.icon}</span>
        <div class="badge-name">${b.name}</div>
        <div class="badge-desc">${b.desc}</div>
      </div>`;
  }).join("");
}

function checkBadges(stats) {
  if (!stats?.badges) return;
  const fresh = stats.badges.filter(b => !_knownBadgeIds.includes(b.id));
  _knownBadgeIds = stats.badges.map(b => b.id);
  if (fresh.length) showBadgeModal(fresh[0]);
}

function showBadgeModal(badge) {
  setText("badge-modal-icon", badge.emoji || badge.icon || "🏅");
  setText("badge-modal-name", badge.name);
  setText("badge-modal-desc", badge.desc || badge.description || "");
  openModal("modal-badge");
}

function closeBadgeModal() {
  closeModal("modal-badge");
}

function closeLevelUp() {
  closeModal("modal-levelup");
}

const THEMES = [
  { id: "default",  name: "Outsmart Blue", bg: "#0d1520", surface: "#111c28" },
  { id: "midnight", name: "Midnight Black", bg: "#07090d", surface: "#131720" },
  { id: "cyber",    name: "Cyber Neon", bg: "#06141b", surface: "#0d2230" },
  { id: "gold",     name: "Gold Elite", bg: "#0b0b0c", surface: "#181612" },
];

function openThemePicker() {
  const swatches = $("theme-swatches");
  if (!swatches) return;
  const current = currentUser?.theme || "default";
  swatches.innerHTML = THEMES.map(t => `
    <div class="theme-swatch ${t.id === current ? "selected" : ""}"
         onclick="applyTheme('${t.id}')"
         style="padding:16px 12px;text-align:center;">
      <div style="width:100%;height:36px;border-radius:8px;margin-bottom:8px;
                  background:${t.bg};border:1px solid rgba(255,255,255,0.08);">
        <div style="margin:6px auto;width:60%;height:8px;border-radius:4px;background:${t.surface}; box-shadow: 0 0 12px ${t.id === 'gold' ? 'rgba(255,215,90,0.28)' : 'transparent'};""></div>
      </div>
      <div style="font-size:12px;font-weight:600;color:rgba(255,255,255,0.6);">${t.name}</div>
    </div>
  `).join("");
  openModal("modal-theme");
}

async function applyTheme(id, saveToServer = true) {
  const t = THEMES.find(x => x.id === id);
  if (!t) return;

  const activeScreen = document.querySelector(".screen.active");
  const isLoginScreen = activeScreen?.id === "screen-login";

  document.body.style.background = isLoginScreen ? "#0d1520" : t.bg;
  document.body.setAttribute("data-theme", id);
  document.documentElement.style.setProperty("--bg", t.bg);
  document.documentElement.style.setProperty("--surface", t.surface);
  if (id === "gold") {
    document.documentElement.style.setProperty("--accent", "#f5c451");
    document.documentElement.style.setProperty("--accent-soft", "rgba(245,196,81,0.18)");
  } else {
    document.documentElement.style.setProperty("--accent", "#63b3ed");
    document.documentElement.style.setProperty("--accent-soft", "rgba(99,179,237,0.12)");
  }

  document.querySelectorAll(".theme-swatch").forEach(el => el.classList.remove("selected"));
  const target = $("theme-swatches")?.querySelector(`[onclick="applyTheme('${id}')"]`);
  if (target) target.classList.add("selected");

  if (saveToServer && currentUser) {
    try {
      await API.saveTheme(id);
      currentUser.theme = id;
    } catch (e) {
      console.error("Failed to save theme:", e);
    }
  }
}

function closeThemePicker() {
  closeModal("modal-theme");
}

async function testAdminRoute() {
  try {
    const data = await API.getAdminTest();
    const el = $("admin-test-output");
    if (el) {
      el.innerHTML = `
        <div style="padding:16px;border:1px solid rgba(255,255,255,0.1);border-radius:12px;background:rgba(255,255,255,0.03);">
          <div><strong>Status:</strong> ${data.ok}</div>
          <div><strong>Message:</strong> ${escapeHtml(data.message)}</div>
          <div><strong>User Role:</strong> ${escapeHtml(data.user.role)}</div>
          <div><strong>User Email:</strong> ${escapeHtml(data.user.email)}</div>
        </div>
      `;
    }
  } catch (e) {
    showToast(e.message);
  }
}

async function loadAdminLessons() {
  try {
    const { lessons } = await API.getAdminLessons();
    const el = $("admin-lessons-output");
    if (!el) return;

    if (!lessons.length) {
      el.innerHTML = `<div style="opacity:.7;">No lessons added yet.</div>`;
      return;
    }

    el.innerHTML = lessons.map(lesson => `
      <div style="padding:12px;border:1px solid rgba(255,255,255,0.1);border-radius:12px;background:rgba(255,255,255,0.03);margin-bottom:10px;">
        <div><strong>${escapeHtml(lesson.name)}</strong></div>
        <div style="font-size:13px;opacity:.75;">${escapeHtml(lesson.category)}</div>
      </div>
    `).join("");
  } catch (e) {
    showToast(e.message);
  }
}

async function loadAdminStudents() {
  try {
    const { students } = await API.getAdminStudents();
    const el = $("admin-students-output");
    if (!el) return;

    if (!students.length) {
      el.innerHTML = `<div style="opacity:.7;">No students found yet.</div>`;
      return;
    }

    el.innerHTML = students.map(student => {
      const totalLogs = student.stats?.total_logs ?? 0;
      const level = student.stats?.level ?? 1;
      const streak = student.stats?.streak_days ?? 0;

      return `
        <div onclick="viewAdminStudentLogs(${student.id})"
             style="padding:14px;border:1px solid rgba(255,255,255,0.1);border-radius:12px;background:rgba(255,255,255,0.03);margin-bottom:10px;cursor:pointer;">
          <div style="font-weight:700;color:#f0f8ff;">${escapeHtml(student.name)}</div>
          <div style="font-size:13px;opacity:.75;margin-top:4px;">${escapeHtml(student.email)}</div>
          <div style="font-size:12px;opacity:.8;margin-top:8px;">
            Logs: ${totalLogs} | Level: ${level} | Streak: ${streak} days
          </div>
        </div>
      `;
    }).join("");
  } catch (e) {
    showToast(e.message);
  }
}

async function viewAdminStudentLogs(studentId) {
  try {
    const { student, logs, stats } = await API.getAdminStudentLogs(studentId);

    const summaryEl = $("admin-student-summary");
    const logsEl = $("admin-student-logs-output");

    if (summaryEl) {
      summaryEl.innerHTML = `
        <div style="padding:16px;border:1px solid rgba(255,255,255,0.1);border-radius:12px;background:rgba(255,255,255,0.03);margin-bottom:14px;">
          <div style="font-size:18px;font-weight:700;color:#f0f8ff;">${escapeHtml(student.name)}</div>
          <div style="font-size:13px;opacity:.75;margin-top:4px;">${escapeHtml(student.email)}</div>
          <div style="font-size:12px;opacity:.85;margin-top:10px;">
            Total Logs: ${stats?.total_logs ?? 0} |
            Level: ${stats?.level ?? 1} |
            Streak: ${stats?.streak_days ?? 0} days
          </div>
        </div>
      `;
    }

    if (!logsEl) return;

    if (!logs.length) {
      logsEl.innerHTML = `<div style="opacity:.7;">This student has no logs yet.</div>`;
      return;
    }

    logsEl.innerHTML = logs.map(log => {
      const date = new Date(log.created_at).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric"
      });

      return `
        <div style="padding:12px;border:1px solid rgba(255,255,255,0.1);border-radius:12px;background:rgba(255,255,255,0.03);margin-bottom:10px;">
          <div style="font-weight:700;color:#f0f8ff;">${escapeHtml(log.title || "")}</div>
          <div style="font-size:12px;opacity:.75;margin-top:4px;">
            ${escapeHtml(log.category || "")} • ${date}
          </div>
          ${log.notes ? `<div style="font-size:13px;opacity:.9;margin-top:8px;">${escapeHtml(log.notes)}</div>` : ""}
        </div>
      `;
    }).join("");
  } catch (e) {
    showToast(e.message);
  }
}

async function loadAdminDinnerTalkLessonOptions() {
  try {
    const { lessons } = await API.getAdminLessons();
    const dropdown = $("admin-dtq-lesson");
    if (!dropdown) return;

    dropdown.innerHTML = `<option value="">Select a related lesson</option>`;

    const allowed = lessons.filter(
      l => l.category === "Financial Literacy" || l.category === "Emotional Intelligence"
    );

    allowed.forEach((lesson) => {
      const option = document.createElement("option");
      option.value = lesson.id;
      option.textContent = `${lesson.name} (${lesson.category})`;
      dropdown.appendChild(option);
    });
  } catch (e) {
    showToast(e.message);
  }
}

async function createAdminLesson() {
  console.log("createAdminLesson clicked");

  try {
    const name = $("admin-lesson-name")?.value?.trim();
    const category = $("admin-lesson-category")?.value;

    console.log("Lesson name:", name);
    console.log("Category:", category);

    if (!name || !category) {
      return showToast("Enter a lesson name and category.");
    }

    console.log("Sending request to server...");

    await API.createAdminLesson(name, category);

    console.log("Server request successful");

    $("admin-lesson-name").value = "";
    showToast("Lesson added!");
    await loadAdminLessons();

  } catch (e) {
    console.error("Lesson creation error:", e);
    showToast(e.message);
  }
}
document.addEventListener("click", (e) => {
  const lessonWrap = $("student-lesson-dropdown-wrap");
  if (lessonWrap && !lessonWrap.contains(e.target)) {
    lessonWrap.classList.remove("open");
  }

  const dtqWrap = $("student-dtq-dropdown-wrap");
  if (dtqWrap && !dtqWrap.contains(e.target)) {
    dtqWrap.classList.remove("open");
  }
});

async function loadAdminDinnerTalkQuestions() {
  try {
    const { questions } = await API.getAdminDinnerTalkQuestions();
    const el = $("admin-dtq-output");
    if (!el) return;

    if (!questions.length) {
      el.innerHTML = `<div style="opacity:.7;">No Dinner Talk questions added yet.</div>`;
      return;
    }

    el.innerHTML = questions.map(q => `
      <div style="padding:12px;border:1px solid rgba(255,255,255,0.1);border-radius:12px;background:rgba(255,255,255,0.03);margin-bottom:10px;">
        <div><strong>${escapeHtml(q.question_text)}</strong></div>
        <div style="font-size:12px;opacity:.7;margin-top:4px;">Related lesson: ${escapeHtml(q.lesson_name || "Unknown")}</div>
      </div>
    `).join("");
  } catch (e) {
    showToast(e.message);
  }
}

async function createAdminDinnerTalkQuestion() {
  try {
    const questionText = $("admin-dtq-text")?.value?.trim();
    const lessonId = $("admin-dtq-lesson")?.value;

    if (!lessonId) {
      return showToast("Select the related lesson.");
    }

    if (!questionText) {
      return showToast("Enter a Dinner Talk question.");
    }

    await API.createAdminDinnerTalkQuestion(questionText, lessonId);

    $("admin-dtq-text").value = "";
    $("admin-dtq-lesson").value = "";
    showToast("Dinner Talk question added!");
    await loadAdminDinnerTalkQuestions();
  } catch (e) {
    showToast(e.message);
  }
}

switchLoginMode("signin");
setFormDateToday();
document.addEventListener("DOMContentLoaded", restoreSession);