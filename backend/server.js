require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { pool, bumpActivity } = require('./db');
const { answerDoubt, generateAssessment } = require('./openai');

const app = express();
app.use(express.json());

// The Android WebView loads assets/index.html from file://, so its fetch()
// calls carry Origin: null. Allow that plus whatever you list in
// ALLOWED_ORIGINS (comma-separated) for local/browser testing.
const allowed = (process.env.ALLOWED_ORIGINS || 'null').split(',').map(s => s.trim());
app.use(cors({
  origin(origin, cb) {
    if (!origin || allowed.includes(origin) || allowed.includes('null')) return cb(null, true);
    cb(new Error('Origin not allowed: ' + origin));
  }
}));

const todayStr = () => new Date().toISOString().slice(0, 10);

app.get('/api/health', (req, res) => res.json({ ok: true }));

// ---- Full-state sync: one call returns everything the app needs ----------
app.get('/api/state', async (req, res, next) => {
  try {
    const [profile, roadmap, daily, projects, activity, notes, githubLinks, projectGithubLinks] = await Promise.all([
      pool.query('select name, role, goal_minutes from profile where id = 1'),
      pool.query('select task_id, completed_date from roadmap_progress'),
      pool.query('select task_index from daily_progress where day = $1', [todayStr()]),
      pool.query('select project_id, step_index, completed_date from project_progress'),
      pool.query('select day, count from activity_log'),
      pool.query('select content from notes where id = 1'),
      pool.query('select phase_index, url, submitted_at from github_links'),
      pool.query('select project_id, url, submitted_at from project_github_links')
    ]);

    const roadmapProgress = {};
    roadmap.rows.forEach(r => { roadmapProgress[r.task_id] = { date: r.completed_date.toISOString().slice(0, 10) }; });

    const projectDone = {};
    projects.rows.forEach(r => {
      projectDone[r.project_id] = projectDone[r.project_id] || [];
      projectDone[r.project_id].push(r.step_index);
    });

    const activityLog = {};
    activity.rows.forEach(r => { activityLog[r.day.toISOString().slice(0, 10)] = r.count; });

    const githubLinksMap = {};
    githubLinks.rows.forEach(r => { githubLinksMap[r.phase_index] = { url: r.url, date: r.submitted_at.toISOString().slice(0, 10) }; });

    const projectGithubLinksMap = {};
    projectGithubLinks.rows.forEach(r => { projectGithubLinksMap[r.project_id] = { url: r.url, date: r.submitted_at.toISOString().slice(0, 10) }; });

    res.json({
      profile: profile.rows[0] || { name: 'Moushana', role: 'backend', goal_minutes: 60 },
      roadmapProgress,
      dailyDone: daily.rows.map(r => r.task_index),
      projectDone,
      activityLog,
      notes: notes.rows[0]?.content || '',
      githubLinks: githubLinksMap,
      projectGithubLinks: projectGithubLinksMap
    });
  } catch (e) { next(e); }
});

app.post('/api/profile', async (req, res, next) => {
  try {
    const { name, role, goalMinutes } = req.body;
    await pool.query(
      `update profile set name=$1, role=$2, goal_minutes=$3, updated_at=now() where id=1`,
      [name || 'Moushana', role || 'backend', goalMinutes || 60]
    );
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.post('/api/notes', async (req, res, next) => {
  try {
    await pool.query(`update notes set content=$1, updated_at=now() where id=1`, [req.body.content || '']);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---- Roadmap task toggling -------------------------------------------------
app.post('/api/roadmap/toggle', async (req, res, next) => {
  const { taskId, done, date } = req.body;
  if (!taskId) return res.status(400).json({ error: 'taskId required' });
  const client = await pool.connect();
  try {
    await client.query('begin');
    if (done) {
      const d = date || todayStr();
      await client.query(
        `insert into roadmap_progress (task_id, completed_date) values ($1,$2)
         on conflict (task_id) do update set completed_date=$2, updated_at=now()`,
        [taskId, d]
      );
      await bumpActivity(client, d, 1);
    } else {
      const existing = await client.query('select completed_date from roadmap_progress where task_id=$1', [taskId]);
      await client.query('delete from roadmap_progress where task_id=$1', [taskId]);
      if (existing.rows[0]) {
        await bumpActivity(client, existing.rows[0].completed_date.toISOString().slice(0, 10), -1);
      }
    }
    await client.query('commit');
    res.json({ ok: true });
  } catch (e) { await client.query('rollback'); next(e); }
  finally { client.release(); }
});

app.post('/api/roadmap/date', async (req, res, next) => {
  const { taskId, date } = req.body;
  if (!taskId || !/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return res.status(400).json({ error: 'taskId and YYYY-MM-DD date required' });
  const client = await pool.connect();
  try {
    await client.query('begin');
    const existing = await client.query('select completed_date from roadmap_progress where task_id=$1', [taskId]);
    if (!existing.rows[0]) { await client.query('rollback'); return res.status(404).json({ error: 'task not marked done yet' }); }
    await bumpActivity(client, existing.rows[0].completed_date.toISOString().slice(0, 10), -1);
    await client.query('update roadmap_progress set completed_date=$1, updated_at=now() where task_id=$2', [date, taskId]);
    await bumpActivity(client, date, 1);
    await client.query('commit');
    res.json({ ok: true });
  } catch (e) { await client.query('rollback'); next(e); }
  finally { client.release(); }
});

// ---- Daily checklist --------------------------------------------------------
app.post('/api/daily/toggle', async (req, res, next) => {
  const { taskIndex, done } = req.body;
  const day = todayStr();
  const client = await pool.connect();
  try {
    await client.query('begin');
    if (done) {
      await client.query('insert into daily_progress (day, task_index) values ($1,$2) on conflict do nothing', [day, taskIndex]);
      await bumpActivity(client, day, 1);
    } else {
      const r = await client.query('delete from daily_progress where day=$1 and task_index=$2', [day, taskIndex]);
      if (r.rowCount) await bumpActivity(client, day, -1);
    }
    await client.query('commit');
    res.json({ ok: true });
  } catch (e) { await client.query('rollback'); next(e); }
  finally { client.release(); }
});

// ---- Project steps ----------------------------------------------------------
app.post('/api/project/toggle', async (req, res, next) => {
  const { projectId, stepIndex, done } = req.body;
  const day = todayStr();
  const client = await pool.connect();
  try {
    await client.query('begin');
    if (done) {
      await client.query(
        `insert into project_progress (project_id, step_index, completed_date) values ($1,$2,$3)
         on conflict (project_id, step_index) do update set completed_date=$3`,
        [projectId, stepIndex, day]
      );
      await bumpActivity(client, day, 1);
    } else {
      const r = await client.query('delete from project_progress where project_id=$1 and step_index=$2', [projectId, stepIndex]);
      if (r.rowCount) await bumpActivity(client, day, -1);
    }
    await client.query('commit');
    res.json({ ok: true });
  } catch (e) { await client.query('rollback'); next(e); }
  finally { client.release(); }
});

app.post('/api/github-link', async (req, res, next) => {
  try {
    const { phaseIndex, url } = req.body;
    if (phaseIndex === undefined || !url || !/^https?:\/\//i.test(url)) {
      return res.status(400).json({ error: 'phaseIndex and a full https:// url are required' });
    }
    await pool.query(
      `insert into github_links (phase_index, url) values ($1,$2)
       on conflict (phase_index) do update set url=$2, submitted_at=now()`,
      [phaseIndex, url]
    );
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.delete('/api/github-link/:phaseIndex', async (req, res, next) => {
  try {
    await pool.query('delete from github_links where phase_index=$1', [req.params.phaseIndex]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.post('/api/project-github-link', async (req, res, next) => {
  try {
    const { projectId, url } = req.body;
    if (!projectId || !url || !/^https?:\/\//i.test(url)) {
      return res.status(400).json({ error: 'projectId and a full https:// url are required' });
    }
    await pool.query(
      `insert into project_github_links (project_id, url) values ($1,$2)
       on conflict (project_id) do update set url=$2, submitted_at=now()`,
      [projectId, url]
    );
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.delete('/api/project-github-link/:projectId', async (req, res, next) => {
  try {
    await pool.query('delete from project_github_links where project_id=$1', [req.params.projectId]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---- Resources --------------------------------------------------------------
app.get('/api/resources', async (req, res, next) => {
  try {
    const { phase, topic } = req.query;
    let q = 'select * from resources where 1=1';
    const params = [];
    if (phase !== undefined) { params.push(phase); q += ` and phase_index = $${params.length}`; }
    if (topic !== undefined) { params.push(topic); q += ` and (topic_index = $${params.length} or topic_index is null)`; }
    q += ' order by created_at asc';
    const r = await pool.query(q, params);
    res.json(r.rows);
  } catch (e) { next(e); }
});

app.post('/api/resources', async (req, res, next) => {
  try {
    const { phaseIndex, topicIndex, title, url, kind, source } = req.body;
    if (!title || !url) return res.status(400).json({ error: 'title and url required' });
    const r = await pool.query(
      `insert into resources (phase_index, topic_index, title, url, kind, source, is_free, added_by)
       values ($1,$2,$3,$4,$5,$6,true,'user') returning *`,
      [phaseIndex ?? null, topicIndex ?? null, title, url, kind || 'article', source || 'Custom']
    );
    res.json(r.rows[0]);
  } catch (e) { next(e); }
});

// ---- Assessments --------------------------------------------------------------
app.get('/api/assessments', async (req, res, next) => {
  try {
    const { phase, topic } = req.query;
    let q = 'select id, phase_index, topic_index, title, source, questions, created_at from assessments where 1=1';
    const params = [];
    if (phase !== undefined) { params.push(phase); q += ` and phase_index = $${params.length}`; }
    if (topic !== undefined) { params.push(topic); q += ` and (topic_index = $${params.length} or topic_index is null)`; }
    q += ' order by created_at desc';
    const r = await pool.query(q, params);
    res.json(r.rows);
  } catch (e) { next(e); }
});

app.post('/api/assessments/generate', async (req, res, next) => {
  try {
    const { phaseIndex, topicIndex, phaseTitle, topicName, count } = req.body;
    if (!phaseTitle || !topicName) return res.status(400).json({ error: 'phaseTitle and topicName required' });
    const questions = await generateAssessment(phaseTitle, topicName, count || 5);
    const r = await pool.query(
      `insert into assessments (phase_index, topic_index, title, source, questions)
       values ($1,$2,$3,'ai',$4::jsonb) returning id, phase_index, topic_index, title, source, questions, created_at`,
      [phaseIndex ?? null, topicIndex ?? null, `${topicName} — AI generated`, JSON.stringify(questions)]
    );
    res.json(r.rows[0]);
  } catch (e) { next(e); }
});

app.post('/api/assessments/:id/attempt', async (req, res, next) => {
  try {
    const { answers } = req.body; // array of chosen option indexes
    const a = await pool.query('select questions from assessments where id=$1', [req.params.id]);
    if (!a.rows[0]) return res.status(404).json({ error: 'assessment not found' });
    const questions = a.rows[0].questions;
    let score = 0;
    questions.forEach((q, i) => { if (answers[i] === q.answerIndex) score++; });
    await pool.query(
      `insert into assessment_attempts (assessment_id, score, total, answers) values ($1,$2,$3,$4::jsonb)`,
      [req.params.id, score, questions.length, JSON.stringify(answers)]
    );
    res.json({ score, total: questions.length });
  } catch (e) { next(e); }
});

// ---- Ask-a-doubt (OpenAI) ----------------------------------------------------
app.post('/api/doubt', async (req, res, next) => {
  try {
    const { question, topic } = req.body;
    if (!question || !question.trim()) return res.status(400).json({ error: 'question required' });
    const answer = await answerDoubt(question.trim(), topic);
    await pool.query('insert into doubt_log (topic, question, answer) values ($1,$2,$3)', [topic || null, question.trim(), answer]);
    res.json({ answer });
  } catch (e) { next(e); }
});

app.get('/api/doubt/history', async (req, res, next) => {
  try {
    const r = await pool.query('select id, topic, question, answer, created_at from doubt_log order by created_at desc limit 50');
    res.json(r.rows);
  } catch (e) { next(e); }
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Server error' });
});

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`Compile Daily API listening on :${port}`));
