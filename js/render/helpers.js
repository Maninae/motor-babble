// Pure canvas geometry + color helpers used by every render module.
// No state, no closures over viewport. Safe to import anywhere in render/.

/** Trace a rounded-rectangle path. Caller strokes or fills. */
export function roundedRect(g, x, y, w, h, r) {
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

/** Trace a circle path. Caller strokes or fills. */
export function circle(g, cx, cy, r) {
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
}

/** Trace an ellipse path. Caller strokes or fills. */
export function ellipse(g, cx, cy, rx, ry) {
  g.beginPath();
  g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
}

/** Fill and outline a capsule (rounded line segment) between (x1,y1) and (x2,y2). */
export function capsule(g, x1, y1, x2, y2, w, color) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
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

/** Rotate local offset (lx, ly) by `angle` and translate by `pos`. Returns world coords. */
export function worldPoint(pos, angle, lx, ly) {
  const c = Math.cos(angle), s = Math.sin(angle);
  return { x: pos.x + c * lx - s * ly, y: pos.y + s * lx + c * ly };
}

/** Lighten (amount > 0) or darken (amount < 0) a #rrggbb color by fraction. rgba/rgb pass through. */
export function shade(hex, amount) {
  if (typeof hex !== 'string') return hex;
  if (hex.startsWith('rgba') || hex.startsWith('rgb(')) return hex;
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
