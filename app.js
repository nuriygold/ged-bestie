// GED-BFF client app. Single-file SPA using a tiny hash-free view switcher.
import {
  CATEGORIES,
  buildQuiz,
  choiceLetter,
  formatTime,
  isCorrect,
  scoreQuiz
} from "./logic.js";

import {
  applyAnswer,
  xpToNextLevel,
  levelTitle,
  evaluateBadges,
  finalizeSession,
  createProfile,
  readinessScore,
  masteryTier
} from "./profile.js";

import { loadProfile, saveProfile } from "./storage.js";

const FOOTER_TAGLINES = [
  "Locked in today. Levels up tomorrow.",
  "You got main character study energy.",
  "That focus is elite. Keep cooking.",
  "Calm brain, sharp moves, big score.",
  "You are building real test-day confidence.",
  "Discipline looks good on you, bro.",
  "One more rep. One more win.",
  "GED-BFF says: you are colder than the clock.",
  "No cap, you are built different.",
  "W grind. Stay dangerous.",
  "Bro ate that question and left no crumbs.",
  "That answer was sending — pure ice.",
  "You are lowkey a math legend.",
  "Zero doubts. Just reps.",
  "Slay the test. Crown yourself."
];

const ACRONYM_BY_CATEGORY = {
  "basic arithmetic": {
    label: "PEMDAS",
    meaning: "Parentheses, Exponents, Multiply/Divide, Add/Subtract"
  },
  "fractions/decimals/percents": {
    label: "KCF",
    meaning: "Keep, Change, Flip for fraction division"
  },
  "ratios and proportions": {
    label: "X-MULTIPLY",
    meaning: "Cross-multiply to solve proportions"
  },
  "algebra basics": {
    label: "ISOLATE",
    meaning: "Inverse operations to get the variable alone"
  },
  "expressions and equations": {
    label: "DISTRIBUTE",
    meaning: "Distribute, combine like terms, then solve"
  },
  geometry: {
    label: "DRAW",
    meaning: "Draw the shape, label values, write the formula"
  },
  "word problems": {
    label: "RUPS",
    meaning: "Read, Underline, Plan, Solve"
  },
  "data/graphs": {
    label: "CATS",
    meaning: "Check Chart, Axes, Trend, Summary"
  }
};

let footerRotationHandle = null;

// ---------------- State ----------------
const state = {
  questions: [],        // full loaded bank
  mode: null,           // "practice" | "test"
  quiz: [],             // current quiz questions
  answers: [],          // user answers aligned with quiz
  index: 0,
  revealed: false,      // whether feedback has been shown for current question (practice mode)
  timer: {
    enabled: false,
    total: 0,
    remaining: 0,
    handle: null
  },
  settings: {
    category: "all",
    count: 10,
    timeMinutes: 15
  },
  profile: null         // loaded from localStorage via storage.js
};

const app = document.getElementById("app");

// ---------------- Nav wiring ----------------
document.querySelectorAll("[data-nav]").forEach(btn => {
  btn.addEventListener("click", () => navigate(btn.dataset.nav));
});

document.querySelectorAll("[data-tool]").forEach(btn => {
  btn.addEventListener("click", () => {
    const tool = btn.dataset.tool;
    if (tool === "calc") openCalc();
    else if (tool === "formulas") openFormulas();
  });
});

// Close modal when backdrop or ✕ button is clicked (event delegation on root).
document.getElementById("modal-root")?.addEventListener("click", e => {
  if (e.target.closest("[data-close]")) closeModal();
});

function navigate(view) {
  clearTimer();
  switch (view) {
    case "home": return renderHome();
    case "practice-setup": return renderSetup("practice");
    case "test-setup": return renderSetup("test");
    default: return renderHome();
  }
}

// ---------------- Data load ----------------
async function loadQuestions() {
  const res = await fetch("./data/questions.json", { cache: "no-cache" });
  if (!res.ok) throw new Error("Failed to load question bank");
  return res.json();
}

// ---------------- Views ----------------
function renderHome() {
  const total = state.questions.length;
  const catCounts = CATEGORIES.map(c => ({
    cat: c,
    n: state.questions.filter(q => q.category === c).length
  }));

  const p = state.profile;
  const lvlInfo = xpToNextLevel(p.xp || 0);
  const lvl = lvlInfo.level;
  const title = levelTitle(lvl);
  const readiness = readinessScore(p);

  const masteryRows = CATEGORIES.map(c => {
    const data = p.byCategory?.[c] || { mastery: 0 };
    const tier = masteryTier(data.mastery);
    return `
      <div class="mastery-row">
        <span class="name">${escapeHtml(c)}</span>
        <span class="pct" style="color:${tier.color}">${data.mastery}%</span>
        <div class="bar"><span style="width:${data.mastery}%;background:${tier.color}"></span></div>
      </div>`;
  }).join("");

  app.innerHTML = `
    <section class="card hero">
      <h1>Welcome back, GED-BFF 👋</h1>
      <div class="stat-row">
        <div class="stat"><div class="num">Lvl ${lvl}</div><div class="lbl">${escapeHtml(title)}</div></div>
        <div class="stat"><div class="num">${p.totalAnswered || 0}</div><div class="lbl">Answered</div></div>
        <div class="stat"><div class="num">${p.dailyStreak || 0}</div><div class="lbl">Day streak 🔥</div></div>
        <div class="stat"><div class="num">${readiness}%</div><div class="lbl">Readiness</div></div>
      </div>
      <div class="xp-wrap">
        <div class="xp-head">
          <span>XP <strong>${p.xp || 0}</strong></span>
          <span>${lvlInfo.remainingXp} XP to level ${lvl + 1}</span>
        </div>
        <div class="xp-bar"><span style="width:${lvlInfo.percent}%"></span></div>
      </div>
    </section>

    <section class="card">
      <h2>Choose a mode</h2>
      <div class="tile-grid">
        <button class="tile" data-go="practice-setup">
          <h3>📘 Start Practice</h3>
          <p>One question at a time with instant feedback and explanations.</p>
        </button>
        <button class="tile" data-go="test-setup">
          <h3>⏱️ Start Timed Test</h3>
          <p>Answer a set of questions against the clock, then review your score.</p>
        </button>
      </div>
    </section>

    <section class="card">
      <h2>Mastery by category</h2>
      <div class="mastery-list">${masteryRows}</div>
    </section>

    <section class="card">
      <h2>Question bank</h2>
      <p class="muted">${total} questions loaded across ${CATEGORIES.length} categories.</p>
      <table class="cat-table">
        <thead><tr><th>Category</th><th>Questions</th></tr></thead>
        <tbody>
          ${catCounts.map(r => `<tr><td>${escapeHtml(r.cat)}</td><td>${r.n}</td></tr>`).join("")}
        </tbody>
      </table>
    </section>
  `;
  app.querySelectorAll("[data-go]").forEach(el =>
    el.addEventListener("click", () => navigate(el.dataset.go))
  );
}

function renderSetup(mode) {
  state.mode = mode;
  const title = mode === "practice" ? "Practice setup" : "Test setup";
  const catCounts = CATEGORIES.map(c => ({
    cat: c,
    n: state.questions.filter(q => q.category === c).length
  }));
  const maxForAll = state.questions.length;

  app.innerHTML = `
    <section class="card">
      <h1>${title}</h1>
      <p class="muted">${
        mode === "practice"
          ? "Work through questions at your own pace with instant explanations."
          : "A timed quiz. You'll see your score and review missed questions at the end."
      }</p>

      <label for="cat">Category</label>
      <select id="cat">
        <option value="all">All categories (${maxForAll})</option>
        ${catCounts.map(r => `<option value="${escapeAttr(r.cat)}">${escapeHtml(r.cat)} (${r.n})</option>`).join("")}
      </select>

      <div class="row" style="margin-top:12px">
        <div>
          <label for="count">Number of questions</label>
          <input id="count" type="number" min="1" max="${maxForAll}" value="${Math.min(10, maxForAll)}" />
        </div>
        ${mode === "test" ? `
        <div>
          <label for="mins">Time limit (minutes)</label>
          <input id="mins" type="number" min="1" max="180" value="${state.settings.timeMinutes}" />
        </div>
        ` : ""}
      </div>

      <div class="btn-row" style="margin-top:18px">
        <button class="btn primary" id="start">Start</button>
        <button class="btn ghost" data-go="home">Cancel</button>
      </div>
    </section>
  `;

  app.querySelector("[data-go='home']").addEventListener("click", () => navigate("home"));
  app.querySelector("#start").addEventListener("click", () => {
    const category = app.querySelector("#cat").value;
    const count = Math.max(1, Math.min(maxForAll, parseInt(app.querySelector("#count").value, 10) || 10));
    const timeMinutes = mode === "test"
      ? Math.max(1, parseInt(app.querySelector("#mins").value, 10) || 15)
      : 0;
    startQuiz({ mode, category, count, timeMinutes });
  });
}

function startQuiz({ mode, category, count, timeMinutes }) {
  state.settings = { category, count, timeMinutes };
  state.mode = mode;
  state.quiz = buildQuiz(state.questions, { category, count });
  state.answers = new Array(state.quiz.length).fill(null);
  state.index = 0;
  state.revealed = false;

  if (mode === "test") {
    state.timer = {
      enabled: true,
      total: timeMinutes * 60,
      remaining: timeMinutes * 60,
      handle: null
    };
    startTimer();
  } else {
    state.timer = { enabled: false, total: 0, remaining: 0, handle: null };
  }
  renderQuestion();
}

function renderQuestion() {
  const q = state.quiz[state.index];
  if (!q) return renderResults();

  const progressPct = Math.round(((state.index) / state.quiz.length) * 100);
  const timerHtml = state.timer.enabled
    ? `<span class="timer" id="timer">${formatTime(state.timer.remaining)}</span>`
    : "";

  app.innerHTML = `
    <section class="card">
      <div class="progress">
        <span>Question ${state.index + 1} of ${state.quiz.length}</span>
        ${timerHtml}
      </div>
      <div class="progress-bar"><span style="width:${progressPct}%"></span></div>

      <div class="q-cat">${escapeHtml(q.category)} · ${escapeHtml(q.difficulty || "")}</div>
      <div class="q-text">${escapeHtml(q.question)}</div>

      ${renderAnswerControls(q)}

      <div id="feedback-slot"></div>

      <div class="btn-row">
        ${renderNavButtons()}
      </div>
    </section>
  `;

  wireAnswerControls();
  wireNavButtons();

  // Practice mode: if already revealed (user navigated back), redisplay feedback.
  if (state.mode === "practice" && state.revealed) {
    showFeedback(q, state.answers[state.index]);
  }
}

function renderAnswerControls(q) {
  if (q.inputType === "numeric") {
    const cur = state.answers[state.index] ?? "";
    const disabled = state.revealed ? "disabled" : "";
    return `
      <div class="numeric-wrap">
        <label for="numans">Your answer</label>
        <input id="numans" type="text" inputmode="decimal" autocomplete="off"
               placeholder="Enter your answer" value="${escapeAttr(cur)}" ${disabled} />
      </div>
    `;
  }
  // multiple-choice
  const selected = state.answers[state.index];
  return `
    <div class="choices" role="radiogroup">
      ${q.choices.map((c, i) => {
        const isSel = selected === i;
        const cls = ["choice"];
        if (isSel) cls.push("selected");
        return `
          <button class="${cls.join(" ")}" role="radio" aria-checked="${isSel}" data-choice="${i}" ${state.revealed ? "disabled" : ""}>
            <span class="letter">${choiceLetter(i)}</span>
            <span>${escapeHtml(c)}</span>
          </button>`;
      }).join("")}
    </div>
  `;
}

function wireAnswerControls() {
  const q = state.quiz[state.index];
  if (q.inputType === "numeric") {
    const input = app.querySelector("#numans");
    if (input) {
      input.addEventListener("input", e => {
        state.answers[state.index] = e.target.value;
        updateNavDisabled();
      });
      input.addEventListener("keydown", e => {
        if (e.key === "Enter") {
          e.preventDefault();
          onPrimaryAction();
        }
      });
    }
  } else {
    app.querySelectorAll("[data-choice]").forEach(btn => {
      btn.addEventListener("click", () => {
        if (state.revealed) return;
        state.answers[state.index] = Number(btn.dataset.choice);
        // Update visual selection without a full re-render.
        app.querySelectorAll(".choice").forEach(el => el.classList.remove("selected"));
        btn.classList.add("selected");
        updateNavDisabled();
      });
    });
  }
}

function renderNavButtons() {
  const last = state.index === state.quiz.length - 1;
  const prevDisabled = state.index === 0 ? "disabled" : "";
  const primaryLabel =
    state.mode === "practice"
      ? (state.revealed ? (last ? "Finish" : "Next →") : "Check answer")
      : (last ? "Submit test" : "Next →");

  return `
    <button class="btn" id="prev" ${prevDisabled}>← Previous</button>
    <button class="btn primary" id="primary">${primaryLabel}</button>
    ${state.mode === "test" ? `<button class="btn ghost" id="end">End test</button>` : ""}
  `;
}

function wireNavButtons() {
  app.querySelector("#prev")?.addEventListener("click", () => {
    if (state.index === 0) return;
    state.index -= 1;
    state.revealed = false; // practice-mode: don't carry reveal across navigation
    renderQuestion();
  });
  app.querySelector("#primary")?.addEventListener("click", onPrimaryAction);
  app.querySelector("#end")?.addEventListener("click", () => {
    if (confirm("End the test and see your score?")) renderResults();
  });
  updateNavDisabled();
}

function updateNavDisabled() {
  const primary = app.querySelector("#primary");
  if (!primary) return;
  const ans = state.answers[state.index];
  const answered = ans !== null && ans !== undefined && ans !== "";
  // In practice mode before reveal, require an answer to check.
  // In practice mode after reveal, allow Next/Finish always.
  // In test mode, allow navigating Next even without answer (skipping).
  if (state.mode === "practice" && !state.revealed) {
    primary.disabled = !answered;
  } else {
    primary.disabled = false;
  }
}

function onPrimaryAction() {
  const q = state.quiz[state.index];
  const last = state.index === state.quiz.length - 1;
  const ans = state.answers[state.index];

  if (state.mode === "practice") {
    if (!state.revealed) {
      if (ans === null || ans === undefined || ans === "") return;
      state.revealed = true;
      // Re-render so inputs become disabled & buttons relabel, then show feedback.
      renderQuestion();
      showFeedback(q, ans);
      return;
    }
    // Already revealed → move on
    if (last) return renderResults();
    state.index += 1;
    state.revealed = false;
    renderQuestion();
    return;
  }

  // Test mode: advance without feedback; submit on last.
  if (last) return renderResults();
  state.index += 1;
  renderQuestion();
}

function showFeedback(q, userAns) {
  const correct = isCorrect(q, userAns);
  const slot = app.querySelector("#feedback-slot");
  if (!slot) return;

  // Highlight choices in multiple choice.
  if (q.inputType === "multiple-choice") {
    app.querySelectorAll("[data-choice]").forEach(btn => {
      const i = Number(btn.dataset.choice);
      btn.classList.remove("selected");
      if (i === q.correctAnswer) btn.classList.add("correct");
      else if (i === Number(userAns)) btn.classList.add("incorrect");
    });
  }

  const correctText = q.inputType === "numeric"
    ? q.correctAnswer
    : `${choiceLetter(q.correctAnswer)}) ${q.choices[q.correctAnswer]}`;
  const walkthroughHtml = correct
    ? ""
    : renderWalkthroughGraphic({
        question: q,
        userAnswer: userAns,
        correctText,
        animated: true
      });

  slot.innerHTML = `
    <div class="feedback ${correct ? "ok" : "bad"}">
      <h4>${correct ? "✅ Correct!" : "❌ Not quite."}</h4>
      ${correct ? "" : `<div><strong>Correct answer:</strong> ${escapeHtml(String(correctText))}</div>`}
      <div class="expl" style="margin-top:6px">${escapeHtml(q.explanation || "")}</div>
      ${walkthroughHtml}
    </div>
  `;

  // Update profile — XP, mastery, streaks, badges.
  const prevLvl = xpToNextLevel(state.profile.xp || 0).level;
  const { profile: p2, xpGained } = applyAnswer(state.profile, q, correct);
  const newLvl = xpToNextLevel(p2.xp).level;
  const { profile: p3, newlyEarned } = evaluateBadges(p2, { hourOfDay: new Date().getHours() });
  state.profile = p3;
  saveProfile(state.profile);

  // XP toast
  if (correct) {
    showToast({ title: `+${xpGained} XP`, body: "Keep stacking wins, bro!", gold: true });
  }

  // Level-up toast
  if (newLvl > prevLvl) {
    showToast({ title: `🎉 Level ${newLvl} unlocked!`, body: `You are now a ${levelTitle(newLvl)}`, gold: true });
    launchConfetti();
  }

  // Badge toasts
  for (const badge of newlyEarned) {
    showToast({ title: `${badge.icon} Badge: ${badge.name}`, body: badge.description });
  }
}

// ---------------- Results ----------------
function renderResults() {
  clearTimer();
  const result = scoreQuiz(state.quiz, state.answers);

  // In test mode, apply unanswered questions to profile stats.
  if (state.mode === "test") {
    let p = state.profile;
    state.quiz.forEach((q, i) => {
      const ans = state.answers[i];
      if (ans === null || ans === undefined || ans === "") return; // skipped
      const correct = isCorrect(q, ans);
      ({ profile: p } = applyAnswer(p, q, correct));
    });
    const { profile: p2, newlyEarned } = evaluateBadges(p, { hourOfDay: new Date().getHours() });
    p = finalizeSession(p2, {
      mode: state.mode,
      total: result.total,
      correct: result.correct,
      percent: result.percent
    });
    state.profile = p;
    saveProfile(state.profile);
    for (const badge of newlyEarned) {
      showToast({ title: `${badge.icon} Badge: ${badge.name}`, body: badge.description });
    }
  } else {
    // Practice mode: finalize session streak / history.
    const p = finalizeSession(state.profile, {
      mode: state.mode,
      total: result.total,
      correct: result.correct,
      percent: result.percent
    });
    state.profile = p;
    saveProfile(state.profile);
  }

  if (result.percent === 100) {
    launchConfetti();
    showToast({ title: "💯 Perfect score! Insane.", body: "You are cold as ice fr.", gold: true });
  } else if (result.percent >= 80) {
    showToast({ title: `${result.percent}% — W session`, body: "GED-BFF is proud of you.", gold: true });
  }

  const catRows = Object.entries(result.byCategory)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([cat, r]) => {
      const pct = Math.round((r.correct / r.total) * 100);
      return `<tr><td>${escapeHtml(cat)}</td><td>${r.correct}/${r.total}</td><td>${pct}%</td></tr>`;
    }).join("");

  const missedHtml = result.missed.length === 0
    ? `<p class="muted">Nothing missed — nice work! 🎉</p>`
    : result.missed.map(({ question: q, userAnswer }) => {
        const correctText = q.inputType === "numeric"
          ? q.correctAnswer
          : `${choiceLetter(q.correctAnswer)}) ${q.choices[q.correctAnswer]}`;
        const userText = formatUserAnswer(q, userAnswer);
        return `
          <div class="miss-item">
            <div class="q-cat">${escapeHtml(q.category)}</div>
            <div class="q">${escapeHtml(q.question)}</div>
            <div class="ans"><span class="lbl">Your answer:</span>${escapeHtml(userText)}</div>
            <div class="ans"><span class="lbl">Correct:</span>${escapeHtml(String(correctText))}</div>
            <div class="expl">${escapeHtml(q.explanation || "")}</div>
            ${renderWalkthroughGraphic({
              question: q,
              userAnswer,
              correctText,
              animated: false
            })}
          </div>`;
      }).join("");

  app.innerHTML = `
    <section class="card">
      <h1>Your results</h1>
      <div class="score-big">${result.percent}%</div>
      <p class="muted">${result.correct} correct out of ${result.total} · ${result.incorrect} missed${
        state.mode === "test" && state.timer.total > 0
          ? ` · time used ${formatTime(state.timer.total - state.timer.remaining)}`
          : ""
      }</p>

      <div class="btn-row" style="margin-top:14px">
        <button class="btn primary" id="again">Try another</button>
        <button class="btn" data-go="home">Home</button>
      </div>
    </section>

    <section class="card">
      <h2>By category</h2>
      <table class="cat-table">
        <thead><tr><th>Category</th><th>Score</th><th>Percent</th></tr></thead>
        <tbody>${catRows}</tbody>
      </table>
    </section>

    <section class="card">
      <h2>Missed questions</h2>
      ${missedHtml}
    </section>
  `;

  app.querySelector("[data-go='home']").addEventListener("click", () => navigate("home"));
  app.querySelector("#again").addEventListener("click", () =>
    navigate(state.mode === "test" ? "test-setup" : "practice-setup")
  );
}

function formatUserAnswer(q, userAns) {
  if (userAns === null || userAns === undefined || userAns === "") return "(skipped)";
  if (q.inputType === "numeric") return String(userAns);
  const i = Number(userAns);
  if (Number.isNaN(i) || !q.choices[i]) return "(skipped)";
  return `${choiceLetter(i)}) ${q.choices[i]}`;
}

function getAcronymHint(category) {
  return ACRONYM_BY_CATEGORY[category] || {
    label: "STEP-UP",
    meaning: "Scan, Translate, Equation, Plug in"
  };
}

function buildWalkthroughSteps({ question, userAnswer, correctText }) {
  const hint = getAcronymHint(question.category);
  const userText = formatUserAnswer(question, userAnswer);
  const setupLine = question.inputType === "numeric"
    ? "Write the equation from the words, then plug in the known numbers."
    : "Eliminate weak choices first, then verify the last best choice."

  return [
    `Acronym check: ${hint.label} = ${hint.meaning}`,
    `Set it up: ${setupLine}`,
    `Student attempt: ${userText}`,
    `Correct result: ${correctText}`,
    "Coach note: slow down on setup, then re-check units/signs before final answer."
  ];
}

function renderWalkthroughGraphic({ question, userAnswer, correctText, animated }) {
  const steps = buildWalkthroughSteps({ question, userAnswer, correctText });
  const cls = animated ? "walkthrough handwriting" : "walkthrough";

  return `
    <div class="${cls}" aria-label="Step-by-step walkthrough">
      <div class="walk-title">✏ Pencil walkthrough</div>
      <div class="walk-board">
        <div class="pencil" aria-hidden="true">✏</div>
        ${steps.map((step, i) => `
          <p class="hand-line" style="--i:${i}"><span>${escapeHtml(step)}</span></p>
        `).join("")}
      </div>
    </div>
  `;
}

// ---------------- Modal ----------------
function openModal(html) {
  const root = document.getElementById("modal-root");
  const content = document.getElementById("modal-content");
  if (!root || !content) return;
  content.innerHTML = html;
  root.classList.remove("hidden");
}

function closeModal() {
  document.getElementById("modal-root")?.classList.add("hidden");
}

// ---------------- Toast ----------------
function showToast({ title, body = "", gold = false }) {
  const stack = document.getElementById("toast-stack");
  if (!stack) return;
  const el = document.createElement("div");
  el.className = "toast" + (gold ? " gold" : "");
  el.innerHTML = `<div class="title">${escapeHtml(title)}</div>${body ? `<div class="body">${escapeHtml(body)}</div>` : ""}`;
  stack.appendChild(el);
  setTimeout(() => el.remove(), 3800);
}

// ---------------- Confetti ----------------
function launchConfetti() {
  const canvas = document.getElementById("confetti");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const colors = ["#4a90e2", "#7b61ff", "#f4b324", "#2ea66b", "#ff77a9", "#ff6b35"];
  const particles = Array.from({ length: 90 }, () => ({
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height - canvas.height,
    r: Math.random() * 6 + 3,
    d: Math.random() * 120,
    color: colors[Math.floor(Math.random() * colors.length)],
    tiltAngle: 0,
    tiltAngleInc: Math.random() * 0.07 + 0.05
  }));

  let frame = 0;

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach(p => {
      p.tiltAngle += p.tiltAngleInc;
      p.y += (Math.cos(p.d) + 2 + p.r / 2) * 0.6;
      const tilt = Math.sin(p.tiltAngle) * 12;
      ctx.beginPath();
      ctx.lineWidth = p.r;
      ctx.strokeStyle = p.color;
      ctx.moveTo(p.x + tilt + p.r / 3, p.y);
      ctx.lineTo(p.x + tilt, p.y + tilt + p.r / 5);
      ctx.stroke();
    });
    frame++;
    if (frame < 200) {
      requestAnimationFrame(draw);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  requestAnimationFrame(draw);
}

// ---------------- Calculator ----------------
const MAX_CALC_DIGITS = 15;

function openCalc() {
  openModal(`
    <h2 style="margin:0 0 12px">🧮 Calculator</h2>
    <div class="calc-display" id="calc-display">0</div>
    <div class="calc-keys">
      <button class="clr" data-calc="C">C</button>
      <button class="op"  data-calc="±">±</button>
      <button class="op"  data-calc="%">%</button>
      <button class="op"  data-calc="/">÷</button>
      <button data-calc="7">7</button>
      <button data-calc="8">8</button>
      <button data-calc="9">9</button>
      <button class="op"  data-calc="*">×</button>
      <button data-calc="4">4</button>
      <button data-calc="5">5</button>
      <button data-calc="6">6</button>
      <button class="op"  data-calc="-">−</button>
      <button data-calc="1">1</button>
      <button data-calc="2">2</button>
      <button data-calc="3">3</button>
      <button class="op"  data-calc="+">+</button>
      <button data-calc="0" style="grid-column:span 2">0</button>
      <button data-calc=".">.</button>
      <button class="eq"  data-calc="=">=</button>
    </div>
  `);

  let cs = { display: "0", first: null, op: null, waiting: false };
  const disp = document.getElementById("calc-display");

  document.getElementById("modal-content").querySelectorAll("[data-calc]").forEach(btn => {
    btn.addEventListener("click", () => {
      cs = handleCalcKey(cs, btn.dataset.calc);
      disp.textContent = cs.display;
    });
  });
}

function handleCalcKey(s, key) {
  if (key === "C") return { display: "0", first: null, op: null, waiting: false };
  if (key === "±") return { ...s, display: String(parseFloat(s.display) * -1 || 0) };
  if (key === "%") return { ...s, display: String(parseFloat(s.display) / 100) };

  if (["+", "-", "*", "/"].includes(key)) {
    return { display: s.display, first: parseFloat(s.display), op: key, waiting: true };
  }

  if (key === "=") {
    if (s.op === null || s.first === null) return s;
    const second = parseFloat(s.display);
    let result;
    switch (s.op) {
      case "+": result = s.first + second; break;
      case "-": result = s.first - second; break;
      case "*": result = s.first * second; break;
      case "/": result = second === 0 ? "Error" : s.first / second; break;
      default: result = second;
    }
    const str = typeof result === "string" ? result : Number(result.toFixed(10)).toString();
    return { display: str, first: null, op: null, waiting: false };
  }

  if (key === ".") {
    if (s.waiting) return { ...s, display: "0.", waiting: false };
    if (s.display.includes(".")) return s;
    return { ...s, display: s.display + "." };
  }

  // digit key
  if (s.waiting) return { ...s, display: key, waiting: false };
  const next = s.display === "0" ? key : s.display + key;
  return { ...s, display: next.slice(0, MAX_CALC_DIGITS) };
}

// ---------------- Formula Sheet ----------------
function openFormulas() {
  openModal(`
    <h2 style="margin:0 0 12px">📐 Formula Sheet</h2>
    <div class="formula-group">
      <h3>Geometry</h3>
      <ul class="formula-list">
        <li><span class="name">Rectangle area</span>      <span class="formula">A = l × w</span></li>
        <li><span class="name">Triangle area</span>       <span class="formula">A = ½bh</span></li>
        <li><span class="name">Circle area</span>         <span class="formula">A = πr²</span></li>
        <li><span class="name">Circumference</span>       <span class="formula">C = 2πr</span></li>
        <li><span class="name">Pythagorean theorem</span> <span class="formula">a² + b² = c²</span></li>
        <li><span class="name">Cube volume</span>         <span class="formula">V = s³</span></li>
        <li><span class="name">Cylinder volume</span>     <span class="formula">V = πr²h</span></li>
      </ul>
    </div>
    <div class="formula-group">
      <h3>Algebra</h3>
      <ul class="formula-list">
        <li><span class="name">Slope</span>               <span class="formula">m = (y₂−y₁)/(x₂−x₁)</span></li>
        <li><span class="name">Slope-intercept</span>     <span class="formula">y = mx + b</span></li>
        <li><span class="name">Quadratic formula</span>   <span class="formula">x = (−b ± √(b²−4ac)) / 2a</span></li>
        <li><span class="name">Distance formula</span>    <span class="formula">d = √((x₂−x₁)² + (y₂−y₁)²)</span></li>
      </ul>
    </div>
    <div class="formula-group">
      <h3>Data &amp; Stats</h3>
      <ul class="formula-list">
        <li><span class="name">Mean</span>                <span class="formula">sum ÷ count</span></li>
        <li><span class="name">Simple interest</span>     <span class="formula">I = Prt</span></li>
        <li><span class="name">Percent change</span>      <span class="formula">(new − old) / old × 100</span></li>
      </ul>
    </div>
  `);
}

// ---------------- Footer taglines ----------------
function initFooterTaglines() {
  if (footerRotationHandle) return;
  const footerLine = document.querySelector(".footer small");
  if (!footerLine) return;

  let idx = 0;
  let paused = false;

  const swap = () => {
    if (paused) return;
    idx = (idx + 1) % FOOTER_TAGLINES.length;
    footerLine.classList.remove("tagline-in");
    requestAnimationFrame(() => {
      footerLine.textContent = FOOTER_TAGLINES[idx];
      footerLine.classList.add("tagline-in");
    });
  };

  footerLine.textContent = FOOTER_TAGLINES[0];
  footerLine.classList.add("tagline-in");

  footerLine.addEventListener("mouseenter", () => { paused = true; });
  footerLine.addEventListener("mouseleave", () => { paused = false; });
  footerLine.addEventListener("focusin", () => { paused = true; });
  footerLine.addEventListener("focusout", () => { paused = false; });

  footerRotationHandle = setInterval(swap, 4200);
}

// ---------------- Timer ----------------
function startTimer() {
  clearTimer();
  state.timer.handle = setInterval(() => {
    state.timer.remaining -= 1;
    const el = document.getElementById("timer");
    if (el) {
      el.textContent = formatTime(state.timer.remaining);
      // Warn when ≤10% of original time remains.
      const warnThreshold = Math.ceil(state.timer.total * 0.1);
      if (state.timer.remaining <= warnThreshold) el.classList.add("warn");
    }
    if (state.timer.remaining <= 0) {
      clearTimer();
      alert("Time's up! Submitting your answers.");
      renderResults();
    }
  }, 1000);
}
function clearTimer() {
  if (state.timer?.handle) {
    clearInterval(state.timer.handle);
    state.timer.handle = null;
  }
}

// ---------------- utils ----------------
function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function escapeAttr(s) { return escapeHtml(s); }

// ---------------- boot ----------------
(async function init() {
  app.innerHTML = `<section class="card"><p class="muted">Loading question bank…</p></section>`;
  try {
    state.questions = await loadQuestions();
    state.profile = loadProfile() || createProfile({ name: "Friend" });
    initFooterTaglines();
    renderHome();
  } catch (err) {
    app.innerHTML = `<section class="card"><h2>Could not load questions</h2>
      <p class="muted">${escapeHtml(err.message)}</p>
      <p class="muted">If you opened <code>index.html</code> directly from the filesystem, please run <code>npm run dev</code> instead so <code>fetch()</code> works.</p></section>`;
  }
})();
