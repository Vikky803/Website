/* ═══════════════════════════════════════════════════════════
   MELON CONTROL DECK — behavior
   ═══════════════════════════════════════════════════════════ */

// ── Access codes, stored as SHA-256 hashes (not plaintext) ──
// This is a soft gate for a private team dashboard, not a real
// auth system — anyone with dev tools can bypass client-side
// checks. Do not put anything here you wouldn't want a
// determined visitor to eventually see. For real security, put
// this dashboard behind actual server-side auth instead.
const KEYHOLDERS = [
  { seat: 1, hash: '5edf07c086f2b2c4cc37e26be885debacaee19d77a2e435c697a0ad8ba2fed99' },
  { seat: 2, hash: 'acc835d968b3728a4e16c4a00d53360e45afa6b3b107f93e058e2ea315c1eadf' },
  { seat: 3, hash: '3dbf698560a35daf3b97cc134fc0d498c2fc6ca9372cb68276daa8052dcdeb7e' },
];

async function sha256(text) {
  const enc = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

const SESSION_KEY = 'melon_deck_seat';

function getSession() {
  return sessionStorage.getItem(SESSION_KEY);
}

function setSession(seat) {
  sessionStorage.setItem(SESSION_KEY, String(seat));
}

function clearSession() {
  sessionStorage.removeItem(SESSION_KEY);
}

// ── Gate ──
const gate = document.getElementById('gate');
const app = document.getElementById('app');
const gateForm = document.getElementById('gate-form');
const gateInput = document.getElementById('gate-input');
const gateError = document.getElementById('gate-error');
const gateDots = document.querySelectorAll('.gate-dot');

async function attemptUnlock(code) {
  const hash = await sha256(code.trim());
  const match = KEYHOLDERS.find(k => k.hash === hash);
  return match ? match.seat : null;
}

function lightDots(count) {
  gateDots.forEach((d, i) => d.classList.toggle('filled', i < count));
}

function enterApp(seat) {
  setSession(seat);
  gate.classList.add('gate-hidden');
  setTimeout(() => {
    gate.hidden = true;
    app.hidden = false;
    initApp(seat);
  }, 550);
}

gateForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = gateInput.value;
  if (!code) return;

  const seat = await attemptUnlock(code);

  if (seat) {
    lightDots(3);
    setTimeout(() => enterApp(seat), 350);
  } else {
    gateError.classList.add('show');
    gateInput.classList.add('gate-shake');
    lightDots(0);
    setTimeout(() => gateInput.classList.remove('gate-shake'), 400);
    gateInput.value = '';
    gateInput.focus();
  }
});

gateInput.addEventListener('input', () => {
  gateError.classList.remove('show');
  const len = gateInput.value.length;
  lightDots(Math.min(3, Math.ceil(len / 3)));
});

// ── Boot: resume session if one exists this tab ──
(function boot() {
  const existing = getSession();
  if (existing) {
    gate.hidden = true;
    app.hidden = false;
    initApp(Number(existing));
  } else {
    gateInput.focus();
  }
})();

// ═══════════════════ APP ═══════════════════

let appInitialized = false;

function initApp(seat) {
  if (appInitialized) return;
  appInitialized = true;

  markActiveSeat(seat);
  setupRailNav();
  setupScrollProgress();
  setupRevealObserver();
  setupCounters();
  setupBarChart();
  setupLockButton();
  startPulseSimulation();
  fetchLiveStats();
}

function markActiveSeat(seat) {
  const card = document.getElementById(`team-card-${seat}`);
  if (card) {
    card.classList.add('active-session');
    const state = card.querySelector('.team-state');
    if (state) state.textContent = 'this session';
  }
}

// ── Left rail: click-to-scroll + touch/hover ping animation ──
function setupRailNav() {
  const items = document.querySelectorAll('.rail-item');
  const sections = document.querySelectorAll('[data-section]');

  items.forEach((item) => {
    const target = document.getElementById(item.dataset.target);

    const ping = () => {
      item.classList.add('touched');
      setTimeout(() => item.classList.remove('touched'), 500);
    };

    item.addEventListener('click', () => {
      ping();
      target?.scrollIntoView({ behavior: 'smooth' });
    });

    // Explicit touch feedback for mobile (left-side touch animation)
    item.addEventListener('touchstart', ping, { passive: true });
  });

  // Highlight nav item matching the section currently in view
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          items.forEach((item) => {
            item.classList.toggle('active', item.dataset.target === entry.target.id);
          });
        }
      });
    },
    { threshold: 0.5 }
  );

  sections.forEach((s) => io.observe(s));
}

// ── Rail progress bar reflecting overall scroll position ──
function setupScrollProgress() {
  const fill = document.getElementById('rail-progress');
  const deck = document.getElementById('deck');

  function update() {
    const scrollTop = window.scrollY;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const pct = max > 0 ? Math.min(100, (scrollTop / max) * 100) : 0;
    fill.style.height = pct + '%';
  }

  window.addEventListener('scroll', update, { passive: true });
  update();
}

// ── Reveal-on-scroll for [data-reveal] elements ──
function setupRevealObserver() {
  const targets = document.querySelectorAll('[data-reveal]');

  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry, i) => {
        if (entry.isIntersecting) {
          const el = entry.target;
          const siblings = [...el.parentElement.querySelectorAll('[data-reveal]')];
          const idx = siblings.indexOf(el);
          setTimeout(() => el.classList.add('in-view'), idx * 60);
          io.unobserve(el);
        }
      });
    },
    { threshold: 0.15 }
  );

  targets.forEach((t) => io.observe(t));
}

// ── Animated stat counters ──
function setupCounters() {
  const counters = document.querySelectorAll('[data-counter]');

  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          animateCounter(entry.target);
          io.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.6 }
  );

  counters.forEach((c) => io.observe(c));
}

function animateCounter(el) {
  const target = Number(el.dataset.target);
  const suffix = el.dataset.suffix || '';
  const duration = 1400;
  const start = performance.now();

  function tick(now) {
    const progress = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(eased * target) + suffix;
    if (progress < 1) requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
}

// ── Command category bar chart ──
const COMMAND_CATEGORIES = [
  { name: 'roleplay', count: 24 },
  { name: 'general', count: 19 },
  { name: 'fun', count: 16 },
  { name: 'stats', count: 16 },
  { name: 'animals', count: 15 },
  { name: 'conversion', count: 14 },
  { name: 'ignore', count: 13 },
  { name: 'moderation', count: 13 },
  { name: 'dump', count: 12 },
  { name: 'owner', count: 12 },
  { name: 'misc', count: 10 },
  { name: 'information', count: 9 },
  { name: 'serverprofile', count: 5 },
  { name: 'pfps', count: 3 },
];

function setupBarChart() {
  const chart = document.getElementById('bar-chart');
  const max = Math.max(...COMMAND_CATEGORIES.map((c) => c.count));

  COMMAND_CATEGORIES.forEach((cat, i) => {
    const row = document.createElement('div');
    row.className = 'bar-row';
    row.dataset.reveal = '';
    row.innerHTML = `
      <span class="bar-cat">${cat.name}</span>
      <span class="bar-track"><span class="bar-fill" data-width="${(cat.count / max) * 100}"></span></span>
      <span class="bar-count">${cat.count}</span>
    `;
    chart.appendChild(row);
  });

  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const fill = entry.target.querySelector('.bar-fill');
          requestAnimationFrame(() => {
            fill.style.width = fill.dataset.width + '%';
          });
          io.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.3 }
  );

  chart.querySelectorAll('.bar-row').forEach((row, i) => {
    row.style.transitionDelay = `${i * 40}ms`;
    io.observe(row);
  });
}

// ── Lock button: clears session, returns to gate ──
function setupLockButton() {
  document.getElementById('lock-btn').addEventListener('click', () => {
    clearSession();
    location.reload();
  });
}

// ═══════════════════ LIVE PULSE (simulated) ═══════════════════
// Replace fetchLiveStats() with a real fetch() to your bot's own
// status endpoint to make this genuinely live. See the Deploy
// section in the page for the integration note.

function startPulseSimulation() {
  const line = document.getElementById('pulse-line');
  const points = [];
  const pointCount = 40;
  let t = 0;

  for (let i = 0; i < pointCount; i++) points.push(40);

  function draw() {
    t += 0.15;
    points.shift();
    const noise = Math.sin(t) * 18 + Math.sin(t * 2.7) * 6 + (Math.random() - 0.5) * 6;
    points.push(40 + noise);

    const step = 400 / (pointCount - 1);
    const coords = points.map((y, i) => `${(i * step).toFixed(1)},${Math.max(4, Math.min(76, y)).toFixed(1)}`).join(' ');
    line.setAttribute('points', coords);

    requestAnimationFrame(draw);
  }

  draw();
}

function fetchLiveStats() {
  // Simulated values — swap this block for a real fetch() call:
  //
  //   fetch('https://your-bot-host.example.com/api/status')
  //     .then(r => r.json())
  //     .then(data => {
  //       document.getElementById('latency-val').textContent = data.latency + ' ms';
  //       document.getElementById('guilds-val').textContent = data.guilds;
  //       document.getElementById('restart-val').textContent = data.lastRestart;
  //     });

  document.getElementById('latency-val').textContent = `${42 + Math.floor(Math.random() * 30)} ms`;
  document.getElementById('guilds-val').textContent = '—';
  document.getElementById('restart-val').textContent = 'not connected';

  setInterval(() => {
    document.getElementById('latency-val').textContent = `${42 + Math.floor(Math.random() * 30)} ms`;
  }, 3000);
}
