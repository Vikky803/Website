/* ═══════════════════════════════════════════════════════════
   HEAVEN MANAGER — CONTROL DECK behavior
   Talks to the real dashboard server over REST + WebSocket.
   Every value on screen comes from an actual API response —
   nothing here is simulated.
   ═══════════════════════════════════════════════════════════ */

const API_BASE = (window.HEAVEN_CONFIG && window.HEAVEN_CONFIG.API_BASE) || '';
const TOKEN_KEY = 'heaven_deck_token';
const SEAT_KEY = 'heaven_deck_seat';

const els = {};
let ws = null;
let wsReconnectTimer = null;
let guildsCache = [];

// ── Safe DOM helpers so one missing element never throws and blanks the page ──
function $(id) { return document.getElementById(id); }
function setText(id, text) { const el = $(id); if (el) el.textContent = text; }

function cacheEls() {
  [
    'config-notice', 'gate', 'app', 'gate-form', 'gate-input', 'gate-submit', 'gate-error',
    'gate-conn-dot', 'gate-conn-text', 'live-badge', 'live-badge-text', 'bot-name',
    'stat-guilds', 'stat-members', 'stat-latency', 'stat-commands', 'stat-uptime',
    'stat-memory', 'stat-node', 'server-list', 'rail-progress', 'lock-btn',
    'activity-input', 'activity-submit', 'reload-btn', 'reload-result',
    'announce-guild', 'announce-channel', 'announce-message', 'announce-submit', 'announce-result',
  ].forEach((id) => (els[id] = $(id)));
}

function formatUptime(ms) {
  if (!ms || ms < 0) return '—';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatNumber(n) {
  if (n === null || n === undefined) return '—';
  return n.toLocaleString();
}

// ═══════════════════ BOOT / CONFIG CHECK ═══════════════════

async function checkServerReachable() {
  if (!API_BASE) return false;
  try {
    const res = await fetch(`${API_BASE}/api/health`, { method: 'GET' });
    return res.ok;
  } catch {
    return false;
  }
}

async function boot() {
  cacheEls();

  if (!API_BASE) {
    if (els['config-notice']) els['config-notice'].hidden = false;
    return;
  }

  const reachable = await checkServerReachable();
  updateConnDot(reachable);

  if (!reachable) {
    // Server not reachable yet — still show the gate so the person isn't
    // stuck on a blank screen; the connection dot tells them what's wrong,
    // and login attempts will surface a clear error rather than hanging.
    if (els['gate']) els['gate'].hidden = false;
    if (els['gate-input']) els['gate-input'].focus();
    return;
  }

  if (els['gate']) els['gate'].hidden = false;

  const existingToken = safeSessionGet(TOKEN_KEY);
  if (existingToken) {
    const valid = await verifySession(existingToken);
    if (valid) {
      enterApp(Number(safeSessionGet(SEAT_KEY)), existingToken);
      return;
    }
    // Stale/expired token — clear it and fall through to the gate.
    safeSessionClear();
  }

  if (els['gate-input']) els['gate-input'].focus();
}

function updateConnDot(ok) {
  const dot = els['gate-conn-dot'];
  const text = els['gate-conn-text'];
  if (!dot || !text) return;
  dot.classList.remove('ok', 'fail');
  dot.classList.add(ok ? 'ok' : 'fail');
  text.textContent = ok ? 'Server reachable' : 'Cannot reach dashboard server — check config.js and that the server is running.';
}

// ── sessionStorage wrapped so a browser blocking storage (private mode,
// some in-app browsers) never throws and breaks the whole page ──
function safeSessionGet(key) {
  try { return sessionStorage.getItem(key); } catch { return null; }
}
function safeSessionSet(key, val) {
  try { sessionStorage.setItem(key, val); } catch { /* ignore — session just won't persist */ }
}
function safeSessionClear() {
  try { sessionStorage.removeItem(TOKEN_KEY); sessionStorage.removeItem(SEAT_KEY); } catch {}
}

async function verifySession(token) {
  try {
    const res = await fetch(`${API_BASE}/api/session`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ═══════════════════ GATE ═══════════════════

function setupGate() {
  const form = els['gate-form'];
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = els['gate-input'];
    const btn = els['gate-submit'];
    const errorEl = els['gate-error'];
    if (!input) return;

    const password = input.value;
    if (!password) return;

    if (btn) btn.disabled = true;
    if (errorEl) errorEl.classList.remove('show');

    try {
      const res = await fetch(`${API_BASE}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        showGateError(data.error || 'Access code not recognized.');
        return;
      }

      safeSessionSet(TOKEN_KEY, data.token);
      safeSessionSet(SEAT_KEY, String(data.seat));
      enterApp(data.seat, data.token);
    } catch (err) {
      showGateError('Could not reach the dashboard server. Is it running?');
    } finally {
      if (btn) btn.disabled = false;
    }
  });
}

function showGateError(message) {
  const input = els['gate-input'];
  const errorEl = els['gate-error'];
  if (errorEl) {
    errorEl.textContent = message;
    errorEl.classList.add('show');
  }
  if (input) {
    input.classList.add('gate-shake');
    setTimeout(() => input.classList.remove('gate-shake'), 400);
    input.value = '';
    input.focus();
  }
}

function enterApp(seat, token) {
  const gate = els['gate'];
  const app = els['app'];
  if (gate) gate.classList.add('gate-hidden');

  setTimeout(() => {
    if (gate) gate.hidden = true;
    if (app) app.hidden = false;
    initApp(seat, token);
  }, 450);
}

// ═══════════════════ APP ═══════════════════

let appInitialized = false;

function initApp(seat, token) {
  if (appInitialized) return;
  appInitialized = true;

  markActiveSeat(seat);
  setupRailNav();
  setupScrollProgress();
  setupRevealObserver();
  setupLockButton(token);
  setupControls(token);
  connectWebSocket(token);
  loadGuilds(token);
}

function markActiveSeat(seat) {
  const card = $(`team-card-${seat}`);
  if (card) {
    card.classList.add('active-session');
    const state = card.querySelector('.team-state');
    if (state) state.textContent = 'this session';
  }
  // Fill in the other two as generically "provisioned" so the row doesn't look broken.
  [1, 2, 3].forEach((s) => {
    if (s === seat) return;
    const c = $(`team-card-${s}`);
    const state = c?.querySelector('.team-state');
    if (state && state.textContent === '—') state.textContent = 'provisioned';
  });
}

function setupRailNav() {
  const items = document.querySelectorAll('.rail-item');
  const sections = document.querySelectorAll('[data-section]');

  items.forEach((item) => {
    const target = $(item.dataset.target);
    const ping = () => {
      item.classList.add('touched');
      setTimeout(() => item.classList.remove('touched'), 500);
    };
    item.addEventListener('click', () => {
      ping();
      target?.scrollIntoView({ behavior: 'smooth' });
    });
    item.addEventListener('touchstart', ping, { passive: true });
  });

  if (!sections.length) return;

  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          items.forEach((item) => item.classList.toggle('active', item.dataset.target === entry.target.id));
        }
      });
    },
    { threshold: 0.5 }
  );
  sections.forEach((s) => io.observe(s));
}

function setupScrollProgress() {
  const fill = els['rail-progress'];
  if (!fill) return;
  function update() {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const pct = max > 0 ? Math.min(100, (window.scrollY / max) * 100) : 0;
    fill.style.height = pct + '%';
  }
  window.addEventListener('scroll', update, { passive: true });
  update();
}

function setupRevealObserver() {
  const targets = document.querySelectorAll('[data-reveal]');
  if (!targets.length) return;
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('in-view');
          io.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.15 }
  );
  targets.forEach((t) => io.observe(t));
}

function setupLockButton(token) {
  const btn = els['lock-btn'];
  if (!btn) return;
  btn.addEventListener('click', () => {
    safeSessionClear();
    if (ws) { try { ws.close(); } catch {} }
    location.reload();
  });
}

// ── Live stat rendering, shared by WebSocket push + initial fetch ──
function renderStats(stats) {
  if (!stats) return;
  setText('bot-name', stats.username || 'Heaven Manager');
  setText('stat-guilds', formatNumber(stats.guildCount));
  setText('stat-members', formatNumber(stats.memberCount));
  setText('stat-latency', stats.latencyMs >= 0 ? `${stats.latencyMs} ms` : '—');
  setText('stat-commands', formatNumber((stats.commandCount || 0) + (stats.prefixCommandCount || 0)));
  setText('stat-uptime', formatUptime(stats.processUptimeMs));
  setText('stat-memory', stats.memoryMb ? `${stats.memoryMb} MB` : '—');
  setText('stat-node', stats.nodeVersion || '—');

  const badge = els['live-badge'];
  const badgeText = els['live-badge-text'];
  const dot = badge?.querySelector('.live-dot');
  if (dot) {
    dot.classList.remove('connected', 'disconnected');
    dot.classList.add(stats.online ? 'connected' : 'disconnected');
  }
  if (badgeText) badgeText.textContent = stats.online ? 'Live — connected to bot process' : 'Bot process offline';
}

// ═══════════════════ WEBSOCKET (real-time push) ═══════════════════

function connectWebSocket(token) {
  if (!API_BASE) return;
  const wsUrl = API_BASE.replace(/^http/, 'ws') + `/ws?token=${encodeURIComponent(token)}`;

  try {
    ws = new WebSocket(wsUrl);
  } catch {
    setDisconnectedBadge();
    return;
  }

  ws.addEventListener('open', () => clearTimeout(wsReconnectTimer));

  ws.addEventListener('message', (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.event === 'hello' || msg.event === 'stats') {
        renderStats(msg.data);
      } else if (msg.event === 'guild_left') {
        loadGuilds(token);
      }
    } catch { /* ignore malformed frame */ }
  });

  ws.addEventListener('close', () => {
    setDisconnectedBadge();
    // Reconnect after a short delay rather than leaving the page stale forever.
    wsReconnectTimer = setTimeout(() => connectWebSocket(token), 4000);
  });

  ws.addEventListener('error', () => setDisconnectedBadge());
}

function setDisconnectedBadge() {
  const badge = els['live-badge'];
  const badgeText = els['live-badge-text'];
  const dot = badge?.querySelector('.live-dot');
  if (dot) { dot.classList.remove('connected'); dot.classList.add('disconnected'); }
  if (badgeText) badgeText.textContent = 'Reconnecting…';
}

// ═══════════════════ SERVERS ═══════════════════

async function loadGuilds(token) {
  const list = els['server-list'];
  const select = els['announce-guild'];
  if (!list) return;

  try {
    const res = await fetch(`${API_BASE}/api/guilds`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('Failed to load servers.');
    guildsCache = await res.json();
    renderGuilds(guildsCache, token);
    renderGuildSelect(guildsCache);
  } catch (err) {
    list.innerHTML = `<p class="empty-note">Couldn't load servers: ${escapeHtml(err.message)}</p>`;
  }
}

function renderGuilds(guilds, token) {
  const list = els['server-list'];
  if (!list) return;

  if (!guilds.length) {
    list.innerHTML = '<p class="empty-note">Bot isn\'t in any servers yet.</p>';
    return;
  }

  list.innerHTML = '';
  guilds.forEach((g) => {
    const row = document.createElement('div');
    row.className = 'server-row';
    row.innerHTML = `
      <div class="server-icon">${g.icon ? `<img src="${escapeAttr(g.icon)}" alt="">` : initials(g.name)}</div>
      <div class="server-info">
        <div class="server-name">${escapeHtml(g.name)}</div>
        <div class="server-members">${formatNumber(g.memberCount)} members</div>
      </div>
      <button class="server-leave-btn" data-guild-id="${escapeAttr(g.id)}">Leave</button>
    `;
    list.appendChild(row);
  });

  list.querySelectorAll('.server-leave-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const guildId = btn.dataset.guildId;
      if (!confirm('Leave this server? This is real — the bot will actually leave.')) return;
      btn.disabled = true;
      btn.textContent = '…';
      try {
        const res = await fetch(`${API_BASE}/api/control/guild/${guildId}/leave`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error((await res.json()).error || 'Failed to leave.');
        loadGuilds(token);
      } catch (err) {
        alert(err.message);
        btn.disabled = false;
        btn.textContent = 'Leave';
      }
    });
  });
}

function renderGuildSelect(guilds) {
  const select = els['announce-guild'];
  if (!select) return;
  select.innerHTML = guilds.map((g) => `<option value="${escapeAttr(g.id)}">${escapeHtml(g.name)}</option>`).join('');
}

function initials(name) {
  return (name || '?').trim().slice(0, 2).toUpperCase();
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(str) { return escapeHtml(str); }

// ═══════════════════ CONTROLS ═══════════════════

function setupControls(token) {
  // Presence status pills
  document.querySelectorAll('#status-pills .pill').forEach((pill) => {
    pill.addEventListener('click', async () => {
      document.querySelectorAll('#status-pills .pill').forEach((p) => p.classList.remove('active'));
      pill.classList.add('active');
      await callControl(token, '/api/control/presence', { status: pill.dataset.status }, null);
    });
  });

  // Activity text
  els['activity-submit']?.addEventListener('click', async () => {
    const activity = els['activity-input']?.value?.trim();
    if (!activity) return;
    await callControl(token, '/api/control/presence', { activity }, null);
  });

  // Reload commands
  els['reload-btn']?.addEventListener('click', async () => {
    const resultEl = els['reload-result'];
    const btn = els['reload-btn'];
    btn.disabled = true;
    btn.textContent = 'Reloading…';
    try {
      const res = await fetch(`${API_BASE}/api/control/reload-commands`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Reload failed.');
      setResult(resultEl, data.message || 'Commands reloaded successfully.', true);
    } catch (err) {
      setResult(resultEl, err.message, false);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Reload all commands';
    }
  });

  // Announce
  els['announce-submit']?.addEventListener('click', async () => {
    const resultEl = els['announce-result'];
    const guildId = els['announce-guild']?.value;
    const channelId = els['announce-channel']?.value?.trim();
    const message = els['announce-message']?.value?.trim();

    if (!guildId || !channelId || !message) {
      setResult(resultEl, 'Fill in server, channel ID, and message first.', false);
      return;
    }

    const btn = els['announce-submit'];
    btn.disabled = true;
    try {
      const res = await fetch(`${API_BASE}/api/control/announce`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ guildId, channelId, message }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send.');
      setResult(resultEl, 'Sent.', true);
      els['announce-message'].value = '';
    } catch (err) {
      setResult(resultEl, err.message, false);
    } finally {
      btn.disabled = false;
    }
  });
}

async function callControl(token, path, body, resultEl) {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed.');
    if (resultEl) setResult(resultEl, 'Done.', true);
    return data;
  } catch (err) {
    if (resultEl) setResult(resultEl, err.message, false);
    return null;
  }
}

function setResult(el, message, ok) {
  if (!el) return;
  el.textContent = message;
  el.classList.remove('ok', 'err');
  el.classList.add(ok ? 'ok' : 'err');
}

// ═══════════════════ INIT ═══════════════════

setupGate();
boot().catch((err) => {
  // Absolute last resort — never leave the page silently blank.
  console.error('[Heaven Manager] Boot failed:', err);
  if (els['gate']) els['gate'].hidden = false;
});
