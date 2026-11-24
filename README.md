# EcoGhar store

Website + customer accounts + admin dashboard (orders, customers, blog) + optional Google Sheet sync.

## Free hosting (about 30 minutes)
You need three free accounts: GitHub (holds the code), Turso (holds the data) and Render (runs the site).

### 1. Put the code on GitHub
1. Create a GitHub account, then a **new private repository** named `ecoghar-store`.
2. Unzip this project. On the repository page click **uploading an existing file**, drag in everything inside the `ecoghar-store` folder (server.js, package.json, package-lock.json, the `public` and `private` folders, README.md, .env.example, .gitignore), and click **Commit changes**.
3. Do NOT upload a `.env` file or `node_modules`.

### 2. Create the free database (Turso)
1. Sign up at turso.tech (no card needed) and create a database. Any name, nearest region.
2. Copy the database **URL** (starts with `libsql://`).
3. Create an **auth token** for that database and copy it. Keep it secret.

### 3. Deploy on Render
1. Sign up at render.com with your GitHub account.
2. Click **New, Web Service** and choose your `ecoghar-store` repository.
3. Name it `ecoghar`. This sets your link to `https://ecoghar.onrender.com`. If the name is taken, try `ecoghar-store` or `ecoghar-kolkata`.
4. Runtime: **Node**. Build command: `npm install`. Start command: `npm start`. Instance type: **Free**.
5. Under **Advanced**, set Health Check Path to `/healthz`.
6. Under **Environment Variables** add: `NODE_ENV` = `production`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` (at least 10 characters), `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`.
7. Click **Create Web Service**. After a few minutes your site is live at the link shown at the top of the page.
8. Open `/login.html` on your link, sign in with your ADMIN_EMAIL and ADMIN_PASSWORD, and you land on `/admin`.

The free plan puts the site to sleep after 15 minutes without visitors, and the next visitor waits about a minute for it to wake. Your data is safe because it lives in Turso, not on Render.

### 4. Google Sheet sync
1. Open your sheet and make three tabs named exactly **Users**, **Orders** and **Blog**.
2. Go to console.cloud.google.com and create a project (any name).
3. **APIs & Services, Library**: search for **Google Sheets API** and click **Enable**.
4. **IAM & Admin, Service Accounts, Create service account**: any name, then Done.
5. Open the new service account, go to **Keys, Add key, Create new key, JSON**. A key file downloads. Keep it private.
6. Open the key file and copy the `client_email` value. In your sheet click **Share**, paste that email and give it **Editor** access.
7. Copy your sheet's ID from its address: `docs.google.com/spreadsheets/d/` THIS-PART `/edit`.
8. Make the key one line: save the file as `key.json` next to this README and run `node -e "console.log(JSON.stringify(require('./key.json')))"`. Copy the output.
9. In Render, **Environment**, add `SHEET_ID` and `GOOGLE_SERVICE_ACCOUNT_JSON` (the one-line output). Save; Render redeploys.
10. In `/admin`, **Orders**, click **Sync to Google Sheet**. New sign-ups and orders also appear automatically.

## Try it on your computer first
Install Node.js 22+, run `npm install`, put ADMIN_EMAIL and ADMIN_PASSWORD in a `.env` file, run `npm start`, open http://localhost:3000. With the Turso values empty it saves to a local file.

## Not included yet
Online card/UPI checkout (orders are saved, payment details go out on WhatsApp), password reset by email, email verification.
