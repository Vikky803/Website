# Melon Control Deck

A private, animated admin dashboard for the Melon Discord bot. Gated behind
3 team access codes, built as a single static site — no build step, no
backend required to run it as-is.

## What's inside

```
melon-dashboard/
├── index.html    All markup + content
├── style.css     Design system + animations
└── script.js     Gate auth, scroll/touch interactions, live pulse
```

## Run it locally

No install needed — it's plain HTML/CSS/JS. Two options:

**Fastest:** double-click `index.html` to open it directly in a browser.
Works, but some browsers restrict certain APIs (`crypto.subtle`) on the
`file://` protocol, which the login gate depends on. If the gate doesn't
accept a correct code when opened this way, use the local server option
below instead.

**Recommended — local server:**
```bash
cd melon-dashboard
python3 -m http.server 8000
# then open http://localhost:8000
```
or, if you have Node:
```bash
npx serve .
```

## The 3 access codes

The codes you gave me are already wired in as SHA-256 hashes in
`script.js` (search for `KEYHOLDERS`) — not stored in plaintext, so
they aren't visible by just glancing at the source. That said, this is
still a **client-side-only gate**: anyone who really wants to can view
the page's JavaScript and work backward, or just brute-force the hash
offline. Treat this as "keeps casual visitors out," not "true
authentication." If you ever need real security, put this dashboard
behind a proper login on a real backend instead.

**To change a code later:** generate a new SHA-256 hash for the new
password and swap it into the `KEYHOLDERS` array in `script.js`. In a
browser console or Node:
```js
// Node:
require('crypto').createHash('sha256').update('newPasswordHere').digest('hex')
```

Each teammate's session is remembered only for that browser tab
(`sessionStorage`) — closing the tab or hitting the lock icon in the
left rail signs them out.

## Wiring in real bot stats (optional)

Right now the "Live Pulse" section is simulated — a smooth animated
line and randomized latency, so the page never looks broken even with
zero backend. To make it genuinely live:

1. Add a small status route to your bot process, e.g. in Express:
   ```js
   app.get('/api/status', (req, res) => {
     res.json({
       latency: client.ws.ping,
       guilds: client.guilds.cache.size,
       lastRestart: process.env.STARTED_AT || 'unknown',
     });
   });
   ```
2. In `script.js`, find `fetchLiveStats()` and replace the simulated
   block with a real `fetch()` call to that endpoint (a commented
   example is already in the file, right above the simulated values).
3. Make sure that endpoint is reachable from wherever you host this
   page — if your bot runs on a host without a public URL, you'll need
   to expose it (e.g. via your host's built-in web service, or a tunnel
   like Cloudflare Tunnel / ngrok for testing).

## Hosting it free — GitHub Pages

This is the simplest free path since the site has zero build step.

1. **Create a new GitHub repo** (can be private if you want — GitHub
   Pages works on private repos too, on any plan, though the *site
   itself* will still be publicly reachable at its URL unless you add
   real auth).
2. **Push these 3 files** to the repo root (or to a `/docs` folder — your
   choice, just match it in step 3):
   ```bash
   git init
   git add index.html style.css script.js
   git commit -m "Melon control deck"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPO.git
   git push -u origin main
   ```
3. **Enable Pages:** repo → **Settings** → **Pages** (left sidebar) →
   under "Build and deployment," set **Source: Deploy from a branch**,
   branch **main**, folder **/ (root)** → **Save**.
4. **Wait ~30–60 seconds.** GitHub will show you the live URL at the
   top of that same Pages settings screen — typically:
   ```
   https://YOUR-USERNAME.github.io/YOUR-REPO/
   ```
5. Every time you `git push` to `main` after this, the live site
   updates automatically within about a minute. No redeploy step, no
   dashboard to click through.

**Keeping it low-key:** GitHub Pages URLs aren't indexed or discoverable
unless linked from somewhere public — but they *are* reachable by
anyone who has the exact URL, gate or no gate. If you want it fully
private, look into GitHub Pages with a custom auth proxy, or host it
instead on a platform that supports real access control (e.g. Cloudflare
Pages + Cloudflare Access, which has a free tier and actual
server-verified login instead of a client-side password check).

## Notes on the bot secrets

While building this I noticed your bot's `config.js` (from the zip you
sent) has a live Discord bot token, a Postgres connection string with
password, and two API keys, all in plaintext. None of that made it into
this dashboard — but if you haven't rotated them yet since our last
message, do that first:

- Discord bot token → Developer Portal → your app → Bot → **Reset Token**
- Postgres password → your DB host's dashboard (Neon, in this case)
- Groq / SerpAPI keys → regenerate from each provider's dashboard

And if `melon` (the bot repo itself) ever goes to GitHub, make sure
`config.js` is in `.gitignore` and split into a `.env` file instead —
otherwise the same leak happens again the moment it's pushed.

---

Developed by `vikkygotlost`
