# GED-BFF — GED Math Practice

A clean, lightweight web app for practicing GED-style math questions. Single-page, zero build step, zero runtime dependencies — just a tiny Node server that ships static files.

## Features

- **Practice mode** — one question at a time, instant feedback, plain-language explanations.
- **Timed test mode** — configurable length and time limit; score + per-category breakdown + missed-question review at the end.
- **Multiple choice _and_ numeric input** — both supported with tolerant answer matching (whitespace, commas, trailing zeros).
- **8 GED math categories** seeded in `data/questions.json`:
  basic arithmetic · fractions/decimals/percents · ratios and proportions · algebra basics · expressions and equations · geometry · word problems · data/graphs.
- **Mobile-first UI** — responsive layout, large tap targets, sticky top nav.

## Project layout

```
index.html            # app shell
styles.css            # responsive styling
app.js                # SPA: router, practice/test views, results
logic.js              # pure quiz helpers (shuffle, scoring, answer-check)
data/questions.json   # starter question bank (32 questions across 8 categories)
server.mjs            # zero-dep static dev server
test/logic.test.mjs   # node:test unit tests
```

## Run locally

Requires Node 18+.

```
npm run dev
```

Then open http://localhost:3000.

Set a different port with `PORT=4000 npm run dev`.

> Note: because the app loads `data/questions.json` via `fetch`, serve it via `npm run dev` rather than opening `index.html` directly from the filesystem.

## Run tests

```
npm test
```

Covers `shuffle`, `normalizeNumeric`, `isCorrect`, `buildQuiz`, `scoreQuiz`, `formatTime`, and a schema/integrity check over the whole question bank.

## Add questions

Edit `data/questions.json`. Each entry looks like:

```json
{
  "id": "ar-5",
  "category": "basic arithmetic",
  "difficulty": "medium",
  "inputType": "multiple-choice",
  "question": "What is 12 × 15?",
  "choices": ["160", "180", "150", "175"],
  "correctAnswer": 1,
  "explanation": "12 × 15 = 12 × (10 + 5) = 120 + 60 = 180."
}
```

Fields:

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | must be unique |
| `category` | string | one of the 8 categories above |
| `difficulty` | `"easy" \| "medium" \| "hard"` | |
| `inputType` | `"multiple-choice" \| "numeric"` | |
| `question` | string | prompt shown to the user |
| `choices` | string[] | required for multiple choice, omit for numeric |
| `correctAnswer` | number \| string | index (MC) or canonical answer (numeric) |
| `explanation` | string | shown after answering |

The test suite validates every question, so `npm test` will catch typos.

## What remains / ideas to extend

- Persist progress to `localStorage` (streaks, cumulative per-category stats).
- Expand the bank toward a full 100+ questions and add formula/diagram support.
- Optional TI-30XS-style calculator and simple graph rendering for data questions.
- Adaptive drills that re-serve categories where the user scored low.
