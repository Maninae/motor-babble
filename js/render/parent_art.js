// Parent art: warm adult sitting cross-legged on the floor with arms open
// toward the baby. World-anchored at ROOM.PARENT_ZONE_X so the camera pans
// past them naturally; all sizes derive from pxPerM so proportions hold.
//
// Kept crisp (drawn onto the main ctx, not the blurred background) so the
// caring face reads even at high newborn-vision blur. The seated silhouette
// replaces the earlier "wall + head" that dominated the right edge.

import { PALETTE, ROOM } from '../config.js';
import { roundedRect, ellipse, circle, shade } from './helpers.js';

// ---- Parent proportions (all in world meters) -----------------------------

const PARENT_ANCHOR_X_OFFSET_M = 0.15;   // world offset from ROOM.PARENT_ZONE_X
const HEAD_RADIUS_M = 0.11;              // seated total ~0.72 m, head ~2x baby's
const SHOULDER_Y_ABOVE_FLOOR_M = 0.44;
const SHOULDER_HALF_W_M = 0.19;
const LAP_TOP_ABOVE_FLOOR_M = 0.13;
const LAP_HALF_W_M = 0.34;

// ---- Parent palette (kept local; the shared PALETTE only has skin/hair) ---

const SWEATER = '#c58f9a';
const SWEATER_SHADE = '#a26a78';
const SWEATER_HIGHLIGHT = '#d6a4ae';
const PANTS = '#8f6f96';
const PANTS_SHADE = '#6f5478';
const BROW = '#3d2618';
const EYE = '#2b1d15';
const SMILE = '#8a3f3f';

// ---- Contact shadow -------------------------------------------------------

const SHADOW_RX_M = 0.42;
const SHADOW_RY_M = 0.08;

export function createParentArt({ viewport, worldToScreen }) {
  /** All entry points recompute anchor + sizes each call, so camera pans and
   *  resize updates come through naturally. No mutable state in this module. */

  function drawContactShadow(g) {
    /** Soft local shadow under the parent's crossed legs. */
    const { pxPerM } = viewport;
    const groundPt = worldToScreen(ROOM.PARENT_ZONE_X + PARENT_ANCHOR_X_OFFSET_M, 0);
    const shadowRx = pxPerM * SHADOW_RX_M;
    const shadowRy = pxPerM * SHADOW_RY_M;
    g.save();
    g.translate(groundPt.x, groundPt.y + 4);
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

  function drawFigure(g) {
    /** Full parent figure. Draw order: crossed legs, torso, arms, head, face. */
    const { pxPerM } = viewport;
    const groundPt = worldToScreen(ROOM.PARENT_ZONE_X + PARENT_ANCHOR_X_OFFSET_M, 0);
    const cx = Math.round(groundPt.x);
    const fy = Math.round(groundPt.y);
    const m = pxPerM;

    const headR = HEAD_RADIUS_M * m;
    const shoulderY = fy - SHOULDER_Y_ABOVE_FLOOR_M * m;
    const shoulderHW = SHOULDER_HALF_W_M * m;
    const lapTopY = fy - LAP_TOP_ABOVE_FLOOR_M * m;
    const lapHW = LAP_HALF_W_M * m;

    const skin = PALETTE.parentSkin;
    const skinShade = shade(skin, -0.12);

    drawCrossedLegs(g, cx, fy, shoulderHW, lapTopY, lapHW, m, skinShade);
    drawTorso(g, cx, shoulderY, lapTopY, shoulderHW, m, skin);
    drawArms(g, cx, fy, shoulderY, shoulderHW, m, skin, skinShade);
    drawHead(g, cx, shoulderY, headR, m, skin, skinShade);
  }

  function drawCrossedLegs(g, cx, fy, shoulderHW, lapTopY, lapHW, m, skinShade) {
    /** A wide, low, rounded bell sitting on the floor with knee bumps + crossed shins. */
    g.fillStyle = PANTS;
    g.beginPath();
    g.moveTo(cx - shoulderHW - 0.02 * m, lapTopY + 0.02 * m);
    g.quadraticCurveTo(cx - lapHW - 0.06 * m, fy - 0.08 * m, cx - lapHW, fy - 0.01 * m);
    g.quadraticCurveTo(cx, fy + 0.02 * m, cx + lapHW, fy - 0.01 * m);
    g.quadraticCurveTo(cx + lapHW + 0.06 * m, fy - 0.08 * m, cx + shoulderHW + 0.02 * m, lapTopY + 0.02 * m);
    g.quadraticCurveTo(cx, lapTopY - 0.04 * m, cx - shoulderHW - 0.02 * m, lapTopY + 0.02 * m);
    g.closePath();
    g.fill();
    // Underside shading for volume
    g.fillStyle = PANTS_SHADE;
    g.beginPath();
    g.moveTo(cx - lapHW * 0.95, fy - 0.02 * m);
    g.quadraticCurveTo(cx, fy + 0.02 * m, cx + lapHW * 0.95, fy - 0.02 * m);
    g.quadraticCurveTo(cx, fy - 0.06 * m, cx - lapHW * 0.95, fy - 0.02 * m);
    g.closePath();
    g.fill();
    // Knee bumps
    g.fillStyle = shade(PANTS, 0.06);
    ellipse(g, cx - lapHW * 0.62, lapTopY + 0.03 * m, 0.09 * m, 0.05 * m); g.fill();
    ellipse(g, cx + lapHW * 0.62, lapTopY + 0.03 * m, 0.09 * m, 0.05 * m); g.fill();
    // Crossed-shins V
    g.strokeStyle = PANTS_SHADE; g.lineWidth = 2.5; g.lineCap = 'round';
    g.beginPath();
    g.moveTo(cx - 0.16 * m, fy - 0.05 * m);
    g.quadraticCurveTo(cx, fy - 0.08 * m, cx + 0.14 * m, fy - 0.04 * m);
    g.stroke();
    // Bare-foot peeks tucked under the lap crossing
    g.fillStyle = skinShade;
    ellipse(g, cx - 0.05 * m, fy - 0.015 * m, 0.045 * m, 0.02 * m); g.fill();
    ellipse(g, cx + 0.09 * m, fy - 0.02 * m, 0.05 * m, 0.022 * m); g.fill();
  }

  function drawTorso(g, cx, shoulderY, lapTopY, shoulderHW, m, skin) {
    /** Rounded sweater silhouette + soft V-neckline + subtle knit ribbing. */
    g.fillStyle = SWEATER;
    g.beginPath();
    g.moveTo(cx - shoulderHW, shoulderY + 0.03 * m);
    g.quadraticCurveTo(cx - shoulderHW - 0.02 * m, (shoulderY + lapTopY) / 2 + 0.02 * m,
                       cx - shoulderHW * 0.9, lapTopY + 0.01 * m);
    g.lineTo(cx + shoulderHW * 0.9, lapTopY + 0.01 * m);
    g.quadraticCurveTo(cx + shoulderHW + 0.02 * m, (shoulderY + lapTopY) / 2 + 0.02 * m,
                       cx + shoulderHW, shoulderY + 0.03 * m);
    g.quadraticCurveTo(cx, shoulderY - 0.03 * m, cx - shoulderHW, shoulderY + 0.03 * m);
    g.closePath();
    g.fill();

    // Low-opacity far-side shading (roundness, not a stripe)
    g.save();
    g.globalAlpha = 0.35;
    g.fillStyle = SWEATER_SHADE;
    g.beginPath();
    g.moveTo(cx + shoulderHW - 0.01 * m, shoulderY + 0.05 * m);
    g.quadraticCurveTo(cx + shoulderHW + 0.005 * m, (shoulderY + lapTopY) / 2, cx + shoulderHW * 0.9, lapTopY);
    g.lineTo(cx + shoulderHW * 0.7, lapTopY);
    g.quadraticCurveTo(cx + shoulderHW - 0.04 * m, (shoulderY + lapTopY) / 2, cx + shoulderHW - 0.06 * m, shoulderY + 0.05 * m);
    g.closePath(); g.fill();
    g.restore();

    // Knit ribbing: thin vertical lines across the torso
    g.strokeStyle = SWEATER_SHADE; g.lineWidth = 0.7; g.globalAlpha = 0.4;
    for (let i = -4; i <= 4; i++) {
      const sx = cx + i * 0.038 * m;
      if (Math.abs(sx - cx) > shoulderHW * 0.92) continue;
      g.beginPath();
      g.moveTo(sx, shoulderY + 0.07 * m);
      g.lineTo(sx, lapTopY - 0.005 * m);
      g.stroke();
    }
    g.globalAlpha = 1;

    // Soft V-neckline
    g.fillStyle = SWEATER_SHADE;
    g.beginPath();
    g.moveTo(cx - 0.05 * m, shoulderY + 0.005 * m);
    g.quadraticCurveTo(cx, shoulderY + 0.04 * m, cx + 0.05 * m, shoulderY + 0.005 * m);
    g.quadraticCurveTo(cx, shoulderY - 0.005 * m, cx - 0.05 * m, shoulderY + 0.005 * m);
    g.closePath(); g.fill();
    // Neck skin peek above collar
    g.fillStyle = skin;
    roundedRect(g, cx - 0.045 * m, shoulderY - 0.06 * m, 0.09 * m, 0.08 * m, 0.02 * m); g.fill();
    // Collar shadow line at neck base
    g.fillStyle = 'rgba(140, 90, 70, 0.18)';
    ellipse(g, cx, shoulderY, 0.055 * m, 0.014 * m); g.fill();
  }

  function drawArms(g, cx, fy, shoulderY, shoulderHW, m, skin, skinShade) {
    /** Both arms curve outward with mittens resting on the floor.
     *  Near arm (baby side, left) reads as "come here"; far arm mirrors it. */
    // ---- Near arm (baby-facing) ----
    const shoulderLX = cx - shoulderHW + 0.015 * m;
    const shoulderLY = shoulderY + 0.05 * m;
    const nearHandX = cx - 0.5 * m;
    const nearHandY = fy - 0.045 * m;
    g.strokeStyle = SWEATER; g.lineWidth = 0.115 * m; g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(shoulderLX, shoulderLY);
    g.quadraticCurveTo(cx - 0.38 * m, shoulderY + 0.18 * m,
                       nearHandX + 0.05 * m, nearHandY - 0.03 * m);
    g.stroke();
    // Sleeve highlight on the upper edge
    g.strokeStyle = SWEATER_HIGHLIGHT; g.lineWidth = 0.035 * m; g.globalAlpha = 0.55;
    g.beginPath();
    g.moveTo(shoulderLX - 0.01 * m, shoulderLY - 0.02 * m);
    g.quadraticCurveTo(cx - 0.38 * m, shoulderY + 0.14 * m,
                       nearHandX + 0.05 * m, nearHandY - 0.05 * m);
    g.stroke();
    g.globalAlpha = 1;
    // Cuff + mitten hand
    g.strokeStyle = SWEATER_SHADE; g.lineWidth = 0.02 * m;
    g.beginPath();
    g.arc(nearHandX + 0.05 * m, nearHandY - 0.025 * m, 0.06 * m, Math.PI * 0.55, Math.PI * 1.55);
    g.stroke();
    g.fillStyle = skin;
    ellipse(g, nearHandX, nearHandY, 0.085 * m, 0.06 * m); g.fill();
    g.fillStyle = shade(skin, -0.05);
    ellipse(g, nearHandX + 0.03 * m, nearHandY - 0.045 * m, 0.028 * m, 0.022 * m); g.fill();
    g.strokeStyle = shade(skin, -0.22); g.lineWidth = 1.4;
    for (let i = 0; i < 4; i++) {
      const fa = Math.PI + (i + 0.5) * (Math.PI / 5);
      g.beginPath();
      g.arc(nearHandX, nearHandY, 0.075 * m, fa - 0.14, fa + 0.14);
      g.stroke();
    }
    g.strokeStyle = shade(skin, -0.18); g.lineWidth = 1.2;
    g.beginPath();
    g.arc(nearHandX, nearHandY + 0.012 * m, 0.06 * m, Math.PI * 0.2, Math.PI * 0.8);
    g.stroke();

    // ---- Far arm (right side, also open) ----
    const shoulderRX = cx + shoulderHW - 0.015 * m;
    const shoulderRY = shoulderY + 0.05 * m;
    const farHandX = cx + 0.42 * m;
    const farHandY = fy - 0.045 * m;
    g.strokeStyle = SWEATER; g.lineWidth = 0.11 * m;
    g.beginPath();
    g.moveTo(shoulderRX, shoulderRY);
    g.quadraticCurveTo(cx + 0.4 * m, shoulderY + 0.18 * m,
                       farHandX - 0.04 * m, farHandY - 0.03 * m);
    g.stroke();
    g.strokeStyle = SWEATER_SHADE; g.lineWidth = 0.02 * m;
    g.beginPath();
    g.arc(farHandX - 0.04 * m, farHandY - 0.025 * m, 0.055 * m, Math.PI * 1.45, Math.PI * 0.45);
    g.stroke();
    g.fillStyle = skinShade;
    ellipse(g, farHandX, farHandY, 0.078 * m, 0.055 * m); g.fill();
    g.fillStyle = shade(skinShade, -0.05);
    ellipse(g, farHandX - 0.028 * m, farHandY - 0.04 * m, 0.026 * m, 0.02 * m); g.fill();
    g.strokeStyle = shade(skinShade, -0.22); g.lineWidth = 1.3;
    for (let i = 0; i < 4; i++) {
      const fa = Math.PI + (i + 0.5) * (Math.PI / 5);
      g.beginPath();
      g.arc(farHandX, farHandY, 0.07 * m, fa - 0.14, fa + 0.14);
      g.stroke();
    }
  }

  function drawHead(g, cx, shoulderY, headR, m, skin, skinShade) {
    /** Warm face: soft bob hair, gentle brows, closed-crescent eyes, blushes, smile. */
    const headX = cx;
    const headY = shoulderY - headR + 0.01 * m;

    // Hair back layer (soft bob past the ears)
    g.fillStyle = PALETTE.parentHair;
    g.beginPath();
    g.ellipse(headX, headY - 0.01 * m, headR + 0.028 * m, headR + 0.02 * m, 0, 0, Math.PI * 2);
    g.fill();
    // Small hair flick behind the near ear
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
    // Face volume shading (far side)
    g.fillStyle = 'rgba(200, 140, 100, 0.15)';
    ellipse(g, headX + 0.03 * m, headY + 0.005 * m, 0.06 * m, headR - 0.01 * m); g.fill();

    // Hair front: soft asymmetric bangs
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
    // A single hair strand across the forehead
    g.strokeStyle = shade(PALETTE.parentHair, 0.12); g.lineWidth = 1.6; g.lineCap = 'round';
    g.beginPath();
    g.moveTo(headX - 0.045 * m, headY - headR + 0.02 * m);
    g.quadraticCurveTo(headX - 0.02 * m, headY - headR + 0.008 * m,
                       headX + 0.02 * m, headY - headR + 0.028 * m);
    g.stroke();
    // Near-side ear peek
    g.fillStyle = skinShade;
    ellipse(g, headX - headR + 0.008 * m, headY + 0.018 * m, 0.014 * m, 0.024 * m); g.fill();

    // Brows
    g.strokeStyle = shade(BROW, 0.08); g.lineWidth = 2.6; g.lineCap = 'round';
    g.beginPath();
    g.moveTo(headX - 0.05 * m, headY - 0.028 * m);
    g.quadraticCurveTo(headX - 0.036 * m, headY - 0.04 * m, headX - 0.022 * m, headY - 0.03 * m);
    g.stroke();
    g.beginPath();
    g.moveTo(headX + 0.022 * m, headY - 0.03 * m);
    g.quadraticCurveTo(headX + 0.036 * m, headY - 0.04 * m, headX + 0.05 * m, headY - 0.028 * m);
    g.stroke();
    // Closed-crescent eyes
    g.strokeStyle = EYE; g.lineWidth = 3;
    g.beginPath();
    g.arc(headX - 0.036 * m, headY - 0.003 * m, 0.02 * m, Math.PI * 0.15, Math.PI * 0.85); g.stroke();
    g.beginPath();
    g.arc(headX + 0.036 * m, headY - 0.003 * m, 0.02 * m, Math.PI * 0.15, Math.PI * 0.85); g.stroke();
    // Cheek blushes
    g.fillStyle = 'rgba(230, 130, 130, 0.55)';
    ellipse(g, headX - 0.052 * m, headY + 0.03 * m, 0.024 * m, 0.014 * m); g.fill();
    ellipse(g, headX + 0.052 * m, headY + 0.03 * m, 0.024 * m, 0.014 * m); g.fill();
    // Warm smile
    g.strokeStyle = SMILE; g.lineWidth = 3.2; g.lineCap = 'round';
    g.beginPath();
    g.arc(headX, headY + 0.032 * m, 0.036 * m, Math.PI * 0.13, Math.PI * 0.87); g.stroke();
    // Upper-lip peak
    g.strokeStyle = SMILE; g.lineWidth = 1.8;
    g.beginPath();
    g.moveTo(headX - 0.008 * m, headY + 0.03 * m);
    g.quadraticCurveTo(headX, headY + 0.024 * m, headX + 0.008 * m, headY + 0.03 * m);
    g.stroke();
    // Nose hint
    g.strokeStyle = shade(skin, -0.28); g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(headX - 0.006 * m, headY + 0.008 * m);
    g.quadraticCurveTo(headX + 0.004 * m, headY + 0.02 * m, headX + 0.012 * m, headY + 0.01 * m);
    g.stroke();
  }

  return { drawFigure, drawContactShadow };
}
