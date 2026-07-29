const { pool } = require('../db');
const eventService = require('./eventService');
const xpService = require('./xpService');
const eventTypes = require('../lib/eventTypes');

// `id` is client-generated so a session started offline can be completed later
// using the same id even if the initial "create" call never reached the server
// (spec 8.14) — insert is idempotent via `on conflict (id) do nothing`.
async function startSession({ id, sourceType, sourceId, moduleIndex, topicIndex, title, intention, plannedMinutes }) {
  const r = await pool.query(
    `insert into focus_sessions (id, source_type, source_id, module_index, topic_index, title, intention, planned_minutes, status)
     values ($1,$2,$3,$4,$5,$6,$7,$8,'running')
     on conflict (id) do nothing
     returning *`,
    [id, sourceType || null, sourceId || null, moduleIndex ?? null, topicIndex ?? null, title || null, intention || null, plannedMinutes]
  );
  return r.rows[0] || (await pool.query('select * from focus_sessions where id=$1', [id])).rows[0];
}

async function pauseSession(id) {
  const r = await pool.query(
    `update focus_sessions set status='paused', paused_at=now(), updated_at=now()
     where id=$1 and status='running' returning *`,
    [id]
  );
  return r.rows[0] || null;
}

async function resumeSession(id) {
  const existing = await pool.query('select paused_at from focus_sessions where id=$1', [id]);
  if (!existing.rows[0]) return null;
  const pausedAt = existing.rows[0].paused_at;
  const addedPauseSeconds = pausedAt ? Math.max(0, Math.round((Date.now() - new Date(pausedAt).getTime()) / 1000)) : 0;
  const r = await pool.query(
    `update focus_sessions set status='running', pause_seconds = pause_seconds + $2, paused_at=null, updated_at=now()
     where id=$1 and status='paused' returning *`,
    [id, addedPauseSeconds]
  );
  return r.rows[0] || null;
}

// Base XP for a focus session, prorated for partial completion (spec 8.10: partial
// XP is allowed but never exceeds the planned-session reward).
function focusXpFor(plannedMinutes, completedMinutes) {
  const preset = xpService.XP_VALUES.focusSessionByMinutes[plannedMinutes];
  const baseXp = preset != null ? preset : Math.round(plannedMinutes * 0.78);
  const ratio = Math.min(1, completedMinutes / plannedMinutes);
  return Math.max(0, Math.round(baseXp * ratio));
}

// Completes a session and (subject to the anti-gaming Focus Timer Minimum: at
// least 5 real minutes, not abandoned) awards XP exactly once via a deterministic
// event_id derived from the session id, so a retried/duplicated completion call
// can never award XP twice.
async function completeSession(id, { completedMinutes, difficultyRating, reflection } = {}) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const existing = await client.query('select * from focus_sessions where id=$1 for update', [id]);
    const session = existing.rows[0];
    if (!session) { await client.query('rollback'); return null; }
    if (session.status === 'completed' || session.status === 'abandoned') {
      await client.query('commit');
      return session;
    }

    const elapsedSeconds = Math.max(0, Math.round((Date.now() - new Date(session.started_at).getTime()) / 1000) - session.pause_seconds);
    const serverMinutes = Math.round(elapsedSeconds / 60);
    const minutes = Math.max(0, Math.min(completedMinutes ?? serverMinutes, serverMinutes + 1));

    let xpAwarded = 0;
    if (minutes >= 5 && session.status !== 'abandoned') {
      const eventId = `xp-focus-${id}`;
      await eventService.recordEvent(client, {
        event_id: eventId,
        event_type: eventTypes.FOCUS_SESSION_COMPLETED,
        source_type: session.source_type,
        source_id: session.source_id,
        module_index: session.module_index,
        topic_index: session.topic_index,
        duration_minutes: minutes,
        metadata: { sessionId: id }
      });
      const award = await xpService.awardXp(client, {
        event_id: eventId,
        event_type: eventTypes.FOCUS_SESSION_COMPLETED,
        source_type: session.source_type,
        source_id: session.source_id,
        xp_amount: focusXpFor(session.planned_minutes, minutes),
        reason: 'Focus session completed'
      });
      xpAwarded = award.xpAmount;
    }

    const r = await client.query(
      `update focus_sessions
       set status='completed', ended_at=now(), completed_minutes=$2,
           difficulty_rating=$3, reflection=$4, xp_awarded=$5, updated_at=now()
       where id=$1 returning *`,
      [id, minutes, difficultyRating || null, reflection || null, xpAwarded]
    );
    await client.query('commit');
    return r.rows[0];
  } catch (e) { await client.query('rollback'); throw e; }
  finally { client.release(); }
}

async function abandonSession(id) {
  const r = await pool.query(
    `update focus_sessions set status='abandoned', ended_at=now(), updated_at=now()
     where id=$1 returning *`,
    [id]
  );
  return r.rows[0] || null;
}

async function getActive() {
  const r = await pool.query(`select * from focus_sessions where status in ('running','paused') order by started_at desc limit 1`);
  return r.rows[0] || null;
}

async function getHistory(limit = 50) {
  const r = await pool.query(`select * from focus_sessions where status in ('completed','abandoned') order by started_at desc limit $1`, [limit]);
  return r.rows;
}

async function getSummary() {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const r = await pool.query(
    `select count(*)::int as sessions, coalesce(sum(completed_minutes),0)::int as minutes
     from focus_sessions where status='completed' and started_at >= $1`,
    [weekAgo]
  );
  const today = new Date().toISOString().slice(0, 10);
  const t = await pool.query(
    `select coalesce(sum(completed_minutes),0)::int as minutes
     from focus_sessions where status='completed' and started_at::date = $1`,
    [today]
  );
  return {
    weekMinutes: r.rows[0].minutes,
    weekSessions: r.rows[0].sessions,
    todayMinutes: t.rows[0].minutes,
    avgSessionMinutes: r.rows[0].sessions ? Math.round(r.rows[0].minutes / r.rows[0].sessions) : 0
  };
}

module.exports = { startSession, pauseSession, resumeSession, completeSession, abandonSession, getActive, getHistory, getSummary };
