// HUD: sidebar (timer, distance meter, milestone pips, calm meter, journal),
// bottom key strip (staggered QWERTY, reveals labels as proprioception grows),
// intro overlay, and the tiny "?" popover that explains the RL angle.
//
// All DOM (not canvas). Follows one-source-of-truth: main.js calls update()
// with the current sim snapshot and derived UI state, and this module rerenders.

import { MILESTONE_DEFS, ROOM } from './config.js';

const KEY_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];   // classic QWERTY, letters only

export function createHud(root) {
  root.innerHTML = `
    <div id="mb-app">
      <main id="mb-canvas-wrap">
        <canvas id="mb-canvas" aria-label="the nursery"></canvas>
        <div id="mb-touch-warning" hidden>
          <div class="tw-inner">
            <h2>this baby needs a physical keyboard</h2>
            <p>motor babble uses all 26 letter keys as scrambled muscles. tap around, but a keyboard is where the game happens.</p>
          </div>
        </div>
      </main>
      <aside id="mb-sidebar">
        <header>
          <h1>motor babble</h1>
          <p class="tagline">you are six weeks old</p>
        </header>
        <section class="hud-block">
          <div class="hud-row">
            <span class="label">run time</span>
            <span id="mb-timer" class="value">0:00</span>
          </div>
          <div class="hud-row">
            <span class="label">seed</span>
            <span id="mb-seed" class="value mono">-</span>
          </div>
        </section>
        <section class="hud-block">
          <div class="meter-label">distance to your parent</div>
          <div id="mb-distance-track">
            <div id="mb-distance-fill"></div>
            <div id="mb-distance-baby">👶</div>
            <div class="dt-endcap left">🛏</div>
            <div class="dt-endcap right">🤗</div>
          </div>
        </section>
        <section class="hud-block">
          <div class="meter-label">milestones</div>
          <div id="mb-milestones"></div>
        </section>
        <section class="hud-block">
          <div class="meter-label">calm <span id="mb-calm-value">80</span></div>
          <div id="mb-calm-track"><div id="mb-calm-fill"></div></div>
        </section>
        <section class="hud-block">
          <div class="meter-label">
            <span>instinct <span id="mb-generation-label"></span></span>
            <button id="mb-rl-explain" class="tiny-btn" title="what is this?">?</button>
          </div>
          <div id="mb-generation-status" class="mono">not yet grown</div>
          <canvas id="mb-fitness-sparkline" width="220" height="42"></canvas>
        </section>
        <section class="hud-block journal-block">
          <div class="meter-label">baby's inner monologue</div>
          <ol id="mb-journal"></ol>
        </section>
        <section class="hud-block button-block">
          <button id="mb-new-body">new body</button>
          <button id="mb-same-body">same body</button>
          <button id="mb-grow-instinct">grow instinct</button>
          <button id="mb-drive" disabled>let instinct drive</button>
        </section>
      </aside>
      <footer id="mb-keystrip"></footer>

      <div id="mb-intro" class="overlay">
        <div class="overlay-card">
          <h1>motor babble</h1>
          <p class="premise">
            you are six weeks old. these 26 letter keys are wired to your muscles.
            nobody will tell you which is which. some keys are single muscles.
            some are crossed wires that jerk two or three limbs at once.
            you may find your face. you may bonk your face. you may cry.
            your only goal, if you can figure out how: reach your parent on the right.
          </p>
          <p class="controls-hint">press any letter key to be born</p>
        </div>
      </div>

      <div id="mb-rl-popover" class="overlay hidden">
        <div class="overlay-card small">
          <h2>what "grow instinct" is doing</h2>
          <p>
            "grow instinct" runs an evolutionary search over rhythmic muscle patterns.
            it spawns dozens of throwaway babies with slightly different wiggles, keeps the
            ones that scoot farthest, mutates them, and repeats. this is the same family of
            algorithms that first taught simulated robots to walk.
          </p>
          <p>
            meanwhile, your own trial-and-error at the keyboard is reinforcement learning:
            you propose an action, the world hands back a reward (a milestone, a bonk, some
            calm), and you slowly figure out which keys do what. real babies do exactly this
            for months.
          </p>
          <button id="mb-rl-close">got it</button>
        </div>
      </div>
    </div>
  `;

  const timer = root.querySelector('#mb-timer');
  const seedEl = root.querySelector('#mb-seed');
  const distFill = root.querySelector('#mb-distance-fill');
  const distBaby = root.querySelector('#mb-distance-baby');
  const milestonesEl = root.querySelector('#mb-milestones');
  const calmFill = root.querySelector('#mb-calm-fill');
  const calmValue = root.querySelector('#mb-calm-value');
  const journalEl = root.querySelector('#mb-journal');
  const keystrip = root.querySelector('#mb-keystrip');
  const genLabel = root.querySelector('#mb-generation-label');
  const genStatus = root.querySelector('#mb-generation-status');
  const driveBtn = root.querySelector('#mb-drive');
  const intro = root.querySelector('#mb-intro');
  const rlPopover = root.querySelector('#mb-rl-popover');
  const sparkCanvas = root.querySelector('#mb-fitness-sparkline');
  const sparkCtx = sparkCanvas.getContext('2d');
  const canvas = root.querySelector('#mb-canvas');
  const touchWarning = root.querySelector('#mb-touch-warning');

  // Detect touch-only devices (no keyboard) and show the friendly hint.
  // The `any-pointer: fine` query is the reliable test: it is TRUE if any fine input
  // (mouse, trackpad, or a real keyboard-havinging device) is present. If it's false
  // AND we have a coarse pointer, the user is on a touch-only device.
  const finePointer = window.matchMedia('(any-pointer: fine)').matches;
  const coarsePointer = window.matchMedia('(any-pointer: coarse)').matches;
  const isTouchOnly = coarsePointer && !finePointer;
  if (isTouchOnly) touchWarning.hidden = false;

  // ---- milestone pips ----------------------------------------------------
  for (const def of MILESTONE_DEFS) {
    const pip = document.createElement('div');
    pip.className = 'milestone-pip';
    pip.dataset.id = def.id;
    pip.innerHTML = `<div class="pip-emoji">${def.emoji}</div><div class="pip-title">${def.title.toLowerCase()}</div>`;
    milestonesEl.appendChild(pip);
  }

  // ---- key strip (staggered QWERTY) ------------------------------------
  const keyElements = {};
  KEY_ROWS.forEach((row, i) => {
    const rowEl = document.createElement('div');
    rowEl.className = `key-row row-${i}`;
    for (const letter of row) {
      const keyEl = document.createElement('button');
      keyEl.className = 'key';
      keyEl.tabIndex = -1;
      keyEl.dataset.letter = letter;
      keyEl.innerHTML = `<span class="key-letter">${letter}</span><span class="key-label">?</span>`;
      rowEl.appendChild(keyEl);
      keyElements[letter] = keyEl;
    }
    keystrip.appendChild(rowEl);
  });

  const fitnessHistory = [];
  const journalEntries = [];   // { text, t }
  const MAX_JOURNAL = 8;

  // ---- Public API --------------------------------------------------------

  function setSeed(seed) { seedEl.textContent = seed; }

  function setPressed(letter, pressed) {
    const el = keyElements[letter];
    if (el) el.classList.toggle('pressed', pressed);
  }

  function setKeyLabel(letter, label) {
    const el = keyElements[letter];
    if (!el) return;
    const labelEl = el.querySelector('.key-label');
    if (label && labelEl.textContent !== label) {
      labelEl.textContent = label;
      el.classList.add('revealed');
    } else if (!label) {
      labelEl.textContent = '?';
      el.classList.remove('revealed');
    }
  }

  function pushJournalLine(text) {
    if (!text) return;
    const entry = { text, at: performance.now() };
    journalEntries.unshift(entry);
    while (journalEntries.length > MAX_JOURNAL) journalEntries.pop();
    renderJournal();
  }

  function renderJournal() {
    journalEl.innerHTML = journalEntries
      .map((e) => `<li>${escapeHtml(e.text)}</li>`)
      .join('');
  }

  function update(sim, wiring, extras) {
    /** Called every frame from main. sim: simulation object; wiring: wiring for reveals. */
    const snap = sim.getSnapshot();
    // Timer
    const t = extras.timerStopped ? extras.stoppedAt : snap.time;
    const mm = Math.floor(t / 60);
    const ss = Math.floor(t % 60).toString().padStart(2, '0');
    timer.textContent = `${mm}:${ss}`;

    // Distance meter: baby position between spawn and parent zone.
    const total = ROOM.PARENT_ZONE_X - ROOM.SPAWN_X;
    const raw = (snap.torsoX - ROOM.SPAWN_X) / total;
    const p = Math.max(0, Math.min(1, raw));
    distFill.style.width = `${p * 100}%`;
    distBaby.style.left = `calc(${p * 100}% - 12px)`;

    // Milestone pips
    for (const def of MILESTONE_DEFS) {
      const pip = milestonesEl.querySelector(`[data-id="${def.id}"]`);
      if (snap.achieved.has(def.id)) pip.classList.add('lit');
      else pip.classList.remove('lit');
    }

    // Calm meter
    const calmPct = Math.max(0, Math.min(100, snap.calm));
    calmFill.style.width = `${calmPct}%`;
    calmValue.textContent = Math.round(calmPct);
    calmFill.classList.toggle('meltdown', snap.meltdown);
    calmFill.classList.toggle('low', calmPct < 40);

    // Key labels: reveal as proprioception grows
    for (const letter of Object.keys(keyElements)) {
      const label = wiring.revealedLabel(letter);
      setKeyLabel(letter, label);
    }
  }

  function setEvolutionStatus(status) {
    /** status: { generation, best, running, driving, history? } */
    if (status.driving) {
      driveBtn.textContent = 'take back control';
      driveBtn.classList.add('driving');
    } else {
      driveBtn.textContent = 'let instinct drive';
      driveBtn.classList.remove('driving');
    }
    driveBtn.disabled = status.best == null;

    if (status.history) {
      fitnessHistory.length = 0;
      fitnessHistory.push(...status.history);
      drawSparkline();
    }

    if (status.running) {
      genStatus.textContent = `generation ${status.generation} · best ${formatMeters(status.best)}`;
      genLabel.textContent = '(growing…)';
    } else if (status.best != null) {
      genStatus.textContent = `generation ${status.generation} · best ${formatMeters(status.best)}`;
      genLabel.textContent = status.driving ? '(driving)' : '(ready)';
    } else {
      genStatus.textContent = 'not yet grown';
      genLabel.textContent = '';
    }
  }

  function drawSparkline() {
    const w = sparkCanvas.width, h = sparkCanvas.height;
    sparkCtx.clearRect(0, 0, w, h);
    if (fitnessHistory.length < 2) {
      sparkCtx.fillStyle = 'rgba(122, 90, 58, 0.4)';
      sparkCtx.font = '11px system-ui, sans-serif';
      sparkCtx.textAlign = 'center';
      sparkCtx.fillText('instinct improving…', w / 2, h / 2 + 4);
      return;
    }
    const maxV = Math.max(0.05, ...fitnessHistory);
    const minV = Math.min(0, ...fitnessHistory);
    const range = Math.max(0.05, maxV - minV);
    sparkCtx.strokeStyle = 'rgba(200, 140, 90, 0.35)';
    sparkCtx.lineWidth = 1;
    sparkCtx.beginPath();
    sparkCtx.moveTo(0, h / 2); sparkCtx.lineTo(w, h / 2);
    sparkCtx.stroke();
    // Filled area
    sparkCtx.beginPath();
    for (let i = 0; i < fitnessHistory.length; i++) {
      const x = (i / (fitnessHistory.length - 1)) * w;
      const y = h - ((fitnessHistory[i] - minV) / range) * (h - 6) - 3;
      if (i === 0) sparkCtx.moveTo(x, y); else sparkCtx.lineTo(x, y);
    }
    sparkCtx.lineTo(w, h); sparkCtx.lineTo(0, h);
    sparkCtx.closePath();
    sparkCtx.fillStyle = 'rgba(232, 180, 92, 0.35)';
    sparkCtx.fill();
    // Line
    sparkCtx.beginPath();
    for (let i = 0; i < fitnessHistory.length; i++) {
      const x = (i / (fitnessHistory.length - 1)) * w;
      const y = h - ((fitnessHistory[i] - minV) / range) * (h - 6) - 3;
      if (i === 0) sparkCtx.moveTo(x, y); else sparkCtx.lineTo(x, y);
    }
    sparkCtx.strokeStyle = '#c67c2e';
    sparkCtx.lineWidth = 2;
    sparkCtx.stroke();
    // End dot
    const lastX = w, lastY = h - ((fitnessHistory.at(-1) - minV) / range) * (h - 6) - 3;
    sparkCtx.fillStyle = '#c67c2e';
    sparkCtx.beginPath();
    sparkCtx.arc(lastX - 2, lastY, 3, 0, Math.PI * 2);
    sparkCtx.fill();
  }

  function bindButton(id, handler) {
    root.querySelector(id).addEventListener('click', handler);
  }

  function bindIntroDismiss(handler) {
    intro.addEventListener('click', handler);
    // handler also gets called on the first keydown, via main.js
  }

  function hideIntro() {
    intro.classList.add('hidden');
  }

  function showRlPopover() { rlPopover.classList.remove('hidden'); }
  function hideRlPopover() { rlPopover.classList.add('hidden'); }
  bindButton('#mb-rl-explain', showRlPopover);
  bindButton('#mb-rl-close', hideRlPopover);

  function getCanvas() { return canvas; }

  function formatMeters(v) {
    if (v == null || Number.isNaN(v)) return '·';
    return `${v.toFixed(2)} m`;
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  return {
    getCanvas,
    setSeed,
    setPressed,
    pushJournalLine,
    update,
    setEvolutionStatus,
    bindButton,
    bindIntroDismiss,
    hideIntro,
    hideRlPopover,
  };
}
