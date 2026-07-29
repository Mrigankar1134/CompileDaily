// XP values, level curve and the anti-gaming award chokepoint (Compile Daily
// Product Spec, section 7). Every XP award in the app should go through
// awardXp() so duplicate event_ids are guaranteed to be rejected exactly once,
// no matter which feature triggered the award.

// Base XP values (spec 7.2). Roadmap task XP depends on the task's priority
// tier (small/important/must-learn), keyed the same way the frontend's
// PRIORITY_RANK does: M (must-learn) > I (important) > L (less important) > O (optional).
const XP_VALUES = {
  roadmapTaskByPriority: { M: 15, I: 12, L: 8, O: 8 },
  focusSessionByMinutes: { 15: 12, 25: 20, 45: 35, 60: 45 },
  dailyTaskCompleted: 8,
  projectStepCompleted: 12
};

// XP required to go from `level` to `level + 1` (spec 7.4).
function xpForLevel(level) {
  return 100 + (level - 1) * 35;
}

// Derives {level, levelXp, xpForNext} from a lifetime total_xp value.
function computeLevelState(totalXp) {
  let level = 1;
  let remaining = Math.max(0, totalXp || 0);
  while (remaining >= xpForLevel(level)) {
    remaining -= xpForLevel(level);
    level++;
  }
  return { level, levelXp: remaining, xpForNext: xpForLevel(level) };
}

// Role-aware level titles (spec 7.5). Reuses the same coarse track grouping the
// frontend already applies to the 6 specific roles for descriptive UI text.
const TRACK_FOR_ROLE = {
  sdet: 'automation',
  automation: 'automation',
  'qa-dev': 'automation',
  backend: 'backend',
  api: 'backend',
  swe: 'swe'
};

const TRACK_TITLES = {
  automation: [
    [11, 15, 'Automation Builder'], [16, 20, 'Test Framework Developer'],
    [21, 25, 'Quality Engineer'], [26, 30, 'Automation Architect'], [31, Infinity, 'SDET Specialist']
  ],
  backend: [
    [11, 15, 'Backend Builder'], [16, 20, 'API Developer'],
    [21, 25, 'Spring Engineer'], [26, 30, 'Service Architect'], [31, Infinity, 'Backend Specialist']
  ],
  swe: [
    [11, 15, 'Software Builder'], [16, 20, 'Java Engineer'],
    [21, 25, 'Systems Developer'], [26, 30, 'Engineering Specialist'], [31, Infinity, 'Software Engineering Professional']
  ]
};

function levelTitle(level, role) {
  if (level <= 3) return 'Java Starter';
  if (level <= 6) return 'Java Explorer';
  if (level <= 10) return 'Java Practitioner';
  const rows = TRACK_TITLES[TRACK_FOR_ROLE[role]] || TRACK_TITLES.backend;
  const row = rows.find(([lo, hi]) => level >= lo && level <= hi);
  return row ? row[2] : rows[rows.length - 1][2];
}

// Awards XP for a single event. Returns { awarded, xpAmount, progression } where
// `awarded` is false whenever event_id was already seen (duplicate completion,
// re-toggle, retried offline sync, etc.) — the anti-gaming rule is enforced here
// via the `xp_transactions.event_id` unique constraint, not by trusting callers.
async function awardXp(client, { event_id, event_type, source_type, source_id, xp_amount, reason, metadata }) {
  if (!event_id || !xp_amount) throw new Error('event_id and xp_amount are required');
  const tx = await client.query(
    `insert into xp_transactions (event_id, event_type, source_type, source_id, xp_amount, reason, metadata)
     values ($1,$2,$3,$4,$5,$6,$7::jsonb)
     on conflict (event_id) do nothing
     returning *`,
    [event_id, event_type, source_type || null, source_id || null, xp_amount, reason || null, metadata ? JSON.stringify(metadata) : null]
  );
  if (tx.rowCount === 0) {
    const current = await client.query('select total_xp, current_level, current_level_xp from user_progression where id=1');
    return { awarded: false, xpAmount: 0, progression: current.rows[0] };
  }
  const totals = await client.query('select coalesce(sum(xp_amount),0) as total from xp_transactions');
  const totalXp = Number(totals.rows[0].total);
  const { level, levelXp } = computeLevelState(totalXp);
  const updated = await client.query(
    `update user_progression set total_xp=$1, current_level=$2, current_level_xp=$3, updated_at=now()
     where id=1 returning total_xp, current_level, current_level_xp`,
    [totalXp, level, levelXp]
  );
  return { awarded: true, xpAmount: xp_amount, progression: updated.rows[0] };
}

async function getSummary(pool, role) {
  const r = await pool.query('select total_xp, current_level, current_level_xp from user_progression where id=1');
  const row = r.rows[0] || { total_xp: 0, current_level: 1, current_level_xp: 0 };
  return {
    totalXp: row.total_xp,
    currentLevel: row.current_level,
    currentLevelXp: row.current_level_xp,
    xpForNextLevel: xpForLevel(row.current_level),
    title: levelTitle(row.current_level, role)
  };
}

module.exports = { XP_VALUES, xpForLevel, computeLevelState, levelTitle, awardXp, getSummary };
