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

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Deterministic pseudo-random for shuffle tests.
function seededRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

test("shuffle preserves elements and does not mutate input", () => {
  const input = [1, 2, 3, 4, 5];
  const out = shuffle(input, seededRng(42));
  assert.equal(out.length, input.length);
  assert.deepEqual([...out].sort(), [...input].sort());
  assert.deepEqual(input, [1, 2, 3, 4, 5], "input should not be mutated");
});

test("normalizeNumeric strips whitespace, commas, and canonicalizes", () => {
  assert.equal(normalizeNumeric("  1,200 "), "1200");
  assert.equal(normalizeNumeric("3.50"), "3.5");
  assert.equal(normalizeNumeric("0"), "0");
  assert.equal(normalizeNumeric(""), "");
  assert.equal(normalizeNumeric(null), "");
  // Non-numeric falls back to lowercased trimmed string.
  assert.equal(normalizeNumeric(" X=5 "), "x=5");
});

test("isCorrect — multiple choice", () => {
  const q = {
    inputType: "multiple-choice",
    choices: ["a", "b", "c"],
    correctAnswer: 1
  };
  assert.equal(isCorrect(q, 1), true);
  assert.equal(isCorrect(q, "1"), true, "accepts numeric string");
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
    { id: "a", category: "geometry" },
    { id: "b", category: "geometry" },
    { id: "c", category: "algebra basics" },
    { id: "d", category: "geometry" }
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
  const answers = ["5", "9", 1]; // 1 of 2 geometry, 0 of 1 algebra
  const res = scoreQuiz(questions, answers);
  assert.equal(res.total, 3);
  assert.equal(res.correct, 1);
  assert.equal(res.incorrect, 2);
  assert.equal(res.percent, 33);
  assert.equal(res.byCategory["geometry"].correct, 1);
  assert.equal(res.byCategory["geometry"].total, 2);
  assert.equal(res.byCategory["algebra basics"].correct, 0);
  assert.equal(res.byCategory["algebra basics"].total, 1);
  assert.equal(res.missed.length, 2);
});

test("formatTime formats mm:ss with padding", () => {
  assert.equal(formatTime(0), "00:00");
  assert.equal(formatTime(5), "00:05");
  assert.equal(formatTime(65), "01:05");
  assert.equal(formatTime(125), "02:05");
});

test("choiceLetter maps indices to A/B/C/D...", () => {
  assert.equal(choiceLetter(0), "A");
  assert.equal(choiceLetter(3), "D");
});

test("question bank is valid: every question has required fields and a valid answer", () => {
  const raw = fs.readFileSync(path.join(__dirname, "..", "data", "questions.json"), "utf8");
  const questions = JSON.parse(raw);
  assert.ok(questions.length > 0, "bank should not be empty");
  const ids = new Set();
  for (const q of questions) {
    assert.ok(q.id && typeof q.id === "string", `missing id: ${JSON.stringify(q)}`);
    assert.ok(!ids.has(q.id), `duplicate id: ${q.id}`);
    ids.add(q.id);
    assert.ok(CATEGORIES.includes(q.category), `unknown category: ${q.category}`);
    assert.ok(q.question && q.explanation, `missing text: ${q.id}`);
    assert.ok(["easy", "medium", "hard"].includes(q.difficulty), `bad difficulty: ${q.id}`);
    if (q.inputType === "multiple-choice") {
      assert.ok(Array.isArray(q.choices) && q.choices.length >= 2, `bad choices: ${q.id}`);
      assert.ok(
        Number.isInteger(q.correctAnswer) && q.correctAnswer >= 0 && q.correctAnswer < q.choices.length,
        `bad correctAnswer index: ${q.id}`
      );
    } else if (q.inputType === "numeric") {
      assert.ok(q.correctAnswer !== undefined && q.correctAnswer !== "", `missing numeric answer: ${q.id}`);
    } else {
      assert.fail(`unknown inputType: ${q.inputType} (${q.id})`);
    }
  }
  // Ensure every category is represented.
  for (const c of CATEGORIES) {
    assert.ok(questions.some(q => q.category === c), `category missing questions: ${c}`);
  }
});
