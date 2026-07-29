// Learning-event type constants (Compile Daily Product Spec, section 5).
// Only the event types actually emitted by Phase 1-3 (shared foundation, Focus
// Timer, XP/Levels) are listed here — Daily Missions/Flashcards/Mentor/Boss
// Battles will add their own event types when those phases are built.
module.exports = {
  ROADMAP_TASK_COMPLETED: 'roadmap_task_completed',
  DAILY_TASK_COMPLETED: 'daily_task_completed',
  PROJECT_STEP_COMPLETED: 'project_step_completed',
  FOCUS_SESSION_COMPLETED: 'focus_session_completed',
  FOCUS_SESSION_ABANDONED: 'focus_session_abandoned'
};
