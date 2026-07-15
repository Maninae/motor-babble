// Evolution mode: a small (mu+lambda) ES over CPG genomes that scoot the baby.
// Runs off the main thread's frame budget by evaluating one genome per idle tick,
// so the live game keeps animating while instinct grows in the background.
//
// A genome is:
//   { freq: number, joints: MUSCLE_COUNT x { amp, phase, bias } }
// which yields activations a_i(t) = clamp(bias + amp * sin(2*pi*freq*t + phase)).
// Fitness = forward torso displacement over EVAL_SIM_SECONDS on a fresh sim.

import { MUSCLE_COUNT } from './config.js';

const POPULATION = 12;
const ELITE = 3;
const EVAL_SIM_SECONDS = 8;
const EVAL_STEPS_PER_TICK = 240;    // one genome takes several ticks so UI stays smooth
const MUTATION_STD = { freq: 0.12, amp: 0.15, phase: 0.4, bias: 0.12 };

export function createEvolution(seedString, createSimulation) {
  let generation = 0;
  let history = [];                  // best fitness per generation
  let running = false;
  let stopRequested = false;
  let listeners = [];
  let population = seedPopulation();
  let bestGenome = null;
  let bestFitness = null;
  let driving = false;
  let driveT0 = 0;

  function seedPopulation() {
    return Array.from({ length: POPULATION }, () => randomGenome());
  }

  function randomGenome() {
    return {
      freq: 0.4 + Math.random() * 1.2,
      joints: Array.from({ length: MUSCLE_COUNT }, () => ({
        amp: Math.random(), phase: Math.random() * Math.PI * 2, bias: (Math.random() - 0.5) * 0.8,
      })),
    };
  }

  function mutate(g) {
    const clone = { freq: g.freq, joints: g.joints.map((j) => ({ ...j })) };
    clone.freq = clamp(clone.freq + randn() * MUTATION_STD.freq, 0.3, 1.8);
    for (const j of clone.joints) {
      j.amp = clamp(j.amp + randn() * MUTATION_STD.amp, 0, 1);
      j.phase = j.phase + randn() * MUTATION_STD.phase;
      j.bias = clamp(j.bias + randn() * MUTATION_STD.bias, -0.5, 0.5);
    }
    return clone;
  }

  function activationsAtTime(g, t) {
    const w = 2 * Math.PI * g.freq;
    const a = new Array(MUSCLE_COUNT);
    for (let i = 0; i < MUSCLE_COUNT; i++) {
      const j = g.joints[i];
      a[i] = Math.max(-1, Math.min(1, j.bias + j.amp * Math.sin(w * t + j.phase)));
    }
    return a;
  }

  async function evaluate(genome) {
    /** Fitness on a fresh (identical-seed) sim: forward torso displacement in meters.
     *  Yields to the event loop every EVAL_STEPS_PER_TICK physics steps so the live
     *  game keeps animating, and aborts (returns null) if a stop was requested.
     */
    const sim = createSimulation(seedString);
    const dt = 1 / 60;
    const startX = sim.baby.parts.torso.getPosition().x;
    const totalSteps = Math.round(EVAL_SIM_SECONDS / dt);
    for (let s = 0; s < totalSteps; s++) {
      if (s > 0 && s % EVAL_STEPS_PER_TICK === 0) {
        if (stopRequested) return null;
        await tick();
      }
      sim.step(activationsAtTime(genome, s * dt), dt);
    }
    return sim.baby.parts.torso.getPosition().x - startX;
  }

  async function run(generations) {
    /** Evaluate {POPULATION} genomes across N generations. evaluate() yields internally,
     *  so the frame loop never stalls for more than a fraction of an evaluation.
     */
    if (running) return;
    running = true;
    stopRequested = false;
    emit();
    for (let gen = 0; gen < generations; gen++) {
      if (stopRequested) break;
      const fitnesses = [];
      for (let i = 0; i < population.length; i++) {
        if (stopRequested) break;
        const f = await evaluate(population[i]);
        if (f == null) break;
        fitnesses.push({ genome: population[i], f });
      }
      if (stopRequested || fitnesses.length === 0) break;
      fitnesses.sort((a, b) => b.f - a.f);
      const best = fitnesses[0];
      generation++;
      if (bestFitness == null || best.f > bestFitness) {
        bestFitness = best.f;
        bestGenome = best.genome;
      }
      history.push(bestFitness);
      // Next generation: keep the top ELITE, refill by mutating the top half.
      const elites = fitnesses.slice(0, ELITE).map((r) => r.genome);
      const kids = [];
      while (elites.length + kids.length < POPULATION) {
        const parent = fitnesses[Math.floor(Math.random() * Math.max(1, POPULATION / 2))].genome;
        kids.push(mutate(parent));
      }
      population = elites.concat(kids);
      emit();
    }
    running = false;
    emit();
  }

  function tick() { return new Promise((r) => setTimeout(r, 0)); }

  function drive(sim, dtSinceStart) {
    /** Ask the champion for activations at the given time. Used by main. */
    if (!bestGenome) return new Array(MUSCLE_COUNT).fill(0);
    return activationsAtTime(bestGenome, dtSinceStart);
  }

  function toggleDrive(sim, currentSimTime) {
    driving = !driving;
    if (driving) driveT0 = currentSimTime;
    emit();
    return driving;
  }

  function stopDriving() { driving = false; emit(); }
  function stop() { stopRequested = true; }

  function dispose() {
    /** Kill this instance for good (new body): abort the search, stop driving,
     *  and drop listeners so a stale final emit cannot overwrite the new run's HUD. */
    stopRequested = true;
    driving = false;
    listeners = [];
  }

  function onChange(fn) { listeners.push(fn); }
  function emit() {
    for (const fn of listeners) fn(status());
  }

  function status() {
    return {
      generation, best: bestFitness, running, driving,
      history: history.slice(),
    };
  }

  return { run, stop, dispose, drive, toggleDrive, stopDriving, onChange, status, get driving() { return driving; }, get driveT0() { return driveT0; }, get bestGenome() { return bestGenome; }};
}

function randn() {
  /** Box-Muller: unit-variance normal. Two draws per call would be wasteful; we only use one. */
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
