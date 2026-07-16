# Heaven Manager — Control Deck

A real-time, glass-themed control dashboard for your Discord bot. Unlike a
static status page, this is two connected pieces:

- **`/server`** — a small Node.js API that runs *inside your bot process*
  and reads live data straight from the same `client` object your bot
  already uses. No polling fakes, no cached numbers.
- **`/public`** — the dashboard itself (HTML/CSS/JS), talking to that
  server over REST for actions and a WebSocket for live push updates.

Because the server shares your bot's process, "real-time" here means
actually real-time — a member joins, `guildCount` updates within 3
seconds; you click "leave server," it really calls `guild.leave()`.

## How the pieces fit together

```
Your bot process (client.js)
   |
   +-- discord.js Client ---- already exists in your bot
   |
   +-- require('./dashboard-server').startDashboard(client)
          |
          +-- REST API  (login, stats, guild list, controls)
          +-- WebSocket (pushes live stats every 3s + on events)
                 |
                 v
        public/index.html (your browser)
```

## Step 1 — Copy the server folder into your bot project

Copy the **`server/`** folder from this zip into your bot's project,
anywhere convenient — e.g. as `dashboard/` inside your bot repo:

```
YourBot/
├── src/
│   └── client.js          <- your existing bot entry point
├── dashboard/              <- paste the contents of /server here
│   ├── dashboard-server.js
│   ├── auth.js
│   ├── hash-password.js
│   ├── package.json
│   └── .env.example
```

## Step 2 — Install its dependencies

```bash
cd dashboard
npm install
```

This installs `express`, `ws`, `jsonwebtoken`, `cors`, and `dotenv` — all
new, separate from your bot's own dependencies (your bot's `package.json`
is untouched).

## Step 3 — Configure

```bash
cp .env.example .env
```

Open `.env` and set:
- `DASHBOARD_JWT_SECRET` — generate one: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
- `DASHBOARD_ALLOWED_ORIGINS` — where the dashboard frontend will be loaded from (see Step 5)
- The 3 `SEAT_n_HASH` values are already filled in and work with the 3
  passwords you gave me. To change one later: `node hash-password.js "newPassword"`
  and paste the output in.

## Step 4 — Wire it into your bot

In your bot's `src/client.js`, near the top (after your existing
requires) add:

```js
require('dotenv').config({ path: require('path').join(__dirname, '../dashboard/.env') });
const { startDashboard } = require('../dashboard/dashboard-server');
```

Then, **after** `client.login(config.BOT_TOKEN)` is called (or inside
your `ready`/`clientReady` handler — either works, since the dashboard
reads `client` live on every request rather than snapshotting it once),
add:

```js
startDashboard(client);
```

That's the entire integration — one require, one function call. Start
your bot as usual:

```bash
npm start
```

You should see in your console:
```
[Dashboard] Server listening on port 3001 (REST + WebSocket at /ws)
```

**Before you wire it in for real**, you can test the dashboard server on
its own, with fake mock data, so you can check the frontend works before
touching your actual bot:

```bash
cd dashboard
node index.js
```
This prints `STANDALONE MOCK MODE` and serves believable fake stats —
useful for checking the dashboard loads and looks right first.

## Step 5 — Run the frontend

The `public/` folder is plain static files — no build step. Two ways to
run it:

**Local testing:**
```bash
cd public
python3 -m http.server 5500
# open http://localhost:5500
```
(Opening `index.html` directly by double-click can work too, but some
browsers restrict background requests from the `file://` protocol — the
local server avoids that entirely and is what `DASHBOARD_ALLOWED_ORIGINS`
in the example `.env` is already set up for.)

**Point it at your server:** open `public/config.js` and confirm
`API_BASE` matches where your dashboard server is running — for local
testing this is already set to `http://localhost:3001`.

## Fixing "the page doesn't load on reload"

This was a real bug in the previous version — it depended on
`crypto.subtle`, which silently breaks outside secure contexts
(`file://` pages, plain `http://` origins that aren't `localhost`). This
version no longer uses that API at all: the password check happens on
your actual server, over a normal `fetch()` call, which works
everywhere. If the page ever looks blank after this, it's almost always
one of:

- `public/config.js` -> `API_BASE` doesn't match where the server is running
- the server isn't running, or `DASHBOARD_ALLOWED_ORIGINS` doesn't include
  the exact origin the page is loaded from (check the browser console —
  CORS errors show up clearly there)
- an ad blocker or privacy extension blocking `sessionStorage` or the
  WebSocket connection

The dashboard now surfaces all of these as visible messages instead of a
blank page — a "can't reach dashboard server" notice, a connection dot on
the login screen, and inline error text on failed logins.

## What's actually "real-time control" here

- **Presence** — status (online/idle/dnd/invisible) and activity text,
  applied instantly via `client.user.setPresence()`
- **Command reload** — hot-reloads every command file via your bot's own
  `reloadAllCommands()` (already present in your `client.js`)
- **Server list** — read live from `client.guilds.cache`; "Leave" really
  calls `guild.leave()`
- **Announce** — sends a real message to a real channel via
  `channel.send()`
- **Live stats** — guild count, member count, gateway ping, memory,
  uptime — pushed over WebSocket every 3 seconds, plus instantly on
  `guildCreate`/`guildDelete` events

## Extending it

Want to add a control for something else your bot can do (mute a user,
trigger a giveaway, whatever)? The pattern is the same every time:

1. Add a route in `dashboard-server.js`, inside `startDashboard()`,
   following the existing ones — it has full access to `client`.
2. Add a button/input in `public/index.html` and wire it up in
   `public/script.js` the same way `reload-btn` or `announce-submit` are
   wired.

Because the server runs in-process with your bot, every discord.js call
your commands already make (`guild.members.ban()`, `channel.send()`,
etc.) is available to a new route with zero extra plumbing.

## Security notes

- Passwords are hashed with salted PBKDF2 (100,000 iterations, SHA-512)
  and verified server-side with a constant-time comparison — this is
  real authentication, not a client-side check that can be bypassed by
  viewing page source (which is what the previous version did).
- Sessions are signed JWTs, expire after 12 hours, and are required on
  every control/data endpoint (`requireAuth` middleware) and on the
  WebSocket connection itself.
- Even so: this dashboard can restart your bot's presence, leave
  servers, and send messages as your bot. Don't expose the server
  publicly without `DASHBOARD_ALLOWED_ORIGINS` locked to only the exact
  origin(s) you actually use, and don't share the access codes beyond
  your 3 keyholders.
- If you ever suspect a code has leaked, generate a new one with
  `hash-password.js` and remove the old hash from `.env` — old sessions
  already issued will still work until they expire (12h), so also change
  `DASHBOARD_JWT_SECRET` if you need to invalidate everyone immediately.

---

Developed by `vikkygotlost`
