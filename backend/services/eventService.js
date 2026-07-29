// Records a learning event exactly once. Every downstream system (XP, and later
// Missions/Mastery/Analytics) is built on top of this table, so this is the single
// place events are written — callers pass an already-open transaction client so the
// event insert and any related writes (e.g. an XP transaction) commit atomically.
async function recordEvent(client, evt) {
  const {
    event_id, event_type, event_timestamp, source_type, source_id,
    module_index, topic_index, task_id, duration_minutes, score, metadata
  } = evt;
  if (!event_id || !event_type) throw new Error('event_id and event_type are required');
  const r = await client.query(
    `insert into learning_events
       (event_id, event_type, event_timestamp, source_type, source_id, module_index, topic_index, task_id, duration_minutes, score, metadata)
     values ($1,$2,coalesce($3,now()),$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
     on conflict (event_id) do nothing
     returning *`,
    [
      event_id, event_type, event_timestamp || null, source_type || null, source_id || null,
      module_index ?? null, topic_index ?? null, task_id || null, duration_minutes ?? null,
      score ?? null, metadata ? JSON.stringify(metadata) : null
    ]
  );
  return { inserted: r.rowCount > 0, row: r.rows[0] || null };
}

module.exports = { recordEvent };
