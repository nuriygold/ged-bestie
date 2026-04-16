// Pure profile/gamification logic. No DOM, no storage — unit-testable.
// A "profile" is a plain JSON object persisted by storage.js.
import { CATEGORIES } from "./logic.js";

export const SCHEMA_VERSION = 1;

/** XP awarded for a single answered question (with streak bonus). */
export function xpForAnswer({ correct, answerStreak = 0 }) {
  if (!correct) return 2; // small reward for trying
  const bonus = Math.min(20, Math.max(0, (answerStreak - 2)) * 2); // +2 per streak ≥3, capped at +20
  return 10 + bonus;
}

/** Level scaling: level N requires cumulative XP of 50 * N*(N-1)/2. */
export function xpToLevel(xp) {
  // solve: 50 * N*(N-1)/2 ≤ xp  →  N(N-1) ≤ xp/25  →  N ≤ (1 + sqrt(1 + 4*xp/25)) / 2
  const n = Math.floor((1 + Math.sqrt(1 + (4 * xp) / 25)) / 2);
  return Math.max(1, n);
}
export function xpForLevel(level) { return 50 * (level * (level - 1)) / 2; }
export function xpToNextLevel(xp) {
  const lvl = xpToLevel(xp);
  const next = xpForLevel(lvl + 1);
  const cur = xpForLevel(lvl);
  return {
    level: lvl,
    progressXp: xp - cur,
    levelSpan: next - cur,
    remainingXp: next - xp,
    percent: Math.min(100, Math.round(((xp - cur) / (next - cur)) * 100))
  };
}

export function levelTitle(level) {
  const titles = [
    "Rookie",         // 1
    "Apprentice",     // 2
    "Scholar",        // 3
    "Problem Solver", // 4
    "Mathlete",       // 5
    "Equation Wrangler", // 6
    "Geometry Guru",  // 7
    "Algebra Ace",    // 8
    "Data Whisperer", // 9
    "GED Virtuoso",   // 10+
  ];
  return titles[Math.min(level - 1, titles.length - 1)];
}

/** Update exponential moving-average mastery for a category (0..100). */
export function updateMastery(previous, correct, { alpha = 0.15 } = {}) {
  const target = correct ? 100 : 0;
  const next = (previous ?? 0) * (1 - alpha) + target * alpha;
  return Math.round(Math.max(0, Math.min(100, next)));
}

export function masteryTier(pct) {
  if (pct >= 80) return { label: "Strong", color: "var(--ok)" };
  if (pct >= 50) return { label: "Building", color: "#d2a40d" };
  return { label: "Focus area", color: "var(--bad)" };
}

/** Local-date ISO (YYYY-MM-DD) in user's timezone. */
export function todayISO(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Days between two ISO date strings (b - a). */
export function daysBetweenISO(a, b) {
  if (!a || !b) return 0;
  const ms = new Date(b + "T00:00:00").getTime() - new Date(a + "T00:00:00").getTime();
  return Math.round(ms / 86_400_000);
}

/** Update daily streak given current profile and today's date. */
export function updateDailyStreak(profile, today = todayISO()) {
  const last = profile.lastActiveDate;
  if (!last) return { ...profile, dailyStreak: 1, lastActiveDate: today };
  if (last === today) return profile; // already counted today
  const gap = daysBetweenISO(last, today);
  if (gap === 1) return { ...profile, dailyStreak: (profile.dailyStreak || 0) + 1, lastActiveDate: today };
  // gap > 1 or negative → reset
  return { ...profile, dailyStreak: 1, lastActiveDate: today };
}

/** Build a fresh profile with sensible defaults. */
export function createProfile({ name = "Friend", targetDate = null } = {}) {
  const byCategory = {};
  for (const c of CATEGORIES) byCategory[c] = { answered: 0, correct: 0, mastery: 0 };
  return {
    schemaVersion: SCHEMA_VERSION,
    name,
    targetDate,
    createdAt: Date.now(),
    xp: 0,
    bestAnswerStreak: 0,
    currentAnswerStreak: 0,
    dailyStreak: 0,
    lastActiveDate: null,
    totalAnswered: 0,
    totalCorrect: 0,
    byCategory,
    questionStats: {}, // id → { seen, correct, lastSeenAt }
    missedDeck: [],    // question ids that need review
    badges: [],        // earned badge ids
    sessions: [],      // compact history: { at, mode, total, correct, percent }
    dailyChallenge: null, // { date, questionIds, completed, correct, total }
    preferences: { confetti: true, sound: false }
  };
}

/** Migrate older profiles forward. */
export function migrateProfile(p) {
  if (!p || typeof p !== "object") return createProfile();
  if (p.schemaVersion === SCHEMA_VERSION) return p;
  // v0 → v1: pad missing fields, preserve whatever's there.
  const fresh = createProfile({ name: p.name, targetDate: p.targetDate });
  return { ...fresh, ...p, schemaVersion: SCHEMA_VERSION,
    byCategory: { ...fresh.byCategory, ...(p.byCategory || {}) },
    preferences: { ...fresh.preferences, ...(p.preferences || {}) }
  };
}

/**
 * Apply the effect of answering one question to a profile (returns new profile).
 * Does NOT persist — caller writes to storage.
 */
export function applyAnswer(profile, question, correct) {
  const p = { ...profile };
  p.byCategory = { ...(p.byCategory || {}) };
  const cat = p.byCategory[question.category] || { answered: 0, correct: 0, mastery: 0 };
  const nextCat = {
    answered: cat.answered + 1,
    correct: cat.correct + (correct ? 1 : 0),
    mastery: updateMastery(cat.mastery, correct)
  };
  p.byCategory[question.category] = nextCat;

  p.totalAnswered = (p.totalAnswered || 0) + 1;
  p.totalCorrect = (p.totalCorrect || 0) + (correct ? 1 : 0);

  // Answer streak (consecutive correct, resets on wrong)
  p.currentAnswerStreak = correct ? (p.currentAnswerStreak || 0) + 1 : 0;
  p.bestAnswerStreak = Math.max(p.bestAnswerStreak || 0, p.currentAnswerStreak);

  const xpGained = xpForAnswer({ correct, answerStreak: p.currentAnswerStreak });
  p.xp = (p.xp || 0) + xpGained;

  // Question stats
  const qs = { ...(p.questionStats || {}) };
  const prev = qs[question.id] || { seen: 0, correct: 0, lastSeenAt: 0 };
  qs[question.id] = {
    seen: prev.seen + 1,
    correct: prev.correct + (correct ? 1 : 0),
    lastSeenAt: Date.now()
  };
  p.questionStats = qs;

  // Missed deck management
  const set = new Set(p.missedDeck || []);
  if (!correct) set.add(question.id);
  else set.delete(question.id); // redeemed
  p.missedDeck = [...set];

  return { profile: p, xpGained };
}

/** Finalize a session — update daily streak, record session summary. */
export function finalizeSession(profile, sessionSummary) {
  let p = updateDailyStreak(profile);
  p = {
    ...p,
    sessions: [
      ...(p.sessions || []).slice(-49),
      { at: Date.now(), ...sessionSummary }
    ]
  };
  return p;
}

/** Select review-deck questions from the bank (in priority order). */
export function buildReviewDeck(profile, bank, limit = 10) {
  const ids = new Set(profile.missedDeck || []);
  const items = bank.filter(q => ids.has(q.id));
  // If no missed yet, fall back to questions with lowest mastery categories.
  if (items.length === 0) {
    const sortedCats = Object.entries(profile.byCategory || {})
      .sort((a, b) => (a[1].mastery ?? 0) - (b[1].mastery ?? 0))
      .map(([c]) => c);
    const weakest = sortedCats[0];
    return bank.filter(q => q.category === weakest).slice(0, limit);
  }
  return items.slice(0, limit);
}

// ---------------- Badges ----------------
// Each badge: { id, name, description, icon, check(profile, ctx) → bool }
// ctx is { lastSession?: {...}, hourOfDay?: number }
export const BADGES = [
  { id: "first_correct",  name: "First Blood",      icon: "🎯", description: "Answer your first question correctly.",
    check: p => p.totalCorrect >= 1 },
  { id: "streak_3",       name: "Hot Hand",         icon: "🔥", description: "Get 3 correct answers in a row.",
    check: p => (p.bestAnswerStreak || 0) >= 3 },
  { id: "streak_10",      name: "Unstoppable",      icon: "⚡", description: "Get 10 correct answers in a row.",
    check: p => (p.bestAnswerStreak || 0) >= 10 },
  { id: "fifty",          name: "Half-Century",     icon: "🏅", description: "Answer 50 questions total.",
    check: p => (p.totalAnswered || 0) >= 50 },
  { id: "centurion",      name: "Centurion",        icon: "💯", description: "Answer 100 questions total.",
    check: p => (p.totalAnswered || 0) >= 100 },
  { id: "perfect_session",name: "Flawless",         icon: "💎", description: "Finish a 10-question session with 100%.",
    check: (p, ctx) => ctx.lastSession && ctx.lastSession.total >= 10 && ctx.lastSession.correct === ctx.lastSession.total },
  { id: "daily_3",        name: "Three-in-a-Row",   icon: "📅", description: "Practice 3 days in a row.",
    check: p => (p.dailyStreak || 0) >= 3 },
  { id: "daily_7",        name: "Week Warrior",     icon: "🗓️", description: "Practice 7 days in a row.",
    check: p => (p.dailyStreak || 0) >= 7 },
  { id: "level_5",        name: "Rising Star",      icon: "🌟", description: "Reach level 5.",
    check: p => xpToLevel(p.xp || 0) >= 5 },
  { id: "level_10",       name: "GED Virtuoso",     icon: "👑", description: "Reach level 10.",
    check: p => xpToLevel(p.xp || 0) >= 10 },
  { id: "cat_master",     name: "Category Master",  icon: "🧠", description: "Reach 80% mastery in any category.",
    check: p => Object.values(p.byCategory || {}).some(c => (c.mastery ?? 0) >= 80) },
  { id: "all_strong",     name: "Well-Rounded",     icon: "🏆", description: "Reach 70%+ mastery in every category.",
    check: p => CATEGORIES.every(c => (p.byCategory?.[c]?.mastery ?? 0) >= 70) },
  { id: "early_bird",     name: "Early Bird",       icon: "🌅", description: "Answer a question before 9 AM.",
    check: (p, ctx) => typeof ctx.hourOfDay === "number" && ctx.hourOfDay < 9 && p.totalAnswered > 0 },
];

/** Evaluate badges and return only newly-earned ones. Mutates a copy of profile. */
export function evaluateBadges(profile, ctx = {}) {
  const earned = new Set(profile.badges || []);
  const newly = [];
  for (const b of BADGES) {
    if (earned.has(b.id)) continue;
    try {
      if (b.check(profile, ctx)) {
        earned.add(b.id);
        newly.push(b);
      }
    } catch { /* defensive */ }
  }
  return { profile: { ...profile, badges: [...earned] }, newlyEarned: newly };
}

/** Readiness score 0..100 — rough estimate based on mastery + coverage. */
export function readinessScore(profile) {
  const cats = Object.values(profile.byCategory || {});
  if (cats.length === 0) return 0;
  const avgMastery = cats.reduce((s, c) => s + (c.mastery || 0), 0) / cats.length;
  const coverageBoost = Math.min(1, (profile.totalAnswered || 0) / 150); // need ~150 answered for full weight
  return Math.round(avgMastery * (0.5 + 0.5 * coverageBoost));
}
