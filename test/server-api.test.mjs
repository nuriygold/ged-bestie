import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const PORT = 3211;
const BASE = `http://127.0.0.1:${PORT}`;

function waitForServer(proc) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("server start timeout")), 10_000);
    proc.stdout.on("data", (chunk) => {
      if (String(chunk).includes(`http://localhost:${PORT}`)) {
        clearTimeout(timeout);
        resolve();
      }
    });
    proc.on("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`server exited early (${code})`));
    });
  });
}

let proc;

test.before(async () => {
  proc = spawn("node", ["server.mjs"], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"]
  });
  await waitForServer(proc);
});

test.after(() => {
  if (proc && !proc.killed) proc.kill("SIGTERM");
});

test("returns 401 without user context", async () => {
  const response = await fetch(`${BASE}/api/games/math-challenge/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({})
  });
  assert.equal(response.status, 401);
});

test("start -> question -> complete happy path with persistence metadata", async () => {
  const sessionId = `s-${Date.now()}`;
  const common = {
    gameId: "math-challenge",
    bridgeVersion: "1.0",
    gameMode: "practice",
    difficulty: "mixed"
  };
  const headers = {
    "Content-Type": "application/json",
    "x-user-id": "test-user-1"
  };

  const startRes = await fetch(`${BASE}/api/games/math-challenge/start`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      ...common,
      sessionId,
      category: "all",
      questionCount: 10,
      startedAt: new Date().toISOString()
    })
  });
  assert.equal(startRes.status, 200);
  const startJson = await startRes.json();
  assert.equal(startJson.ok, true);
  assert.equal(startJson.sessionId, sessionId);
  assert.equal(typeof startJson.persistence?.persisted, "boolean");

  const questionRes = await fetch(`${BASE}/api/games/math-challenge/question`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      ...common,
      sessionId,
      questionNumber: 1,
      isCorrect: true,
      answerTimeSec: 1.25,
      score: 1,
      streak: 1
    })
  });
  assert.equal(questionRes.status, 200);
  const questionJson = await questionRes.json();
  assert.equal(questionJson.ok, true);
  assert.match(questionJson.eventId, /^evt-/);

  const completeRes = await fetch(`${BASE}/api/games/math-challenge/complete`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      ...common,
      sessionId,
      score: 1,
      correct: 1,
      incorrect: 0,
      accuracyPct: 100,
      maxStreak: 1,
      durationSec: 5,
      completedAt: new Date().toISOString()
    })
  });
  assert.equal(completeRes.status, 200);
  const completeJson = await completeRes.json();
  assert.equal(completeJson.ok, true);
  assert.equal(completeJson.session.sessionId, sessionId);
  assert.equal(completeJson.learnerMetrics.attempts >= 1, true);
});

test("rejects invalid payload ranges", async () => {
  const response = await fetch(`${BASE}/api/games/math-challenge/complete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-user-id": "test-user-2"
    },
    body: JSON.stringify({
      gameId: "math-challenge",
      bridgeVersion: "1.0",
      gameMode: "practice",
      difficulty: "mixed",
      sessionId: "missing-start-session",
      score: 2,
      accuracyPct: 101
    })
  });

  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error, "Invalid payload");
});
