# Compile Daily — Full Technical Documentation

**A personal Java career-preparation app for Moushana Bharadwaj**, covering the entire system from the ground up: the Android app itself, the cloud backend that powers it, the database behind it, the AI integration, and the completely custom Android packaging pipeline that turns a single HTML file into an installable, signed APK — without the Android SDK, without a build tool like Gradle, and without any framework.

This document explains how every part of the system actually works, why it was built the way it was, and how the pieces fit together.

---

## 1. What Compile Daily Is

Compile Daily is a daily-use mobile app that turns a large, structured Java career curriculum (46 modules, spanning Core Java through interview preparation and job-search operations) into a personalized, trackable, motivating daily habit. It's built for one specific person, targeting one of six specific job roles at a time:

- SDET – Java
- Java Automation Engineer
- QA Automation Developer
- Associate Java Backend Developer
- Software Engineer I – Java
- Java API Developer

Every one of the 46 curriculum modules carries an individually tuned priority — Must-learn, Important, Learn-later, or Optional — **per role**, not just per broad category. This means the same roadmap reshapes itself depending on which of the six roles is currently selected as the active career goal: a Java API Developer sees Kafka and Resilience4j pushed to "Must-learn," while the same modules sit at "Learn later" for an Associate Backend Developer, and DSA depth is prioritized differently for a generalist Software Engineer I versus a specialist Java Automation Engineer.

The product's daily loop is: **see today's plan → work through a roadmap module → check off tasks → get AI help when stuck → practice interview questions → track a portfolio project → watch progress accumulate.**

---

## 2. System Architecture at a Glance

There are four independently-deployable pieces:

1. **The frontend** — a single self-contained HTML file (`assets/index.html`) containing all markup, CSS, and JavaScript. No build step, no bundler, no npm packages on the client side at all.
2. **The backend** — a small Node.js/Express API (`backend/`) that owns the database connection and the AI provider key, deployed to Render.
3. **The database** — a managed Postgres instance on Neon, holding both the user's live progress data and a curated resource catalogue.
4. **The APK builder** — a from-scratch Python script (`build_apk.py`) that hand-assembles the Android binary formats needed to package the frontend into a real, installable, signed `.apk` file.

The frontend never talks to the database directly. It only ever calls the backend over HTTPS, and the backend is the only piece of the system that holds the Postgres connection string and the Gemini API key. This separation exists for a concrete reason: the frontend ships inside an APK, and an APK is just a zip file — anyone who receives it can trivially unzip it and read every string inside. If the database URL or an AI API key were embedded in `assets/index.html`, whoever installed the app could extract full write access to the database or unlimited use of the AI billing account within minutes. Keeping secrets exclusively server-side is not an optional hardening step here; it's the only way the architecture can be shared with another person at all.

```
┌─────────────────────┐        HTTPS         ┌──────────────────────┐        TCP/SSL       ┌─────────────────┐
│   assets/index.html │ ───────────────────▶ │  Render (Node/Express)│ ───────────────────▶ │  Neon Postgres  │
│  (packaged into the │ ◀─────────────────── │      backend/server.js│ ◀─────────────────── │                 │
│   APK, or opened     │                      │                       │                      └─────────────────┘
│   directly in a      │                      │  also calls, over     │
│   browser as a file) │                      │  HTTPS: Google Gemini │
└─────────────────────┘                      └──────────────────────┘
```

---

## 3. The Frontend: One HTML File, No Build Step

`assets/index.html` is intentionally a single file with an inline `<style>` block and an inline `<script>` block. There is no React, no Vue, no bundler, no transpilation. This was a deliberate choice matching the project's overall philosophy of minimal dependencies: the app needed to be packageable into an APK by a hand-written Python script with no Android SDK, so keeping the web layer equally dependency-free kept the whole pipeline auditable end to end.

### 3.1 Local-first data, with background cloud sync

Every piece of user state — which roadmap tasks are checked off, the daily checklist, notes, GitHub links, the assessment history — is written to the browser's `localStorage` **immediately** on every interaction. This means the app is instantly responsive and works fully offline. Separately, each of those same writes also fires a best-effort `fetch()` call to the backend's REST API in the background. If that call fails (no network, backend asleep, whatever), the local write already succeeded and nothing is lost — the failed sync is silently retried the next time state changes.

On load, the app calls `pullState()`, which fetches `/api/state` from the backend and merges the server's copy of the data down into `localStorage`. This is what makes progress durable across reinstalls and, eventually, across devices: the database is the real source of truth, and `localStorage` is a fast local cache in front of it.

### 3.2 The five-tab navigation and the "Focused Momentum" design system

The app went through a full UI/UX redesign partway through development, moving from a six-tab layout with repeated large headers on every screen to a five-tab structure: **Home, Roadmap, Learn, Practice, Projects**. Tracker (time logged, streaks, milestones) was folded out of the bottom navigation entirely and is instead reached by tapping either stat card on the Home screen — a deliberate choice to keep the primary navigation to five items, which is both a mobile usability convention and a real constraint (six icons on a narrow phone screen get cramped and hard to tap accurately).

Only the Home screen keeps the large hero header (greeting, avatar, the two big stat cards for overall roadmap progress and day streak). Every other screen uses a compact header — a title, a one-line subtitle, and at most one or two contextual actions — driven by a `viewMeta` lookup table in JavaScript that swaps the header's content based on which tab is active. This was a direct fix for an identified problem: repeating the same large greeting and streak cards on every single screen wastes vertical space and makes every screen look nearly identical.

The visual language itself ("Focused Momentum") replaced the original iOS-blue palette with a chromatic dark navy system: a deep navy background (`#0b1020` in dark mode), layered "elevated" surfaces for cards, and a violet-blue primary accent (`#7968f2`) instead of a flat, cold blue. Success states use a mint green, warnings use amber, and errors use coral — deliberately avoiding the "everything is either blue or red" trap of many minimum-viable designs. The palette is defined once as CSS custom properties and swapped automatically via `prefers-color-scheme`, so the same markup renders correctly in both light and dark mode without any JavaScript branching.

Icons in the bottom navigation are hand-drawn inline SVGs (simple stroke-based line icons for Home, Roadmap, Learn, Practice, and Projects) rather than emoji or a mixed bag of Unicode glyphs, specifically to fix an inconsistency where the original build mixed emoji, letter avatars, and typographic symbols as if they were one icon system.

### 3.3 The curriculum data model

Three parallel arrays drive almost everything in the Roadmap and Learn tabs:

- **`phases`** — the 46 modules themselves. Each has a title, an icon, a "milestone project" (a small suggested build task with a title and description), and a `topics` array. Each topic has a name and a `tasks` array of plain strings — the actual checkable leaf items. There are 725 leaf tasks across all 46 modules.
- **`stages`** — six higher-level groupings that the 46 modules are bucketed into for the Roadmap tab's accordion UI (Programming Foundation, Backend & Data Engineering, Test Automation Engineering, Delivery & Platform Engineering, Engineering Craft & Extras, Career Readiness). Each stage has a `range` — the inclusive start/end module indices it covers — so the UI can compute stage-level progress by aggregating over its member modules.
- **`modulePriority`** — a 46-entry array where each entry is an object keyed by all six role IDs (`sdet`, `automation`, `qa-dev`, `backend`, `swe`, `api`), with each value being one of `M` (Must-learn), `I` (Important), `L` (Learn later), or `O` (Optional). This is what makes the roadmap genuinely personalized: `computeCurrentModuleIndex()` doesn't just find the next incomplete module in numeric order — it ranks all incomplete modules by priority *for the currently selected role* and recommends the highest-priority one first. Within each stage's expanded view, modules are likewise sorted by priority for the active role, so a Must-learn module always surfaces above a merely Optional one even if it comes later in the canonical module numbering.

Every task ID follows the pattern `{moduleIndex}-{topicIndex}-{taskIndex}` (e.g. `7-0-3`), which is how the frontend and backend agree on which specific leaf item was checked without needing a database-generated ID for every one of the 725 tasks.

### 3.4 The Learn tab and the real resource catalogue

The Learn tab is backed by a genuinely curated, 137-item resource catalogue (`backend/data/java_career_resource_seed.json`) — real documentation links, tutorials, videos, and practice platforms, each carrying rich metadata: provider, resource type, difficulty level, a `P0`–`P3` priority, which of the four broad tracks it serves (Shared / Automation / Backend / Advanced), estimated time, an access note (free vs. account-required), and a "resource role" (Primary, Supplementary, Practice, Reference, or Optional).

When the Learn tab loads resources for the current module, a small scoring function (`scoreResource`) ranks them: matching the Shared track adds points, matching the user's specific automation/backend track adds more, higher catalogue priority adds points, and being tagged "Primary" or "Practice" adds points over "Optional." The top three scored resources become "Recommended for you"; everything else is grouped into sections — "Start here," "Practise," "Keep for reference," "Alternative explanations," "Further exploration" — mapped directly from the resource's role field.

### 3.5 Honest empty states and microcopy

A specific and repeated piece of feedback shaped a lot of the copy in this app: a brand-new user should never open a dashboard dominated by zeros and technical error language. Concretely, this means: a 0% overall roadmap ring reads "Ready to begin" instead of just "0%"; a 0-day streak reads "Start today"; an empty activity chart reads "Complete one 15-minute session to begin tracking your activity" instead of showing a blank graph; and backend-connectivity failures in the Learn tab read as "Your learning library is being prepared" rather than exposing implementation details like "Add a Backend URL in Settings" to the person actually using the app day to day.

---

## 4. The Backend: A Small, Purpose-Built Express API

`backend/server.js` is a conventional Express application, but everything it exposes was scoped tightly to exactly what the frontend needs — there is no generic CRUD layer, no ORM, just direct parameterized SQL via the `pg` driver.

### 4.1 Endpoint surface

- `GET /api/state` — the one call the frontend makes on every launch; returns the entire user's synced state (profile, roadmap progress, today's daily checklist, project progress, activity log, notes, GitHub links) in a single response so the app doesn't have to make a dozen separate round trips.
- `POST /api/profile`, `POST /api/notes` — simple field updates.
- `POST /api/roadmap/toggle`, `POST /api/roadmap/date` — mark a specific task done/undone, or correct its recorded completion date.
- `POST /api/daily/toggle`, `POST /api/project/toggle` — same pattern for the daily checklist and portfolio project milestones.
- `POST /api/github-link` / `DELETE /api/github-link/:phaseIndex` and the parallel `project-github-link` routes — record the GitHub repo URL that marks a roadmap module's milestone project (or a portfolio project) as "created."
- `GET /api/resources`, `POST /api/resources` — serve (and optionally extend) the curated catalogue, filterable by module.
- `GET /api/assessments`, `POST /api/assessments/generate`, `POST /api/assessments/:id/attempt` — serve hand-written quizzes, generate new ones on demand via the AI provider, and record attempt scores.
- `POST /api/doubt`, `GET /api/doubt/history` — the "Ask AI" doubt-solving chat.

### 4.2 Activity tracking and streaks

Every meaningful completion — a roadmap task, a daily checklist item, a project step — increments (or, on undo, decrements) a per-day counter in an `activity_log` table via a shared `bumpActivity()` helper. The frontend's streak calculation (`computeStreak()`) reads this log and walks backward from today, counting consecutive active days, entirely client-side — the backend just needs to keep an honest daily tally.

### 4.3 CORS and the file:// origin problem

Because the frontend runs inside an Android `WebView` loading `assets/index.html` via a `file://` URL (or, during development, directly as a local file in a desktop browser), its `fetch()` calls carry an `Origin: null` header rather than a normal `https://...` origin. The backend's CORS configuration explicitly allows `null` as a valid origin (alongside `http://localhost:8000` for local testing) — a detail that would otherwise silently block every single request from the packaged app.

### 4.4 The AI layer: Google Gemini

`backend/gemini.js` calls Google's Gemini REST API directly via Node's built-in `fetch()` — no SDK dependency at all. It exposes two functions: `answerDoubt(question, topic)`, which sends a fixed tutor-persona system instruction plus the user's question and returns the model's answer for the Ask-AI chat; and `generateAssessment(phaseTitle, topicName, count)`, which asks the model to return strict JSON matching a fixed quiz schema (`responseMimeType: 'application/json'` forces this) and parses/validates the result before handing it back.

The system originally used OpenAI, and was switched to Gemini mid-project after the OpenAI account hit `insufficient_quota` (a billing issue, not a code or key problem — verified by calling the API directly and reading the actual error body rather than trusting the frontend's generic failure message). The default model is `gemini-3.5-flash`, chosen after directly testing several candidates against the live API: `gemini-3.1-pro-preview` is a real, valid model ID (confirmed by Google's own error response naming it), but the free API tier grants it a **hard zero quota** — Pro-tier models require a billed Google Cloud project, whereas Flash-tier models work immediately on the free tier. `gemini-3.5-flash` was confirmed live and working via a direct test call before being set as the default.

---

## 5. The Database: Neon Postgres

The schema (`backend/schema.sql`) is deliberately unnormalized in the places where normalization would add no real value for a single-user app, and precise where correctness actually matters:

- **`profile`** — a single-row table (enforced by a `check (id = 1)` constraint) holding the user's name, target role, and daily study-time goal.
- **`roadmap_progress`** — one row per completed task, keyed by the `{module}-{topic}-{task}` ID string, storing the completion date.
- **`daily_progress`**, **`project_progress`** — analogous per-day and per-project-step completion records.
- **`activity_log`** — one row per calendar day with a completion counter, feeding the streak/heatmap calculations.
- **`resources`** — the 137-item curated catalogue, with `module_indexes` as a Postgres array column (a resource can legitimately belong to more than one module — the "Learn Java" hub resource, for instance, is tagged against both Core Java and Computer Science Fundamentals).
- **`assessments`** and **`assessment_attempts`** — quiz content (tagged `planned` for hand-written ones or `ai` for Gemini-generated ones) and the score history.
- **`github_links`**, **`project_github_links`** — the repo URLs marking roadmap/portfolio milestones as "created."
- **`doubt_log`** — a running history of every Ask-AI question and answer.

The database is shared identically between local development and the live Render deployment — there's exactly one Neon instance, one schema, one set of data. Two supporting scripts manage it: `seed.js` (hand-written assessment questions) and `import-resources.js` (an idempotent upsert of the JSON resource catalogue, keyed by the catalogue's own stable IDs like `R001`, so re-running it after editing the JSON file safely updates existing rows and deactivates — never deletes — resources that were removed from the source file, preserving any historical user data that referenced them).

---

## 6. The APK Builder: Packaging Android From Scratch

This is the most unusual part of the system. `build_apk.py` produces a real, installable, signed Android `.apk` file using only the Python standard library plus the two JDK command-line tools required for signing (`keytool`, `jarsigner`) — no Android SDK, no Gradle, no `aapt`.

### 6.1 Why this is hard

An APK is a zip file, but three of the things inside it are binary formats with no plain-text equivalent:

1. **`classes.dex`** — compiled Java bytecode in Android's Dalvik Executable format.
2. **`AndroidManifest.xml`** — not actually XML on disk; Android requires a specific binary-encoded format (AXML).
3. **`resources.arsc`** — Android's compiled resource table, needed for anything referenced by `@type/name` syntax, including the launcher icon.

`build_apk.py` implements a `DexBuilder`, an `AxmlBuilder`, and an `ArscBuilder`, each hand-assembling exactly the minimum viable version of its format:

- **`DexBuilder`** constructs a single class, `MainActivity`, whose entire logic is: create a `WebView`, enable JavaScript and DOM storage, and call `loadUrl("file:///android_asset/index.html")`. It manually builds the DEX string pool, type list, method list, and the actual Dalvik bytecode instructions (`invoke35c`-style calls, `new-instance`, `move-result-object`) for the two required methods, `<init>` and `onCreate`. Every part — the SHA-1 checksum embedded in the header, the Adler-32 checksum, the `map_list` describing the file's own layout — is computed and verified before the file is trusted.
- **`AxmlBuilder`** encodes the manifest's string pool, namespace declarations, and each XML element (`manifest`, `uses-sdk`, `uses-permission` ×2 for `INTERNET` and `ACCESS_NETWORK_STATE`, `application`, `activity`, `intent-filter`) as binary chunks matching Android's `ResXMLTree` format.
- **`ArscBuilder`** builds the minimum resource table capable of satisfying exactly one reference: `android:icon="@mipmap/ic_launcher"`. It constructs a package chunk, a type-string pool (just "mipmap"), a key-string pool (just "ic_launcher"), a type-spec chunk, and a type chunk with a single simple entry pointing at a string in the global pool — the in-APK path to the actual icon PNG.

Each builder has a matching `verify_*` function (`verify_dex`, `verify_axml`, `verify_arsc`) that re-parses its own output and asserts internal consistency — chunk sizes summing correctly, checksums matching, the icon resource ID (`0x7f010000`) actually appearing in the manifest bytes — before the build is allowed to proceed. This matters because there is no Android device or emulator available to test against directly in this development environment; the verification functions are the only safety net against a subtly malformed binary that "looks right" but fails to install.

### 6.2 Assembling and signing the APK

`make_apk()` builds the DEX, manifest, and resource table, writes `assets/index.html` and the launcher icon PNG into a zip alongside them, then shells out to `keytool` (to generate a debug signing keystore, once, on first build) and `jarsigner` (to actually sign the APK) before verifying the signature with `jarsigner -verify`. The app is currently signed with a self-signed debug-style certificate — appropriate for direct personal sharing, not for Play Store distribution.

### 6.3 The launcher icon

The app icon went through two iterations: an initial custom-drawn icon (a blue squircle with a code-prompt glyph and a checkmark badge, generated with Pillow), later replaced with a more polished professionally-designed icon (`Icon.png`) supplied directly, resized to 512×512 and swapped in as `assets/icon/ic_launcher.png` — no code changes were needed for the second swap, since `build_apk.py` already read from that exact path.

### 6.4 Building without a system-installed JDK

Signing requires `keytool` and `jarsigner`, which ship with a JDK. No JDK was installed on the build machine, and the standard installation path (`winget install ... Temurin.21.JDK`) uses an MSI installer that requires an interactive UAC elevation prompt — something an automated shell can't click through. The workaround: download the **portable ZIP distribution** of the same JDK (Temurin 21) directly from Adoptium's GitHub releases, extract it into a local, gitignored `.tools/` folder, and prepend its `bin/` directory to `PATH` for the build command only. This produces byte-for-byte the same signing tools as a full system install, without needing administrator rights.

---

## 7. Deployment

The backend is deployed on **Render** as a Node web service, connected directly to the `Mrigankar1134/CompileDaily` GitHub repository — every push to `main` triggers an automatic rebuild and redeploy. A `render.yaml` Blueprint file in the repo root pre-declares the service configuration (root directory `backend`, build command `npm install`, start command `npm start`) and the required environment variables, with secrets (`DATABASE_URL`, `GEMINI_API_KEY`) marked `sync: false` so they're prompted for during setup rather than committed to the repo.

The live URL, `https://compiledaily.onrender.com`, is now **hardcoded** into the frontend (`API_BASE_URL` constant) rather than configurable through a Settings field — a deliberate simplification once the backend location stabilized, removing a point of user error for a single-deployment personal app. Render's free tier spins the service down after roughly fifteen minutes of inactivity, so the first request after a quiet period can take ten to thirty seconds to wake it back up; this is expected behavior, not a fault.

---

## 8. Security Practices Followed Throughout

Several real secret-handling incidents occurred during development and were caught and corrected rather than ignored:

- An early Neon database connection string was pasted directly into chat and was treated as immediately compromised — the password was rotated in the Neon console regardless of whether it had actually been misused, on the principle that any credential that appears in a conversation transcript should be considered burned.
- A real Gemini API key was later found sitting in `backend/.env.example` (a file that *is* tracked by git) rather than `backend/.env` (which is gitignored). This was caught and reverted to a placeholder before any commit or push occurred, avoiding a public exposure on GitHub.
- `.gitignore` explicitly excludes `backend/.env`, `node_modules/`, `build/`, `*.apk`, `*.keystore`, `*-Source.zip`, and the portable `.tools/` JDK directory — keeping the repository limited to source code and genuinely shareable assets.

---

## 9. Known Limitations and Deliberately Deferred Work

Not everything a full production app would eventually need has been built, and several larger proposals were explicitly scoped down rather than half-implemented:

- No onboarding wizard or automated personalized-plan generation at signup.
- No per-resource user progress tracking (start/complete/save state) — the Learn tab's resource cards link out to external sites without recording return-and-checkpoint interactions.
- No dedicated full-page resource or question "detail" views with routing — everything still lives inside the existing accordion/modal patterns.
- No admin panel, scheduled link-health checking, or analytics event tracking for the resource catalogue.
- No offline download/caching of external resource content (by design — most catalogue entries are third-party links, and copying their content into the app would raise real licensing questions).
- The app is signed with a personal debug-style certificate, not intended for Play Store distribution.

---

## 10. File-by-File Reference

| Path | Purpose |
|---|---|
| `assets/index.html` | The entire frontend — markup, styles, and logic in one file. |
| `assets/icon/ic_launcher.png` | The app's launcher icon, embedded into the APK by `build_apk.py`. |
| `build_apk.py` | Hand-rolled DEX/AXML/ARSC builder that packages and signs the APK. |
| `render.yaml` | Render Blueprint describing the backend service's deployment config. |
| `backend/server.js` | The Express API — every route the frontend calls. |
| `backend/db.js` | Postgres connection pool and the shared activity-log helper. |
| `backend/gemini.js` | Google Gemini REST API integration (doubt-solving, assessment generation). |
| `backend/schema.sql` | Full Postgres schema definition. |
| `backend/seed.js` | Seeds hand-written ("planned") assessment questions. |
| `backend/import-resources.js` | Idempotent importer for the JSON resource catalogue. |
| `backend/data/java_career_resource_seed.json` | The curated, 137-item resource catalogue source of truth. |
| `.gitignore` | Excludes secrets, build artifacts, and the portable JDK. |

---

*This document reflects the system as built through iterative, conversational development — every architectural decision described above was made in response to a concrete requirement or a problem found while testing, not designed upfront in the abstract.*
