// Ephemeral effects: dust motes, floor puff from a roll, confetti bursts,
// pain vignette, milestone banner, and the win overlay. All owned here so
// the coordinator only forwards the sim tick and event stream.

import { MILESTONE_DEFS } from '../config.js';
import { roundedRect, ellipse, circle } from './helpers.js';

// ---- Effect tuning --------------------------------------------------------

const DUST_MOTE_COUNT = 14;
const CONFETTI_SPEED_MIN = 200;
const CONFETTI_SPEED_MAX_ADD = 280;
const CONFETTI_LIFE_MIN = 1.0;           // seconds
const CONFETTI_LIFE_MAX_ADD = 0.6;
const CONFETTI_GRAVITY_PXPS2 = 900;
const PAIN_FLASH_ON_HIT_S = 0.5;
const MELTDOWN_MIN_FLASH_S = 0.3;
const MILESTONE_JOY_S = 1.5;
const MILESTONE_BANNER_LIFE_S = 3.0;
const MILESTONE_BANNER_FADE_START_S = 2.5;
const FLOMP_SHAKE_S = 0.35;
const FLOMP_PUFF_S = 0.6;
const WIN_CONFETTI_INTERVAL_S = 0.15;

// Confetti color palettes per event type.
const CONFETTI_PAIN = ['#c94a3b'];
const CONFETTI_MILESTONE = ['#ffcf6b', '#f28ba1', '#8ec6e8', '#a8d8c9', '#b5ea9d'];
const CONFETTI_WIN = ['#ffcf6b', '#f28ba1', '#8ec6e8', '#a8d8c9'];

export function createEffectsState() {
  /** Shared mutable state read by baby_art (for milestoneJoyT) and effects itself. */
  return {
    painFlash: 0,           // seconds remaining on the red vignette
    milestoneBanner: null,  // { id, title, emoji, t }
    milestoneJoyT: 0,       // "just landed a milestone" happy-face timer
    confetti: [],           // array of { x, y, vx, vy, color, life, size, spin, angle }
    winConfettiSpawn: 0,
    flompShake: 0,          // seconds remaining of "flomp" screen shake after a roll
    flompFloorPuff: null,   // { t } — small dust puff from a roll's floor impact
  };
}

export function createEffectsLayer({ viewport, worldToScreen, ambient, effects, reducedMotion }) {
  /** Groups all ephemeral overlay draws + the noteEvent dispatcher. */
  const dust = Array.from({ length: DUST_MOTE_COUNT }, (_, i) => ({
    seedX: (i * 137.5) % 100 / 100,
    seedY: (i * 91.7) % 100 / 100,
    phase: (i * 0.9) % (Math.PI * 2),
  }));

  function spawnConfetti(centerX, centerY, count, colors) {
    if (reducedMotion) return;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = CONFETTI_SPEED_MIN + Math.random() * CONFETTI_SPEED_MAX_ADD;
      effects.confetti.push({
        x: centerX, y: centerY,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed - 100,
        color: colors[Math.floor(Math.random() * colors.length)],
        life: CONFETTI_LIFE_MIN + Math.random() * CONFETTI_LIFE_MAX_ADD,
        size: 3 + Math.random() * 5,
        spin: (Math.random() - 0.5) * 8,
        angle: 0,
      });
    }
  }

  function noteEvent(event) {
    switch (event.type) {
      case 'pain':
        effects.painFlash = PAIN_FLASH_ON_HIT_S;
        spawnConfetti(viewport.width / 2, viewport.height / 2, 6, CONFETTI_PAIN);
        break;
      case 'milestone': {
        const def = MILESTONE_DEFS.find((m) => m.id === event.id);
        if (def) {
          effects.milestoneBanner = { id: def.id, title: def.title, emoji: def.emoji, t: 0 };
          effects.milestoneJoyT = MILESTONE_JOY_S;
          spawnConfetti(viewport.width / 2, viewport.height / 2, 80, CONFETTI_MILESTONE);
        }
        break;
      }
      case 'meltdown':
        effects.painFlash = Math.max(effects.painFlash, MELTDOWN_MIN_FLASH_S);
        break;
      case 'roll':
        effects.flompShake = FLOMP_SHAKE_S;
        effects.flompFloorPuff = { t: FLOMP_PUFF_S };
        break;
      default: break;
    }
  }

  function tickTimers(dt) {
    /** Drain the effect timers by dt. Called once per frame from the coordinator. */
    effects.painFlash = Math.max(0, effects.painFlash - dt);
    effects.milestoneJoyT = Math.max(0, effects.milestoneJoyT - dt);
    effects.flompShake = Math.max(0, effects.flompShake - dt);
    if (effects.flompFloorPuff) {
      effects.flompFloorPuff.t -= dt;
      if (effects.flompFloorPuff.t <= 0) effects.flompFloorPuff = null;
    }
    if (effects.milestoneBanner) {
      effects.milestoneBanner.t += dt;
      if (effects.milestoneBanner.t > MILESTONE_BANNER_LIFE_S) effects.milestoneBanner = null;
    }
  }

  function drawConfetti(g, dt) {
    for (const c of effects.confetti) {
      c.vy += CONFETTI_GRAVITY_PXPS2 * dt;
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
    const { width, height } = viewport;
    g.fillStyle = 'rgba(255,240,220,0.6)';
    for (const d of dust) {
      const x = ((d.seedX * width + Math.sin(ambient.t * 0.3 + d.phase) * 40) + width) % width;
      const y = ((d.seedY * (height * 0.6) + Math.cos(ambient.t * 0.25 + d.phase) * 20));
      circle(g, x, y, 1.5 + Math.sin(ambient.t + d.phase) * 0.5); g.fill();
    }
  }

  function drawPainVignette(g) {
    if (effects.painFlash <= 0) return;
    const { width, height } = viewport;
    const alpha = Math.min(0.55, effects.painFlash * 1.1);
    const grad = g.createRadialGradient(
      width / 2, height / 2, Math.min(width, height) * 0.2,
      width / 2, height / 2, Math.max(width, height) * 0.7);
    grad.addColorStop(0, 'rgba(220,60,50,0)');
    grad.addColorStop(1, `rgba(220,60,50,${alpha})`);
    g.fillStyle = grad;
    g.fillRect(0, 0, width, height);
  }

  function drawMilestoneBanner(g) {
    if (!effects.milestoneBanner) return;
    const { width, height } = viewport;
    const m = effects.milestoneBanner;
    const t = m.t;
    const bannerY = Math.min(120, height * 0.14);
    const alpha = t > MILESTONE_BANNER_FADE_START_S
      ? 1 - (t - MILESTONE_BANNER_FADE_START_S) / (MILESTONE_BANNER_LIFE_S - MILESTONE_BANNER_FADE_START_S)
      : 1;
    g.save();
    g.globalAlpha = Math.max(0, alpha);
    const bannerW = Math.min(560, width * 0.7);
    const bx = width / 2 - bannerW / 2;
    g.fillStyle = 'rgba(255, 250, 240, 0.95)';
    roundedRect(g, bx, bannerY - 30, bannerW, 60, 30); g.fill();
    g.strokeStyle = '#e8b45c'; g.lineWidth = 3;
    roundedRect(g, bx, bannerY - 30, bannerW, 60, 30); g.stroke();
    g.fillStyle = '#5a3a1a';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '600 22px system-ui, sans-serif';
    g.fillText(`${m.emoji}  milestone: ${m.title.toLowerCase()}`, width / 2, bannerY);
    g.restore();
  }

  function drawWinOverlay(g, sim) {
    if (!sim.state.won) return;
    const { width, height } = viewport;
    g.fillStyle = 'rgba(255, 235, 210, 0.55)';
    g.fillRect(0, 0, width, height);
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

  function drawFlompPuff(g, sim) {
    if (!effects.flompFloorPuff || reducedMotion) return;
    const puffLifeT = 1 - effects.flompFloorPuff.t / FLOMP_PUFF_S;
    const alpha = 1 - puffLifeT;
    const torsoPos = sim.baby.parts.torso.getPosition();
    const s = worldToScreen(torsoPos.x, 0);
    g.save();
    g.globalAlpha = alpha * 0.7;
    g.fillStyle = '#e2c9a4';
    ellipse(g, s.x - 20 - puffLifeT * 20, s.y - 4 - puffLifeT * 8,
            12 + puffLifeT * 10, 6 + puffLifeT * 6); g.fill();
    ellipse(g, s.x + 20 + puffLifeT * 20, s.y - 4 - puffLifeT * 8,
            12 + puffLifeT * 10, 6 + puffLifeT * 6); g.fill();
    g.restore();
  }

  function spawnWinConfetti(dt) {
    /** Called on win: rain confetti in from above every WIN_CONFETTI_INTERVAL_S. */
    if (reducedMotion) return;
    effects.winConfettiSpawn += dt;
    if (effects.winConfettiSpawn > WIN_CONFETTI_INTERVAL_S) {
      effects.winConfettiSpawn = 0;
      spawnConfetti(Math.random() * viewport.width, -10, 8, CONFETTI_WIN);
    }
  }

  return {
    noteEvent,
    tickTimers,
    drawConfetti,
    drawDust,
    drawPainVignette,
    drawMilestoneBanner,
    drawWinOverlay,
    drawFlompPuff,
    spawnWinConfetti,
  };
}
