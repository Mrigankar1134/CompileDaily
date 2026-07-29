# Compile Daily — backend

Small Express API that owns the Neon Postgres connection and the OpenAI API
key. The app (assets/index.html, running inside the Android WebView) talks
to this over HTTPS — it never sees the database URL or the OpenAI key.

## 1. Rotate the database password first

The connection string that was shared in chat must be treated as leaked.
In the Neon console: your project → **Roles** → reset the password for
`neondb_owner`, then use the **new** connection string below.

## 2. Local setup

```
cd backend
cp .env.example .env
# edit .env: paste the (rotated) DATABASE_URL and your OPENAI_API_KEY
npm install
npm run seed     # creates tables (schema.sql is applied via psql, see below) + seeds curated resources/assessments
npm start
```

The `seed` script assumes the tables already exist. Create them once with:

```
psql "$DATABASE_URL" -f schema.sql
```

(or paste schema.sql into the Neon SQL editor in the console, then run
`npm run seed` locally to populate resources/assessments.)

Health check: `curl http://localhost:8080/api/health` → `{"ok":true}`

## 3. Deploy on Render

1. Push this `backend/` folder to a Git repo (or deploy the whole project
   and set the service's **root directory** to `backend`).
2. Render dashboard → New → Web Service → connect the repo.
   - Build command: `npm install`
   - Start command: `npm start`
3. Add environment variables in Render's dashboard (Settings → Environment):
   `DATABASE_URL`, `OPENAI_API_KEY`, `OPENAI_MODEL` (optional),
   `ALLOWED_ORIGINS=null` (the WebView's file:// origin), `PORT` (Render sets
   this automatically — you can leave it out).
4. Deploy. Render gives you a URL like `https://javacareerprep-api.onrender.com`.
5. Run the schema + seed once against the live database (from your machine,
   pointed at the same DATABASE_URL): `psql "$DATABASE_URL" -f schema.sql`
   then `npm run seed`.
6. In the app, open **Settings** and paste that URL into "Backend URL".

Render's free tier sleeps after inactivity — the first request after a
while can take a few seconds to wake up. That's expected.

## API summary

- `GET  /api/state` — profile, roadmap progress, today's daily checklist, project progress, activity log, notes
- `POST /api/profile` `{name, role, goalMinutes}`
- `POST /api/notes` `{content}`
- `POST /api/roadmap/toggle` `{taskId, done, date?}`
- `POST /api/roadmap/date` `{taskId, date}`
- `POST /api/daily/toggle` `{taskIndex, done}`
- `POST /api/project/toggle` `{projectId, stepIndex, done}`
- `POST /api/github-link` `{phaseIndex, url}` / `DELETE /api/github-link/:phaseIndex` — roadmap milestone project links
- `POST /api/project-github-link` `{projectId, url}` / `DELETE /api/project-github-link/:projectId` — portfolio project links
- `GET  /api/resources?phase=&topic=`
- `POST /api/resources` `{phaseIndex, topicIndex, title, url, kind, source}`
- `GET  /api/assessments?phase=&topic=`
- `POST /api/assessments/generate` `{phaseIndex, topicIndex, phaseTitle, topicName, count?}` — calls OpenAI
- `POST /api/assessments/:id/attempt` `{answers:[...]}`
- `POST /api/doubt` `{question, topic}` — calls OpenAI
- `GET  /api/doubt/history`
