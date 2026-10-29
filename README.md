# Lost & Found Portal — Website

A complete, real working website: Node.js/Express + **PostgreSQL** backend with an AI-powered matching engine, serving a browser-based frontend.

**Persistent storage**: uses a free Postgres database (Supabase / Neon / Render Postgres). Data survives restarts and redeploys on Render.

## What's in this folder
```
lost-found-website/
  server.js              <- starts everything
  db.js                   <- connects to Postgres + creates tables + seeds data
  package.json
  .env.example              <- copy this to .env
  test-matching.js            <- automated tests for the AI matching engine
  config/
    mailer.js                 <- sends verification/reset emails
  middleware/
    auth.js                    <- JWT token protection
    rateLimiter.js               <- blocks brute-force login attempts
  routes/
    auth.js                      <- register/login/verify/forgot/reset
    reports.js                     <- report CRUD + AI matching
  utils/
    validators.js                  <- email/password format checks
    matching.js                     <- the AI matching engine itself
  uploads/                          <- photos (ephemeral on free Render – see note below)
  public/                           <- the actual website
    index.html
    style.css
    app.js
```

## Why the change from SQLite?

Render’s free tier has an **ephemeral filesystem**. Any local SQLite file (`lostfound.db`) is deleted every time the service restarts or redeploys.  
Switching to a free hosted Postgres database (Supabase recommended) fixes this permanently.

---

## Step 1 — Create a free Postgres database (Supabase)

1. Go to **https://supabase.com** → Sign up / Log in
2. **New project** → pick a name, set a strong database password, choose a region close to you
3. Wait ~1–2 minutes for the project to be ready
4. Go to **Project Settings → Database**
5. Under **Connection string** choose **URI** (or “Connection pooling” → Transaction mode for free tier)
6. Copy the string. It looks like:
   ```
   postgresql://postgres.[project-ref]:[YOUR-PASSWORD]@aws-0-[region].pooler.supabase.com:6543/postgres
   ```
   Replace `[YOUR-PASSWORD]` with the password you set.

> Alternative free options: [Neon](https://neon.tech) or Render’s own free Postgres add-on.

## Step 2 — Install Node.js (skip if already installed)
Go to **nodejs.org**, download the “LTS” version, install it.

## Step 3 — Install dependencies
```bash
cd lost-found-website
npm install
```

## Step 4 — Create your settings file
```bash
cp .env.example .env
```

Open `.env` and fill in:

```env
JWT_SECRET=any_long_random_string_you_like
DATABASE_URL=postgresql://postgres....   # the string you copied from Supabase
APP_URL=http://localhost:3000
```

Leave `EMAIL_USER` / `EMAIL_PASS` blank for now (the site still works; OTPs are printed in the terminal / Render logs).

## Step 5 — Confirm the AI matching engine works
```bash
node test-matching.js
```
You should see 5 lines saying `PASS`.

## Step 6 — Start the website
```bash
npm start
```
You should see:
```
Seeded class roster: 43 students
Seeded default admin -> email: admin@college.edu | password: admin123
Server running at http://localhost:3000
```

Open **http://localhost:3000** in your browser.

---

## Deploying on Render (with persistent DB)

1. Push this folder to a GitHub repo
2. On Render → **New → Web Service** → connect the repo
3. Settings:
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Environment**:
     - `JWT_SECRET` = long random string
     - `DATABASE_URL` = your Supabase (or Neon / Render Postgres) connection string
     - `APP_URL` = `https://your-app-name.onrender.com`
     - (optional) `EMAIL_USER` / `EMAIL_PASS` for real emails
4. Deploy

Your data now lives in Supabase and survives every Render restart.

---

## Photo uploads note

Photos are still stored on the local disk (`uploads/`). On Render free tier that disk is wiped on restart.  
For a production-ready solution later you can switch photo storage to **Cloudinary** (free tier) or Supabase Storage. The rest of the app already works with permanent data.

---

## First Test Checklist

1. Register using one of the class register numbers (e.g. `2401150731`) and any email.
2. Look in the terminal / Render logs for the 6-digit OTP (or check email if configured).
3. Verify → log in → check Profile (name + roll number should match the roster).
4. Post a **Found** report and a **Lost** report from two different accounts.
5. Open the Lost report → you should see the Found item under **AI-Suggested Matches**.

Default admin account (seeded automatically):
- Email: `admin@college.edu`
- Password: `admin123`

---

## Switching to real email (recommended before a live demo)

1. Turn on 2-Step Verification on a Gmail account
2. Create an App Password
3. In `.env` / Render env vars set `EMAIL_USER` and `EMAIL_PASS`
4. Restart the service

---

## Class roster

The roster is seeded automatically the first time the database is empty (see `db.js`).  
If you need to change it later, edit the `ROSTER` array in `db.js` and run a one-time SQL truncate + restart, or just delete the rows in the Supabase Table Editor and restart the app so it re-seeds.
