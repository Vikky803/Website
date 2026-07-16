const express = require('express');
const cors = require('cors');
const http = require('http');
const { WebSocketServer } = require('ws');
const { checkLogin, issueToken, requireAuth, verifyToken } = require('./auth');

/**
 * Starts the Heaven Manager dashboard server. Call this ONCE from your
 * bot's client.js, after the client has logged in (or even before —
 * the routes read `client` live on every request, so they always
 * reflect current state, whatever point the bot is at).
 *
 * @param {import('discord.js').Client} client - your live bot client
 * @param {Object} [opts]
 * @param {number} [opts.port] - defaults to process.env.DASHBOARD_PORT or 3001
 * @returns {{ app, server, wss, broadcast: (event: string, data: any) => void }}
 *
 * Usage in your bot's client.js, after `client.login(config.BOT_TOKEN)`
 * or inside the ready/clientReady handler:
 *
 *   require('dotenv').config();
 *   const { startDashboard } = require('./dashboard-server');
 *   startDashboard(client);
 */
function startDashboard(client, opts = {}) {
  require('dotenv').config();

  const PORT = opts.port || process.env.DASHBOARD_PORT || 3001;
  const JWT_SECRET = process.env.DASHBOARD_JWT_SECRET;
  const ALLOWED_ORIGINS = (process.env.DASHBOARD_ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (!JWT_SECRET || JWT_SECRET.includes('REPLACE_ME')) {
    console.warn(
      '[Dashboard] WARNING: DASHBOARD_JWT_SECRET is not set (or still the placeholder). ' +
      'Sessions will not be secure. Set a real random value in .env before exposing this publicly.'
    );
  }

  const app = express();
  app.use(express.json());
  app.use(
    cors({
      origin: (origin, cb) => {
        // Allow no-origin requests (curl, server-to-server) and anything explicitly listed.
        if (!origin || ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin)) {
          return cb(null, true);
        }
        return cb(new Error('Origin not allowed by dashboard CORS policy.'));
      },
      credentials: true,
    })
  );

  const startedAt = Date.now();

  // ── Helpers to pull live stats from the client ──────────
  function getStats() {
    const guilds = client.guilds.cache;
    const totalMembers = guilds.reduce((sum, g) => sum + (g.memberCount || 0), 0);

    return {
      online: client.ws?.status === 0, // 0 = READY in discord.js WS status enum
      username: client.user?.tag || null,
      avatar: client.user?.displayAvatarURL?.() || null,
      guildCount: guilds.size,
      memberCount: totalMembers,
      latencyMs: Math.round(client.ws?.ping ?? -1),
      commandCount: client.commands?.size || 0,
      prefixCommandCount: client.prefixCommands?.size || 0,
      uptimeMs: Date.now() - startedAt,
      processUptimeMs: Math.round(process.uptime() * 1000),
      nodeVersion: process.version,
      memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    };
  }

  function getGuildsSummary() {
    return [...client.guilds.cache.values()]
      .sort((a, b) => b.memberCount - a.memberCount)
      .slice(0, 25)
      .map((g) => ({
        id: g.id,
        name: g.name,
        memberCount: g.memberCount,
        icon: g.iconURL?.() || null,
      }));
  }

  // ── Auth routes ──────────────────────────────────────────
  app.post('/api/login', (req, res) => {
    const { password } = req.body || {};
    if (!password) return res.status(400).json({ error: 'Password required.' });

    const seat = checkLogin(password, process.env);
    if (!seat) return res.status(401).json({ error: 'Access code not recognized.' });

    const token = issueToken(seat, JWT_SECRET);
    res.json({ token, seat });
  });

  app.get('/api/session', requireAuth(JWT_SECRET), (req, res) => {
    res.json({ seat: req.seat, valid: true });
  });

  // ── Read-only stat routes (all require auth) ─────────────
  const auth = requireAuth(JWT_SECRET);

  app.get('/api/status', auth, (req, res) => res.json(getStats()));
  app.get('/api/guilds', auth, (req, res) => res.json(getGuildsSummary()));

  app.get('/api/health', (req, res) => {
    // Unauthenticated, minimal — for uptime monitors / the reload-safety check.
    res.json({ ok: true, botOnline: client.ws?.status === 0 });
  });

  // ── Control routes (state-changing — all require auth) ──
  app.post('/api/control/presence', auth, async (req, res) => {
    const { status, activity } = req.body || {};
    const validStatus = ['online', 'idle', 'dnd', 'invisible'];
    if (status && !validStatus.includes(status)) {
      return res.status(400).json({ error: `Status must be one of: ${validStatus.join(', ')}` });
    }
    try {
      await client.user.setPresence({
        status: status || undefined,
        activities: activity ? [{ name: activity, type: 0 }] : undefined,
      });
      broadcast('presence_updated', { status, activity });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/control/guild/:guildId/leave', auth, async (req, res) => {
    try {
      const guild = client.guilds.cache.get(req.params.guildId);
      if (!guild) return res.status(404).json({ error: 'Guild not found.' });
      const name = guild.name;
      await guild.leave();
      broadcast('guild_left', { id: req.params.guildId, name });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/control/reload-commands', auth, async (req, res) => {
    try {
      if (typeof client.reloadAllCommands !== 'function') {
        return res.status(501).json({ error: 'reloadAllCommands() not implemented on this bot client.' });
      }
      const result = client.reloadAllCommands();
      broadcast('commands_reloaded', result);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/control/announce', auth, async (req, res) => {
    const { guildId, channelId, message } = req.body || {};
    if (!guildId || !channelId || !message) {
      return res.status(400).json({ error: 'guildId, channelId, and message are all required.' });
    }
    try {
      const guild = client.guilds.cache.get(guildId);
      if (!guild) return res.status(404).json({ error: 'Guild not found.' });
      const channel = guild.channels.cache.get(channelId);
      if (!channel || !channel.isTextBased()) {
        return res.status(404).json({ error: 'Channel not found or is not text-based.' });
      }
      await channel.send(message);
      broadcast('announcement_sent', { guildId, channelId });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── HTTP + WebSocket server ──────────────────────────────
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  function broadcast(event, data) {
    const payload = JSON.stringify({ event, data, ts: Date.now() });
    wss.clients.forEach((ws) => {
      if (ws.readyState === ws.OPEN) ws.send(payload);
    });
  }

  wss.on('connection', (ws, req) => {
    // Require a valid token as a query param: /ws?token=...
    const url = new URL(req.url, `http://${req.headers.host}`);
    const token = url.searchParams.get('token');
    const payload = token ? verifyToken(token, JWT_SECRET) : null;

    if (!payload) {
      ws.close(4001, 'Unauthorized');
      return;
    }

    ws.send(JSON.stringify({ event: 'hello', data: getStats(), ts: Date.now() }));

    const interval = setInterval(() => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ event: 'stats', data: getStats(), ts: Date.now() }));
      }
    }, 3000);

    ws.on('close', () => clearInterval(interval));
  });

  // Push a guild-count update the moment the bot joins/leaves a server,
  // instead of waiting for the next 3s tick — genuinely event-driven.
  client.on('guildCreate', () => broadcast('stats', getStats()));
  client.on('guildDelete', () => broadcast('stats', getStats()));

  server.listen(PORT, () => {
    console.log(`[Dashboard] Server listening on port ${PORT} (REST + WebSocket at /ws)`);
    if (ALLOWED_ORIGINS.length === 0) {
      console.warn('[Dashboard] WARNING: DASHBOARD_ALLOWED_ORIGINS is empty — CORS is open to all origins.');
    }
  });

  return { app, server, wss, broadcast };
}

module.exports = { startDashboard };
