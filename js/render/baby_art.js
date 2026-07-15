// Baby art: dresses the physics ragdoll as an onesie'd newborn. Supine and
// prone states, roll-over squash animation, expression driven by sim state
// (meltdown, joy, scrambled, calm), plus the local contact shadow that
// grounds the baby on the floor.

import { PALETTE, ROOM } from '../config.js';
import { roundedRect, ellipse, circle, capsule, worldPoint, shade } from './helpers.js';

// ---- Baby anatomy sizes (all in world meters, multiplied by pxPerM) -------

const HEAD_RADIUS_M = 0.078;
const TORSO_HALF_W_M = 0.11;
const TORSO_HALF_H_M = 0.055;

// Physics ragdoll segment lengths, used to recover fixture endpoints for capsules.
const ARM_PROX_HALF_LEN_M = 0.052;
const ARM_DIST_HALF_LEN_M = 0.048;
const LEG_PROX_HALF_LEN_M = 0.058;
const LEG_DIST_HALF_LEN_M = 0.052;

// Capsule widths in screen px. Baby is small; these read at the current scale.
const ARM_WIDTH_PX = 20;
const LEG_WIDTH_PX = 26;
const HAND_RADIUS_PX = 11;
const FOOT_RX_PX = 14;
const FOOT_RY_PX = 11;

// ---- Roll-over animation --------------------------------------------------

// Horizontal squash during the flip: 1 -> 0.2 -> 1 as rollAnim animates.
const ROLL_SQUASH_MIN = 0.2;
// Radial "motion lines" around the baby during a roll.
const ROLL_MOTION_LINE_COUNT = 6;
// Rock-charge halo: glow radius grows as rockCharge builds.
const ROCK_HALO_BASE_RADIUS_PX = 80;
const ROCK_HALO_GROWTH_PX = 40;

// ---- Local floor shadow ---------------------------------------------------

const BABY_SHADOW_RX_M = 0.22;
const BABY_SHADOW_RY_M = 0.05;

export function createBabyArt({ viewport, worldToScreen, ambient, effects, reducedMotion }) {
  /** All entry points read the current sim snapshot each call so the drawings
   *  stay in sync with the physics. `effects` is shared with the effects layer
   *  (for milestoneJoyT). No mutable state lives in this module. */

  function drawContactShadow(g, sim) {
    /** Soft ellipse under the baby's torso: the crisp contact cue that
     *  replaced the old scene-wide floor band. */
    const { pxPerM } = viewport;
    const torsoPos = sim.baby.parts.torso.getPosition();
    const s = worldToScreen(torsoPos.x, 0);
    const shadowRx = pxPerM * BABY_SHADOW_RX_M;
    const shadowRy = pxPerM * BABY_SHADOW_RY_M;
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

  function draw(g, sim) {
    /** Full baby drawing: dress the ragdoll with onesie limbs, torso, head, face. */
    const parts = sim.baby.parts;
    const snap = sim.getSnapshot();
    const prone = snap.facing === 'down';
    const rollAnim = snap.rollAnim || 0;
    const rockCharge = snap.rockCharge || 0;

    // Roll-over squash: horizontal scale flips 1 -> ROLL_SQUASH_MIN -> 1 across the arc.
    let squashScale = 1;
    if (rollAnim > 0) {
      const phase = 1 - rollAnim;
      const tri = Math.abs(0.5 - phase) * 2;
      squashScale = ROLL_SQUASH_MIN + (1 - ROLL_SQUASH_MIN) * tri;
    }

    // Depth-swap: near/far limb shading flips when prone (belly is down).
    const depthNear = prone ? 'far' : 'near';
    const depthFar = prone ? 'near' : 'far';

    // Charge shimmer: glow halo under baby as rocking builds. Suppressed prone/mid-roll.
    if (rockCharge > 0.15 && !prone && rollAnim <= 0) {
      const torsoPos = parts.torso.getPosition();
      const s = worldToScreen(torsoPos.x, torsoPos.y);
      const radius = ROCK_HALO_BASE_RADIUS_PX + rockCharge * ROCK_HALO_GROWTH_PX;
      const glow = g.createRadialGradient(s.x, s.y, 4, s.x, s.y, radius);
      glow.addColorStop(0, `rgba(255, 220, 130, ${0.35 * rockCharge})`);
      glow.addColorStop(1, 'rgba(255, 220, 130, 0)');
      g.fillStyle = glow;
      g.beginPath(); g.arc(s.x, s.y, radius, 0, Math.PI * 2); g.fill();
    }

    // Motion lines during a roll (behind the baby)
    if (rollAnim > 0 && !reducedMotion) {
      const torsoPos = parts.torso.getPosition();
      const s = worldToScreen(torsoPos.x, torsoPos.y);
      g.strokeStyle = 'rgba(180, 130, 80, 0.55)';
      g.lineWidth = 3; g.lineCap = 'round';
      for (let i = 0; i < ROLL_MOTION_LINE_COUNT; i++) {
        const a = (i / ROLL_MOTION_LINE_COUNT) * Math.PI * 2;
        const r1 = 45 + rollAnim * 20;
        const r2 = 65 + rollAnim * 30;
        g.beginPath();
        g.moveTo(s.x + Math.cos(a) * r1, s.y + Math.sin(a) * r1);
        g.lineTo(s.x + Math.cos(a) * r2, s.y + Math.sin(a) * r2);
        g.stroke();
      }
    }

    // Apply the roll squash around the torso center
    if (squashScale < 0.999) {
      const torsoPos = parts.torso.getPosition();
      const cs = worldToScreen(torsoPos.x, torsoPos.y);
      g.save();
      g.translate(cs.x, cs.y);
      g.scale(squashScale, 1);
      g.translate(-cs.x, -cs.y);
    }

    // Draw order matters: far limbs first, then torso, then near limbs, then head on top.
    drawLimb(g, parts.armFarProx, parts.armFarDist, depthFar, 'arm');
    drawLimb(g, parts.legFarProx, parts.legFarDist, depthFar, 'leg');
    drawTorso(g, parts.torso, prone);
    drawLimb(g, parts.armNearProx, parts.armNearDist, depthNear, 'arm');
    drawLimb(g, parts.legNearProx, parts.legNearDist, depthNear, 'leg');
    drawHead(g, parts.head, sim, prone);

    if (squashScale < 0.999) g.restore();
  }

  function drawLimb(g, proxBody, distBody, depth, kind) {
    /** Capsule limb with a skin-tone hand tip (arms) or sock foot (legs). */
    const isArm = kind === 'arm';
    const w = isArm ? ARM_WIDTH_PX : LEG_WIDTH_PX;
    const proxHalfLen = isArm ? ARM_PROX_HALF_LEN_M : LEG_PROX_HALF_LEN_M;
    const distHalfLen = isArm ? ARM_DIST_HALF_LEN_M : LEG_DIST_HALF_LEN_M;
    const pProx = proxBody.getPosition();
    const pDist = distBody.getPosition();
    const proxA = proxBody.getAngle();
    const distA = distBody.getAngle();
    const proxEnd1 = worldPoint(pProx, proxA, proxHalfLen, 0);
    const proxEnd2 = worldPoint(pProx, proxA, -proxHalfLen, 0);
    const distEnd1 = worldPoint(pDist, distA, distHalfLen, 0);
    const distEnd2 = worldPoint(pDist, distA, -distHalfLen, 0);
    const p1 = worldToScreen(proxEnd1.x, proxEnd1.y);
    const p2 = worldToScreen(proxEnd2.x, proxEnd2.y);
    const p3 = worldToScreen(distEnd1.x, distEnd1.y);
    const p4 = worldToScreen(distEnd2.x, distEnd2.y);

    const onesie = depth === 'far' ? PALETTE.onesieShade : PALETTE.onesie;
    capsule(g, p1.x, p1.y, p2.x, p2.y, w, onesie);
    if (isArm) {
      capsule(g, p3.x, p3.y, p4.x, p4.y, w * 0.86, onesie);
      const handEnd = worldPoint(pDist, distA, -distHalfLen - 0.02, 0);
      const hs = worldToScreen(handEnd.x, handEnd.y);
      g.fillStyle = depth === 'far' ? PALETTE.skinShade : PALETTE.skin;
      circle(g, hs.x, hs.y, HAND_RADIUS_PX); g.fill();
      g.strokeStyle = shade(g.fillStyle, -0.2); g.lineWidth = 1;
      g.beginPath(); g.arc(hs.x, hs.y, HAND_RADIUS_PX, 0, Math.PI * 2); g.stroke();
    } else {
      capsule(g, p3.x, p3.y, p4.x, p4.y, w * 0.9, onesie);
      const footEnd = worldPoint(pDist, distA, -distHalfLen - 0.025, 0);
      const fs = worldToScreen(footEnd.x, footEnd.y);
      g.fillStyle = depth === 'far' ? shade('#f2c68a', -0.15) : '#f2c68a';
      ellipse(g, fs.x, fs.y, FOOT_RX_PX, FOOT_RY_PX); g.fill();
    }
  }

  function drawTorso(g, torso, prone) {
    /** Onesie oval matching torso rotation. Prone: shows the back-bulge side up. */
    const { pxPerM } = viewport;
    const p = torso.getPosition();
    const a = torso.getAngle();
    const c = worldToScreen(p.x, p.y);
    const halfW = TORSO_HALF_W_M * pxPerM;
    const halfH = TORSO_HALF_H_M * pxPerM;
    g.save();
    g.translate(c.x, c.y);
    g.rotate(-a);
    g.fillStyle = prone ? PALETTE.onesieShade : PALETTE.onesie;
    roundedRect(g, -halfW, -halfH, halfW * 2, halfH * 2, 14); g.fill();
    if (prone) {
      // Back-bulge visible from above
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
      // Belly-side snap buttons + collar hint
      g.fillStyle = shade(PALETTE.onesie, -0.2);
      for (let i = 0; i < 3; i++) {
        circle(g, -0.06 * pxPerM + i * 0.06 * pxPerM, 0, 2); g.fill();
      }
      g.strokeStyle = PALETTE.onesieShade; g.lineWidth = 2;
      g.beginPath();
      g.arc(0.09 * pxPerM, 0, 0.05 * pxPerM, Math.PI * 0.55, Math.PI * 1.45, true);
      g.stroke();
    }
    g.restore();
  }

  function drawHead(g, head, sim, prone) {
    /** Big round head with a sim-driven face. Prone: back of head + peeking cheek. */
    const { pxPerM } = viewport;
    const p = head.getPosition();
    const a = head.getAngle();
    const s = worldToScreen(p.x, p.y);
    const radius = HEAD_RADIUS_M * pxPerM;

    g.save();
    g.translate(s.x, s.y);
    g.rotate(-a);

    if (prone) {
      // Face-down: hair cap covers most of head, one squished eye peeks
      g.fillStyle = PALETTE.skin;
      circle(g, 0, 0, radius); g.fill();
      g.fillStyle = PALETTE.hair;
      g.beginPath();
      g.arc(0, -radius * 0.1, radius * 0.95, Math.PI * 1.1, Math.PI * 1.9, false);
      g.lineTo(radius * 0.95, radius * 0.4);
      g.quadraticCurveTo(0, radius * 0.55, -radius * 0.95, radius * 0.4);
      g.closePath();
      g.fill();
      g.fillStyle = shade(PALETTE.skin, -0.1);
      ellipse(g, -radius * 0.05, radius * 0.35, radius * 0.5, radius * 0.25); g.fill();
      g.strokeStyle = '#2b1d15'; g.lineWidth = 2.5; g.lineCap = 'round';
      g.beginPath();
      g.moveTo(-radius * 0.35, radius * 0.3);
      g.quadraticCurveTo(-radius * 0.15, radius * 0.15, radius * 0.05, radius * 0.3);
      g.stroke();
      g.beginPath();
      g.moveTo(-radius * 0.15, radius * 0.5);
      g.quadraticCurveTo(0, radius * 0.42, radius * 0.2, radius * 0.5);
      g.stroke();
      g.restore();
      return;
    }

    // Face-up: full head, hair curl, sim-driven expression
    g.fillStyle = PALETTE.skin;
    circle(g, 0, 0, radius); g.fill();
    g.fillStyle = shade(PALETTE.skin, -0.12);
    ellipse(g, radius * 0.9, 0, 5, 8); g.fill();
    g.fillStyle = PALETTE.hair;
    g.beginPath();
    g.arc(-radius * 0.25, -radius * 0.85, radius * 0.35, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = PALETTE.hair; g.lineWidth = 4; g.lineCap = 'round';
    g.beginPath();
    g.moveTo(-radius * 0.5, -radius * 0.8);
    g.quadraticCurveTo(-radius * 0.9, -radius * 1.1, -radius * 0.2, -radius * 1.2);
    g.stroke();

    // Expression state
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
      const drawX = (e) => {
        g.beginPath();
        g.moveTo(e.x - eyeR, e.y - eyeR); g.lineTo(e.x + eyeR, e.y + eyeR);
        g.moveTo(e.x + eyeR, e.y - eyeR); g.lineTo(e.x - eyeR, e.y + eyeR);
        g.stroke();
      };
      drawX(leftEye); drawX(rightEye);
      g.fillStyle = '#8a3037';
      ellipse(g, 0, radius * 0.4, radius * 0.28, radius * 0.22); g.fill();
      g.fillStyle = '#e08b8b';
      ellipse(g, 0, radius * 0.48, radius * 0.14, radius * 0.09); g.fill();
      g.fillStyle = '#7ac2e6';
      ellipse(g, leftEye.x, leftEye.y + radius * 0.35, 3, 7); g.fill();
      ellipse(g, rightEye.x, rightEye.y + radius * 0.35, 3, 7); g.fill();
    } else if (joy) {
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
      g.strokeStyle = '#8a3037'; g.lineWidth = 4;
      g.beginPath();
      g.arc(0, radius * 0.15, radius * 0.5, Math.PI * 0.15, Math.PI * 0.85);
      g.stroke();
    } else if (scrambled) {
      const wobble = Math.sin(ambient.t * 20) * 1.5;
      circle(g, leftEye.x + wobble, leftEye.y, eyeR); g.fill();
      circle(g, rightEye.x - wobble, rightEye.y, eyeR); g.fill();
      g.strokeStyle = '#8a3037'; g.lineWidth = 3;
      g.beginPath();
      g.arc(0, radius * 0.3, radius * 0.18, 0, Math.PI * 2);
      g.stroke();
    } else {
      const eyeH = calm > 80 ? eyeR * 0.6 : eyeR;
      ellipse(g, leftEye.x, leftEye.y, eyeR, eyeH); g.fill();
      ellipse(g, rightEye.x, rightEye.y, eyeR, eyeH); g.fill();
      g.fillStyle = 'white';
      circle(g, leftEye.x + 2, leftEye.y - 2, 1.5); g.fill();
      circle(g, rightEye.x + 2, rightEye.y - 2, 1.5); g.fill();
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

  return { draw, drawContactShadow };
}
