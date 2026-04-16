// Pure helper functions for the quiz engine.
// Kept framework-free so they can be unit tested with `node --test`.

export const CATEGORIES = [
  "basic arithmetic",
  "fractions/decimals/percents",
  "ratios and proportions",
  "algebra basics",
  "expressions and equations",
  "geometry",
  "word problems",
  "data/graphs"
];

/** Fisher–Yates shuffle. Returns a new array; does not mutate input. */
export function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Normalize a numeric answer string for comparison. */
export function normalizeNumeric(v) {
  if (v === null || v === undefined) return "";
  const s = String(v).trim().replace(/\s+/g, "").replace(/,/g, "");
  if (s === "") return "";
  // If it parses as a finite number, return canonical numeric form.
  const n = Number(s);
  if (Number.isFinite(n)) {
    // Drop trailing zeros after decimal.
    return String(n);
  }
  // Fallback: compare as lowercased stripped string (e.g., "3/4", "x=5")
  return s.toLowerCase();
}

/** Check whether the user's answer matches the correct answer for a question. */
export function isCorrect(question, userAnswer) {
  if (userAnswer === null || userAnswer === undefined || userAnswer === "") return false;
  if (question.inputType === "numeric") {
    return normalizeNumeric(userAnswer) === normalizeNumeric(question.correctAnswer);
  }
  // multiple-choice: correctAnswer is the index of the correct choice (0..n-1)
  return Number(userAnswer) === Number(question.correctAnswer);
}

/** Build a quiz set from a pool, optionally filtered by category. */
export function buildQuiz(pool, { category = "all", count = 10, rng = Math.random } = {}) {
  const filtered = category === "all" ? pool : pool.filter(q => q.category === category);
  const shuffled = shuffle(filtered, rng);
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

/** Compute overall and per-category stats from an answered quiz. */
export function scoreQuiz(questions, answers) {
  let correct = 0;
  const byCategory = {};
  const missed = [];
  questions.forEach((q, i) => {
    const userAns = answers[i];
    const ok = isCorrect(q, userAns);
    if (!byCategory[q.category]) byCategory[q.category] = { correct: 0, total: 0 };
    byCategory[q.category].total += 1;
    if (ok) {
      correct += 1;
      byCategory[q.category].correct += 1;
    } else {
      missed.push({ question: q, userAnswer: userAns });
    }
  });
  return {
    total: questions.length,
    correct,
    incorrect: questions.length - correct,
    percent: questions.length === 0 ? 0 : Math.round((correct / questions.length) * 100),
    byCategory,
    missed
  };
}

/** Format seconds as mm:ss. */
export function formatTime(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

/** Pretty label for a choice index: 0 → "A", 1 → "B", ... */
export function choiceLetter(i) {
  return String.fromCharCode(65 + i);
}
