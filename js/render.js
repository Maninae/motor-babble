// Canvas renderer. Draws the nursery, the physics ragdoll dressed as a baby,
// and the vision blur that clears as milestones land.
//
// World-to-screen: X grows right, Y grows UP in world space, DOWN in screen space.
// worldToScreen maps world coords into the canvas rect, keeping the floor
// pinned near the bottom third of the visible area.

import { MILESTONE_DEFS, PALETTE, ROOM } from './config.js';

const PIXELS_PER_METER = 300;
const FLOOR_SCREEN_FRAC = 0.68;         // floor sits ~68% down the canvas
// Camera targets a point BETWEEN the baby and the parent so both stay in view.
// We compute the target each frame in render().
const CAMERA_FRAME_TARGET_FRAC = 0.55;   // 0 = frame on baby, 1 = frame on parent
const CAMERA_FOLLOW_STRENGTH = 3.0;      // seconds^-1 easing factor toward target

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const bgCanvas = document.createElement('canvas');
  const bgCtx = bgCanvas.getContext('2d');

  // Ambient wobble sources for the mobile, sky, dust motes. Frozen if user prefers reduced motion.
  const ambient = { t: 0 };

  // Ephemeral overlays driven by events. Each one carries a lifetime clock.
  const effects = {
    painFlash: 0,           // seconds remaining on the red vignette
    milestoneBanner: null,  // { id, title, emoji, t }
    milestoneJoyT: 0,       // "just landed a milestone" happy-face timer
    confetti: [],           // array of { x, y, vx, vy, hue, life, size, spin }
    winConfettiSpawn: 0,
    flompShake: 0,          // seconds remaining of "flomp" screen shake after a roll
    flompFloorPuff: null,   // { x, y, t } small dust puff from a roll's floor impact
  };

  const dust = Array.from({ length: 14 }, (_, i) => ({
    seedX: (i * 137.5) % 100 / 100, seedY: (i * 91.7) % 100 / 100, phase: (i * 0.9) % (Math.PI * 2),
  }));

  let width = 0, height = 0, pxPerM = PIXELS_PER_METER;
  let floorScreenY = 0;
  // Camera starts framed at the midpoint between spawn and the parent so both are visible on load.
  let cameraX = ROOM.SPAWN_X + (ROOM.PARENT_ZONE_X - ROOM.SPAWN_X) * CAMERA_FRAME_TARGET_FRAC;

  function resize() {
    /** Match canvas backing store to CSS size, keep floor pinned, recompute px scale. */
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    width = Math.max(320, Math.floor(rect.width));
    height = Math.max(240, Math.floor(rect.height));
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    bgCanvas.width = canvas.width;
    bgCanvas.height = canvas.height;
    bgCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Choose pxPerM so the baby is big and the crib+parent fit comfortably.
    // Target ~3.6 m across the canvas: crib+rug+parent all visible.
    pxPerM = Math.min(PIXELS_PER_METER, width / 3.6);
    pxPerM = Math.max(200, pxPerM);
    floorScreenY = Math.round(height * FLOOR_SCREEN_FRAC);
  }

  window.addEventListener('resize', resize);
  resize();

  function worldToScreen(x, y) {
    /** World meters -> canvas pixels. y is world-up, screen is y-down, so invert. */
    return {
      x: width / 2 + (x - cameraX) * pxPerM,
      y: floorScreenY - y * pxPerM,
    };
  }

  // ---------- Background scene (rendered to offscreen canvas, then blurred) -----

  function drawWall(g) {
    /** Warm pastel gradient wall with subtle texture flecks. */
    const grad = g.createLinearGradient(0, 0, 0, floorScreenY);
    grad.addColorStop(0, PALETTE.wallTop);
    grad.addColorStop(1, PALETTE.wallBottom);
    g.fillStyle = grad;
    g.fillRect(0, 0, width, floorScreenY + 4);

    // A soft window: rounded rect of sky with a horizon and one cloud.
    const winW = Math.min(220, width * 0.22);
    const winH = winW * 0.75;
    const winX = width * 0.55;
    const winY = floorScreenY - winH - Math.min(80, height * 0.12);
    const frameCol = '#c9a982';
    // Frame shadow
    g.fillStyle = 'rgba(0,0,0,0.06)';
    roundedRect(g, winX - 6, winY + 8, winW + 12, winH + 12, 14); g.fill();
    // Sky
    const sky = g.createLinearGradient(0, winY, 0, winY + winH);
    sky.addColorStop(0, '#bfe1f4');
    sky.addColorStop(1, '#eaf5fb');
    g.fillStyle = sky;
    roundedRect(g, winX, winY, winW, winH, 8); g.fill();
    // Cloud (position drifts under reducedMotion=false)
    const cloudDrift = reducedMotion ? 0 : Math.sin(ambient.t * 0.2) * winW * 0.15;
    g.fillStyle = 'rgba(255,255,255,0.9)';
    ellipse(g, winX + winW * 0.35 + cloudDrift, winY + winH * 0.45, 26, 12); g.fill();
    ellipse(g, winX + winW * 0.5 + cloudDrift, winY + winH * 0.42, 22, 14); g.fill();
    ellipse(g, winX + winW * 0.62 + cloudDrift, winY + winH * 0.5, 18, 10); g.fill();
    // Window frame + cross
    g.strokeStyle = frameCol;
    g.lineWidth = 6;
    roundedRect(g, winX, winY, winW, winH, 8); g.stroke();
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(winX + winW / 2, winY); g.lineTo(winX + winW / 2, winY + winH);
    g.moveTo(winX, winY + winH / 2); g.lineTo(winX + winW, winY + winH / 2);
    g.stroke();

    // Wall art: framed heart print, positioned as intentional wall decor at
    // typical picture-hanging height (mid-wall, well clear of the ceiling mobile).
    const artW = 92, artH = 108;
    const artCx = width * 0.24;
    const artCy = floorScreenY - 245;
    // Frame drop shadow
    g.fillStyle = 'rgba(60, 40, 20, 0.14)';
    roundedRect(g, artCx - artW / 2 + 4, artCy - artH / 2 + 5, artW, artH, 6); g.fill();
    // Wooden frame
    g.fillStyle = '#b48b62';
    roundedRect(g, artCx - artW / 2, artCy - artH / 2, artW, artH, 6); g.fill();
    g.strokeStyle = '#8f6a45'; g.lineWidth = 1;
    roundedRect(g, artCx - artW / 2, artCy - artH / 2, artW, artH, 6); g.stroke();
    // Cream mat
    g.fillStyle = '#fff6e6';
    roundedRect(g, artCx - artW / 2 + 7, artCy - artH / 2 + 7, artW - 14, artH - 14, 3); g.fill();
    // Heart on the mat
    g.fillStyle = '#e67589';
    const hx = artCx, hy = artCy - 4;
    g.beginPath();
    g.moveTo(hx, hy + 10);
    g.bezierCurveTo(hx - 18, hy - 8, hx - 18, hy + 18, hx, hy + 26);
    g.bezierCurveTo(hx + 18, hy + 18, hx + 18, hy - 8, hx, hy + 10);
    g.fill();
    // Tiny nail highlight above the frame
    g.fillStyle = 'rgba(90, 60, 30, 0.35)';
    circle(g, artCx, artCy - artH / 2 - 6, 1.8); g.fill();
  }

  function drawFloor(g) {
    /** Wooden floor with plank lines, a warm sunlight pool under the window,
     *  and a cozy oval rug tucked under the baby's play area. */
    g.fillStyle = PALETTE.floor;
    g.fillRect(0, floorScreenY, width, height - floorScreenY);
    // Plank lines with slight variation
    g.strokeStyle = PALETTE.floorEdge;
    g.lineWidth = 1.2;
    for (let i = 0; i < 8; i++) {
      const y = floorScreenY + (i + 1) * ((height - floorScreenY) / 9);
      g.globalAlpha = 0.35 + 0.1 * ((i * 37) % 5) / 5;
      g.beginPath();
      g.moveTo(0, y); g.lineTo(width, y);
      g.stroke();
    }
    // Vertical seams staggered
    for (let i = 0; i < 12; i++) {
      const x = ((i * 173) % width) + (i % 2) * 30;
      const yStart = floorScreenY + (i % 4) * ((height - floorScreenY) / 4);
      const yEnd = yStart + (height - floorScreenY) / 4;
      g.globalAlpha = 0.25;
      g.beginPath();
      g.moveTo(x, yStart); g.lineTo(x, yEnd);
      g.stroke();
    }
    g.globalAlpha = 1;

    // Warm sunlight pool on the floor beneath the window. Soft, low-opacity,
    // sits behind the rug so the rug still reads clearly on top.
    const lightCx = width * 0.62;
    const lightCy = floorScreenY + 40;
    const lightR = Math.min(180, width * 0.18);
    g.save();
    g.translate(lightCx, lightCy);
    g.scale(1, 0.42);
    const lightGrad = g.createRadialGradient(0, 0, 8, 0, 0, lightR);
    lightGrad.addColorStop(0, 'rgba(255, 236, 190, 0.42)');
    lightGrad.addColorStop(1, 'rgba(255, 236, 190, 0)');
    g.fillStyle = lightGrad;
    g.beginPath(); g.arc(0, 0, lightR, 0, Math.PI * 2); g.fill();
    g.restore();

    // Cozy rug: a small oval tucked under the baby's spawn area (about a third
    // of the visible floor width) so the wooden planks stay visible around it.
    const rugCenter = worldToScreen(ROOM.SPAWN_X + 0.15, 0);
    const rugRx = pxPerM * 0.68;
    const rugRy = pxPerM * 0.2;
    // Rug shadow catching on the floor
    g.fillStyle = 'rgba(60, 40, 25, 0.16)';
    ellipse(g, rugCenter.x + 4, rugCenter.y + 10, rugRx * 1.02, rugRy * 1.05); g.fill();
    // Outer rug
    g.fillStyle = PALETTE.rug;
    ellipse(g, rugCenter.x, rugCenter.y + 6, rugRx, rugRy); g.fill();
    // Inner rug (concentric pattern)
    g.fillStyle = PALETTE.rugInner;
    ellipse(g, rugCenter.x, rugCenter.y + 5, rugRx * 0.72, rugRy * 0.72); g.fill();
    // Little cream medallion in the center
    g.fillStyle = '#fbe7ea';
    ellipse(g, rugCenter.x, rugCenter.y + 5, rugRx * 0.22, rugRy * 0.28); g.fill();
    // Rug tassels around the rim
    g.strokeStyle = '#c98a90';
    g.lineWidth = 1.5;
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * Math.PI * 2;
      const x1 = rugCenter.x + Math.cos(a) * rugRx;
      const y1 = rugCenter.y + 6 + Math.sin(a) * rugRy;
      const x2 = x1 + Math.cos(a) * 5;
      const y2 = y1 + Math.sin(a) * 5;
      g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
    }
  }

  function drawCrib(g) {
    /** Left-side crib: several decorative bars behind the one physical bar. */
    const phys = worldToScreen(ROOM.CRIB_BAR_X, 0);
    const barH = pxPerM * (ROOM.CRIB_BAR_HALF_HEIGHT * 2);
    const barW = Math.max(6, pxPerM * ROOM.CRIB_BAR_HALF_WIDTH * 2);
    // Decorative bars behind
    for (let i = 0; i < 3; i++) {
      const x = phys.x - 30 - i * 20;
      g.fillStyle = shade(PALETTE.crib, -0.15 - i * 0.05);
      roundedRect(g, x - barW / 2, phys.y - barH, barW, barH, 3); g.fill();
    }
    // Top rail
    g.fillStyle = shade(PALETTE.crib, -0.05);
    roundedRect(g, phys.x - 90, phys.y - barH - 10, 100, 10, 3); g.fill();
    // Physical bar
    g.fillStyle = PALETTE.crib;
    roundedRect(g, phys.x - barW / 2, phys.y - barH, barW, barH, 3); g.fill();
    g.strokeStyle = shade(PALETTE.crib, -0.25);
    g.lineWidth = 1;
    g.strokeRect(phys.x - barW / 2, phys.y - barH, barW, barH);
  }

  function drawMobile(g) {
    /** A hanging mobile with dangling stars that sway. */
    // Ceiling beam: a warm wooden strip across the top so the mobile has something to hang from.
    g.fillStyle = '#c9a982';
    g.fillRect(0, 0, width, 22);
    g.fillStyle = shade('#c9a982', -0.2);
    g.fillRect(0, 20, width, 3);
    // Little decorative knots on the beam
    g.fillStyle = shade('#c9a982', -0.35);
    for (let i = 0; i < 6; i++) {
      circle(g, 40 + i * (width - 80) / 5, 12, 3); g.fill();
    }
    // Mobile hangs above the baby's spawn area so it feels intentional.
    const spawnScreen = worldToScreen(ROOM.SPAWN_X + 0.15, 0);
    const anchor = { x: Math.max(120, Math.min(width * 0.55, spawnScreen.x)), y: 40 };
    const sway = reducedMotion ? 0 : Math.sin(ambient.t * 1.1) * 6;
    g.strokeStyle = '#7f6c58';
    g.lineWidth = 2;
    g.beginPath(); g.moveTo(anchor.x, 0); g.lineTo(anchor.x, anchor.y); g.stroke();
    g.beginPath();
    g.moveTo(anchor.x - 40 + sway * 0.3, anchor.y);
    g.lineTo(anchor.x + 40 + sway * 0.3, anchor.y);
    g.stroke();
    const stars = [
      { off: -40, color: '#ffcf6b' },
      { off: 0, color: '#f28ba1' },
      { off: 40, color: '#8ec6e8' },
    ];
    for (const s of stars) {
      const localSway = reducedMotion ? 0 : Math.sin(ambient.t * 1.4 + s.off * 0.05) * 3;
      const px = anchor.x + s.off + sway * (0.3 + s.off * 0.005);
      const py = anchor.y + 40 + localSway;
      g.strokeStyle = '#7f6c58'; g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(anchor.x + s.off + sway * 0.3, anchor.y); g.lineTo(px, py); g.stroke();
      drawStar(g, px, py, 12, 6, s.color);
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

  function drawParentSilhouette() {
    /** Parent body/sweater used to live here in the blurred layer. Moved to the crisp
     *  foreground so it connects to the face and arms; this stub is a no-op kept so the
     *  background composition still calls it in the same order. */
  }

  function drawTeddyBear(g) {
    /** Small teddy bear propped near the crib, sitting on the floor. Blurred with
     *  the rest of the background, so it reads as a soft warm shape at a glance. */
    const groundPt = worldToScreen(ROOM.CRIB_BAR_X + 0.28, 0);
    const cxT = groundPt.x;
    const cyT = groundPt.y;
    const m = pxPerM;
    // Contact shadow
    g.fillStyle = 'rgba(60, 40, 25, 0.22)';
    ellipse(g, cxT + 2, cyT + 4, 0.09 * m, 0.02 * m); g.fill();
    // Body
    g.fillStyle = '#c39167';
    ellipse(g, cxT, cyT - 0.07 * m, 0.075 * m, 0.085 * m); g.fill();
    // Head
    g.fillStyle = '#c9976d';
    circle(g, cxT, cyT - 0.17 * m, 0.055 * m); g.fill();
    // Ears
    circle(g, cxT - 0.04 * m, cyT - 0.21 * m, 0.022 * m); g.fill();
    circle(g, cxT + 0.04 * m, cyT - 0.21 * m, 0.022 * m); g.fill();
    // Inner ears
    g.fillStyle = '#e5b98d';
    circle(g, cxT - 0.04 * m, cyT - 0.21 * m, 0.012 * m); g.fill();
    circle(g, cxT + 0.04 * m, cyT - 0.21 * m, 0.012 * m); g.fill();
    // Muzzle
    g.fillStyle = '#efd5b3';
    ellipse(g, cxT, cyT - 0.155 * m, 0.028 * m, 0.02 * m); g.fill();
    // Nose
    g.fillStyle = '#2b1d15';
    circle(g, cxT, cyT - 0.165 * m, 0.006 * m); g.fill();
    // Eyes
    circle(g, cxT - 0.018 * m, cyT - 0.185 * m, 0.005 * m); g.fill();
    circle(g, cxT + 0.018 * m, cyT - 0.185 * m, 0.005 * m); g.fill();
    // Little tummy patch
    g.fillStyle = '#e5b98d';
    ellipse(g, cxT, cyT - 0.06 * m, 0.04 * m, 0.05 * m); g.fill();
    // Legs poking forward
    g.fillStyle = '#c39167';
    ellipse(g, cxT - 0.03 * m, cyT - 0.005 * m, 0.025 * m, 0.016 * m); g.fill();
    ellipse(g, cxT + 0.03 * m, cyT - 0.005 * m, 0.025 * m, 0.016 * m); g.fill();
    // Arms out to the sides
    ellipse(g, cxT - 0.065 * m, cyT - 0.08 * m, 0.025 * m, 0.04 * m); g.fill();
    ellipse(g, cxT + 0.065 * m, cyT - 0.08 * m, 0.025 * m, 0.04 * m); g.fill();
  }

  function renderBackground() {
    /** Everything that gets vision-blurred. Redrawn every frame because the mobile sways. */
    bgCtx.clearRect(0, 0, width, height);
    drawWall(bgCtx);
    drawFloor(bgCtx);
    drawTeddyBear(bgCtx);
    drawCrib(bgCtx);
    drawMobile(bgCtx);
    drawParentSilhouette(bgCtx);
  }

  // ---------- Foreground (crisp): parent face, baby, floor line, effects --------

  function drawParentFigure(g) {
    /** A warm parent sitting cross-legged on the floor, arms open toward the baby.
     *
     *  Anchored in world coords at ROOM.PARENT_ZONE_X so the parent is a real object
     *  in the room and the camera pans past them naturally. All sizes derive from
     *  pxPerM so the parent scales with the canvas alongside the baby and stays at a
     *  believable adult-vs-newborn ratio (roughly 2x the baby's supine length).
     *  Draw order (back-to-front): back leg, torso, near arm behind, near leg, hair
     *  back, head, face, near arm forward, hands. Kept crisp: the newborn-vision
     *  blur only touches the background layer.
     */
    const groundPt = worldToScreen(ROOM.PARENT_ZONE_X + 0.15, 0);
    const cx = Math.round(groundPt.x);
    const fy = Math.round(groundPt.y);
    const m = pxPerM;  // world-meter -> pixels

    // Proportions (in meters). Total seated height ~0.72 m, head r ~0.11 m.
    const headR = 0.11 * m;
    const shoulderY = fy - 0.44 * m;
    const shoulderHW = 0.19 * m;
    const lapTopY = fy - 0.13 * m;
    const lapHW = 0.34 * m;

    const skin = PALETTE.parentSkin;
    const skinShade = shade(skin, -0.12);
    const sweater = '#c58f9a';
    const sweaterShade = '#a26a78';
    const sweaterHi = '#d6a4ae';
    const pants = '#8f6f96';
    const pantsShade = '#6f5478';

    // ---- Crossed legs (a wide, low, rounded bell sitting on the floor) ----
    g.fillStyle = pants;
    g.beginPath();
    g.moveTo(cx - shoulderHW - 0.02 * m, lapTopY + 0.02 * m);
    // Left thigh arc down to floor
    g.quadraticCurveTo(cx - lapHW - 0.06 * m, fy - 0.08 * m, cx - lapHW, fy - 0.01 * m);
    // Floor sweep across the crossed legs
    g.quadraticCurveTo(cx, fy + 0.02 * m, cx + lapHW, fy - 0.01 * m);
    // Right thigh arc up to torso
    g.quadraticCurveTo(cx + lapHW + 0.06 * m, fy - 0.08 * m, cx + shoulderHW + 0.02 * m, lapTopY + 0.02 * m);
    // Top curve joining the two sides (belt line, slightly convex)
    g.quadraticCurveTo(cx, lapTopY - 0.04 * m, cx - shoulderHW - 0.02 * m, lapTopY + 0.02 * m);
    g.closePath();
    g.fill();
    // Pants shading on the underside for volume
    g.fillStyle = pantsShade;
    g.beginPath();
    g.moveTo(cx - lapHW * 0.95, fy - 0.02 * m);
    g.quadraticCurveTo(cx, fy + 0.02 * m, cx + lapHW * 0.95, fy - 0.02 * m);
    g.quadraticCurveTo(cx, fy - 0.06 * m, cx - lapHW * 0.95, fy - 0.02 * m);
    g.closePath();
    g.fill();
    // Two knee bumps (softer highlights on either lap side)
    g.fillStyle = shade(pants, 0.06);
    ellipse(g, cx - lapHW * 0.62, lapTopY + 0.03 * m, 0.09 * m, 0.05 * m); g.fill();
    ellipse(g, cx + lapHW * 0.62, lapTopY + 0.03 * m, 0.09 * m, 0.05 * m); g.fill();
    // Crossed shins: soft darker "V" where legs fold across each other
    g.strokeStyle = pantsShade;
    g.lineWidth = 2.5; g.lineCap = 'round';
    g.beginPath();
    g.moveTo(cx - 0.16 * m, fy - 0.05 * m);
    g.quadraticCurveTo(cx, fy - 0.08 * m, cx + 0.14 * m, fy - 0.04 * m);
    g.stroke();
    // Two bare feet peeking out (soft skin ellipses tucked under the lap crossing)
    g.fillStyle = skinShade;
    ellipse(g, cx - 0.05 * m, fy - 0.015 * m, 0.045 * m, 0.02 * m); g.fill();
    ellipse(g, cx + 0.09 * m, fy - 0.02 * m, 0.05 * m, 0.022 * m); g.fill();

    // ---- Torso (dusty rose sweater rising from the lap) ----
    // Draw as one flowing rounded shape: shoulders wider, waist narrower.
    g.fillStyle = sweater;
    g.beginPath();
    // Left shoulder top
    g.moveTo(cx - shoulderHW, shoulderY + 0.03 * m);
    // Left side down to waist
    g.quadraticCurveTo(cx - shoulderHW - 0.02 * m, (shoulderY + lapTopY) / 2 + 0.02 * m,
                       cx - shoulderHW * 0.9, lapTopY + 0.01 * m);
    // Waist across
    g.lineTo(cx + shoulderHW * 0.9, lapTopY + 0.01 * m);
    // Right side up to shoulder
    g.quadraticCurveTo(cx + shoulderHW + 0.02 * m, (shoulderY + lapTopY) / 2 + 0.02 * m,
                       cx + shoulderHW, shoulderY + 0.03 * m);
    // Rounded shoulder line across the top
    g.quadraticCurveTo(cx, shoulderY - 0.03 * m, cx - shoulderHW, shoulderY + 0.03 * m);
    g.closePath();
    g.fill();
    // Soft shading down the far (right) side for roundness. Kept low-opacity so it
    // reads as gentle volume rather than a distinct dark stripe.
    g.save();
    g.globalAlpha = 0.35;
    g.fillStyle = sweaterShade;
    g.beginPath();
    g.moveTo(cx + shoulderHW - 0.01 * m, shoulderY + 0.05 * m);
    g.quadraticCurveTo(cx + shoulderHW + 0.005 * m, (shoulderY + lapTopY) / 2, cx + shoulderHW * 0.9, lapTopY);
    g.lineTo(cx + shoulderHW * 0.7, lapTopY);
    g.quadraticCurveTo(cx + shoulderHW - 0.04 * m, (shoulderY + lapTopY) / 2, cx + shoulderHW - 0.06 * m, shoulderY + 0.05 * m);
    g.closePath(); g.fill();
    g.restore();
    // Knit ribbing texture: subtle thin vertical lines
    g.strokeStyle = sweaterShade;
    g.lineWidth = 0.7;
    g.globalAlpha = 0.4;
    for (let i = -4; i <= 4; i++) {
      const sx = cx + i * 0.038 * m;
      if (Math.abs(sx - cx) > shoulderHW * 0.92) continue;
      g.beginPath();
      g.moveTo(sx, shoulderY + 0.07 * m);
      g.lineTo(sx, lapTopY - 0.005 * m);
      g.stroke();
    }
    g.globalAlpha = 1;
    // Sweater collar/neckline: darker soft V under the neck
    g.fillStyle = sweaterShade;
    g.beginPath();
    g.moveTo(cx - 0.05 * m, shoulderY + 0.005 * m);
    g.quadraticCurveTo(cx, shoulderY + 0.04 * m, cx + 0.05 * m, shoulderY + 0.005 * m);
    g.quadraticCurveTo(cx, shoulderY - 0.005 * m, cx - 0.05 * m, shoulderY + 0.005 * m);
    g.closePath(); g.fill();
    // Neck (skin peeking above collar)
    g.fillStyle = skin;
    roundedRect(g, cx - 0.045 * m, shoulderY - 0.06 * m, 0.09 * m, 0.08 * m, 0.02 * m); g.fill();
    // Small collar shadow line at the neck base
    g.fillStyle = 'rgba(140, 90, 70, 0.18)';
    ellipse(g, cx, shoulderY, 0.055 * m, 0.014 * m); g.fill();

    // ---- Arms (sleeves reaching open toward the baby, mittens on the floor) ----
    // Near arm (baby-facing side): sweeps outward past the lap, hand resting on
    // the floor with the palm turned up toward the baby, as if inviting them over.
    const shoulderLX = cx - shoulderHW + 0.015 * m;
    const shoulderLY = shoulderY + 0.05 * m;
    const nearHandX = cx - 0.5 * m;
    const nearHandY = fy - 0.045 * m;
    g.strokeStyle = sweater;
    g.lineWidth = 0.115 * m;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(shoulderLX, shoulderLY);
    // First control: bring elbow OUT away from the torso so the arm reads as extended
    g.quadraticCurveTo(cx - 0.38 * m, shoulderY + 0.18 * m,
                       nearHandX + 0.05 * m, nearHandY - 0.03 * m);
    g.stroke();
    // Sleeve upper highlight to hint at a rounded arm cylinder
    g.strokeStyle = sweaterHi;
    g.lineWidth = 0.035 * m;
    g.globalAlpha = 0.55;
    g.beginPath();
    g.moveTo(shoulderLX - 0.01 * m, shoulderLY - 0.02 * m);
    g.quadraticCurveTo(cx - 0.38 * m, shoulderY + 0.14 * m,
                       nearHandX + 0.05 * m, nearHandY - 0.05 * m);
    g.stroke();
    g.globalAlpha = 1;
    // Cuff at wrist
    g.strokeStyle = sweaterShade;
    g.lineWidth = 0.02 * m;
    g.beginPath();
    g.arc(nearHandX + 0.05 * m, nearHandY - 0.025 * m, 0.06 * m,
          Math.PI * 0.55, Math.PI * 1.55);
    g.stroke();
    // Near hand: soft mitten resting on the floor, palm up toward the baby
    g.fillStyle = skin;
    ellipse(g, nearHandX, nearHandY, 0.085 * m, 0.06 * m); g.fill();
    // Thumb bump on the upper edge of the mitten
    g.fillStyle = shade(skin, -0.05);
    ellipse(g, nearHandX + 0.03 * m, nearHandY - 0.045 * m, 0.028 * m, 0.022 * m); g.fill();
    // Four soft finger dimples along the top curve of the mitten
    g.strokeStyle = shade(skin, -0.22); g.lineWidth = 1.4;
    for (let i = 0; i < 4; i++) {
      const fa = Math.PI + (i + 0.5) * (Math.PI / 5);
      g.beginPath();
      g.arc(nearHandX, nearHandY, 0.075 * m, fa - 0.14, fa + 0.14);
      g.stroke();
    }
    // Palm crease line on the bottom edge (subtle)
    g.strokeStyle = shade(skin, -0.18); g.lineWidth = 1.2;
    g.beginPath();
    g.arc(nearHandX, nearHandY + 0.012 * m, 0.06 * m, Math.PI * 0.2, Math.PI * 0.8);
    g.stroke();

    // Far arm (right side): also open but arcing forward, hand resting on floor.
    const shoulderRX = cx + shoulderHW - 0.015 * m;
    const shoulderRY = shoulderY + 0.05 * m;
    const farHandX = cx + 0.42 * m;
    const farHandY = fy - 0.045 * m;
    g.strokeStyle = sweater;
    g.lineWidth = 0.11 * m;
    g.beginPath();
    g.moveTo(shoulderRX, shoulderRY);
    g.quadraticCurveTo(cx + 0.4 * m, shoulderY + 0.18 * m,
                       farHandX - 0.04 * m, farHandY - 0.03 * m);
    g.stroke();
    // Cuff
    g.strokeStyle = sweaterShade;
    g.lineWidth = 0.02 * m;
    g.beginPath();
    g.arc(farHandX - 0.04 * m, farHandY - 0.025 * m, 0.055 * m,
          Math.PI * 1.45, Math.PI * 0.45);
    g.stroke();
    // Far hand: slightly darker (further from viewer's light)
    g.fillStyle = skinShade;
    ellipse(g, farHandX, farHandY, 0.078 * m, 0.055 * m); g.fill();
    // Thumb bump
    g.fillStyle = shade(skinShade, -0.05);
    ellipse(g, farHandX - 0.028 * m, farHandY - 0.04 * m, 0.026 * m, 0.02 * m); g.fill();
    // Finger dimples
    g.strokeStyle = shade(skinShade, -0.22); g.lineWidth = 1.3;
    for (let i = 0; i < 4; i++) {
      const fa = Math.PI + (i + 0.5) * (Math.PI / 5);
      g.beginPath();
      g.arc(farHandX, farHandY, 0.07 * m, fa - 0.14, fa + 0.14);
      g.stroke();
    }

    // ---- Head + face (warm, gentle, looking down toward the baby) ----
    const headX = cx;
    const headY = shoulderY - headR + 0.01 * m;

    // Hair back layer (soft bob outline behind the head, extending past the ears)
    g.fillStyle = PALETTE.parentHair;
    g.beginPath();
    g.ellipse(headX, headY - 0.01 * m, headR + 0.028 * m, headR + 0.02 * m, 0, 0, Math.PI * 2);
    g.fill();
    // A small hair "flick" behind the ear on the near side for softness
    g.beginPath();
    g.moveTo(headX - headR - 0.008 * m, headY + 0.04 * m);
    g.quadraticCurveTo(headX - headR - 0.03 * m, headY + 0.07 * m,
                       headX - headR + 0.01 * m, headY + 0.09 * m);
    g.quadraticCurveTo(headX - headR + 0.005 * m, headY + 0.05 * m,
                       headX - headR - 0.008 * m, headY + 0.04 * m);
    g.fill();
    // Head
    g.fillStyle = skin;
    circle(g, headX, headY, headR); g.fill();
    // Face volume shading on the right/far side
    g.fillStyle = 'rgba(200, 140, 100, 0.15)';
    ellipse(g, headX + 0.03 * m, headY + 0.005 * m, 0.06 * m, headR - 0.01 * m); g.fill();
    // Hair front: soft asymmetric bangs sweeping across the forehead
    g.fillStyle = PALETTE.parentHair;
    g.beginPath();
    g.moveTo(headX - headR + 0.01 * m, headY - 0.005 * m);
    g.quadraticCurveTo(headX - headR - 0.008 * m, headY - headR - 0.005 * m,
                       headX - 0.02 * m, headY - headR + 0.02 * m);
    g.quadraticCurveTo(headX + 0.03 * m, headY - headR - 0.03 * m,
                       headX + headR - 0.005 * m, headY - 0.008 * m);
    g.quadraticCurveTo(headX + headR - 0.005 * m, headY - headR * 0.75,
                       headX + 0.05 * m, headY - headR * 0.5);
    g.quadraticCurveTo(headX - 0.03 * m, headY - headR * 0.3,
                       headX - headR + 0.01 * m, headY - 0.005 * m);
    g.fill();
    // A single soft hair strand across the forehead for character
    g.strokeStyle = shade(PALETTE.parentHair, 0.12); g.lineWidth = 1.6; g.lineCap = 'round';
    g.beginPath();
    g.moveTo(headX - 0.045 * m, headY - headR + 0.02 * m);
    g.quadraticCurveTo(headX - 0.02 * m, headY - headR + 0.008 * m, headX + 0.02 * m, headY - headR + 0.028 * m);
    g.stroke();
    // Little ear peeking on the near (baby-facing) side
    g.fillStyle = skinShade;
    ellipse(g, headX - headR + 0.008 * m, headY + 0.018 * m, 0.014 * m, 0.024 * m); g.fill();

    // Warm brows: gentle arches, hair-colored so they read soft
    g.strokeStyle = shade(PALETTE.parentHair, 0.08); g.lineWidth = 2.6; g.lineCap = 'round';
    g.beginPath();
    g.moveTo(headX - 0.05 * m, headY - 0.028 * m);
    g.quadraticCurveTo(headX - 0.036 * m, headY - 0.04 * m, headX - 0.022 * m, headY - 0.03 * m);
    g.stroke();
    g.beginPath();
    g.moveTo(headX + 0.022 * m, headY - 0.03 * m);
    g.quadraticCurveTo(headX + 0.036 * m, headY - 0.04 * m, headX + 0.05 * m, headY - 0.028 * m);
    g.stroke();
    // Eyes: soft closed happy crescents (arced smiles)
    g.strokeStyle = '#2b1d15'; g.lineWidth = 3;
    g.beginPath();
    g.arc(headX - 0.036 * m, headY - 0.003 * m, 0.02 * m, Math.PI * 0.15, Math.PI * 0.85); g.stroke();
    g.beginPath();
    g.arc(headX + 0.036 * m, headY - 0.003 * m, 0.02 * m, Math.PI * 0.15, Math.PI * 0.85); g.stroke();
    // Cheek blushes
    g.fillStyle = 'rgba(230, 130, 130, 0.55)';
    ellipse(g, headX - 0.052 * m, headY + 0.03 * m, 0.024 * m, 0.014 * m); g.fill();
    ellipse(g, headX + 0.052 * m, headY + 0.03 * m, 0.024 * m, 0.014 * m); g.fill();
    // Warm smile: a little wider and thicker so it reads clearly
    g.strokeStyle = '#8a3f3f'; g.lineWidth = 3.2; g.lineCap = 'round';
    g.beginPath();
    g.arc(headX, headY + 0.032 * m, 0.036 * m, Math.PI * 0.13, Math.PI * 0.87); g.stroke();
    // Tiny upper lip peak, subtle
    g.strokeStyle = '#8a3f3f'; g.lineWidth = 1.8;
    g.beginPath();
    g.moveTo(headX - 0.008 * m, headY + 0.03 * m);
    g.quadraticCurveTo(headX, headY + 0.024 * m, headX + 0.008 * m, headY + 0.03 * m);
    g.stroke();
    // Nose hint (soft skin shadow under the bridge)
    g.strokeStyle = shade(skin, -0.28); g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(headX - 0.006 * m, headY + 0.008 * m);
    g.quadraticCurveTo(headX + 0.004 * m, headY + 0.02 * m, headX + 0.012 * m, headY + 0.01 * m);
    g.stroke();
  }

  function drawParentContactShadow(g) {
    /** Soft local shadow under the parent's crossed legs, replacing the old
     *  full-width floor band. Kept subtle so the wooden floor still reads. */
    const groundPt = worldToScreen(ROOM.PARENT_ZONE_X + 0.15, 0);
    const s = { x: groundPt.x, y: groundPt.y };
    const shadowRx = pxPerM * 0.42;
    const shadowRy = pxPerM * 0.08;
    g.save();
    g.translate(s.x, s.y + 4);
    g.scale(1, shadowRy / shadowRx);
    const grad = g.createRadialGradient(0, 0, 4, 0, 0, shadowRx);
    grad.addColorStop(0, 'rgba(60, 40, 25, 0.32)');
    grad.addColorStop(1, 'rgba(60, 40, 25, 0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(0, 0, shadowRx, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  function drawBabyContactShadow(g, sim) {
    /** Local soft shadow directly under the baby's torso. This is the crisp
     *  contact cue that replaces the old scene-wide floor band. */
    const torsoPos = sim.baby.parts.torso.getPosition();
    const s = worldToScreen(torsoPos.x, 0);
    const shadowRx = pxPerM * 0.22;
    const shadowRy = pxPerM * 0.05;
    g.save();
    g.translate(s.x, s.y + 4);
    g.scale(1, shadowRy / shadowRx);
    const grad = g.createRadialGradient(0, 0, 2, 0, 0, shadowRx);
    grad.addColorStop(0, 'rgba(60, 40, 25, 0.35)');
    grad.addColorStop(1, 'rgba(60, 40, 25, 0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(0, 0, shadowRx, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  function drawBaby(g, sim) {
    /** Dress the physics ragdoll: onesie limbs, head, face expressions. */
    const parts = sim.baby.parts;
    const snap = sim.getSnapshot();
    const prone = snap.facing === 'down';
    const rollAnim = snap.rollAnim || 0;   // 1 -> 0 across the flip
    const rockCharge = snap.rockCharge || 0;

    // Compute a cinematic flip transform: horizontal squash during the roll.
    // rollAnim = 1 at start of flip, 0 when done. squash: 1 -> ~0.2 -> 1 across the arc.
    let squashScale = 1;
    if (rollAnim > 0) {
      const phase = 1 - rollAnim;                  // 0 -> 1 as animation completes
      const tri = Math.abs(0.5 - phase) * 2;       // 1 -> 0 -> 1 triangle wave
      squashScale = 0.2 + 0.8 * tri;
    }

    // "Depth swap" flag: when prone, near/far shading swaps (belly side down).
    // When rolling, near limbs briefly flatten with the squash.
    const depthNear = prone ? 'far' : 'near';
    const depthFar = prone ? 'near' : 'far';

    // Charge shimmer: soft glowing halo under the baby as rocking builds. Not shown when prone.
    if (rockCharge > 0.15 && !prone && rollAnim <= 0) {
      const torsoPos = parts.torso.getPosition();
      const s = worldToScreen(torsoPos.x, torsoPos.y);
      const glow = g.createRadialGradient(s.x, s.y, 4, s.x, s.y, 80 + rockCharge * 40);
      glow.addColorStop(0, `rgba(255, 220, 130, ${0.35 * rockCharge})`);
      glow.addColorStop(1, 'rgba(255, 220, 130, 0)');
      g.fillStyle = glow;
      g.beginPath(); g.arc(s.x, s.y, 80 + rockCharge * 40, 0, Math.PI * 2); g.fill();
    }

    // Motion lines during a roll (behind the baby).
    if (rollAnim > 0 && !reducedMotion) {
      const torsoPos = parts.torso.getPosition();
      const s = worldToScreen(torsoPos.x, torsoPos.y);
      const lineCount = 6;
      g.strokeStyle = 'rgba(180, 130, 80, 0.55)';
      g.lineWidth = 3;
      g.lineCap = 'round';
      for (let i = 0; i < lineCount; i++) {
        const a = (i / lineCount) * Math.PI * 2;
        const r1 = 45 + rollAnim * 20;
        const r2 = 65 + rollAnim * 30;
        g.beginPath();
        g.moveTo(s.x + Math.cos(a) * r1, s.y + Math.sin(a) * r1);
        g.lineTo(s.x + Math.cos(a) * r2, s.y + Math.sin(a) * r2);
        g.stroke();
      }
    }

    // Apply the horizontal squash around torso center.
    if (squashScale < 0.999) {
      const torsoPos = parts.torso.getPosition();
      const cs = worldToScreen(torsoPos.x, torsoPos.y);
      g.save();
      g.translate(cs.x, cs.y);
      g.scale(squashScale, 1);
      g.translate(-cs.x, -cs.y);
    }

    // Far side limbs first (depth), then near limbs.
    drawLimb(g, parts.armFarProx, parts.armFarDist, depthFar, 'arm');
    drawLimb(g, parts.legFarProx, parts.legFarDist, depthFar, 'leg');
    drawTorso(g, parts.torso, prone);
    drawLimb(g, parts.armNearProx, parts.armNearDist, depthNear, 'arm');
    drawLimb(g, parts.legNearProx, parts.legNearDist, depthNear, 'leg');
    drawHead(g, parts.head, parts.torso, sim, prone);

    if (squashScale < 0.999) g.restore();
  }

  function drawLimb(g, proxBody, distBody, depth, kind) {
    /** Capsule limb. Onesie color for arms and legs alike. */
    const pProx = proxBody.getPosition();
    const pDist = distBody.getPosition();
    const s1 = worldToScreen(pProx.x, pProx.y);
    const s2 = worldToScreen(pDist.x, pDist.y);
    const isArm = kind === 'arm';
    const w = isArm ? 20 : 26;
    // Proximal segment: torso to end of upper
    // Recover end points from body angle & length
    const proxLen = isArm ? 0.052 * 2 : 0.058 * 2;
    const distLen = isArm ? 0.048 * 2 : 0.052 * 2;
    const proxA = proxBody.getAngle();
    const distA = distBody.getAngle();
    // Local (hw, 0) offset in world coords
    const proxEnd1 = worldPoint(pProx, proxA, proxLen / 2, 0);
    const proxEnd2 = worldPoint(pProx, proxA, -proxLen / 2, 0);
    const distEnd1 = worldPoint(pDist, distA, distLen / 2, 0);
    const distEnd2 = worldPoint(pDist, distA, -distLen / 2, 0);
    const p1 = worldToScreen(proxEnd1.x, proxEnd1.y);
    const p2 = worldToScreen(proxEnd2.x, proxEnd2.y);
    const p3 = worldToScreen(distEnd1.x, distEnd1.y);
    const p4 = worldToScreen(distEnd2.x, distEnd2.y);

    const onesie = depth === 'far' ? PALETTE.onesieShade : PALETTE.onesie;
    // Upper segment (proximal)
    capsule(g, p1.x, p1.y, p2.x, p2.y, w, onesie);
    // Lower segment (distal): arms get skin hand-tip; legs get sock/foot
    if (isArm) {
      capsule(g, p3.x, p3.y, p4.x, p4.y, w * 0.86, onesie);
      // Hand at outer end
      const handEnd = worldPoint(pDist, distA, -distLen / 2 - 0.02, 0);
      const hs = worldToScreen(handEnd.x, handEnd.y);
      g.fillStyle = depth === 'far' ? PALETTE.skinShade : PALETTE.skin;
      circle(g, hs.x, hs.y, 11); g.fill();
      // Thumb dimple
      g.strokeStyle = shade(g.fillStyle, -0.2); g.lineWidth = 1;
      g.beginPath(); g.arc(hs.x, hs.y, 11, 0, Math.PI * 2); g.stroke();
    } else {
      capsule(g, p3.x, p3.y, p4.x, p4.y, w * 0.9, onesie);
      // Foot
      const footEnd = worldPoint(pDist, distA, -distLen / 2 - 0.025, 0);
      const fs = worldToScreen(footEnd.x, footEnd.y);
      g.fillStyle = depth === 'far' ? shade('#f2c68a', -0.15) : '#f2c68a';
      ellipse(g, fs.x, fs.y, 14, 11); g.fill();
    }
  }

  function drawTorso(g, torso, prone) {
    /** Onesie oval matching torso rotation. When prone, draws the back-bulge side up. */
    const p = torso.getPosition();
    const a = torso.getAngle();
    const c = worldToScreen(p.x, p.y);
    const halfW = 0.11 * pxPerM;
    const halfH = 0.055 * pxPerM;
    g.save();
    g.translate(c.x, c.y);
    g.rotate(-a);
    // Body base
    g.fillStyle = prone ? PALETTE.onesieShade : PALETTE.onesie;
    roundedRect(g, -halfW, -halfH, halfW * 2, halfH * 2, 14); g.fill();
    if (prone) {
      // Back bulge visible from above: darker rounded hump sitting on top of the torso.
      g.fillStyle = shade(PALETTE.onesie, -0.15);
      g.beginPath();
      g.ellipse(0, -halfH * 0.2, halfW * 0.85, halfH * 1.05, 0, Math.PI, Math.PI * 2);
      g.fill();
      // Spine dimple
      g.strokeStyle = shade(PALETTE.onesie, -0.35);
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(-halfW * 0.5, -halfH * 0.25);
      g.quadraticCurveTo(0, -halfH * 0.5, halfW * 0.5, -halfH * 0.25);
      g.stroke();
    } else {
      // Onesie snap buttons visible on the belly side.
      g.fillStyle = shade(PALETTE.onesie, -0.2);
      for (let i = 0; i < 3; i++) {
        circle(g, -0.06 * pxPerM + i * 0.06 * pxPerM, 0, 2); g.fill();
      }
      // Little onesie collar
      g.strokeStyle = PALETTE.onesieShade; g.lineWidth = 2;
      g.beginPath();
      g.arc(0.09 * pxPerM, 0, 0.05 * pxPerM, Math.PI * 0.55, Math.PI * 1.45, true);
      g.stroke();
    }
    g.restore();
  }

  function drawHead(g, head, torso, sim, prone) {
    /** Big round head with a face driven by the sim state. When prone, face is squished into the floor. */
    const p = head.getPosition();
    const a = head.getAngle();
    const s = worldToScreen(p.x, p.y);
    const radius = 0.078 * pxPerM;

    g.save();
    g.translate(s.x, s.y);
    g.rotate(-a);

    if (prone) {
      // Face-down: back of head visible (all hair), plus a peeking cheek/eye.
      g.fillStyle = PALETTE.skin;
      circle(g, 0, 0, radius); g.fill();
      // Big hair patch covering most of the head from behind
      g.fillStyle = PALETTE.hair;
      g.beginPath();
      g.arc(0, -radius * 0.15, radius * 0.92, Math.PI * 1.15, Math.PI * 1.85, false);
      g.arc(0, -radius * 0.15, radius * 0.92, Math.PI * 0.15, Math.PI * 0.85, false);
      g.closePath();
      // Simpler: just draw a full hair cap
      g.beginPath();
      g.arc(0, -radius * 0.1, radius * 0.95, Math.PI * 1.1, Math.PI * 1.9, false);
      g.lineTo(radius * 0.95, radius * 0.4);
      g.quadraticCurveTo(0, radius * 0.55, -radius * 0.95, radius * 0.4);
      g.closePath();
      g.fill();
      // Peeking cheek (visible skin) on the near side
      g.fillStyle = shade(PALETTE.skin, -0.1);
      ellipse(g, -radius * 0.05, radius * 0.35, radius * 0.5, radius * 0.25); g.fill();
      // One squished eye
      g.strokeStyle = '#2b1d15'; g.lineWidth = 2.5; g.lineCap = 'round';
      g.beginPath();
      g.moveTo(-radius * 0.35, radius * 0.3);
      g.quadraticCurveTo(-radius * 0.15, radius * 0.15, radius * 0.05, radius * 0.3);
      g.stroke();
      // Little squished mouth (frustrated but comical)
      g.beginPath();
      g.moveTo(-radius * 0.15, radius * 0.5);
      g.quadraticCurveTo(0, radius * 0.42, radius * 0.2, radius * 0.5);
      g.stroke();
      g.restore();
      return;
    }

    // Head
    g.fillStyle = PALETTE.skin;
    circle(g, 0, 0, radius); g.fill();
    // Ear on the side away from us (small nub)
    g.fillStyle = shade(PALETTE.skin, -0.12);
    ellipse(g, radius * 0.9, 0, 5, 8); g.fill();
    // Hair curl on top
    g.fillStyle = PALETTE.hair;
    g.beginPath();
    g.arc(-radius * 0.25, -radius * 0.85, radius * 0.35, 0, Math.PI * 2);
    g.fill();
    // A single curl
    g.strokeStyle = PALETTE.hair; g.lineWidth = 4; g.lineCap = 'round';
    g.beginPath();
    g.moveTo(-radius * 0.5, -radius * 0.8);
    g.quadraticCurveTo(-radius * 0.9, -radius * 1.1, -radius * 0.2, -radius * 1.2);
    g.stroke();

    // ---------- Face state ----------
    const meltdown = sim.state.meltdownTimer > 0;
    const scrambled = sim.state.scrambleTimer > 0;
    const joy = effects.milestoneJoyT > 0;
    const calm = sim.state.calm;

    // Blushes always present
    g.fillStyle = 'rgba(230, 120, 120, 0.55)';
    ellipse(g, -radius * 0.35, radius * 0.15, radius * 0.22, radius * 0.14); g.fill();
    ellipse(g, radius * 0.15, radius * 0.2, radius * 0.22, radius * 0.14); g.fill();

    const leftEye = { x: -radius * 0.3, y: -radius * 0.1 };
    const rightEye = { x: radius * 0.25, y: -radius * 0.1 };
    const eyeR = radius * 0.13;

    g.strokeStyle = '#2b1d15';
    g.fillStyle = '#2b1d15';
    g.lineWidth = 3;
    g.lineCap = 'round';

    if (meltdown) {
      // X eyes
      const drawX = (e) => {
        g.beginPath();
        g.moveTo(e.x - eyeR, e.y - eyeR); g.lineTo(e.x + eyeR, e.y + eyeR);
        g.moveTo(e.x + eyeR, e.y - eyeR); g.lineTo(e.x - eyeR, e.y + eyeR);
        g.stroke();
      };
      drawX(leftEye); drawX(rightEye);
      // Wailing mouth
      g.fillStyle = '#8a3037';
      ellipse(g, 0, radius * 0.4, radius * 0.28, radius * 0.22); g.fill();
      // Tongue
      g.fillStyle = '#e08b8b';
      ellipse(g, 0, radius * 0.48, radius * 0.14, radius * 0.09); g.fill();
      // Tear streams
      g.fillStyle = '#7ac2e6';
      ellipse(g, leftEye.x, leftEye.y + radius * 0.35, 3, 7); g.fill();
      ellipse(g, rightEye.x, rightEye.y + radius * 0.35, 3, 7); g.fill();
    } else if (joy) {
      // Heart eyes
      const drawHeart = (e) => {
        g.fillStyle = '#e8546b';
        g.beginPath();
        const r = eyeR * 1.1;
        g.moveTo(e.x, e.y + r * 0.6);
        g.bezierCurveTo(e.x - r * 1.1, e.y - r * 0.3, e.x - r * 0.5, e.y - r * 1.1, e.x, e.y - r * 0.35);
        g.bezierCurveTo(e.x + r * 0.5, e.y - r * 1.1, e.x + r * 1.1, e.y - r * 0.3, e.x, e.y + r * 0.6);
        g.fill();
      };
      drawHeart(leftEye); drawHeart(rightEye);
      // Wide smile
      g.strokeStyle = '#8a3037'; g.lineWidth = 4;
      g.beginPath();
      g.arc(0, radius * 0.15, radius * 0.5, Math.PI * 0.15, Math.PI * 0.85);
      g.stroke();
    } else if (scrambled) {
      // Wobbly worried eyes (spirals)
      const wobble = Math.sin(ambient.t * 20) * 1.5;
      circle(g, leftEye.x + wobble, leftEye.y, eyeR); g.fill();
      circle(g, rightEye.x - wobble, rightEye.y, eyeR); g.fill();
      // O mouth
      g.strokeStyle = '#8a3037'; g.lineWidth = 3;
      g.beginPath();
      g.arc(0, radius * 0.3, radius * 0.18, 0, Math.PI * 2);
      g.stroke();
    } else {
      // Default: content dot eyes, slight upward blink under high calm
      const eyeH = calm > 80 ? eyeR * 0.6 : eyeR;
      ellipse(g, leftEye.x, leftEye.y, eyeR, eyeH); g.fill();
      ellipse(g, rightEye.x, rightEye.y, eyeR, eyeH); g.fill();
      // Eye sparkles
      g.fillStyle = 'white';
      circle(g, leftEye.x + 2, leftEye.y - 2, 1.5); g.fill();
      circle(g, rightEye.x + 2, rightEye.y - 2, 1.5); g.fill();
      // Mouth: little smile at high calm, neutral otherwise
      g.strokeStyle = '#8a3037'; g.lineWidth = 2.5;
      g.beginPath();
      if (calm > 60) {
        g.arc(0, radius * 0.28, radius * 0.22, Math.PI * 0.15, Math.PI * 0.85);
      } else {
        g.moveTo(-radius * 0.15, radius * 0.35);
        g.lineTo(radius * 0.15, radius * 0.35);
      }
      g.stroke();
    }

    g.restore();
  }

  // ---------- Ephemeral effects ---------------------------------------------

  function spawnConfetti(centerX, centerY, count, colors) {
    if (reducedMotion) return;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = 200 + Math.random() * 280;
      effects.confetti.push({
        x: centerX, y: centerY,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed - 100,
        color: colors[Math.floor(Math.random() * colors.length)],
        life: 1 + Math.random() * 0.6,
        size: 3 + Math.random() * 5,
        spin: (Math.random() - 0.5) * 8,
        angle: 0,
      });
    }
  }

  function drawConfetti(g, dt) {
    for (const c of effects.confetti) {
      c.vy += 900 * dt;
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.angle += c.spin * dt;
      c.life -= dt;
      if (c.life <= 0) continue;
      g.save();
      g.translate(c.x, c.y);
      g.rotate(c.angle);
      g.fillStyle = c.color;
      g.globalAlpha = Math.min(1, c.life * 2);
      g.fillRect(-c.size / 2, -c.size / 2, c.size, c.size * 0.6);
      g.restore();
    }
    effects.confetti = effects.confetti.filter((c) => c.life > 0);
    g.globalAlpha = 1;
  }

  function drawDust(g) {
    if (reducedMotion) return;
    g.fillStyle = 'rgba(255,240,220,0.6)';
    for (const d of dust) {
      const x = ((d.seedX * width + Math.sin(ambient.t * 0.3 + d.phase) * 40) + width) % width;
      const y = ((d.seedY * (height * 0.6) + Math.cos(ambient.t * 0.25 + d.phase) * 20));
      circle(g, x, y, 1.5 + Math.sin(ambient.t + d.phase) * 0.5); g.fill();
    }
  }

  function drawPainVignette(g) {
    if (effects.painFlash <= 0) return;
    const alpha = Math.min(0.55, effects.painFlash * 1.1);
    const grad = g.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.2, width / 2, height / 2, Math.max(width, height) * 0.7);
    grad.addColorStop(0, `rgba(220,60,50,0)`);
    grad.addColorStop(1, `rgba(220,60,50,${alpha})`);
    g.fillStyle = grad;
    g.fillRect(0, 0, width, height);
  }

  function drawMilestoneBanner(g) {
    if (!effects.milestoneBanner) return;
    const m = effects.milestoneBanner;
    const t = m.t;
    const bannerY = Math.min(120, height * 0.14);
    const alpha = t > 2.5 ? 1 - (t - 2.5) / 0.5 : 1;
    g.save();
    g.globalAlpha = Math.max(0, alpha);
    // Banner background
    const bannerW = Math.min(560, width * 0.7);
    const bx = width / 2 - bannerW / 2;
    // Ribbon
    g.fillStyle = 'rgba(255, 250, 240, 0.95)';
    roundedRect(g, bx, bannerY - 30, bannerW, 60, 30); g.fill();
    g.strokeStyle = '#e8b45c'; g.lineWidth = 3;
    roundedRect(g, bx, bannerY - 30, bannerW, 60, 30); g.stroke();
    // Text
    g.fillStyle = '#5a3a1a';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '600 22px system-ui, sans-serif';
    g.fillText(`${m.emoji}  milestone: ${m.title.toLowerCase()}`, width / 2, bannerY);
    g.restore();
  }

  function drawWinOverlay(g, sim) {
    if (!sim.state.won) return;
    // A soft warm wash
    g.fillStyle = 'rgba(255, 235, 210, 0.55)';
    g.fillRect(0, 0, width, height);
    // Center card
    const cardW = Math.min(560, width * 0.7);
    const cardH = 210;
    const cx = width / 2 - cardW / 2;
    const cy = height / 2 - cardH / 2 - 40;
    g.fillStyle = 'rgba(255, 253, 248, 0.95)';
    roundedRect(g, cx, cy, cardW, cardH, 24); g.fill();
    g.strokeStyle = '#e8b45c'; g.lineWidth = 4;
    roundedRect(g, cx, cy, cardW, cardH, 24); g.stroke();
    g.fillStyle = '#5a3a1a';
    g.textAlign = 'center';
    g.font = '700 34px system-ui, sans-serif';
    g.fillText('you made it to your parent', width / 2, cy + 60);
    g.font = '500 20px system-ui, sans-serif';
    g.fillStyle = '#7a5a3a';
    const mm = Math.floor(sim.state.time / 60);
    const ss = Math.floor(sim.state.time % 60).toString().padStart(2, '0');
    g.fillText(`total time: ${mm}:${ss}`, width / 2, cy + 105);
    g.font = '400 16px system-ui, sans-serif';
    g.fillText('press "new body" for a fresh scrambled nervous system', width / 2, cy + 145);
    g.font = '500 22px system-ui, sans-serif';
    g.fillText('🎉', width / 2 - 100, cy + 65);
    g.fillText('🎉', width / 2 + 100, cy + 65);
  }

  // ---------- Public API -----------------------------------------------------

  function noteEvent(event) {
    /** Called from main.js for each sim event so the renderer can play visual effects. */
    switch (event.type) {
      case 'pain':
        effects.painFlash = 0.5;
        spawnConfetti(width / 2, height / 2, 6, ['#c94a3b']);
        break;
      case 'milestone':
        {
          const def = MILESTONE_DEFS.find((m) => m.id === event.id);
          if (def) {
            effects.milestoneBanner = { id: def.id, title: def.title, emoji: def.emoji, t: 0 };
            effects.milestoneJoyT = 1.5;
            spawnConfetti(width / 2, height / 2, 80, ['#ffcf6b', '#f28ba1', '#8ec6e8', '#a8d8c9', '#b5ea9d']);
          }
        }
        break;
      case 'meltdown':
        effects.painFlash = Math.max(effects.painFlash, 0.3);
        break;
      case 'roll':
        effects.flompShake = 0.35;
        // Floor puff: spawn some soft particles near the floor under the baby's approximate position.
        effects.flompFloorPuff = { t: 0.6 };
        break;
      default: break;
    }
  }

  function render(sim, dt) {
    /** Main draw. Called every animation frame. */
    ambient.t += reducedMotion ? 0 : dt;
    // Camera targets the midpoint (weighted) between the baby and the parent so both stay in view.
    const torsoX = sim.baby.parts.torso.getPosition().x;
    const targetX = torsoX + (ROOM.PARENT_ZONE_X - torsoX) * CAMERA_FRAME_TARGET_FRAC;
    cameraX += (targetX - cameraX) * Math.min(1, dt * CAMERA_FOLLOW_STRENGTH);
    effects.painFlash = Math.max(0, effects.painFlash - dt);
    effects.milestoneJoyT = Math.max(0, effects.milestoneJoyT - dt);
    effects.flompShake = Math.max(0, effects.flompShake - dt);
    if (effects.flompFloorPuff) {
      effects.flompFloorPuff.t -= dt;
      if (effects.flompFloorPuff.t <= 0) effects.flompFloorPuff = null;
    }
    if (effects.milestoneBanner) {
      effects.milestoneBanner.t += dt;
      if (effects.milestoneBanner.t > 3.0) effects.milestoneBanner = null;
    }

    // Background: warm room, blurred by vision level.
    renderBackground();
    const blur = sim.getSnapshot().blurPx;
    ctx.clearRect(0, 0, width, height);
    // "Flomp" shake: translate the whole render by a small oscillating offset while active.
    let shakeX = 0, shakeY = 0;
    if (effects.flompShake > 0 && !reducedMotion) {
      const amp = 6 * (effects.flompShake / 0.35);
      shakeX = Math.sin(ambient.t * 40) * amp;
      shakeY = Math.cos(ambient.t * 48) * amp * 0.5;
    }
    ctx.save();
    ctx.translate(shakeX, shakeY);
    ctx.filter = blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : 'none';
    ctx.drawImage(bgCanvas, 0, 0, canvas.width, canvas.height, 0, 0, width, height);
    ctx.filter = 'none';

    // Crisp foreground. Order matters: local contact shadows under characters
    // sit behind them; parent renders behind the baby so a reaching arm can pass
    // over the baby without covering them; dust sits behind everything; confetti
    // and the pain vignette go on top.
    drawParentContactShadow(ctx);
    drawBabyContactShadow(ctx, sim);
    drawParentFigure(ctx);
    drawDust(ctx);
    drawFlompPuff(ctx, sim);
    drawBaby(ctx, sim);
    drawConfetti(ctx, dt);
    drawPainVignette(ctx);
    ctx.restore();
    drawMilestoneBanner(ctx);

    // Win overlay
    drawWinOverlay(ctx, sim);
    if (sim.state.won && !reducedMotion) {
      effects.winConfettiSpawn += dt;
      if (effects.winConfettiSpawn > 0.15) {
        effects.winConfettiSpawn = 0;
        spawnConfetti(Math.random() * width, -10, 8, ['#ffcf6b', '#f28ba1', '#8ec6e8', '#a8d8c9']);
      }
    }
  }

  function drawFlompPuff(g, sim) {
    if (!effects.flompFloorPuff || reducedMotion) return;
    const puffLifeT = 1 - effects.flompFloorPuff.t / 0.6;   // 0 -> 1
    const alpha = 1 - puffLifeT;
    const torsoPos = sim.baby.parts.torso.getPosition();
    const s = worldToScreen(torsoPos.x, 0);
    g.save();
    g.globalAlpha = alpha * 0.7;
    g.fillStyle = '#e2c9a4';
    // Two dust puffs left and right
    ellipse(g, s.x - 20 - puffLifeT * 20, s.y - 4 - puffLifeT * 8, 12 + puffLifeT * 10, 6 + puffLifeT * 6); g.fill();
    ellipse(g, s.x + 20 + puffLifeT * 20, s.y - 4 - puffLifeT * 8, 12 + puffLifeT * 10, 6 + puffLifeT * 6); g.fill();
    g.restore();
  }

  return { render, noteEvent, resize };
}

// ---------- Helpers ---------------------------------------------------------

function roundedRect(g, x, y, w, h, r) {
  const rr = Math.min(r, Math.min(w, h) / 2);
  g.beginPath();
  g.moveTo(x + rr, y);
  g.lineTo(x + w - rr, y);
  g.quadraticCurveTo(x + w, y, x + w, y + rr);
  g.lineTo(x + w, y + h - rr);
  g.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  g.lineTo(x + rr, y + h);
  g.quadraticCurveTo(x, y + h, x, y + h - rr);
  g.lineTo(x, y + rr);
  g.quadraticCurveTo(x, y, x + rr, y);
  g.closePath();
}

function ellipse(g, cx, cy, rx, ry) {
  g.beginPath();
  g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
}

function circle(g, cx, cy, r) {
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
}

function capsule(g, x1, y1, x2, y2, w, color) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  const nx = -dy / len, ny = dx / len;
  const hw = w / 2;
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(x1 + nx * hw, y1 + ny * hw);
  g.lineTo(x2 + nx * hw, y2 + ny * hw);
  g.arc(x2, y2, hw, Math.atan2(ny, nx), Math.atan2(-ny, -nx), false);
  g.lineTo(x1 - nx * hw, y1 - ny * hw);
  g.arc(x1, y1, hw, Math.atan2(-ny, -nx), Math.atan2(ny, nx), false);
  g.closePath();
  g.fill();
  g.strokeStyle = shade(color, -0.25);
  g.lineWidth = 1;
  g.stroke();
}

function worldPoint(pos, angle, lx, ly) {
  /** Rotate (lx, ly) by `angle` and translate by pos, returning world coords. */
  const c = Math.cos(angle), s = Math.sin(angle);
  return { x: pos.x + c * lx - s * ly, y: pos.y + s * lx + c * ly };
}

function shade(hex, amount) {
  /** Lighten (>0) or darken (<0) a #rrggbb color by fraction. Accepts rgba() too. */
  if (hex.startsWith('rgba')) return hex;
  const m = hex.match(/^#([0-9a-f]{6})$/i);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const t = amount > 0 ? 255 : 0;
  const p = Math.abs(amount);
  r = Math.round(r + (t - r) * p);
  g = Math.round(g + (t - g) * p);
  b = Math.round(b + (t - b) * p);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}
