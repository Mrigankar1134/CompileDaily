const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Adjusts activity_log(day).count by delta, used for streak/heatmap tracking
// whenever any task (roadmap/daily/project) is marked done or undone.
async function bumpActivity(client, day, delta) {
  await client.query(
    `insert into activity_log (day, count) values ($1, greatest($2,0))
     on conflict (day) do update set count = greatest(activity_log.count + $2, 0)`,
    [day, delta]
  );
}

module.exports = { pool, bumpActivity };
