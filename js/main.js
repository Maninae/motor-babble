// Motor Babble entry point. Wires HUD, renderer, simulation, wiring, journal,
// and the evolution mode into a single fixed-timestep loop.

import { PHYSICS } from './config.js';
import { randomSeedString } from './rng.js';
import { createSimulation } from './sim.js';
import { createWiring } from './wiring.js';
import { createJournal } from './journal.js';
import { createRenderer } from './render.js';
import { createHud } from './hud.js';
import { createEvolution } from './evolution.js';

const app = createHud(document.body);

let currentSeed = readSeedFromUrl() || randomSeedString();
let sim, wiring, journal, evolution;
let renderer;
let heldLetters = new Set();
let firstKeyPressed = false;
let bornYet = false;              // dismisses intro on first keypress
let timerStopped = false;
let stoppedAt = 0;
let lastKeyPressedLetter = null;  // for the superstition threading
let lastRollJournalAt = -Infinity; // throttle repeat roll lines
const ROLL_JOURNAL_COOLDOWN = 5;   // seconds
let firstRollLandedAt = null;      // gate: skip repeat line if the milestone line just fired

const canvas = app.getCanvas();

function readSeedFromUrl() {
  const params = new URLSearchParams(location.search);
  const s = params.get('seed');
  return s && /^[a-z0-9]{2,32}$/i.test(s) ? s : null;
}

function writeSeedToUrl(seed) {
  const params = new URLSearchParams(location.search);
  params.set('seed', seed);
  const url = `${location.pathname}?${params.toString()}`;
  history.replaceState({}, '', url);
}

function newRun(seed) {
  currentSeed = seed;
  writeSeedToUrl(seed);
  sim = createSimulation(seed);
  wiring = createWiring(seed);
  journal = createJournal(seed);
  evolution = createEvolution(seed, createSimulation);
  evolution.onChange((status) => {
    app.setEvolutionStatus(status);
  });
  app.setSeed(seed);
  app.setEvolutionStatus(evolution.status());
  heldLetters.clear();
  firstKeyPressed = false;
  timerStopped = false;
  stoppedAt = 0;
  lastKeyPressedLetter = null;
  const opening = journal.lineFor({ type: 'opening' });
  if (opening) app.pushJournalLine(opening);
  if (!renderer) renderer = createRenderer(canvas);
  renderer.resize();
}

function isLetter(k) { return /^[a-z]$/.test(k); }

function onKeyDown(e) {
  if (e.repeat) return;
  const target = e.target;
  if (target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
  if (!bornYet) {
    bornYet = true;
    app.hideIntro();
  }
  const k = e.key.toLowerCase();
  if (!isLetter(k)) return;
  heldLetters.add(k);
  app.setPressed(k, true);
  if (!firstKeyPressed) {
    firstKeyPressed = true;
    const line = journal.lineFor({ type: 'first-key' });
    if (line) app.pushJournalLine(line);
  }
  lastKeyPressedLetter = k;
}

function onKeyUp(e) {
  const k = e.key.toLowerCase();
  if (!isLetter(k)) return;
  heldLetters.delete(k);
  app.setPressed(k, false);
}

window.addEventListener('keydown', onKeyDown);
window.addEventListener('keyup', onKeyUp);
window.addEventListener('blur', () => {
  // Release all keys when window loses focus.
  for (const k of heldLetters) app.setPressed(k, false);
  heldLetters.clear();
});

// ---- Buttons -----------------------------------------------------------

app.bindButton('#mb-new-body', () => {
  newRun(randomSeedString());
});
app.bindButton('#mb-same-body', () => {
  newRun(currentSeed);
});
app.bindButton('#mb-grow-instinct', () => {
  if (!evolution) return;
  evolution.run(5).catch((e) => console.error('evolution failed:', e));
});
app.bindButton('#mb-drive', () => {
  if (!evolution || evolution.status().best == null) return;
  const nowDriving = evolution.toggleDrive(sim, sim.state.time);
  if (nowDriving) {
    const line = journal.lineFor({ type: 'instinct' });
    if (line) app.pushJournalLine(line);
  }
});

// Dismiss intro on click as well
document.querySelector('#mb-intro').addEventListener('click', () => {
  bornYet = true;
  app.hideIntro();
});

// ---- Fixed-timestep loop -----------------------------------------------

let lastTime = performance.now();
let accumulator = 0;
const dt = PHYSICS.TIMESTEP;

function frame(now) {
  const wall = (now - lastTime) / 1000;
  lastTime = now;
  accumulator += Math.min(0.25, wall);   // cap to avoid death spirals on tab-switch

  while (accumulator >= dt) {
    accumulator -= dt;
    let activations;
    if (evolution && evolution.driving && evolution.bestGenome) {
      const tSinceDrive = sim.state.time - evolution.driveT0;
      activations = evolution.drive(sim, tSinceDrive);
    } else {
      activations = wiring.activationsForKeys(heldLetters);
      for (const k of heldLetters) wiring.noteUse(k, dt);
    }
    const events = sim.step(activations, dt);
    // First pass: detect if a milestone roll-over event happened this tick, so we can
    // suppress the throttled repeat-roll line (the milestone line already covers it).
    const milestoneRollHere = events.some((e) => e.type === 'milestone' && e.id === 'roll-over');
    if (milestoneRollHere) firstRollLandedAt = sim.state.time;

    for (const ev of events) {
      // Thread the last pressed key into pain events for the superstition line.
      if (ev.type === 'pain' && lastKeyPressedLetter) ev.recentKey = lastKeyPressedLetter;

      let suppressLine = false;
      if (ev.type === 'roll') {
        // Skip the repeat-roll journal line when the milestone event already fires this tick,
        // or when we posted a roll line within the cooldown window.
        if (milestoneRollHere) suppressLine = true;
        else if (sim.state.time - lastRollJournalAt < ROLL_JOURNAL_COOLDOWN) suppressLine = true;
        else lastRollJournalAt = sim.state.time;
      }

      if (!suppressLine) {
        const line = journal.lineFor(ev);
        if (line) app.pushJournalLine(line);
      }
      renderer.noteEvent(ev);
    }
    // On win, freeze the timer but keep the physics stepping so confetti animates.
    if (sim.state.won && !timerStopped) {
      timerStopped = true;
      stoppedAt = sim.state.time;
    }
  }

  app.update(sim, wiring, { timerStopped, stoppedAt });
  renderer.render(sim, wall);

  requestAnimationFrame(frame);
}

// Boot
newRun(currentSeed);

// Expose a small debug/test hook for automation and inspection.
window.motorBabble = {
  get sim() { return sim; },
  get wiring() { return wiring; },
  get evolution() { return evolution; },
  get heldLetters() { return Array.from(heldLetters); },
  getSnapshot: () => sim.getSnapshot(),
  simulateKeyDown: (k) => onKeyDown({ key: k, target: document.body, repeat: false }),
  simulateKeyUp: (k) => onKeyUp({ key: k, target: document.body }),
  newRun,
  currentSeed: () => currentSeed,
};

requestAnimationFrame((t) => { lastTime = t; requestAnimationFrame(frame); });
