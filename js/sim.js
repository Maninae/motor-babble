// The headless simulation: one baby, one nursery, stepped with per-muscle activations.
// No DOM, no rendering. The human player and the evolution mode both drive this same
// interface: step(activations, dt) -> events. Determinism note: given the same seed and
// the same activation sequence, runs replay exactly (Box2D is deterministic per build).

import { CALM, MILESTONE_DEFS, MOTOR, MUSCLE_COUNT, NOISE, PAIN, PHYSICS, ROCK, ROOM, VISION } from './config.js';
import { createBaby } from './baby.js';
import { createNursery } from './nursery.js';
import { createMilestoneTracker, wrapAngle } from './milestones.js';
import { createRng } from './rng.js';

const pl = globalThis.planck;

export function createSimulation(seedString) {
  // allowSleep MUST stay false: planck's setMotorSpeed does not wake sleeping bodies,
  // so a settled baby would ignore all muscle commands forever (verified by probe).
  const world = new pl.World({ gravity: new pl.Vec2(0, PHYSICS.GRAVITY_Y), allowSleep: false });
  const nursery = createNursery(world);
  const baby = createBaby(world);
  const milestones = createMilestoneTracker();
  const noiseRng = createRng(seedString + '::noise');

  const state = {
    time: 0,
    calm: CALM.START,
    painCooldown: 0,
    scrambleTimer: 0,
    meltdownTimer: 0,
    handOnFace: false,
    wasSoothing: false,
    won: false,
    // Rock-to-roll: which way the belly faces ('up' = supine), plus rocking peak trackers.
    facing: 'up',
    rollAnimTimer: 0,
    rockPeakPos: 0,
    rockPeakNeg: 0,
  };

  // --- Contact bookkeeping -------------------------------------------------
  // begin/end-contact tracks hand-on-face; post-solve queues impacts for step().
  let handHeadContacts = 0;
  const pendingImpacts = [];

  function partsOf(contact) {
    const a = contact.getFixtureA().getUserData();
    const b = contact.getFixtureB().getUserData();
    return [a ? a.part : '', b ? b.part : ''];
  }

  function isHandHead(pa, pb) {
    const hand = (p) => p === 'armNearDist' || p === 'armFarDist';
    return (hand(pa) && pb === 'head') || (hand(pb) && pa === 'head');
  }

  world.on('begin-contact', (contact) => {
    const [pa, pb] = partsOf(contact);
    if (isHandHead(pa, pb)) handHeadContacts++;
  });

  world.on('end-contact', (contact) => {
    const [pa, pb] = partsOf(contact);
    if (isHandHead(pa, pb)) handHeadContacts = Math.max(0, handHeadContacts - 1);
  });

  world.on('post-solve', (contact, impulse) => {
    const maxImpulse = Math.max(...impulse.normalImpulses);
    if (maxImpulse < PAIN.SELF_BONK_IMPULSE) return;
    const [pa, pb] = partsOf(contact);
    pendingImpacts.push({ pa, pb, impulse: maxImpulse });
  });

  function classifyImpacts(events) {
    /** Turn queued raw impacts into pain / self-bonk events, respecting the pain cooldown. */
    if (state.time < 1.0) {   // grace period: the spawn drop is not the world's fault
      pendingImpacts.length = 0;
      return;
    }
    for (const hit of pendingImpacts) {
      const { pa, pb, impulse } = hit;
      const hasCrib = pa === 'crib' || pb === 'crib';
      const headFloor = (pa === 'head' && pb === 'floor') || (pb === 'head' && pa === 'floor');

      if (isHandHead(pa, pb)) {
        events.push({ type: 'self-bonk' });
        state.calm = Math.max(0, state.calm - CALM.BONK_COST);
      } else if ((hasCrib && impulse >= PAIN.CRIB_IMPULSE) || (headFloor && impulse >= PAIN.FLOOR_HEAD_IMPULSE)) {
        if (state.painCooldown <= 0) {
          state.painCooldown = PAIN.COOLDOWN_SEC;
          state.scrambleTimer = PAIN.SCRAMBLE_SEC;
          state.calm = Math.max(0, state.calm - CALM.PAIN_COST);
          events.push({ type: 'pain' });
        }
      }
    }
    pendingImpacts.length = 0;
  }

  // --- Development scaling --------------------------------------------------
  function noiseLevel() {
    const dev = milestones.level / MILESTONE_DEFS.length;
    return NOISE.BASE * Math.pow(1 - dev, 1.2);
  }

  function strengthScale() {
    return MOTOR.STRENGTH_BASE + milestones.level * MOTOR.STRENGTH_PER_LEVEL;
  }

  function blurPx() {
    const dev = milestones.level / MILESTONE_DEFS.length;
    return VISION.MAX_BLUR_PX * Math.pow(1 - dev, 1.5);
  }

  function corruptActivations(activations) {
    /** Motor noise: smear commands, add spontaneous twitches, override during meltdowns. */
    const noisy = activations.slice();
    const n = noiseLevel();
    const scrambling = state.scrambleTimer > 0 || state.meltdownTimer > 0;
    for (let i = 0; i < MUSCLE_COUNT; i++) {
      if (scrambling) {
        noisy[i] = noiseRng() * 2 - 1;
      } else {
        if (Math.abs(noisy[i]) > 0.02) noisy[i] += n * 0.6 * (noiseRng() * 2 - 1);
        else if (noiseRng() < NOISE.TWITCH_CHANCE * (0.3 + n)) noisy[i] = (noiseRng() * 2 - 1);
      }
      noisy[i] = Math.max(-1, Math.min(1, noisy[i]));
    }
    return noisy;
  }

  // --- Main step -------------------------------------------------------------
  function step(activations, dt) {
    /** Advance one tick. activations: Float[-1..1] x MUSCLE_COUNT. Returns event list. */
    const events = [];
    state.time += dt;
    state.painCooldown = Math.max(0, state.painCooldown - dt);
    state.scrambleTimer = Math.max(0, state.scrambleTimer - dt);

    baby.setNeckStrength(MOTOR.NECK_TORQUE_BASE + milestones.level * MOTOR.NECK_TORQUE_PER_LEVEL);
    baby.applyMuscleActivations(corruptActivations(activations), strengthScale());

    world.step(dt, PHYSICS.VELOCITY_ITERATIONS, PHYSICS.POSITION_ITERATIONS);

    classifyImpacts(events);

    // Calm: slow regen, fast soothe while a hand rests on the face, meltdown at zero.
    state.handOnFace = handHeadContacts > 0;
    const regen = CALM.REGEN_PER_SEC + (state.handOnFace ? CALM.SOOTHE_PER_SEC : 0);
    if (state.meltdownTimer > 0) {
      state.meltdownTimer -= dt;
      if (state.meltdownTimer <= 0) state.calm = CALM.MELTDOWN_RESET;
    } else {
      state.calm = Math.min(CALM.MAX, state.calm + regen * dt);
      if (state.calm <= 0) {
        state.meltdownTimer = CALM.MELTDOWN_SECONDS;
        events.push({ type: 'meltdown' });
      }
    }
    if (state.handOnFace && !state.wasSoothing && state.calm < 90) events.push({ type: 'soothe' });
    state.wasSoothing = state.handOnFace;

    // Rock-to-roll: build a rocking oscillation to earn a (scripted) roll. Physically
    // flipping 180 in this view would be a somersault, so the skill we demand is the
    // rocking itself; the flip is cinematic and the facing state does the bookkeeping.
    const torso = baby.parts.torso;
    const wrapped = wrapAngle(torso.getAngle());
    state.rollAnimTimer = Math.max(0, state.rollAnimTimer - dt);
    state.rockPeakPos = Math.max(state.rockPeakPos * ROCK.PEAK_DECAY, wrapped);
    state.rockPeakNeg = Math.min(state.rockPeakNeg * ROCK.PEAK_DECAY, wrapped);
    const rockAmplitude = state.rockPeakPos - state.rockPeakNeg;
    let justRolled = false;
    if (rockAmplitude >= ROCK.AMPLITUDE_TO_ROLL && state.rollAnimTimer <= 0 && state.meltdownTimer <= 0) {
      state.facing = state.facing === 'up' ? 'down' : 'up';
      state.rollAnimTimer = ROCK.ROLL_ANIM_SEC;
      state.rockPeakPos = 0;
      state.rockPeakNeg = 0;
      justRolled = true;
      events.push({ type: 'roll', facing: state.facing });
    }
    const prone = state.facing === 'down' && Math.abs(wrapped) < 0.8;

    // Milestones
    const fresh = milestones.update(dt, {
      prone,
      justRolled,
      torsoX: torso.getPosition().x,
      torsoY: torso.getPosition().y,
      headY: baby.parts.head.getPosition().y,
      handOnFace: state.handOnFace,
    });
    for (const id of fresh) {
      events.push({ type: 'milestone', id });
      if (id === 'reach-parent') state.won = true;
    }

    return events;
  }

  function getSnapshot() {
    /** Everything the renderer and HUD need, as plain data. */
    const torsoPos = baby.parts.torso.getPosition();
    return {
      time: state.time,
      calm: state.calm,
      meltdown: state.meltdownTimer > 0,
      scrambled: state.scrambleTimer > 0,
      handOnFace: state.handOnFace,
      won: state.won,
      level: milestones.level,
      achieved: new Set(milestones.achieved),
      blurPx: blurPx(),
      torsoX: torsoPos.x,
      distanceToParent: Math.max(0, ROOM.PARENT_ZONE_X - torsoPos.x),
      facing: state.facing,
      rollAnim: state.rollAnimTimer > 0 ? state.rollAnimTimer / ROCK.ROLL_ANIM_SEC : 0,
      rockCharge: Math.min(1, (state.rockPeakPos - state.rockPeakNeg) / ROCK.AMPLITUDE_TO_ROLL),
    };
  }

  return { world, baby, nursery, milestones, state, step, getSnapshot };
}
