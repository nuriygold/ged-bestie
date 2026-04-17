// Minimal zero-dependency static file server for local development.
// Usage: `npm run dev` then open http://localhost:3000
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const FEATURE_FLAGS = {
  games: {
    mathChallenge: {
      enabled: true
    }
  }
};
const GAME_MODE_ENUM = new Set(["practice", "test", "speed", "time-attack", "survival"]);
const DIFFICULTY_ENUM = new Set(["easy", "medium", "hard", "mixed", "unknown"]);
const BRIDGE_VERSION_ENUM = new Set(["1.0"]);
const GAME_ID_ENUM = new Set(["math-challenge"]);
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
let supabaseClient;
let createSupabaseClientFn;

const gameSessions = [];
const gameEvents = [];
const learnerMetrics = new Map();

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8"
};

async function handleRequest(req, res) {
  try {
    const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (await handleGameApi(req, res, urlPath)) return;

    let filePath = path.join(__dirname, urlPath === "/" ? "/index.html" : urlPath);

    // Prevent path traversal
    if (!filePath.startsWith(__dirname)) {
      res.writeHead(403);
      return res.end("Forbidden");
    }

    let stat;
    try {
      stat = await fs.stat(filePath);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain" });
      return res.end("Not found");
    }
    if (stat.isDirectory()) filePath = path.join(filePath, "index.html");

    const ext = path.extname(filePath).toLowerCase();
    const data = await fs.readFile(filePath);
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": "no-cache"
    });
    res.end(data);
  } catch (err) {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("Server error: " + err.message);
  }
}

async function handleGameApi(req, res, urlPath) {
  const isGameRoute = urlPath.startsWith("/api/games/math-challenge/");
  if (!isGameRoute) return false;

  if (!FEATURE_FLAGS.games.mathChallenge.enabled) {
    writeJson(res, 404, { error: "Feature disabled", flag: "games.mathChallenge.enabled" });
    return true;
  }

  if (req.method !== "POST") {
    writeJson(res, 405, { error: "Method not allowed" });
    return true;
  }

  const userId = resolveUserId(req);
  if (!userId) {
    writeJson(res, 401, { error: "Unauthorized: missing authenticated user context" });
    return true;
  }

  const payload = await readJsonBody(req);
  if (urlPath.endsWith("/start")) {
    return handleStart(res, userId, payload);
  }
  if (urlPath.endsWith("/question")) {
    return handleQuestion(res, userId, payload);
  }
  if (urlPath.endsWith("/complete")) {
    return handleComplete(res, userId, payload);
  }

  writeJson(res, 404, { error: "Unknown game endpoint" });
  return true;
}

async function handleStart(res, userId, payload) {
  const errors = validateCommonPayload(payload);
  if (!payload?.sessionId) errors.push("sessionId is required");
  if (errors.length) {
    writeJson(res, 400, { error: "Invalid payload", details: errors });
    return true;
  }

  const session = {
    sessionId: payload.sessionId,
    userId,
    gameId: payload.gameId || "math-challenge",
    gameMode: payload.gameMode,
    difficulty: payload.difficulty || "unknown",
    category: payload.category || "all",
    questionCount: Number(payload.questionCount || 0),
    startedAt: payload.startedAt || new Date().toISOString(),
    completedAt: null,
    score: 0,
    correct: 0,
    incorrect: 0,
    accuracyPct: 0,
    maxStreak: 0,
    durationSec: 0
  };

  const existingIndex = gameSessions.findIndex(row => row.sessionId === session.sessionId);
  if (existingIndex >= 0) gameSessions[existingIndex] = session;
  else gameSessions.push(session);

  const persistence = await persistWithFallback(() => persistGameSessionStart(session));
  writeJson(res, 200, {
    ok: true,
    sessionId: session.sessionId,
    persistence
  });
  return true;
}

async function handleQuestion(res, userId, payload) {
  const errors = validateCommonPayload(payload);
  if (!payload?.sessionId) errors.push("sessionId is required");
  if (typeof payload?.questionNumber !== "number") errors.push("questionNumber must be a number");
  if (typeof payload?.isCorrect !== "boolean") errors.push("isCorrect must be boolean");
  if (typeof payload?.answerTimeSec !== "number") errors.push("answerTimeSec must be a number");
  if (errors.length) {
    writeJson(res, 400, { error: "Invalid payload", details: errors });
    return true;
  }

  const eventId = `evt-${payload.sessionId}-${payload.questionNumber}`;
  const event = {
    eventId,
    type: "question",
    receivedAt: new Date().toISOString(),
    userId,
    sessionId: payload.sessionId,
    questionNumber: payload.questionNumber,
    questionId: payload.questionId || null,
    userAnswer: payload.userAnswer ?? null,
    correctAnswer: payload.correctAnswer ?? null,
    isCorrect: payload.isCorrect,
    latencySec: payload.answerTimeSec,
    score: Number(payload.score || 0),
    streak: Number(payload.streak || 0),
    gameMode: payload.gameMode,
    difficulty: payload.difficulty || "unknown"
  };
  const existingEventIndex = gameEvents.findIndex((row) => row.eventId === eventId);
  if (existingEventIndex >= 0) gameEvents[existingEventIndex] = event;
  else gameEvents.push(event);

  const persistence = await persistWithFallback(() => persistGameEvent(event));
  writeJson(res, 200, {
    ok: true,
    eventId: event.eventId,
    persistence
  });
  return true;
}

async function handleComplete(res, userId, payload) {
  const errors = validateCommonPayload(payload);
  if (!payload?.sessionId) errors.push("sessionId is required");
  if (typeof payload?.score !== "number") errors.push("score must be a number");
  if (typeof payload?.accuracyPct !== "number") errors.push("accuracyPct must be a number");
  if (errors.length) {
    writeJson(res, 400, { error: "Invalid payload", details: errors });
    return true;
  }

  const session = gameSessions.find(row => row.sessionId === payload.sessionId && row.userId === userId);
  if (!session) {
    writeJson(res, 404, { error: "Session not found. Start endpoint must be called first." });
    return true;
  }

  Object.assign(session, {
    completedAt: payload.completedAt || new Date().toISOString(),
    score: payload.score,
    correct: Number(payload.correct || 0),
    incorrect: Number(payload.incorrect || 0),
    accuracyPct: payload.accuracyPct,
    maxStreak: Number(payload.maxStreak || 0),
    durationSec: Number(payload.durationSec || 0)
  });

  const metrics = learnerMetrics.get(userId) || {
    userId,
    attempts: 0,
    bestScore: 0,
    bestStreak: 0,
    avgAccuracyPct: 0,
    accuracyTrend: []
  };
  const attempts = metrics.attempts + 1;
  const avgAccuracyPct = Number((((metrics.avgAccuracyPct * metrics.attempts) + session.accuracyPct) / attempts).toFixed(2));
  const accuracyTrend = [...metrics.accuracyTrend.slice(-29), {
    sessionId: session.sessionId,
    completedAt: session.completedAt,
    accuracyPct: session.accuracyPct
  }];

  const nextMetrics = {
    ...metrics,
    attempts,
    bestScore: Math.max(metrics.bestScore, session.score),
    bestStreak: Math.max(metrics.bestStreak, session.maxStreak),
    avgAccuracyPct,
    accuracyTrend
  };
  learnerMetrics.set(userId, nextMetrics);

  const persistence = await persistWithFallback(async () => {
    await persistGameSessionComplete(session);
    await persistLearnerMetrics(nextMetrics);
  });
  writeJson(res, 200, {
    ok: true,
    session,
    learnerMetrics: nextMetrics,
    persistence
  });
  return true;
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function validateCommonPayload(payload) {
  const errors = [];
  if (!payload || typeof payload !== "object") return ["payload must be a JSON object"];

  const mode = String(payload.gameMode || "").toLowerCase();
  if (!GAME_MODE_ENUM.has(mode)) errors.push(`gameMode must be one of: ${[...GAME_MODE_ENUM].join(", ")}`);

  const difficulty = String(payload.difficulty || "unknown").toLowerCase();
  if (!DIFFICULTY_ENUM.has(difficulty)) {
    errors.push(`difficulty must be one of: ${[...DIFFICULTY_ENUM].join(", ")}`);
  }
  const gameId = String(payload.gameId || "").toLowerCase();
  if (!GAME_ID_ENUM.has(gameId)) errors.push(`gameId must be one of: ${[...GAME_ID_ENUM].join(", ")}`);
  if (!BRIDGE_VERSION_ENUM.has(String(payload.bridgeVersion || ""))) {
    errors.push(`bridgeVersion must be one of: ${[...BRIDGE_VERSION_ENUM].join(", ")}`);
  }
  if (payload.questionNumber !== undefined) {
    const questionNumber = Number(payload.questionNumber);
    if (!Number.isInteger(questionNumber) || questionNumber < 1) {
      errors.push("questionNumber must be an integer greater than 0");
    }
  }
  if (payload.accuracyPct !== undefined) {
    const accuracy = Number(payload.accuracyPct);
    if (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > 100) {
      errors.push("accuracyPct must be between 0 and 100");
    }
  }
  if (payload.durationSec !== undefined) {
    const durationSec = Number(payload.durationSec);
    if (!Number.isFinite(durationSec) || durationSec < 0) errors.push("durationSec must be >= 0");
  }
  if (payload.answerTimeSec !== undefined) {
    const answerTimeSec = Number(payload.answerTimeSec);
    if (!Number.isFinite(answerTimeSec) || answerTimeSec < 0) errors.push("answerTimeSec must be >= 0");
  }

  return errors;
}

function resolveUserId(req) {
  const headerUserId = req.headers["x-user-id"];
  if (headerUserId) return String(headerUserId).trim();

  const cookies = parseCookies(req.headers.cookie || "");
  if (cookies.userId) return cookies.userId;
  if (cookies.uid) return cookies.uid;

  return "";
}

function parseCookies(cookieHeader) {
  return cookieHeader.split(";").reduce((acc, pair) => {
    const [rawKey, ...rest] = pair.trim().split("=");
    if (!rawKey) return acc;
    acc[rawKey] = decodeURIComponent(rest.join("=") || "");
    return acc;
  }, {});
}

function writeJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-cache"
  });
  res.end(JSON.stringify(body));
}

async function getSupabase() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  if (!createSupabaseClientFn) {
    try {
      const mod = await import("@supabase/supabase-js");
      createSupabaseClientFn = mod.createClient;
    } catch {
      return null;
    }
  }
  if (!supabaseClient) {
    supabaseClient = createSupabaseClientFn(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  }
  return supabaseClient;
}

async function persistWithFallback(persistOperation) {
  const isConfigured = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
  if (!isConfigured) {
    return {
      persisted: false,
      store: "memory",
      warnings: ["Supabase disabled: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY"]
    };
  }
  try {
    await persistOperation();
    return { persisted: true, store: "supabase", warnings: [] };
  } catch (err) {
    return {
      persisted: false,
      store: "memory",
      warnings: [err instanceof Error ? err.message : String(err)]
    };
  }
}

async function persistGameSessionStart(session) {
  const supabase = await getSupabase();
  if (!supabase) return;
  const { error } = await supabase.from("game_sessions").upsert({
    session_id: session.sessionId,
    user_id: session.userId,
    game_id: session.gameId,
    game_mode: session.gameMode,
    difficulty: session.difficulty,
    category: session.category,
    question_count: session.questionCount,
    started_at: session.startedAt
  }, { onConflict: "session_id" });
  if (error) throw error;
}

async function persistGameEvent(event) {
  const supabase = await getSupabase();
  if (!supabase) return;
  const { error } = await supabase.from("game_events").upsert({
    event_id: event.eventId,
    user_id: event.userId,
    session_id: event.sessionId,
    event_type: event.type,
    question_number: event.questionNumber,
    question_id: event.questionId,
    user_answer: event.userAnswer,
    correct_answer: event.correctAnswer,
    is_correct: event.isCorrect,
    latency_sec: event.latencySec,
    score: event.score,
    streak: event.streak,
    game_mode: event.gameMode,
    difficulty: event.difficulty,
    received_at: event.receivedAt
  }, { onConflict: "event_id" });
  if (error) throw error;
}

async function persistGameSessionComplete(session) {
  const supabase = await getSupabase();
  if (!supabase) return;
  const { error } = await supabase.from("game_sessions").upsert({
    session_id: session.sessionId,
    user_id: session.userId,
    completed_at: session.completedAt,
    score: session.score,
    correct: session.correct,
    incorrect: session.incorrect,
    accuracy_pct: session.accuracyPct,
    max_streak: session.maxStreak,
    duration_sec: session.durationSec
  }, { onConflict: "session_id" });
  if (error) throw error;
}

async function persistLearnerMetrics(metrics) {
  const supabase = await getSupabase();
  if (!supabase) return;
  const { error } = await supabase.from("learner_metrics").upsert({
    user_id: metrics.userId,
    attempts: metrics.attempts,
    best_score: metrics.bestScore,
    best_streak: metrics.bestStreak,
    avg_accuracy_pct: metrics.avgAccuracyPct,
    accuracy_trend: metrics.accuracyTrend
  }, { onConflict: "user_id" });
  if (error) throw error;
}

// Export a request handler so this file can run as a Vercel function.
export default function vercelHandler(req, res) {
  return handleRequest(req, res);
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isDirectRun) {
  const server = http.createServer(handleRequest);
  server.listen(PORT, () => {
    console.log(`ged-bff dev server -> http://localhost:${PORT}`);
  });
}
