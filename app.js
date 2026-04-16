// GED-BFF client app. Single-file SPA using a tiny hash-free view switcher.
import {
  CATEGORIES,
  buildQuiz,
  choiceLetter,
  formatTime,
  isCorrect,
  scoreQuiz
} from "./logic.js";

const FOOTER_TAGLINES = [
  "Locked in, legend. Your future self is proud.",
  "You study like a starter, not a bench player.",
  "That brain work is varsity-level, my guy.",
  "Focus this clean? Certified clutch mode.",
  "You bring captain energy every session.",
  "Calm, sharp, and built for big scores.",
  "Heavy grind. Heavy glow-up.",
  "GED-BFF says: you are built different."
];

const HOME_FAQS = [
  {
    q: "How many questions should I do per day?",
    a: "Start with 10–20 focused questions. If your accuracy stays above 70%, add another short set."
  },
  {
    q: "Should I practice by category or mixed?",
    a: "Use category mode first to build confidence, then switch to mixed sets so your brain learns to identify problem types fast."
  },
  {
    q: "What if I keep missing the same style of problem?",
    a: "Review the explanation, retry a similar question immediately, and make a one-line note about the mistake pattern."
  },
  {
    q: "How often should I take a timed test?",
    a: "Aim for 2–3 timed sets each week and spend more time reviewing misses than taking new tests."
  }
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
  sessionStartedAt: Date.now(),
  breakShown: false
};

const app = document.getElementById("app");

// ---------------- Nav wiring ----------------
document.querySelectorAll("[data-nav]").forEach(btn => {
  btn.addEventListener("click", () => navigate(btn.dataset.nav));
});
document.querySelectorAll("[data-close]").forEach(btn => {
  btn.addEventListener("click", closeModal);
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
    <section class="card hero home-hero">
      <p class="eyebrow">GED Math prep, leveled up</p>
      <h1>Welcome to GED-BFF 👋</h1>
      <p class="muted">A lightweight GED Math practice app with game energy, coaching, and visual walk-throughs.</p>
      <p class="muted">Practice smarter with focused drills, timed sets, and quick review loops.</p>
      <div class="tile-grid">
        <button class="tile" data-go="practice-setup">
          <h3>📘 Start Practice</h3>
          <p>One question at a time with instant feedback and explanations.</p>
        </button>
        <button class="tile" data-go="test-setup">
          <h3>⏱️ Start Timed Test</h3>
          <p>Answer a set of questions against the clock, then review your score.</p>
        </button>
        <button class="tile" id="tour-btn">
          <h3>🧭 Quick tutorial</h3>
          <p>See exactly where to click, how practice works, and where to review.</p>
        </button>
        <button class="tile" id="mini-game-btn">
          <h3>🏀 Mini hoop break game</h3>
          <p>Lo-fi tap game for breaks. No math questions, just chill shots.</p>
        </button>
      </div>
      <div class="quick-pills" aria-label="Quick actions">
        <button class="pill-btn" data-go="practice-setup">Warm up (10 Q)</button>
        <button class="pill-btn" data-go="test-setup">Timed set (15 min)</button>
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

    <section class="card">
      <h2>Got questions? Quick answers.</h2>
      <p class="muted">If you had a hundred more questions, start with these common ones:</p>
      <div class="faq-list">
        ${HOME_FAQS.map(item => `
          <details class="faq-item">
            <summary>${escapeHtml(item.q)}</summary>
            <p>${escapeHtml(item.a)}</p>
          </details>
        `).join("")}
      </div>
    </section>
  `;
  app.querySelectorAll("[data-go]").forEach(el =>
    el.addEventListener("click", () => navigate(el.dataset.go))
  );
  app.querySelector("#tour-btn")?.addEventListener("click", openTutorialModal);
  app.querySelector("#mini-game-btn")?.addEventListener("click", openMiniGameModal);
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
  state.sessionStartedAt = Date.now();
  state.breakShown = false;

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
      ${renderBreakReminder()}

      <div class="q-cat">${escapeHtml(q.category)} · ${escapeHtml(q.difficulty || "")}</div>
      <div class="q-text">${escapeHtml(q.question)}</div>
      ${renderShotMeter(q)}

      ${renderAnswerControls(q)}

      <div id="feedback-slot"></div>

      <div class="btn-row social-row">
        <button class="btn ghost" id="share-auntie">Share with Auntie</button>
        <button class="btn ghost" id="ask-auntie">Ask Auntie how she'd solve this</button>
      </div>

      <div class="btn-row">
        ${renderNavButtons()}
      </div>
    </section>
  `;

  wireAnswerControls();
  wireNavButtons();
  app.querySelector("#share-auntie")?.addEventListener("click", () => shareQuestion(q, false));
  app.querySelector("#ask-auntie")?.addEventListener("click", () => shareQuestion(q, true));
  app.querySelector("#break-mini-game")?.addEventListener("click", openMiniGameModal);

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

function renderShotMeter(q) {
  const difficulty = (q.difficulty || "medium").toLowerCase();
  const distance = difficulty === "easy" ? 32 : difficulty === "hard" ? 72 : 52;
  const label = difficulty === "easy" ? "Close shot" : difficulty === "hard" ? "Deep 3" : "Mid-range";
  return `
    <div class="shot-meter" aria-label="Basketball challenge meter">
      <div class="shot-head">
        <strong>🏀 ${escapeHtml(label)}</strong>
        <span>${distance}% distance</span>
      </div>
      <div class="court">
        <div class="rim" aria-hidden="true">🧺</div>
        <div class="ball" style="left:${distance}%;" aria-hidden="true">🏀</div>
      </div>
    </div>
  `;
}

function renderBreakReminder() {
  const elapsedMin = Math.floor((Date.now() - state.sessionStartedAt) / 60000);
  if (elapsedMin < 20 || state.breakShown) return "";
  state.breakShown = true;
  return `
    <div class="break-reminder">
      ⏳ You’ve been grinding for ${elapsedMin} minutes. Take a 2-minute water break, then come back strong.
      <button class="btn ghost break-play" id="break-mini-game">Play mini hoop break</button>
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
}

// ---------------- Results ----------------
function renderResults() {
  clearTimer();
  const result = scoreQuiz(state.quiz, state.answers);
  const recommendation = buildScoreRecommendation(result);

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
      <div class="recommend ${recommendation.tone}">
        <strong>${escapeHtml(recommendation.title)}</strong>
        <p>${escapeHtml(recommendation.body)}</p>
      </div>

      <div class="btn-row" style="margin-top:14px">
        <button class="btn primary" id="again">Try another</button>
        <button class="btn" id="focus-practice">Practice weakest subject</button>
        <button class="btn ghost" id="share-results">Share score with Auntie</button>
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
  app.querySelector("#focus-practice")?.addEventListener("click", () => {
    state.settings.category = recommendation.focusCategory || "all";
    navigate("practice-setup");
    const cat = app.querySelector("#cat");
    if (cat && recommendation.focusCategory) cat.value = recommendation.focusCategory;
  });
  app.querySelector("#share-results")?.addEventListener("click", () => shareResults(result, recommendation));
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
  const acronymLetters = hint.label.split("").map((letter, idx) => `${letter}: ${hint.meaning.split(",")[idx]?.trim() || "Apply the step"}`);
  const equationLine = question.inputType === "numeric"
    ? "Equation path: given values → substitute numbers → isolate unknown → solve."
    : "Choice path: remove impossible options → compare remaining choices → select best evidence.";

  return [
    `Acronym check: ${hint.label}`,
    ...acronymLetters,
    `Set it up: ${setupLine}`,
    equationLine,
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

function buildScoreRecommendation(result) {
  const weakest = Object.entries(result.byCategory)
    .map(([category, data]) => ({ category, pct: Math.round((data.correct / data.total) * 100) }))
    .sort((a, b) => a.pct - b.pct)[0];
  if (result.percent >= 85) {
    return {
      tone: "high",
      title: "🔥 Elite work.",
      body: "You are test-ready. Keep momentum with one timed set every other day and maintain speed checks.",
      focusCategory: weakest?.category || null
    };
  }
  if (result.percent >= 65) {
    return {
      tone: "mid",
      title: "📈 Solid progress.",
      body: `You're close. Spend next session on ${weakest?.category || "your lowest category"} and re-run a short timed set after.`,
      focusCategory: weakest?.category || null
    };
  }
  return {
    tone: "low",
    title: "🛠 Build mode (that’s okay).",
    body: `Next best move: focus on ${weakest?.category || "foundational skills"} first, then do 5 practice questions before another test.`,
    focusCategory: weakest?.category || null
  };
}

async function shareQuestion(q, askStyle) {
  const prompt = askStyle
    ? `Auntie, how would you solve this?\n\n${q.question}\n\nCan you show your setup and steps?`
    : `Can you quiz me on this GED question?\n\n${q.question}`;
  await copyOrShare(prompt, askStyle ? "Question sent for coaching." : "Question copied to share.");
}

async function shareResults(result, recommendation) {
  const text = `I scored ${result.percent}% on GED-BFF (${result.correct}/${result.total}). ${recommendation.body}`;
  await copyOrShare(text, "Results copied to share.");
}

async function copyOrShare(text, fallbackToast) {
  try {
    if (navigator.share) {
      await navigator.share({ text });
      return;
    }
    await navigator.clipboard.writeText(text);
    alert(fallbackToast);
  } catch {
    // no-op: user may cancel share
  }
}

function openTutorialModal() {
  openModal(`
    <h2>Quick app tutorial</h2>
    <ol class="tutorial-list">
      <li><strong>Top nav:</strong> Home, Practice, and Test are always at the top.</li>
      <li><strong>Practice mode:</strong> Use “Check answer” to see coaching and pencil walkthroughs.</li>
      <li><strong>Timed test:</strong> Use the GED timer to simulate real pressure.</li>
      <li><strong>After score:</strong> Use “Practice weakest subject” for targeted reps.</li>
      <li><strong>Share buttons:</strong> Tap “Share with Auntie” or “Ask Auntie how she'd solve this.”</li>
    </ol>
  `);
}

function openMiniGameModal() {
  openModal(`
    <h2>Mini Hoop Break 🏀</h2>
    <p class="muted">Tap “Shoot” when the marker is in the green zone. No math, just quick focus reset.</p>
    <div class="mini-game">
      <div class="mini-track"><span id="mini-marker"></span><span class="mini-zone"></span></div>
      <div class="btn-row" style="margin-top:10px">
        <button class="btn primary" id="mini-shoot">Shoot</button>
        <button class="btn" id="mini-reset">Reset</button>
      </div>
      <p id="mini-score" class="muted">Buckets: 0 · Attempts: 0</p>
    </div>
  `);
  startMiniGame();
}

let miniGame = null;
function startMiniGame() {
  let pos = 6;
  let dir = 1;
  let buckets = 0;
  let attempts = 0;
  const marker = document.getElementById("mini-marker");
  const score = document.getElementById("mini-score");
  if (!marker || !score) return;
  const tick = () => {
    pos += dir * 2.8;
    if (pos >= 94 || pos <= 2) dir *= -1;
    marker.style.left = `${pos}%`;
  };
  if (miniGame) clearInterval(miniGame);
  miniGame = setInterval(tick, 85);

  document.getElementById("mini-shoot")?.addEventListener("click", () => {
    attempts += 1;
    if (pos >= 44 && pos <= 58) buckets += 1;
    score.textContent = `Buckets: ${buckets} · Attempts: ${attempts}`;
  });
  document.getElementById("mini-reset")?.addEventListener("click", () => {
    buckets = 0;
    attempts = 0;
    score.textContent = `Buckets: ${buckets} · Attempts: ${attempts}`;
  });
}

function openModal(html) {
  const root = document.getElementById("modal-root");
  const content = document.getElementById("modal-content");
  if (!root || !content) return;
  content.innerHTML = html;
  root.classList.remove("hidden");
}

function closeModal() {
  const root = document.getElementById("modal-root");
  if (!root) return;
  root.classList.add("hidden");
  if (miniGame) {
    clearInterval(miniGame);
    miniGame = null;
  }
}

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

document.addEventListener("keydown", e => {
  if (e.key === "Escape") closeModal();
});

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
    initFooterTaglines();
    renderHome();
  } catch (err) {
    app.innerHTML = `<section class="card"><h2>Could not load questions</h2>
      <p class="muted">${escapeHtml(err.message)}</p>
      <p class="muted">If you opened <code>index.html</code> directly from the filesystem, please run <code>npm run dev</code> instead so <code>fetch()</code> works.</p></section>`;
  }
})();
