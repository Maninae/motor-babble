# Motor Babble: agent onboarding

A physics game (browser, zero build step) plus a Python RL sandbox, both simulating a six-week-old baby with 8 muscles and hidden, randomized keyboard wiring. This file is the map; read it before touching code.

## Repo layout

| Path | What it is |
|---|---|
| `index.html`, `css/`, `js/` | The browser game. Raw ES modules, no bundler, no framework. |
| `vendor/planck.min.js` | Planck.js 1.4.2 (Box2D port), loaded as a classic script BEFORE the modules; exposed as `globalThis.planck`. |
| `python/` | Gymnasium env + PPO training (pymunk physics). Independent of the JS; see `python/CLAUDE.md`. |

## JS module map (dependency direction: main → sim/render/hud → config)

| Module | Responsibility |
|---|---|
| `js/config.js` | ALL gameplay tunables: room geometry, muscle torques, noise, calm, pain, milestones, palette. Change feel here, not in sim code. |
| `js/rng.js` | Seeded mulberry32 streams. Every random draw in a run derives from the seed string. |
| `js/wiring.js` | letter → muscle-action mapping (16 clean, 10 crossed-wire combos), proprioception reveal. |
| `js/journal.js` | The baby's inner monologue. Comedy rule: the baby never attributes cause correctly. |
| `js/baby.js` | Ragdoll construction: bodies, fixtures, revolute joints, muscle motor application. |
| `js/nursery.js` | Static geometry: floor, walls, crib bar. Every fixture carries `userData.part` for contact classification. |
| `js/milestones.js` | Milestone state machine over sim snapshots. Pure, no physics. |
| `js/sim.js` | The headless coordinator: world stepping, contact events, calm/pain/meltdown, development scaling. NO DOM ACCESS, ever. |
| `js/render/` | Canvas art layer: `index.js` (coordinator), `background.js` (static scene + per-bucket blur cache), `baby_art.js`, `parent_art.js`, `effects.js`, `helpers.js`. |
| `js/hud.js` | DOM sidebar: journal feed, milestones, calm, key strip, buttons. |
| `js/evolution.js` | In-browser evolutionary policy search (CPG genomes) on fresh headless sims. |
| `js/main.js` | Boot, input, fixed-timestep loop, wiring it all together. |

## Invariants (violating these = hours of silent debugging)

- **`allowSleep: false` on the World.** Planck's `setMotorSpeed` does not wake sleeping bodies; a settled baby would ignore all input forever.
- **Joint limit keys are `lowerAngle`/`upperAngle`.** Wrong keys spread into the def leave limits undefined = 0/0 = the joint is welded shut, silently. Cost us the first smoke test.
- **`muscleJoints[i]` must align with `config.MUSCLES[i]`.** Wiring, sim, evolution, and the HUD all index muscles by that order.
- **The torso's rounded back bulge is gameplay-load-bearing.** A flat box torso cannot physically tip prone (evolutionary search plateaued at 0.6 rad); the bulge makes rocking, and therefore the roll-over milestone, possible.
- **`sim.js` stays DOM-free.** Evolution and Node smoke tests step it headlessly (`globalThis.planck` injection; see the smoke-test pattern below).
- **Determinism per seed.** Same seed + same activation sequence replays exactly. No `Math.random()` inside the sim path; use `rng.js` streams.
- **Limbs never self-collide except hand → head** (collision categories in `config.js`). That exception is the game's origin story; do not "fix" it.
- **No em-dashes in any copy, code comment, or doc. No real names of family members anywhere in the repo.**

## Headless testing pattern

Physics changes get verified in Node before the browser:

```js
globalThis.planck = require('./vendor/planck.min.js');
const { createSimulation } = await import('./js/sim.js');   // step it, assert on positions
```

Settle test, per-muscle actuation test, and an evolutionary feasibility search (can the body still scoot and roll?) are the three checks that matter after any change to `baby.js`, `config.js` MOTOR/NOISE, or `sim.js`.

## Feel-tuning quick reference

- Baby too weak or too spastic: `MOTOR.TORQUE`, `MOTOR.SPEED`, `NOISE.BASE` in `config.js`.
- Milestones too hard/easy: thresholds at the top of `milestones.js`.
- Pain too frequent: `PAIN.*_IMPULSE` thresholds in `config.js` (there is a 1 s spawn grace period in `sim.js`).
