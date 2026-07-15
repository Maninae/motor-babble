// Static + animated background layer: the vision-blurred half of the render.
//
// Wall, window frame, sky, wall art, floor, plank lines, sunlight pool, rug,
// crib, teddy, and ceiling beam are all STATIC in canvas coordinates once the
// viewport is known, so they're baked into an offscreen `staticCanvas` on
// resize. The animated overlays (window cloud drift, mobile sway) are cheap
// per-frame draws.
//
// The blur pass used to run every frame over the full backing store, which
// dominated the render cost. Instead, we quantize the current blurPx to a
// coarse bucket, keep a pre-blurred copy of `staticCanvas` per bucket in
// `blurredCache`, and blit that cache with a plain drawImage. Because blurPx
// only changes when a milestone lands, cache hits are the common case; the
// blur pass runs once per bucket, not once per frame. The two animated
// overlays still take a blur filter, but their bounding boxes are small so
// the cost scales with those regions, not the full canvas.

import { PALETTE, ROOM } from '../config.js';
import { roundedRect, ellipse, circle, shade } from './helpers.js';

// ---- Blur cache tuning ----------------------------------------------------

// Round blurPx to this granularity so nearby blur values share a cache entry.
// blurPx maxes at VISION.MAX_BLUR_PX = 3.5, and milestones bump it in ~1px
// increments, so 0.5 px buckets give at most ~7 distinct entries.
const BLUR_BUCKET_STEP = 0.5;
// Below this blur, we skip the filter entirely (indistinguishable from crisp).
const BLUR_THRESHOLD = 0.05;
// Cap on distinct cached buckets, evicted oldest-first if exceeded.
const MAX_BLUR_CACHE = 8;

// ---- Wall / window geometry (fractions of the viewport) -------------------

const WINDOW_WIDTH_FRAC = 0.22;
const WINDOW_WIDTH_MAX_PX = 220;
const WINDOW_ASPECT = 0.75;
const WINDOW_X_FRAC = 0.55;
const WINDOW_TOP_MAX_PX = 80;
const WINDOW_TOP_BELOW_FLOOR_FRAC = 0.12;

// ---- Wall art (framed heart print) ----------------------------------------

const ART_CX_FRAC = 0.24;
const ART_UP_FROM_FLOOR_PX = 245;
const ART_WIDTH_PX = 92;
const ART_HEIGHT_PX = 108;

// ---- Sunlight pool on the floor -------------------------------------------

const LIGHT_POOL_CX_FRAC = 0.62;
const LIGHT_POOL_OFFSET_Y_PX = 40;
const LIGHT_POOL_MAX_RADIUS_PX = 180;
const LIGHT_POOL_RADIUS_FRAC = 0.18;
const LIGHT_POOL_Y_SCALE = 0.42;

// ---- Rug tucked under the baby's play area --------------------------------

const RUG_CENTER_OFFSET_M = 0.15;
const RUG_RX_M = 0.68;
const RUG_RY_M = 0.2;
const RUG_TASSEL_COUNT = 22;

// ---- Floor plank lines ----------------------------------------------------

const FLOOR_PLANK_H_LINE_COUNT = 8;
const FLOOR_PLANK_V_SEAM_COUNT = 12;

// ---- Ceiling beam + mobile -----------------------------------------------

const BEAM_HEIGHT_PX = 22;
const BEAM_KNOT_COUNT = 6;
const MOBILE_ANCHOR_Y_PX = 40;
const MOBILE_HANGER_HALF_W_PX = 40;
const MOBILE_STAR_DROP_PX = 40;
const MOBILE_STAR_OFFSETS = [-40, 0, 40];
const MOBILE_STAR_COLORS = ['#ffcf6b', '#f28ba1', '#8ec6e8'];
const MOBILE_STAR_OUTER_PX = 12;
const MOBILE_STAR_INNER_PX = 6;
const MOBILE_SWAY_HZ = 1.1;
const MOBILE_SWAY_AMP_PX = 6;
const MOBILE_STAR_LOCAL_SWAY_HZ = 1.4;
const MOBILE_STAR_LOCAL_SWAY_AMP_PX = 3;
const MOBILE_ANCHOR_LEFT_CLAMP_PX = 120;
const MOBILE_ANCHOR_RIGHT_CLAMP_FRAC = 0.55;

// ---- Cloud drift inside the window ----------------------------------------

const CLOUD_DRIFT_HZ = 0.2;
const CLOUD_DRIFT_AMP_FRAC = 0.15;

// ---- Teddy bear (world-anchored via worldToScreen) ------------------------

const TEDDY_OFFSET_FROM_CRIB_M = 0.28;

// ---------------------------------------------------------------------------

export function createBackgroundLayer({ viewport, worldToScreen, ambient, reducedMotion }) {
  /** Owns the static bg cache + per-bucket blurred caches.
   *  - `resize()` rebuilds the static bake to the new viewport size and clears blur caches.
   *  - `render(g, blurPx)` blits the appropriate cached bg to `g`, then paints the two
   *    animated overlays (cloud + swaying mobile) on top with matching blur.
   */
  const staticCanvas = document.createElement('canvas');
  const staticCtx = staticCanvas.getContext('2d');
  const blurredCache = new Map();

  function bucketFor(blurPx) {
    if (blurPx < BLUR_THRESHOLD) return 0;
    return Math.round(blurPx / BLUR_BUCKET_STEP) * BLUR_BUCKET_STEP;
  }

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    staticCanvas.width = Math.floor(viewport.width * dpr);
    staticCanvas.height = Math.floor(viewport.height * dpr);
    staticCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    staticCtx.clearRect(0, 0, viewport.width, viewport.height);
    drawWallStatic(staticCtx);
    drawFloorStatic(staticCtx);
    drawTeddyBearStatic(staticCtx);
    drawCribStatic(staticCtx);
    drawMobileBeamStatic(staticCtx);
    blurredCache.clear();
  }

  function buildBlurredCache(bucket) {
    /** Bake a blurred copy of the static bg at the current viewport size.
     *  DPR gotcha: staticCanvas holds device pixels (dpr'd), but its ctx has
     *  a dpr transform so `blur(Npx)` in the original render meant N CSS px.
     *  This cache ctx has no transform, so we scale the bucket by dpr to keep
     *  the visible blur radius identical to the pre-cache behavior. */
    const c = document.createElement('canvas');
    c.width = staticCanvas.width;
    c.height = staticCanvas.height;
    const bg = c.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    bg.filter = `blur(${bucket * dpr}px)`;
    bg.drawImage(staticCanvas, 0, 0);
    bg.filter = 'none';
    return c;
  }

  function render(g, blurPx) {
    const bucket = bucketFor(blurPx);
    let src = staticCanvas;
    if (bucket > 0) {
      let cached = blurredCache.get(bucket);
      if (!cached) {
        if (blurredCache.size >= MAX_BLUR_CACHE) {
          const oldestKey = blurredCache.keys().next().value;
          blurredCache.delete(oldestKey);
        }
        cached = buildBlurredCache(bucket);
        blurredCache.set(bucket, cached);
      }
      src = cached;
    }
    g.drawImage(src, 0, 0, src.width, src.height, 0, 0, viewport.width, viewport.height);
    // Animated overlays: cheap because their bounding boxes are small.
    const applyBlur = bucket > 0;
    if (applyBlur) g.filter = `blur(${bucket}px)`;
    drawCloudAnimated(g);
    drawMobileAnimated(g);
    if (applyBlur) g.filter = 'none';
  }

  // ---- Static bake (called from resize) -----------------------------------

  function drawWallStatic(g) {
    /** Wall gradient + window frame + sky + wall art. The drifting cloud is
     *  drawn separately per-frame so it's not baked into the static cache. */
    const { width, height, floorScreenY } = viewport;
    const grad = g.createLinearGradient(0, 0, 0, floorScreenY);
    grad.addColorStop(0, PALETTE.wallTop);
    grad.addColorStop(1, PALETTE.wallBottom);
    g.fillStyle = grad;
    g.fillRect(0, 0, width, floorScreenY + 4);

    const winW = Math.min(WINDOW_WIDTH_MAX_PX, width * WINDOW_WIDTH_FRAC);
    const winH = winW * WINDOW_ASPECT;
    const winX = width * WINDOW_X_FRAC;
    const winY = floorScreenY - winH - Math.min(WINDOW_TOP_MAX_PX, height * WINDOW_TOP_BELOW_FLOOR_FRAC);
    const frameCol = '#c9a982';
    g.fillStyle = 'rgba(0,0,0,0.06)';
    roundedRect(g, winX - 6, winY + 8, winW + 12, winH + 12, 14); g.fill();
    const sky = g.createLinearGradient(0, winY, 0, winY + winH);
    sky.addColorStop(0, '#bfe1f4');
    sky.addColorStop(1, '#eaf5fb');
    g.fillStyle = sky;
    roundedRect(g, winX, winY, winW, winH, 8); g.fill();
    g.strokeStyle = frameCol;
    g.lineWidth = 6;
    roundedRect(g, winX, winY, winW, winH, 8); g.stroke();
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(winX + winW / 2, winY); g.lineTo(winX + winW / 2, winY + winH);
    g.moveTo(winX, winY + winH / 2); g.lineTo(winX + winW, winY + winH / 2);
    g.stroke();

    // Wall art: framed heart print at typical picture-hanging height.
    const artCx = width * ART_CX_FRAC;
    const artCy = floorScreenY - ART_UP_FROM_FLOOR_PX;
    g.fillStyle = 'rgba(60, 40, 20, 0.14)';
    roundedRect(g, artCx - ART_WIDTH_PX / 2 + 4, artCy - ART_HEIGHT_PX / 2 + 5, ART_WIDTH_PX, ART_HEIGHT_PX, 6); g.fill();
    g.fillStyle = '#b48b62';
    roundedRect(g, artCx - ART_WIDTH_PX / 2, artCy - ART_HEIGHT_PX / 2, ART_WIDTH_PX, ART_HEIGHT_PX, 6); g.fill();
    g.strokeStyle = '#8f6a45'; g.lineWidth = 1;
    roundedRect(g, artCx - ART_WIDTH_PX / 2, artCy - ART_HEIGHT_PX / 2, ART_WIDTH_PX, ART_HEIGHT_PX, 6); g.stroke();
    g.fillStyle = '#fff6e6';
    roundedRect(g, artCx - ART_WIDTH_PX / 2 + 7, artCy - ART_HEIGHT_PX / 2 + 7, ART_WIDTH_PX - 14, ART_HEIGHT_PX - 14, 3); g.fill();
    g.fillStyle = '#e67589';
    const hx = artCx, hy = artCy - 4;
    g.beginPath();
    g.moveTo(hx, hy + 10);
    g.bezierCurveTo(hx - 18, hy - 8, hx - 18, hy + 18, hx, hy + 26);
    g.bezierCurveTo(hx + 18, hy + 18, hx + 18, hy - 8, hx, hy + 10);
    g.fill();
    g.fillStyle = 'rgba(90, 60, 30, 0.35)';
    circle(g, artCx, artCy - ART_HEIGHT_PX / 2 - 6, 1.8); g.fill();
  }

  function drawFloorStatic(g) {
    /** Wooden floor + plank lines + sunlight pool + cozy rug. */
    const { width, height, floorScreenY, pxPerM } = viewport;
    g.fillStyle = PALETTE.floor;
    g.fillRect(0, floorScreenY, width, height - floorScreenY);
    // Horizontal plank lines
    g.strokeStyle = PALETTE.floorEdge; g.lineWidth = 1.2;
    for (let i = 0; i < FLOOR_PLANK_H_LINE_COUNT; i++) {
      const y = floorScreenY + (i + 1) * ((height - floorScreenY) / (FLOOR_PLANK_H_LINE_COUNT + 1));
      g.globalAlpha = 0.35 + 0.1 * ((i * 37) % 5) / 5;
      g.beginPath(); g.moveTo(0, y); g.lineTo(width, y); g.stroke();
    }
    // Staggered vertical seams
    for (let i = 0; i < FLOOR_PLANK_V_SEAM_COUNT; i++) {
      const x = ((i * 173) % width) + (i % 2) * 30;
      const yStart = floorScreenY + (i % 4) * ((height - floorScreenY) / 4);
      const yEnd = yStart + (height - floorScreenY) / 4;
      g.globalAlpha = 0.25;
      g.beginPath(); g.moveTo(x, yStart); g.lineTo(x, yEnd); g.stroke();
    }
    g.globalAlpha = 1;

    // Warm sunlight pool beneath the window
    const lightCx = width * LIGHT_POOL_CX_FRAC;
    const lightCy = floorScreenY + LIGHT_POOL_OFFSET_Y_PX;
    const lightR = Math.min(LIGHT_POOL_MAX_RADIUS_PX, width * LIGHT_POOL_RADIUS_FRAC);
    g.save();
    g.translate(lightCx, lightCy);
    g.scale(1, LIGHT_POOL_Y_SCALE);
    const lightGrad = g.createRadialGradient(0, 0, 8, 0, 0, lightR);
    lightGrad.addColorStop(0, 'rgba(255, 236, 190, 0.42)');
    lightGrad.addColorStop(1, 'rgba(255, 236, 190, 0)');
    g.fillStyle = lightGrad;
    g.beginPath(); g.arc(0, 0, lightR, 0, Math.PI * 2); g.fill();
    g.restore();

    // Cozy oval rug over the spawn area
    const rugCenter = worldToScreen(ROOM.SPAWN_X + RUG_CENTER_OFFSET_M, 0);
    const rugRx = pxPerM * RUG_RX_M;
    const rugRy = pxPerM * RUG_RY_M;
    g.fillStyle = 'rgba(60, 40, 25, 0.16)';
    ellipse(g, rugCenter.x + 4, rugCenter.y + 10, rugRx * 1.02, rugRy * 1.05); g.fill();
    g.fillStyle = PALETTE.rug;
    ellipse(g, rugCenter.x, rugCenter.y + 6, rugRx, rugRy); g.fill();
    g.fillStyle = PALETTE.rugInner;
    ellipse(g, rugCenter.x, rugCenter.y + 5, rugRx * 0.72, rugRy * 0.72); g.fill();
    g.fillStyle = '#fbe7ea';
    ellipse(g, rugCenter.x, rugCenter.y + 5, rugRx * 0.22, rugRy * 0.28); g.fill();
    g.strokeStyle = '#c98a90'; g.lineWidth = 1.5;
    for (let i = 0; i < RUG_TASSEL_COUNT; i++) {
      const a = (i / RUG_TASSEL_COUNT) * Math.PI * 2;
      const x1 = rugCenter.x + Math.cos(a) * rugRx;
      const y1 = rugCenter.y + 6 + Math.sin(a) * rugRy;
      const x2 = x1 + Math.cos(a) * 5;
      const y2 = y1 + Math.sin(a) * 5;
      g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
    }
  }

  function drawCribStatic(g) {
    /** Left-side crib: several decorative bars behind the one physical bar. */
    const { pxPerM } = viewport;
    const phys = worldToScreen(ROOM.CRIB_BAR_X, 0);
    const barH = pxPerM * (ROOM.CRIB_BAR_HALF_HEIGHT * 2);
    const barW = Math.max(6, pxPerM * ROOM.CRIB_BAR_HALF_WIDTH * 2);
    for (let i = 0; i < 3; i++) {
      const x = phys.x - 30 - i * 20;
      g.fillStyle = shade(PALETTE.crib, -0.15 - i * 0.05);
      roundedRect(g, x - barW / 2, phys.y - barH, barW, barH, 3); g.fill();
    }
    g.fillStyle = shade(PALETTE.crib, -0.05);
    roundedRect(g, phys.x - 90, phys.y - barH - 10, 100, 10, 3); g.fill();
    g.fillStyle = PALETTE.crib;
    roundedRect(g, phys.x - barW / 2, phys.y - barH, barW, barH, 3); g.fill();
    g.strokeStyle = shade(PALETTE.crib, -0.25); g.lineWidth = 1;
    g.strokeRect(phys.x - barW / 2, phys.y - barH, barW, barH);
  }

  function drawTeddyBearStatic(g) {
    /** Small teddy bear propped near the crib. Blurred with the rest of the bg. */
    const { pxPerM } = viewport;
    const groundPt = worldToScreen(ROOM.CRIB_BAR_X + TEDDY_OFFSET_FROM_CRIB_M, 0);
    const cxT = groundPt.x, cyT = groundPt.y;
    const m = pxPerM;
    g.fillStyle = 'rgba(60, 40, 25, 0.22)';
    ellipse(g, cxT + 2, cyT + 4, 0.09 * m, 0.02 * m); g.fill();
    g.fillStyle = '#c39167';
    ellipse(g, cxT, cyT - 0.07 * m, 0.075 * m, 0.085 * m); g.fill();
    g.fillStyle = '#c9976d';
    circle(g, cxT, cyT - 0.17 * m, 0.055 * m); g.fill();
    circle(g, cxT - 0.04 * m, cyT - 0.21 * m, 0.022 * m); g.fill();
    circle(g, cxT + 0.04 * m, cyT - 0.21 * m, 0.022 * m); g.fill();
    g.fillStyle = '#e5b98d';
    circle(g, cxT - 0.04 * m, cyT - 0.21 * m, 0.012 * m); g.fill();
    circle(g, cxT + 0.04 * m, cyT - 0.21 * m, 0.012 * m); g.fill();
    g.fillStyle = '#efd5b3';
    ellipse(g, cxT, cyT - 0.155 * m, 0.028 * m, 0.02 * m); g.fill();
    g.fillStyle = '#2b1d15';
    circle(g, cxT, cyT - 0.165 * m, 0.006 * m); g.fill();
    circle(g, cxT - 0.018 * m, cyT - 0.185 * m, 0.005 * m); g.fill();
    circle(g, cxT + 0.018 * m, cyT - 0.185 * m, 0.005 * m); g.fill();
    g.fillStyle = '#e5b98d';
    ellipse(g, cxT, cyT - 0.06 * m, 0.04 * m, 0.05 * m); g.fill();
    g.fillStyle = '#c39167';
    ellipse(g, cxT - 0.03 * m, cyT - 0.005 * m, 0.025 * m, 0.016 * m); g.fill();
    ellipse(g, cxT + 0.03 * m, cyT - 0.005 * m, 0.025 * m, 0.016 * m); g.fill();
    ellipse(g, cxT - 0.065 * m, cyT - 0.08 * m, 0.025 * m, 0.04 * m); g.fill();
    ellipse(g, cxT + 0.065 * m, cyT - 0.08 * m, 0.025 * m, 0.04 * m); g.fill();
  }

  function drawMobileBeamStatic(g) {
    /** Ceiling beam (full width). The swaying mobile parts below it are animated. */
    const { width } = viewport;
    g.fillStyle = '#c9a982';
    g.fillRect(0, 0, width, BEAM_HEIGHT_PX);
    g.fillStyle = shade('#c9a982', -0.2);
    g.fillRect(0, BEAM_HEIGHT_PX - 2, width, 3);
    g.fillStyle = shade('#c9a982', -0.35);
    const knotSpacing = (width - 80) / Math.max(1, BEAM_KNOT_COUNT - 1);
    for (let i = 0; i < BEAM_KNOT_COUNT; i++) {
      circle(g, 40 + i * knotSpacing, BEAM_HEIGHT_PX / 2, 3); g.fill();
    }
  }

  // ---- Animated overlays (per frame) --------------------------------------

  function drawCloudAnimated(g) {
    /** The one drifting cloud inside the window. Small region, blur cost low. */
    const { width, height, floorScreenY } = viewport;
    const winW = Math.min(WINDOW_WIDTH_MAX_PX, width * WINDOW_WIDTH_FRAC);
    const winH = winW * WINDOW_ASPECT;
    const winX = width * WINDOW_X_FRAC;
    const winY = floorScreenY - winH - Math.min(WINDOW_TOP_MAX_PX, height * WINDOW_TOP_BELOW_FLOOR_FRAC);
    const drift = reducedMotion ? 0 : Math.sin(ambient.t * CLOUD_DRIFT_HZ) * winW * CLOUD_DRIFT_AMP_FRAC;
    g.fillStyle = 'rgba(255,255,255,0.9)';
    ellipse(g, winX + winW * 0.35 + drift, winY + winH * 0.45, 26, 12); g.fill();
    ellipse(g, winX + winW * 0.5 + drift, winY + winH * 0.42, 22, 14); g.fill();
    ellipse(g, winX + winW * 0.62 + drift, winY + winH * 0.5, 18, 10); g.fill();
  }

  function drawMobileAnimated(g) {
    /** The vertical string, horizontal bar, star strings, and stars. */
    const { width } = viewport;
    const spawnScreen = worldToScreen(ROOM.SPAWN_X + 0.15, 0);
    const anchorX = Math.max(MOBILE_ANCHOR_LEFT_CLAMP_PX,
                             Math.min(width * MOBILE_ANCHOR_RIGHT_CLAMP_FRAC, spawnScreen.x));
    const anchorY = MOBILE_ANCHOR_Y_PX;
    const sway = reducedMotion ? 0 : Math.sin(ambient.t * MOBILE_SWAY_HZ) * MOBILE_SWAY_AMP_PX;
    // Vertical string from the ceiling beam to the hanger anchor
    g.strokeStyle = '#7f6c58'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(anchorX, 0); g.lineTo(anchorX, anchorY); g.stroke();
    // Horizontal hanger bar (sways left-right)
    g.beginPath();
    g.moveTo(anchorX - MOBILE_HANGER_HALF_W_PX + sway * 0.3, anchorY);
    g.lineTo(anchorX + MOBILE_HANGER_HALF_W_PX + sway * 0.3, anchorY);
    g.stroke();
    // Star strings + stars
    for (let i = 0; i < MOBILE_STAR_OFFSETS.length; i++) {
      const off = MOBILE_STAR_OFFSETS[i];
      const color = MOBILE_STAR_COLORS[i];
      const localSway = reducedMotion ? 0
        : Math.sin(ambient.t * MOBILE_STAR_LOCAL_SWAY_HZ + off * 0.05) * MOBILE_STAR_LOCAL_SWAY_AMP_PX;
      const sx = anchorX + off + sway * (0.3 + off * 0.005);
      const sy = anchorY + MOBILE_STAR_DROP_PX + localSway;
      g.strokeStyle = '#7f6c58'; g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(anchorX + off + sway * 0.3, anchorY); g.lineTo(sx, sy); g.stroke();
      drawStar(g, sx, sy, MOBILE_STAR_OUTER_PX, MOBILE_STAR_INNER_PX, color);
    }
  }

  function drawStar(g, cx, cy, outer, inner, color) {
    g.fillStyle = color;
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? outer : inner;
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.closePath();
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.15)'; g.lineWidth = 1; g.stroke();
  }

  return { resize, render };
}
