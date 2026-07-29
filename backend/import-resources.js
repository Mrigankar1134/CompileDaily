// Imports backend/data/java_career_resource_seed.json (the real 133-item
// curated resource catalogue) into the `resources` table. Safe to re-run:
// upserts by the catalogue's own stable id (e.g. "R001"), and deactivates any
// previously-imported row that's no longer present in the current JSON file
// (rather than deleting it, so historical user activity referencing it is preserved).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function importCatalogue() {
  const file = path.join(__dirname, 'data', 'java_career_resource_seed.json');
  const catalogue = JSON.parse(fs.readFileSync(file, 'utf8'));
  const resources = catalogue.resources || [];
  if (!resources.length) throw new Error('No resources found in ' + file);

  const client = await pool.connect();
  try {
    await client.query('begin');
    const seenIds = [];
    for (const r of resources) {
      const moduleIndexes = (r.module_no || []).map(n => n - 1);
      const phaseIndex = moduleIndexes[0] ?? null;
      seenIds.push(r.id);
      await client.query(
        `insert into resources
           (id, phase_index, module_indexes, title, provider, resource_type, level, priority,
            tracks, url, access, estimated_time, use_desc, notes, resource_role, topics,
            active, last_reviewed, added_by)
         values ($1,$2,$3::int[],$4,$5,$6,$7,$8,$9::text[],$10,$11,$12,$13,$14,$15,$16::text[],$17,$18,'catalogue')
         on conflict (id) do update set
           phase_index=$2, module_indexes=$3::int[], title=$4, provider=$5, resource_type=$6, level=$7,
           priority=$8, tracks=$9::text[], url=$10, access=$11, estimated_time=$12, use_desc=$13,
           notes=$14, resource_role=$15, topics=$16::text[], active=$17, last_reviewed=$18, added_by='catalogue'`,
        [
          r.id, phaseIndex, moduleIndexes, r.title, r.provider, r.resource_type, r.level, r.priority,
          r.tracks || [], r.url, r.access, r.estimated_time, r.use, r.notes, r.primary_or_supplementary,
          r.topics || [], r.active !== false, r.last_reviewed || null
        ]
      );
    }
    if (seenIds.length) {
      await client.query(
        `update resources set active=false where added_by='catalogue' and not (id = any($1::text[]))`,
        [seenIds]
      );
    }
    await client.query('commit');
    console.log(`Imported/updated ${resources.length} resources from ${catalogue.catalogue_title || file} (version ${catalogue.version}).`);
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

importCatalogue().catch(e => { console.error(e); process.exit(1); });
