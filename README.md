# Picante — test deployment

Fresh rebuild of the Picante short-video social app (Node.js/Express + Postgres),
deployed free on Render with Cloudinary for video storage. $0, no card.

## What this is

- `server/` — Express API (auth with 13+ age gate, feed, profiles, upload via
  Cloudinary, likes/comments/saves/follows, report/block, legal text).
- `public/` — the app itself (vanilla HTML/CSS/JS, mobile-first vertical feed).
- `render.yaml` — Render Blueprint: free web service + free Postgres.
- `server/seed-clips.json` — starter clips (freely licensed Pexels videos) that
  are auto-seeded on first boot when the videos table is empty.

## Local run (dev)

```bash
npm install
# needs a Postgres DATABASE_URL, or the server exits after initDb retries
DATABASE_URL=postgres://user:pass@localhost:5432/picante npm start
# seed explicitly: DATABASE_URL=... npm run seed
```

Without Cloudinary env vars, uploads fall back to local `uploads/` (dev only).
In production Cloudinary must be configured.

## Deploy runbook (browser steps — see parent agent's notes for whose email to use)

### 1. GitHub (free, no card)
1. Create a GitHub account (email verification required — use Ricky's chosen email).
2. Create a new **public** repository named `picante-test`.
3. From this machine, push the code:
   ```bash
   cd ~/workspace/picante-test-deployment
   git init && git add -A && git commit -m "Picante test build"
   git branch -M main
   git remote add origin https://github.com/<USERNAME>/picante-test.git
   git push -u origin main   # needs a GitHub personal access token as password
   ```

### 2. Cloudinary (free, no card)
1. Create a free Cloudinary account (email verification required).
2. Dashboard → copy **Cloud name**, **API Key**, **API Secret**.
   (Keep the API Secret private — it goes only into Render env vars.)

### 3. Render (free, no card)
1. Create a Render account — easiest via **Sign up with GitHub**.
2. Dashboard → **New +** → **Blueprint** → connect the `picante-test` repo.
3. Render reads `render.yaml` and creates the web service + Postgres.
4. When prompted for the `sync: false` env vars, paste the three Cloudinary
   values from step 2.
5. Deploy. First boot runs migrations and auto-seeds the starter clips.
6. The app URL will be `https://picante-test.onrender.com` (or the name Render
   assigns). Free web services sleep after 15 min idle (~1 min to wake).

## Watch-outs

- **Free Postgres expires 30 days after creation** (deleted 14 days later).
  Record the creation date at deploy time. Before day 30: upgrade to $6/mo
  or export the data.
- **Free web service sleeps after 15 min idle** — first load after idle takes
  ~1 minute. Acceptable for a test.
- Cloudinary free tier: 25 credits/month shared pool (1 credit = 1 GB storage
  or 1 GB bandwidth or 1,000 transformations). A handful of testers is well
  inside this.

## Smoke test (on the live link, two accounts)

1. Account A signs up (username, password, display name, date of birth).
2. Account B signs up, uploads a short video, likes and comments on A's seed
   video, follows A.
3. Account A sees the like/comment/follow from B and the global counts update.
4. A reports a video (reason picker) and blocks a creator; the blocked
   creator's videos disappear from A's feed only; unblock restores them.
5. Sign-up with a 2016 birthdate is rejected; Terms/Privacy open before sign-up.
