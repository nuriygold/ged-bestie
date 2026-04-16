// Ged-Bestie client app. Single-file SPA using a tiny hash-free view switcher.
import {
  CATEGORIES,
  buildQuiz,
  choiceLetter,
  formatTime,
  isCorrect,
  scoreQuiz
} from "./logic.js";

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
  }
};

const app = document.getElementById("app");

// ---------------- Nav wiring ----------------
document.querySelectorAll("[data-nav]").forEach(btn => {
  btn.addEventListener("click", () => navigate(btn.dataset.nav));
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

  app.innerHTML = `
    <section class="card">
      <h1>Welcome to Ged-Bestie 👋</h1>
      <p class="muted">A lightweight GED Math practice app. Pick a mode to get started.</p>
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

  slot.innerHTML = `
    <div class="feedback ${correct ? "ok" : "bad"}">
      <h4>${correct ? "✅ Correct!" : "❌ Not quite."}</h4>
      ${correct ? "" : `<div><strong>Correct answer:</strong> ${escapeHtml(String(correctText))}</div>`}
      <div class="expl" style="margin-top:6px">${escapeHtml(q.explanation || "")}</div>
    </div>
  `;
}

// ---------------- Results ----------------
function renderResults() {
  clearTimer();
  const result = scoreQuiz(state.quiz, state.answers);

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

// ---------------- Timer ----------------
function startTimer() {
  clearTimer();
  state.timer.handle = setInterval(() => {
    state.timer.remaining -= 1;
    const el = document.getElementById("timer");
    if (el) el.textContent = formatTime(state.timer.remaining);
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
    renderHome();
  } catch (err) {
    app.innerHTML = `<section class="card"><h2>Could not load questions</h2>
      <p class="muted">${escapeHtml(err.message)}</p>
      <p class="muted">If you opened <code>index.html</code> directly from the filesystem, please run <code>npm run dev</code> instead so <code>fetch()</code> works.</p></section>`;
  }
})();
