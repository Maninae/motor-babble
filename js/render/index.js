// Renderer coordinator. Owns viewport state, wires the four layer modules
// together, and exposes the public API used by main.js:
//   createRenderer(canvas) -> { render, noteEvent, resize }
//
// Layer order per frame (back to front):
//   1. Cached blurred background (background.render): wall, floor, rug, crib,
//      teddy, mobile beam, plus the two animated overlays (cloud, mobile sway).
//   2. Parent contact shadow, baby contact shadow.
//   3. Parent figure (crisp).
//   4. Dust motes + flomp floor puff (behind the baby).
//   5. Baby (crisp, always on top of the parent so a reaching arm never covers it).
//   6. Confetti burst + pain vignette.
//   7. Milestone banner + win overlay (viewport-space, ignore the flomp shake).

import { ROOM } from '../config.js';
import { createBackgroundLayer } from './background.js';
import { createBabyArt } from './baby_art.js';
import { createParentArt } from './parent_art.js';
import { createEffectsState, createEffectsLayer } from './effects.js';

// ---- Viewport tuning ------------------------------------------------------

const PIXELS_PER_METER = 300;
const PXPERM_MIN = 200;
const TARGET_METERS_ACROSS = 3.6;          // crib + rug + parent visible
const FLOOR_SCREEN_FRAC = 0.68;            // floor sits ~68% down the canvas
const MIN_CANVAS_W = 320;
const MIN_CANVAS_H = 240;

// ---- Camera framing -------------------------------------------------------

// 0 = frame on baby, 1 = frame on parent. 0.55 keeps both in view while
// biasing slightly toward the parent (goal).
const CAMERA_FRAME_TARGET_FRAC = 0.55;
// Easing factor (per-second) toward the target framing point.
const CAMERA_FOLLOW_STRENGTH = 3.0;

// ---- Flomp shake (post-roll) ---------------------------------------------

const FLOMP_SHAKE_AMP_PX = 6;
const FLOMP_SHAKE_RATE_X = 40;             // rad/s
const FLOMP_SHAKE_RATE_Y = 48;             // rad/s
const FLOMP_SHAKE_MAX_S = 0.35;

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');

  // Viewport state: mutated by resize(), read by every layer.
  const viewport = {
    width: 0, height: 0, pxPerM: PIXELS_PER_METER,
    floorScreenY: 0,
  };
  // Ambient clock powering cloud drift, mobile sway, dust, and scrambled-eye wobble.
  const ambient = { t: 0 };
  // Camera starts at the framing midpoint so both baby and parent are visible on load.
  let cameraX = ROOM.SPAWN_X + (ROOM.PARENT_ZONE_X - ROOM.SPAWN_X) * CAMERA_FRAME_TARGET_FRAC;

  function worldToScreen(x, y) {
    /** World meters -> canvas CSS px. Y is world-up, screen is y-down, so invert. */
    return {
      x: viewport.width / 2 + (x - cameraX) * viewport.pxPerM,
      y: viewport.floorScreenY - y * viewport.pxPerM,
    };
  }

  // Effects state is shared with baby_art (for milestoneJoyT face expression).
  const effects = createEffectsState();

  // Wire the layers. Each closure captures `viewport`, `ambient`, `effects`.
  const background = createBackgroundLayer({ viewport, worldToScreen, ambient, reducedMotion });
  const babyArt = createBabyArt({ viewport, worldToScreen, ambient, effects, reducedMotion });
  const parentArt = createParentArt({ viewport, worldToScreen });
  const effectsLayer = createEffectsLayer({ viewport, worldToScreen, ambient, effects, reducedMotion });

  function resize() {
    /** Match backing store to CSS size, keep floor pinned, recompute px scale.
     *  Rebuilds the background cache (and drops any pre-blurred variants). */
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(MIN_CANVAS_W, Math.floor(rect.width));
    const h = Math.max(MIN_CANVAS_H, Math.floor(rect.height));
    viewport.width = w;
    viewport.height = h;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Choose pxPerM so the baby is big and the crib+parent fit comfortably.
    let pxPerM = Math.min(PIXELS_PER_METER, w / TARGET_METERS_ACROSS);
    pxPerM = Math.max(PXPERM_MIN, pxPerM);
    viewport.pxPerM = pxPerM;
    viewport.floorScreenY = Math.round(h * FLOOR_SCREEN_FRAC);
    background.resize();
  }

  window.addEventListener('resize', resize);
  resize();

  function updateCamera(sim, dt) {
    const torsoX = sim.baby.parts.torso.getPosition().x;
    const targetX = torsoX + (ROOM.PARENT_ZONE_X - torsoX) * CAMERA_FRAME_TARGET_FRAC;
    cameraX += (targetX - cameraX) * Math.min(1, dt * CAMERA_FOLLOW_STRENGTH);
  }

  function computeShake() {
    if (effects.flompShake <= 0 || reducedMotion) return { x: 0, y: 0 };
    const amp = FLOMP_SHAKE_AMP_PX * (effects.flompShake / FLOMP_SHAKE_MAX_S);
    return {
      x: Math.sin(ambient.t * FLOMP_SHAKE_RATE_X) * amp,
      y: Math.cos(ambient.t * FLOMP_SHAKE_RATE_Y) * amp * 0.5,
    };
  }

  function render(sim, dt) {
    /** Draw one frame. Called every rAF. */
    ambient.t += reducedMotion ? 0 : dt;
    updateCamera(sim, dt);
    effectsLayer.tickTimers(dt);

    const { width, height } = viewport;
    const blurPx = sim.getSnapshot().blurPx;
    ctx.clearRect(0, 0, width, height);

    const shake = computeShake();
    ctx.save();
    ctx.translate(shake.x, shake.y);

    // 1. Background (cached blurred + animated overlays with matching blur)
    background.render(ctx, blurPx);

    // 2 - 6. Crisp foreground
    parentArt.drawContactShadow(ctx);
    babyArt.drawContactShadow(ctx, sim);
    parentArt.drawFigure(ctx);
    effectsLayer.drawDust(ctx);
    effectsLayer.drawFlompPuff(ctx, sim);
    babyArt.draw(ctx, sim);
    effectsLayer.drawConfetti(ctx, dt);
    effectsLayer.drawPainVignette(ctx);
    ctx.restore();

    // 7. Overlays in viewport space (unshaken)
    effectsLayer.drawMilestoneBanner(ctx);
    effectsLayer.drawWinOverlay(ctx, sim);

    if (sim.state.won) effectsLayer.spawnWinConfetti(dt);
  }

  function noteEvent(event) {
    effectsLayer.noteEvent(event);
  }

  return { render, noteEvent, resize };
}
