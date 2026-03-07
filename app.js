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

  studentRegister(name, email, password) {
    return this._post("/auth/student/register", { name, email, password });
  },

  login(email, password) {
    return this._post("/auth/login", { email, password });
  },

  me() {
    return this._get("/me");
  },

  submitLog(category, title, notes) {
    return this._post("/logs", { category, title, notes });
  },

  getLogs() {
    return this._get("/logs");
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
  if (screenId === "screen-log") setFormDateToday();
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

    if (user.role === "student") {
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
    if (user.role !== "student") return showToast("No student account found for this email.");

    API._token = token;
    sessionStorage.setItem("ots_token", token);
    currentUser = user;
    currentStats = stats;

    showToast("Signed in!");
    await refreshDashboard();
    showScreen("screen-dashboard");
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

    const title = $("form-intel")?.value?.trim();
    const notes = $("form-action")?.value?.trim() || "";

    if (!title) return showToast("Write what you learned.");

    const { stats } = await API.submitLog(selectedCatKey, title, notes);
    currentStats = stats;

    if ($("form-intel")) $("form-intel").value = "";
    if ($("form-action")) $("form-action").value = "";
    selectedCatKey = null;
    ["fin","eq","lead","din"].forEach(k => $(`opt-${k}`)?.classList.remove("selected"));

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
  { id: "first_log", icon: "🥇", name: "First Log", desc: "Submitted your very first lesson." },
  { id: "all_categories", icon: "🎯", name: "Well Rounded", desc: "Logged in all 4 categories." },
  { id: "level_2", icon: "⬆️", name: "Level Up", desc: "Reached Level 2." },
  { id: "level_3", icon: "🚀", name: "Rising Leader", desc: "Reached Level 3." },
  { id: "ten_logs", icon: "🔥", name: "Dedicated", desc: "Submitted 10 total logs." },
  { id: "twenty_five_logs", icon: "💪", name: "Committed", desc: "Submitted 25 total logs." },
  { id: "streak_7", icon: "📅", name: "Week Streak", desc: "7-day logging streak." },
  { id: "finance_master", icon: "💰", name: "Finance Master", desc: "5 Financial Literacy logs." },
  { id: "eq_master", icon: "🧠", name: "EQ Champion", desc: "5 Emotional Intelligence logs." },
  { id: "leader", icon: "⭐", name: "Leader", desc: "5 Leadership logs." },
  { id: "conversationalist", icon: "🗣️", name: "Conversationalist", desc: "5 Dinner Talk logs." },
];

function renderBadges() {
  const grid = $("badges-grid");
  if (!grid) return;

  if (!currentStats) {
    grid.innerHTML = `<div style="grid-column:span 2;text-align:center;padding:40px 0;font-size:13px;color:rgba(255,255,255,0.25);">Sign in to see your badges.</div>`;
    return;
  }

  const earnedIds = new Set((currentStats.badges ?? []).map(b => b.id));

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
  { id: "default",  name: "Dark Blue",   bg: "#0d1520", surface: "#111c28" },
  { id: "midnight", name: "Midnight",    bg: "#080810", surface: "#0f0f1a" },
  { id: "forest",   name: "Forest",      bg: "#0a1a0f", surface: "#0f1f14" },
  { id: "ember",    name: "Ember",       bg: "#1a0d08", surface: "#221208" },
  { id: "slate",    name: "Slate",       bg: "#0d1117", surface: "#161b22" },
  { id: "violet",   name: "Violet Dusk", bg: "#0f0a1a", surface: "#160f24" },
];

function openThemePicker() {
  const swatches = $("theme-swatches");
  if (!swatches) return;
  const current = localStorage.getItem("ots_theme") || "default";
  swatches.innerHTML = THEMES.map(t => `
    <div class="theme-swatch ${t.id === current ? "selected" : ""}"
         onclick="applyTheme('${t.id}')"
         style="padding:16px 12px;text-align:center;">
      <div style="width:100%;height:36px;border-radius:8px;margin-bottom:8px;
                  background:${t.bg};border:1px solid rgba(255,255,255,0.08);">
        <div style="margin:6px auto;width:60%;height:8px;border-radius:4px;background:${t.surface};"></div>
      </div>
      <div style="font-size:12px;font-weight:600;color:rgba(255,255,255,0.6);">${t.name}</div>
    </div>
  `).join("");
  openModal("modal-theme");
}

function applyTheme(id) {
  const t = THEMES.find(x => x.id === id);
  if (!t) return;
  document.body.style.background = t.bg;
  document.documentElement.style.setProperty("--bg", t.bg);
  document.documentElement.style.setProperty("--surface", t.surface);
  localStorage.setItem("ots_theme", id);
  document.querySelectorAll(".theme-swatch").forEach(el => el.classList.remove("selected"));
  const target = $("theme-swatches")?.querySelector(`[onclick="applyTheme('${id}')"]`);
  if (target) target.classList.add("selected");
}

function closeThemePicker() {
  closeModal("modal-theme");
}

(function() {
  const saved = localStorage.getItem("ots_theme");
  if (saved) applyTheme(saved);
})();

switchLoginMode("signin");
setFormDateToday();
document.addEventListener("DOMContentLoaded", restoreSession);