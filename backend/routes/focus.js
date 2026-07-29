const express = require('express');
const router = express.Router();
const focusService = require('../services/focusService');

router.post('/start', async (req, res, next) => {
  try {
    const { id, sourceType, sourceId, moduleIndex, topicIndex, title, intention, plannedMinutes } = req.body;
    if (!id || !plannedMinutes) return res.status(400).json({ error: 'id and plannedMinutes are required' });
    const session = await focusService.startSession({ id, sourceType, sourceId, moduleIndex, topicIndex, title, intention, plannedMinutes });
    res.json(session);
  } catch (e) { next(e); }
});

router.post('/:id/pause', async (req, res, next) => {
  try {
    const session = await focusService.pauseSession(req.params.id);
    if (!session) return res.status(404).json({ error: 'session not found or not running' });
    res.json(session);
  } catch (e) { next(e); }
});

router.post('/:id/resume', async (req, res, next) => {
  try {
    const session = await focusService.resumeSession(req.params.id);
    if (!session) return res.status(404).json({ error: 'session not found or not paused' });
    res.json(session);
  } catch (e) { next(e); }
});

router.post('/:id/complete', async (req, res, next) => {
  try {
    const { completedMinutes, difficultyRating, reflection } = req.body;
    const session = await focusService.completeSession(req.params.id, { completedMinutes, difficultyRating, reflection });
    if (!session) return res.status(404).json({ error: 'session not found' });
    res.json(session);
  } catch (e) { next(e); }
});

router.post('/:id/abandon', async (req, res, next) => {
  try {
    const session = await focusService.abandonSession(req.params.id);
    if (!session) return res.status(404).json({ error: 'session not found' });
    res.json(session);
  } catch (e) { next(e); }
});

router.get('/active', async (req, res, next) => {
  try { res.json(await focusService.getActive()); } catch (e) { next(e); }
});

router.get('/history', async (req, res, next) => {
  try { res.json(await focusService.getHistory()); } catch (e) { next(e); }
});

router.get('/summary', async (req, res, next) => {
  try { res.json(await focusService.getSummary()); } catch (e) { next(e); }
});

module.exports = router;
