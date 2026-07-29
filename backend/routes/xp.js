const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const xpService = require('../services/xpService');

// No public /api/xp/award — per spec 7.10, XP is only ever awarded server-side
// as a side effect of a trusted event (roadmap/daily/project toggle, focus
// session completion), never from an arbitrary client-supplied amount.

router.get('/summary', async (req, res, next) => {
  try {
    const profile = await pool.query('select role from profile where id=1');
    const role = profile.rows[0]?.role || 'backend';
    res.json(await xpService.getSummary(pool, role));
  } catch (e) { next(e); }
});

router.get('/history', async (req, res, next) => {
  try {
    const r = await pool.query('select event_type, source_type, source_id, xp_amount, reason, created_at from xp_transactions order by created_at desc limit 100');
    res.json(r.rows);
  } catch (e) { next(e); }
});

module.exports = router;
