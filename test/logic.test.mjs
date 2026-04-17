import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CATEGORIES,
  shuffle,
  normalizeNumeric,
  isCorrect,
  buildQuiz,
  scoreQuiz,
  formatTime,
  choiceLetter
} from "../logic.js";

import {
  xpForAnswer,
  xpToLevel,
  xpForLevel,
  xpToNextLevel,
  levelTitle,
  updateMastery,
  masteryTier,
  todayISO,
  daysBetweenISO,
  updateDailyStreak,
  createProfile,
  migrateProfile,
  applyAnswer,
  recordExerciseAttempt,
  evaluateBadges,
  readinessScore,
  BADGES
} from "../profile.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function seededRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0xffffffff; };
}

// ── logic.js ──────────────────────────────────────────────────────────────────
test("shuffle preserves elements and does not mutate input", () => {
  const input = [1, 2, 3, 4, 5];
  const out = shuffle(input, seededRng(42));
  assert.equal(out.length, input.length);
  assert.deepEqual([...out].sort(), [...input].sort());
  assert.deepEqual(input, [1, 2, 3, 4, 5]);
});

test("normalizeNumeric strips whitespace, commas, and canonicalizes", () => {
  assert.equal(normalizeNumeric("  1,200 "), "1200");
  assert.equal(normalizeNumeric("3.50"), "3.5");
  assert.equal(normalizeNumeric(""), "");
  assert.equal(normalizeNumeric(null), "");
  assert.equal(normalizeNumeric(" X=5 "), "x=5");
});

test("isCorrect — multiple choice", () => {
  const q = { inputType: "multiple-choice", choices: ["a", "b", "c"], correctAnswer: 1 };
  assert.equal(isCorrect(q, 1), true);
  assert.equal(isCorrect(q, "1"), true);
  assert.equal(isCorrect(q, 0), false);
  assert.equal(isCorrect(q, null), false);
});

test("isCorrect — numeric with loose formatting", () => {
  const q = { inputType: "numeric", correctAnswer: "283" };
  assert.equal(isCorrect(q, "283"), true);
  assert.equal(isCorrect(q, " 283 "), true);
  assert.equal(isCorrect(q, "283.0"), true);
  assert.equal(isCorrect(q, 283), true);
  assert.equal(isCorrect(q, "284"), false);
  assert.equal(isCorrect(q, ""), false);
});

test("buildQuiz respects category filter and count", () => {
  const pool = [
    { id: "a", category: "geometry" }, { id: "b", category: "geometry" },
    { id: "c", category: "algebra basics" }, { id: "d", category: "geometry" }
  ];
  const only = buildQuiz(pool, { category: "geometry", count: 10, rng: seededRng(1) });
  assert.equal(only.length, 3);
  assert.ok(only.every(q => q.category === "geometry"));
  const all = buildQuiz(pool, { category: "all", count: 2, rng: seededRng(1) });
  assert.equal(all.length, 2);
});

test("scoreQuiz computes overall and per-category stats", () => {
  const questions = [
    { id: "1", category: "geometry", inputType: "numeric", correctAnswer: "5" },
    { id: "2", category: "geometry", inputType: "numeric", correctAnswer: "10" },
    { id: "3", category: "algebra basics", inputType: "multiple-choice", choices: ["a", "b"], correctAnswer: 0 }
  ];
  const res = scoreQuiz(questions, ["5", "9", 1]);
  assert.equal(res.correct, 1);
  assert.equal(res.incorrect, 2);
  assert.equal(res.percent, 33);
  assert.equal(res.byCategory["geometry"].correct, 1);
  assert.equal(res.byCategory["algebra basics"].correct, 0);
  assert.equal(res.missed.length, 2);
});

test("formatTime formats mm:ss with padding", () => {
  assert.equal(formatTime(0), "00:00");
  assert.equal(formatTime(5), "00:05");
  assert.equal(formatTime(65), "01:05");
});

test("choiceLetter maps indices to A/B/C/D", () => {
  assert.equal(choiceLetter(0), "A");
  assert.equal(choiceLetter(3), "D");
});

// ── profile.js ────────────────────────────────────────────────────────────────
test("xpForAnswer: wrong=2, correct=10, streak bonus capped at +20", () => {
  assert.equal(xpForAnswer({ correct: false }), 2);
  assert.equal(xpForAnswer({ correct: true, answerStreak: 1 }), 10);
  assert.equal(xpForAnswer({ correct: true, answerStreak: 3 }), 12);
  assert.equal(xpForAnswer({ correct: true, answerStreak: 13 }), 30);
});

test("xpToLevel and xpForLevel are inverses", () => {
  assert.equal(xpToLevel(0), 1);
  assert.equal(xpToLevel(xpForLevel(2)), 2);
  assert.equal(xpToLevel(xpForLevel(5)), 5);
  assert.ok(xpToLevel(xpForLevel(5) - 1) < 5);
});

test("xpToNextLevel returns correct percent and progress", () => {
  const info = xpToNextLevel(0);
  assert.equal(info.level, 1);
  assert.equal(info.percent, 0);
  const info3 = xpToNextLevel(xpForLevel(3));
  assert.equal(info3.level, 3);
  assert.equal(info3.progressXp, 0);
});

test("levelTitle returns a non-empty string for levels 1–15", () => {
  for (let l = 1; l <= 15; l++) {
    assert.ok(typeof levelTitle(l) === "string" && levelTitle(l).length > 0);
  }
});

test("updateMastery applies exponential moving average", () => {
  let m = 0;
  m = updateMastery(m, true);
  assert.ok(m > 0 && m <= 20);
  for (let i = 0; i < 40; i++) m = updateMastery(m, true);
  assert.ok(m >= 90, `Expected mastery >= 90 after 41 corrects, got ${m}`);
});

test("masteryTier classifies correctly", () => {
  assert.equal(masteryTier(85).label, "Strong");
  assert.equal(masteryTier(60).label, "Building");
  assert.equal(masteryTier(30).label, "Focus area");
});

test("todayISO returns a valid ISO date string", () => {
  assert.match(todayISO(), /^\d{4}-\d{2}-\d{2}$/);
});

test("daysBetweenISO computes correct gap", () => {
  assert.equal(daysBetweenISO("2026-04-01", "2026-04-08"), 7);
  assert.equal(daysBetweenISO("2026-04-08", "2026-04-01"), -7);
  assert.equal(daysBetweenISO("2026-04-01", "2026-04-01"), 0);
});

test("updateDailyStreak increments on consecutive days, resets on gap", () => {
  let p = createProfile();
  p = updateDailyStreak(p, "2026-04-01");
  assert.equal(p.dailyStreak, 1);
  p = updateDailyStreak(p, "2026-04-02");
  assert.equal(p.dailyStreak, 2);
  p = updateDailyStreak(p, "2026-04-02"); // same day — no change
  assert.equal(p.dailyStreak, 2);
  p = updateDailyStreak(p, "2026-04-04"); // gap — resets
  assert.equal(p.dailyStreak, 1);
});

test("createProfile has all CATEGORIES with zero mastery", () => {
  const p = createProfile({ name: "Anthony" });
  assert.equal(p.name, "Anthony");
  for (const c of CATEGORIES) {
    assert.ok(p.byCategory[c], `missing: ${c}`);
    assert.equal(p.byCategory[c].mastery, 0);
  }
});

test("applyAnswer updates xp, mastery, streak, and missedDeck", () => {
  let p = createProfile({ name: "Anthony" });
  const q = { id: "q1", category: "geometry", inputType: "numeric", correctAnswer: "5" };

  const { profile: p2, xpGained } = applyAnswer(p, q, true);
  assert.equal(xpGained, 10);
  assert.equal(p2.totalCorrect, 1);
  assert.equal(p2.currentAnswerStreak, 1);
  assert.ok(p2.byCategory["geometry"].mastery > 0);
  assert.equal(p2.missedDeck.includes("q1"), false);

  const { profile: p3 } = applyAnswer(p2, q, false);
  assert.equal(p3.currentAnswerStreak, 0);
  assert.ok(p3.missedDeck.includes("q1"));

  const { profile: p4 } = applyAnswer(p3, q, true);
  assert.equal(p4.missedDeck.includes("q1"), false, "should be redeemed");
});

test("evaluateBadges detects first_correct and streak_3 without re-awarding", () => {
  let p = createProfile();
  let result = evaluateBadges(p);
  assert.equal(result.newlyEarned.length, 0);

  p = { ...p, totalCorrect: 1, totalAnswered: 1 };
  result = evaluateBadges(p);
  assert.ok(result.newlyEarned.some(b => b.id === "first_correct"));

  p = { ...result.profile, bestAnswerStreak: 3 };
  result = evaluateBadges(p);
  assert.ok(result.newlyEarned.some(b => b.id === "streak_3"));

  result = evaluateBadges(result.profile); // already earned
  assert.equal(result.newlyEarned.length, 0);
});

test("readinessScore grows with mastery and question coverage", () => {
  let p = createProfile();
  assert.equal(readinessScore(p), 0);
  for (const c of CATEGORIES) p.byCategory[c].mastery = 80;
  p = { ...p, totalAnswered: 150 };
  assert.ok(readinessScore(p) >= 70);
});

test("BADGES has unique ids and each check is a function", () => {
  const ids = new Set();
  for (const b of BADGES) {
    assert.ok(!ids.has(b.id), `duplicate id: ${b.id}`);
    ids.add(b.id);
    assert.equal(typeof b.check, "function");
    assert.ok(b.name && b.icon && b.description);
  }
});

test("migrateProfile handles missing fields gracefully", () => {
  const p = migrateProfile({ name: "Anthony", xp: 500 });
  assert.equal(p.name, "Anthony");
  assert.equal(p.xp, 500);
  assert.ok(p.byCategory && p.missedDeck && Array.isArray(p.exerciseHistory));
});

test("migrateProfile backfills missing v2 fields", () => {
  const p = migrateProfile({ schemaVersion: 2, name: "Anthony", sessions: "oops" });
  assert.equal(p.schemaVersion, 2);
  assert.ok(Array.isArray(p.sessions));
  assert.ok(Array.isArray(p.exerciseHistory));
});

test("recordExerciseAttempt appends attempts and caps history length", () => {
  let p = createProfile();
  for (let i = 0; i < 1105; i += 1) {
    p = recordExerciseAttempt(p, {
      questionId: `q${i}`,
      category: "geometry",
      correct: i % 2 === 0
    });
  }
  assert.equal(p.exerciseHistory.length, 1000);
  assert.equal(p.exerciseHistory.at(-1).questionId, "q1104");
  assert.equal(p.exerciseHistory[0].questionId, "q105");
});

test("question bank: valid fields, unique ids, all categories covered", () => {
  const qs = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "questions.json"), "utf8"));
  assert.ok(qs.length >= 32);
  const ids = new Set();
  for (const q of qs) {
    assert.ok(q.id && !ids.has(q.id), `bad/dup id: ${q.id}`);
    ids.add(q.id);
    assert.ok(CATEGORIES.includes(q.category), `unknown cat: ${q.category}`);
    assert.ok(["easy","medium","hard"].includes(q.difficulty), `bad diff: ${q.id}`);
    if (q.inputType === "multiple-choice") {
      assert.ok(Array.isArray(q.choices) && q.choices.length >= 2);
      assert.ok(Number.isInteger(q.correctAnswer) && q.correctAnswer < q.choices.length);
    } else {
      assert.equal(q.inputType, "numeric");
      assert.ok(q.correctAnswer !== undefined && q.correctAnswer !== "");
    }
  }
  for (const c of CATEGORIES) assert.ok(qs.some(q => q.category === c), `missing cat: ${c}`);
});
