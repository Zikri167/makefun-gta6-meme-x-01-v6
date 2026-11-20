// GTA 6 Meme v6 — Leonida News. Own rasterizer + PNG encoder, deterministic.
import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hex(c) {
  return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
}
function mix(a, b, t) { const o = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; if (a.length > 3 || b.length > 3) o.push((a[3] ?? 1) + ((b[3] ?? 1) - (a[3] ?? 1)) * t); return o; }
function gradStops(stops, t) {
  t = Math.max(0, Math.min(1, t));
  for (let i = 0; i < stops.length - 1; i++) {
    if (t >= stops[i][0] && t <= stops[i + 1][0]) {
      const u = (t - stops[i][0]) / (stops[i + 1][0] - stops[i][0] || 1);
      return mix(stops[i][1], stops[i + 1][1], u);
    }
  }
  return stops[stops.length - 1][1];
}

class Frame {
  constructor(scale) {
    this.s = scale; this.w = 1024 * scale; this.h = 1024 * scale;
    this.d = new Uint8Array(this.w * this.h * 3);
  }
  blend(px, py, col, a) {
    if (px < 0 || py < 0 || px >= this.w || py >= this.h || a <= 0) return;
    if (a > 1) a = 1;
    const i = (py * this.w + px) * 3, d = this.d;
    d[i] = d[i] * (1 - a) + col[0] * a;
    d[i + 1] = d[i + 1] * (1 - a) + col[1] * a;
    d[i + 2] = d[i + 2] * (1 - a) + col[2] * a;
  }
  rect(x, y, w, h, col, a = 1) {
    const s = this.s, x0 = Math.round(x * s), y0 = Math.round(y * s), x1 = Math.round((x + w) * s), y1 = Math.round((y + h) * s);
    for (let py = y0; py < y1; py++) for (let px = x0; px < x1; px++) this.blend(px, py, col, a);
  }
  vGrad(x, y, w, h, stops, a = 1) {
    const s = this.s, x0 = Math.round(x * s), y0 = Math.round(y * s), x1 = Math.round((x + w) * s), y1 = Math.round((y + h) * s);
    for (let py = y0; py < y1; py++) {
      const col = gradStops(stops, (py / s - y) / h);
      for (let px = x0; px < x1; px++) this.blend(px, py, col, a * (col.length > 3 ? col[3] : 1));
    }
  }
  circle(cx, cy, r, col, a = 1) { this.ellipse(cx, cy, r, r, col, a); }
  ellipse(cx, cy, rx, ry, col, a = 1, rot = 0) {
    const s = this.s, R = Math.max(rx, ry);
    const x0 = Math.floor((cx - R - 2) * s), x1 = Math.ceil((cx + R + 2) * s), y0 = Math.floor((cy - R - 2) * s), y1 = Math.ceil((cy + R + 2) * s);
    const ca = Math.cos(rot), sa = Math.sin(rot);
    for (let py = y0; py <= y1; py++) for (let px = x0; px <= x1; px++) {
      let dx = px / s - cx, dy = py / s - cy;
      const ux = dx * ca + dy * sa, uy = -dx * sa + dy * ca;
      const q = (ux * ux) / (rx * rx) + (uy * uy) / (ry * ry);
      if (q <= 1) this.blend(px, py, col, a * Math.min(1, (1 - q) * 4 + 0.2));
    }
  }
  radial(cx, cy, r, stops) {
    const s = this.s, x0 = Math.floor((cx - r) * s), x1 = Math.ceil((cx + r) * s), y0 = Math.floor((cy - r) * s), y1 = Math.ceil((cy + r) * s);
    for (let py = y0; py <= y1; py++) for (let px = x0; px <= x1; px++) {
      const dx = px / s - cx, dy = py / s - cy, dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > r) continue;
      const st = gradStops(stops, dist / r);
      this.blend(px, py, st.slice(0, 3), st.length > 3 ? st[3] : 1);
    }
  }
  line(x1, y1, x2, y2, wdt, col, a = 1) {
    const s = this.s, hw = wdt / 2;
    const minx = Math.floor((Math.min(x1, x2) - hw - 2) * s), maxx = Math.ceil((Math.max(x1, x2) + hw + 2) * s);
    const miny = Math.floor((Math.min(y1, y2) - hw - 2) * s), maxy = Math.ceil((Math.max(y1, y2) + hw + 2) * s);
    const vx = x2 - x1, vy = y2 - y1, len2 = vx * vx + vy * vy || 1;
    for (let py = miny; py <= maxy; py++) for (let px = minx; px <= maxx; px++) {
      const X = px / s, Y = py / s;
      let t = ((X - x1) * vx + (Y - y1) * vy) / len2; t = Math.max(0, Math.min(1, t));
      const dx = X - (x1 + vx * t), dy = Y - (y1 + vy * t), dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= hw) this.blend(px, py, col, a * Math.min(1, (hw - dist) * s + 0.5));
    }
  }
  poly(pts, col, a = 1) { for (let i = 0; i < pts.length - 1; i++) this.line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], this._sw || 4, col, a); }
  strokePts(pts, wdt, col, a = 1, closed = false) {
    const n = closed ? pts.length : pts.length - 1;
    for (let i = 0; i < n; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; this.line(p[0], p[1], q[0], q[1], wdt, col, a); }
  }
  fillPoly(pts, colorFn) {
    const s = this.s;
    let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9;
    for (const p of pts) { minx = Math.min(minx, p[0]); maxx = Math.max(maxx, p[0]); miny = Math.min(miny, p[1]); maxy = Math.max(maxy, p[1]); }
    const x0 = Math.floor(minx * s), x1 = Math.ceil(maxx * s), y0 = Math.floor(miny * s), y1 = Math.ceil(maxy * s);
    for (let py = y0; py <= y1; py++) for (let px = x0; px <= x1; px++) {
      const X = px / s, Y = py / s; let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
        if ((yi > Y) !== (yj > Y) && X < ((xj - xi) * (Y - yi)) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) { const c = colorFn(X, Y); this.blend(px, py, c, c.length > 3 ? c[3] : 1); }
    }
  }
  quad(p0, p1, p2, wdt, col, a = 1, taper = 0) {
    let prev = p0;
    const steps = 22;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps, u = 1 - t;
      const pt = [u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]];
      this.line(prev[0], prev[1], pt[0], pt[1], wdt * (1 - taper * t), col, a);
      prev = pt;
    }
  }
  rrect(x, y, w, h, r, col, a = 1) {
    // filled rounded rect via rects + corner circles
    this.rect(x + r, y, w - 2 * r, h, col, a); this.rect(x, y + r, w, h - 2 * r, col, a);
    this.circle(x + r, y + r, r, col, a); this.circle(x + w - r, y + r, r, col, a);
    this.circle(x + r, y + h - r, r, col, a); this.circle(x + w - r, y + h - r, r, col, a);
  }
}
function bez(p0, p1, p2, n = 24) {
  const out = [];
  for (let i = 0; i <= n; i++) { const t = i / n, u = 1 - t; out.push([u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]]); }
  return out;
}
function arcPts(cx, cy, rx, ry, a0, a1, n = 20) {
  const out = [];
  for (let i = 0; i <= n; i++) { const t = a0 + (a1 - a0) * (i / n); out.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]); }
  return out;
}

// ---- Stroke-vector glyph font (unit box 0..1, y down) ----
const PI = Math.PI;
function A(cx, cy, rx, ry, a0, a1, n = 14) { return arcPts(cx, cy, rx, ry, a0, a1, n); }
const GLYPHS = {};
GLYPHS['A'] = [[[0, 1], [0.5, 0], [1, 1]], [[0.24, 0.66], [0.76, 0.66]]];
GLYPHS['B'] = [[[0, 0], [0, 1]], [[0, 0], [0.58, 0], [0.74, 0.13], [0.74, 0.34], [0.58, 0.47], [0, 0.47]], [[0, 0.47], [0.66, 0.47], [0.84, 0.62], [0.84, 0.85], [0.66, 1], [0, 1]]];
GLYPHS['C'] = [[[0.86, 0.16], [0.66, 0.03], [0.36, 0.0], [0.12, 0.14], [0.04, 0.38], [0.04, 0.64], [0.14, 0.86], [0.38, 1.0], [0.68, 0.97], [0.88, 0.82]]];
GLYPHS['D'] = [[[0, 0], [0, 1]], [[0, 0], [0.55, 0], ...A(0.55, 0.5, 0.42, 0.5, -PI / 2, PI / 2), [0, 1]]];
GLYPHS['E'] = [[[0.85, 0], [0, 0], [0, 1], [0.85, 1]], [[0, 0.5], [0.68, 0.5]]];
GLYPHS['F'] = [[[0.85, 0], [0, 0], [0, 1]], [[0, 0.5], [0.65, 0.5]]];
GLYPHS['G'] = [[[0.86, 0.16], [0.66, 0.03], [0.36, 0.0], [0.12, 0.14], [0.04, 0.38], [0.04, 0.64], [0.14, 0.86], [0.38, 1.0], [0.68, 0.97], [0.88, 0.84], [0.88, 0.56], [0.6, 0.56]]];
GLYPHS['H'] = [[[0, 0], [0, 1]], [[1, 0], [1, 1]], [[0, 0.5], [1, 0.5]]];
GLYPHS['I'] = [[[0.5, 0], [0.5, 1]], [[0.15, 0], [0.85, 0]], [[0.15, 1], [0.85, 1]]];
GLYPHS['J'] = [[[0.8, 0], [0.8, 0.78], [0.62, 0.97], [0.3, 1], [0.08, 0.82]]];
GLYPHS['K'] = [[[0, 0], [0, 1]], [[0.82, 0], [0, 0.52]], [[0.18, 0.38], [0.85, 1]]];
GLYPHS['L'] = [[[0, 0], [0, 1], [0.85, 1]]];
GLYPHS['M'] = [[[0, 1], [0, 0], [0.5, 0.62], [1, 0], [1, 1]]];
GLYPHS['N'] = [[[0, 1], [0, 0], [1, 1], [1, 0]]];
GLYPHS['O'] = [[...A(0.5, 0.5, 0.48, 0.5, 0, PI * 2, 28)]];
GLYPHS['P'] = [[[0, 1], [0, 0], [0.6, 0], [0.82, 0.14], [0.82, 0.36], [0.6, 0.5], [0, 0.5]]];
GLYPHS['Q'] = [[...A(0.5, 0.48, 0.48, 0.48, 0, PI * 2, 28)], [[0.62, 0.78], [1, 1.02]]];
GLYPHS['R'] = [[[0, 1], [0, 0], [0.6, 0], [0.82, 0.14], [0.82, 0.36], [0.6, 0.5], [0, 0.5]], [[0.45, 0.5], [0.88, 1]]];
GLYPHS['S'] = [[[0.84, 0.18], [0.68, 0.04], [0.38, 0.0], [0.14, 0.1], [0.09, 0.27], [0.17, 0.41], [0.36, 0.5], [0.64, 0.56], [0.85, 0.67], [0.89, 0.83], [0.74, 0.97], [0.42, 1.0], [0.16, 0.93], [0.05, 0.79]]];
GLYPHS['T'] = [[[0, 0], [1, 0]], [[0.5, 0], [0.5, 1]]];
GLYPHS['U'] = [[[0, 0], [0, 0.72], [0.18, 0.96], [0.5, 1], [0.82, 0.96], [1, 0.72], [1, 0]]];
GLYPHS['V'] = [[[0, 0], [0.5, 1], [1, 0]]];
GLYPHS['W'] = [[[0, 0], [0.18, 1], [0.5, 0.35], [0.82, 1], [1, 0]]];
GLYPHS['X'] = [[[0, 0], [1, 1]], [[1, 0], [0, 1]]];
GLYPHS['Y'] = [[[0, 0], [0.5, 0.5], [1, 0]], [[0.5, 0.5], [0.5, 1]]];
GLYPHS['Z'] = [[[0, 0], [1, 0], [0, 1], [1, 1]]];
GLYPHS['0'] = [[...A(0.5, 0.5, 0.44, 0.5, 0, PI * 2, 26)]];
GLYPHS['1'] = [[[0.28, 0.18], [0.55, 0], [0.55, 1]], [[0.2, 1], [0.9, 1]]];
GLYPHS['2'] = [[[0.1, 0.15], [0.3, 0.02], [0.6, 0.02], [0.85, 0.15], [0.87, 0.33], [0.74, 0.5], [0.42, 0.7], [0.06, 1], [0.9, 1]]];
GLYPHS['3'] = [[[0.14, 0.1], [0.36, 0.01], [0.63, 0.02], [0.81, 0.15], [0.79, 0.32], [0.6, 0.44], [0.36, 0.46], [0.62, 0.52], [0.84, 0.64], [0.85, 0.83], [0.66, 0.98], [0.35, 1.0], [0.13, 0.89]]];
GLYPHS['4'] = [[[0.68, 1], [0.68, 0], [0, 0.68], [0.95, 0.68]]];
GLYPHS['5'] = [[[0.85, 0], [0.12, 0], [0.1, 0.44], [0.5, 0.36], [0.84, 0.5], [0.86, 0.8], [0.62, 0.99], [0.25, 1], [0.05, 0.85]]];
GLYPHS['6'] = [[...A(0.5, 0.68, 0.42, 0.3, 0, PI * 2, 22)], [[0.78, 0.05], [0.4, 0.3], [0.12, 0.62]]];
GLYPHS['7'] = [[[0, 0], [0.9, 0], [0.42, 1]]];
GLYPHS['8'] = [[...A(0.5, 0.26, 0.36, 0.25, 0, PI * 2, 18)], [...A(0.5, 0.72, 0.43, 0.28, 0, PI * 2, 20)]];
GLYPHS['9'] = [[...A(0.5, 0.32, 0.42, 0.3, 0, PI * 2, 22)], [[0.22, 0.95], [0.6, 0.7], [0.88, 0.38]]];
GLYPHS['.'] = [[[0.38, 0.88], [0.62, 0.88], [0.62, 1], [0.38, 1], [0.38, 0.88]]];
GLYPHS[','] = [[[0.5, 0.85], [0.42, 1.02]]];
GLYPHS["'"] = [[[0.5, 0], [0.5, 0.2]]];
GLYPHS['!'] = [[[0.5, 0], [0.5, 0.68]], [[0.5, 0.9], [0.5, 1]]];
GLYPHS['?'] = [[...A(0.5, 0.3, 0.4, 0.3, PI, PI * 2.15, 12), [0.5, 0.68]], [[0.5, 0.9], [0.5, 1]]];
GLYPHS['$'] = [[...GLYPHS['S'][0]], [[0.5, -0.08], [0.5, 1.08]]];
GLYPHS[':'] = [[[0.5, 0.28], [0.5, 0.36]], [[0.5, 0.86], [0.5, 0.94]]];
GLYPHS['-'] = [[[0.1, 0.5], [0.9, 0.5]]];
GLYPHS['/'] = [[[0.85, 0], [0.15, 1]]];
GLYPHS['•'] = [[...A(0.5, 0.5, 0.16, 0.16, 0, PI * 2, 10)]];
// lowercase: reuse uppercase shapes scaled (same glyphs read fine at small size)
for (const ch of "acefkmnu") GLYPHS[ch] = GLYPHS[ch.toUpperCase()];
GLYPHS[' '] = [];
function charAdv(ch) { return ch === ' ' ? 0.38 : (ch === '.' || ch === ',' || ch === "'") ? 0.30 : 0.63; }
function textWidth(text, size) {
  let w = 0;
  for (const ch of text) w += charAdv(ch) * size;
  return w;
}
function drawRun(fr, text, x, y, size, col, a, sw, spacing = 0) {
  let cx = x;
  for (const ch of text) {
    const g = GLYPHS[ch];
    const lower = ch >= 'a' && ch <= 'z';
    if (g) for (const stroke of g) {
      const pts = stroke.map(p => lower ? [cx + p[0] * size * 0.55, y + size * 0.30 + p[1] * size * 0.70] : [cx + p[0] * size * 0.55, y + p[1] * size]);
      fr.strokePts(pts, sw, col, a);
    }
    cx += charAdv(ch) * size + spacing;
  }
}
function drawText(fr, text, x, y, size, col, a = 1, spacing = 0) {
  const sw = size * 0.145;
  drawRun(fr, text, x + 3, y + 4, size, hex("#000000"), 0.5 * a, sw, spacing);
  drawRun(fr, text, x, y, size, hex("#000000"), a, sw + 5, spacing);
  drawRun(fr, text, x, y, size, col, a, sw, spacing);
}
function drawTextPlain(fr, text, x, y, size, col, a = 1) {
  drawRun(fr, text, x, y, size, col, a, size * 0.145);
}
function starPts(cx, cy, ro, ri, n = 5, rot = -PI / 2) {
  const out = [];
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 === 0 ? ro : ri, t = rot + (i * PI) / n;
    out.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
  }
  return out;
}
function sparklePts(cx, cy, R) {
  const k = R / 30;
  const rel = [[0, -30], [4.5, -10], [11, -11], [10, -4.5], [30, 0], [10, 4.5], [11, 11], [4.5, 10], [0, 30], [-4.5, 10], [-11, 11], [-10, 4.5], [-30, 0], [-10, -4.5], [-11, -11], [-4.5, -10]];
  return rel.map(p => [cx + p[0] * k, cy + p[1] * k]);
}

// ---- Scene ----
const rng = mulberry32(0xC0FFEE);
const fr = new Frame(2);
// 1 SKY
{
  const skyStops = [[0, hex("#150B2E")], [140 / 560, hex("#3D1154")], [300 / 560, hex("#8E2160")], [430 / 560, hex("#E14E63")], [520 / 560, hex("#FF9E57")], [1, hex("#FFD166")]];
  fr.vGrad(0, 0, 1024, 560, skyStops.map(s => [s[0], s[1]]));
  fr.rect(0, 560, 1024, 464, hex("#2A1030"));
}
// 2 SUN
fr.radial(352, 452, 300, [[0, [...hex("#FF6B4A"), 0.30]], [1, [...hex("#FF6B4A"), 0]]]);
fr.vGrad(52, 444, 600, 16, [[0, [...hex("#FFFFFF"), 0]], [0.5, [...hex("#FFB37A"), 0.18]], [1, [...hex("#FFFFFF"), 0]]]);
// lens streak as horizontal alpha band: use rects with fading alpha
for (let i = 0; i < 40; i++) { const t = i / 40; fr.rect(52 + t * 600, 448, 16, 8, hex("#FFD9A0"), 0.18 * Math.sin(t * PI)); }
fr.radial(352, 452, 64, [[0, hex("#FFF3B0")], [1, hex("#FFB347")]]);
// 3 CLOUDS
for (const c of [[210, 90, 340, 26], [620, 170, 420, 30], [300, 250, 300, 22], [700, 330, 360, 24]]) {
  fr.ellipse(c[0], c[1], c[2] / 2, c[3] / 2, hex("#241038"), 0.55);
  fr.ellipse(c[0] - 40, c[1] - 6, c[2] / 3, c[3] / 2.4, hex("#241038"), 0.5);
  fr.ellipse(c[0], c[1] + c[3] / 2 + 3, c[2] / 2.2, 5, hex("#FF8A5B"), 0.35);
}
// Polish (own detail): a distant flock of five tiny birds crossing the sunset,
// each just two soft wing arcs — adds life and depth to the upper sky.
for (const b of [[468, 128, 13], [512, 106, 10], [548, 138, 8], [430, 158, 9], [586, 112, 7]]) {
  fr.strokePts(arcPts(b[0] - b[2] * 0.55, b[1], b[2] * 0.55, b[2] * 0.42, PI * 1.15, PI * 1.95, 8), 2.6, hex("#1B0B33"), 0.75);
  fr.strokePts(arcPts(b[0] + b[2] * 0.55, b[1], b[2] * 0.55, b[2] * 0.42, PI * 1.05, PI * 1.85, 8), 2.6, hex("#1B0B33"), 0.75);
}
// windows registry for reflections
const litWindows = [];
function building(x, w, top, base, col, winAlpha, density) {
  fr.rect(x, top, w, base - top, col);
  for (let wy = top + 14; wy < base - 14; wy += 15) for (let wx = x + 7; wx < x + w - 9; wx += 13) {
    if (rng() < density) {
      const warm = rng() < 0.65;
      const c = warm ? hex("#FFD98A") : hex("#9BE8FF");
      fr.rect(wx, wy, 4, 6, c, winAlpha * (0.55 + rng() * 0.45));
      if (rng() < 0.5) litWindows.push([wx + 2, wy + 3, warm]);
    }
  }
}
function neonSign(x, y, w, h, colHex) {
  const col = hex(colHex);
  for (let i = 3; i >= 1; i--) {
    fr.strokePts([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], 3 + i * 3, col, 0.10, true);
  }
  fr.strokePts([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], 3, col, 0.95, true);
}
// 4 FAR SKYLINE
{
  let x = -10;
  const tops = [];
  while (x < 1030) { const w = 40 + rng() * 70, top = 300 + rng() * 200; tops.push([x, w, top]); building(x, w, top, 560, hex("#1B0B33"), 0.85, 0.55); x += w + 4 + rng() * 10; }
  neonSign(120, 360, 54, 30, "#FF2D95");
  neonSign(560, 330, 46, 64, "#22D3EE");
  neonSign(880, 380, 58, 28, "#FF9E57");
  for (let i = 0; i < 5; i++) fr.circle(1010, 330 + i * 22, 5, hex("#FF2D95"), 0.9);
}
// 5 NEAR SKYLINE (gap 430-790)
{
  const blocks = [[-6, 120, 400], [120, 90, 452], [216, 110, 388], [332, 92, 470], [796, 96, 430], [898, 130, 396]];
  for (const b of blocks) {
    building(b[0], b[1], b[2], 560, hex("#12061F"), 0.6, 0.30);
    // stepped top
    fr.rect(b[0] + b[1] * 0.25, b[2] - 18, b[1] * 0.5, 18, hex("#12061F"));
    fr.rect(b[0] + b[1] * 0.4, b[2] - 32, b[1] * 0.2, 14, hex("#12061F"));
  }
  // dome block
  fr.rect(60, 470, 110, 90, hex("#12061F"));
  fr.fillPoly(arcPts(115, 470, 55, 42, PI, PI * 2, 20), (X, Y) => hex("#12061F"));
}
// 6 STREET
fr.vGrad(0, 560, 1024, 464, [[0, hex("#2A1030")], [1, hex("#0B0614")]]);
fr.ellipse(352, 720, 58, 175, hex("#FF9E57"), 0.10);
fr.ellipse(352, 660, 34, 105, hex("#FFB347"), 0.10);
for (const wpos of litWindows) {
  if (rng() < 0.45) continue;
  const len = 8 + rng() * 22, my = 575 + rng() * 330;
  const off = Math.sin(my * 0.05 + wpos[0]) * 3;
  fr.line(wpos[0] + off, my, wpos[0] + off, my + len, 2.5, wpos[2] ? hex("#FFD98A") : hex("#9BE8FF"), 0.10 + rng() * 0.20);
}
for (const by of [640, 730, 830, 930]) fr.rect(0, by, 1024, 10, hex("#FFFFFF"), 0.04);
for (let i = 0; i < 40; i++) fr.ellipse(rng() * 1024, 800 + rng() * 210, 6 + rng() * 22, 2 + rng() * 4, hex("#FFFFFF"), 0.10 + rng() * 0.10);
// 7 PALMS
function palm(base, crown, scaleP) {
  const col = hex("#0D0518"), rim = hex("#FF7A4D");
  const mid = [(base[0] + crown[0]) / 2 + 40 * scaleP, (base[1] + crown[1]) / 2];
  const trunkPts = bez(base, mid, crown, 20);
  for (let i = 0; i < trunkPts.length - 1; i++) {
    const t = i / (trunkPts.length - 1);
    fr.line(trunkPts[i][0], trunkPts[i][1], trunkPts[i + 1][0], trunkPts[i + 1][1], (17 - 9 * t) * scaleP, col, 1);
    fr.line(trunkPts[i][0] + (8 - 4 * t) * scaleP, trunkPts[i][1], trunkPts[i + 1][0] + (8 - 4 * t) * scaleP, trunkPts[i + 1][1], 2, rim, 0.5);
  }
  for (let f = 0; f < 9; f++) {
    const ang = -PI * 0.92 + (f / 8) * PI * 1.05;
    const L = (120 + rng() * 50) * scaleP;
    const end = [crown[0] + Math.cos(ang) * L, crown[1] + Math.sin(ang) * L * 0.45 + L * 0.42];
    const ctrl = [crown[0] + Math.cos(ang) * L * 0.5, crown[1] + Math.sin(ang) * L * 0.5 - 18 * scaleP];
    const rib = bez(crown, ctrl, end, 16);
    fr.strokePts(rib, 4.5 * scaleP, col, 1);
    fr.strokePts(rib.map(p => [p[0], p[1] - 2]), 1.4, rim, 0.45);
    for (let lf = 1; lf <= 14; lf++) {
      const t = lf / 15, idx = Math.min(15, Math.floor(t * 16)), p = rib[idx];
      const ll = (20 - 10 * t) * scaleP;
      fr.line(p[0], p[1], p[0] - ll * 0.4, p[1] + ll, 1.8 * scaleP, col, 0.95);
      fr.line(p[0], p[1], p[0] + ll * 0.4, p[1] + ll, 1.8 * scaleP, col, 0.95);
    }
  }
}
palm([86, 560], [190, 300], 1);
palm([952, 548], [858, 318], 0.88);

// 8 GHOST
fr.ellipse(600, 768, 190, 30, hex("#000000"), 0.35);
fr.ellipse(600, 768, 130, 20, hex("#000000"), 0.25);
function ghostPath(scaleC = 1, cx = 600, cyOff = 0) {
  const pts = [];
  const dome = arcPts(600, 410 + cyOff, 172 * scaleC, 172 * scaleC, PI, PI * 2, 36);
  // scale dome around centre x
  const dp = dome.map(p => [cx + (p[0] - 600) * scaleC, 410 + cyOff + (p[1] - 410) * scaleC]);
  pts.push(...dp);
  pts.push([cx + 172 * scaleC, 690 + cyOff]);
  for (let x = 772; x >= 428; x -= 8) {
    const t = (772 - x) / 344;
    pts.push([cx + (x - 600) * scaleC, 690 + cyOff + 16 * Math.abs(Math.sin(t * PI * 4)) * scaleC + (1 - scaleC) * 0]);
  }
  pts.push([cx - 172 * scaleC, 690 + cyOff]);
  return pts;
}
{
  const body = ghostPath(1);
  const topC = hex("#FFFFFF"), botC = hex("#D9E4F2");
  fr.fillPoly(body, (X, Y) => mix(topC, botC, Math.max(0, Math.min(1, (Y - 238) / 468))));
  const inner = ghostPath(0.92, 600, 10);
  fr.fillPoly(inner, (X, Y) => { const a = 0.16 * Math.max(0, Math.min(1, (Y - 430) / 280)) * (1 - 0.55 * Math.max(0, Math.min(1, (X - 560) / 220))); return [...hex("#7A8FB0"), a]; });
  // cheek blush
  fr.ellipse(500, 478, 26, 14, hex("#FF9EBB"), 0.35);
  fr.ellipse(700, 478, 26, 14, hex("#FF9EBB"), 0.35);
  fr.strokePts(body, 11, hex("#0A0A0A"), 1, true);
  // rim lights: right arc and left arc just inside outline
  fr.strokePts(arcPts(600, 410, 163, 163, -1.25, 0.35, 18), 5, hex("#FF5C8A"), 0.85);
  fr.strokePts(arcPts(600, 410, 163, 163, PI - 0.3, PI + 1.05, 14), 5, hex("#38E1FF"), 0.55);
  fr.strokePts([[772, 430], [772, 640]], 5, hex("#FF5C8A"), 0.6);
  // eyes: black four-pointed sparkles
  for (const ex of [546, 654]) {
    fr.fillPoly(sparklePts(ex, 398, 33), () => hex("#0A0A0A"));
    fr.circle(ex - 8, 386, 4, hex("#FFFFFF"), 0.95);
  }
  // mouth: friendly open smile arc
  fr.strokePts(arcPts(600, 438, 24, 20, 0.15 * PI, 0.85 * PI, 14), 7, hex("#0A0A0A"), 1);
  fr.fillPoly(arcPts(600, 442, 15, 12, 0, PI, 10), () => [...hex("#0A0A0A"), 0.9]);
  // other hand (left)
  fr.circle(430, 528, 23, hex("#FFFFFF"), 1);
  fr.strokePts(arcPts(430, 528, 23, 23, 0, PI * 2, 24), 8, hex("#0A0A0A"), 1);
  fr.circle(430, 528, 23, hex("#FFFFFF"), 1);
  // raised hand + coin glow
  fr.radial(808, 388, 115, [[0, [...hex("#FF2D95"), 0.28]], [1, [...hex("#FF2D95"), 0]]]);
  fr.circle(770, 436, 30, hex("#FFFFFF"), 1);
  fr.strokePts(arcPts(770, 436, 30, 30, 0, PI * 2, 26), 9, hex("#0A0A0A"), 1);
  fr.circle(770, 436, 29, hex("#FFFFFF"), 1);
  // coin
  fr.radial(808, 388, 62, [[0, hex("#FF5CA8")], [0.55, hex("#E6007A")], [1, hex("#A8005C")]]);
  fr.strokePts(arcPts(808, 388, 62, 62, 0, PI * 2, 36), 8, hex("#0A0A0A"), 1);
  fr.strokePts(arcPts(808, 388, 50, 50, 0, PI * 2, 36), 3, hex("#FFB3D9"), 0.6);
  fr.fillPoly(starPts(808, 388, 30, 13), () => hex("#FFFFFF"));
  fr.strokePts(starPts(808, 388, 30, 13), 3, hex("#FFFFFF"), 1, true);
  fr.ellipse(786, 362, 13, 7, hex("#FFFFFF"), 0.85, -0.52);
  // redraw hand overlap on coin lower-left
  fr.fillPoly(arcPts(770, 436, 30, 30, PI * 0.9, PI * 1.9, 14), () => hex("#FFFFFF"));
  fr.strokePts(arcPts(770, 436, 30, 30, 0, PI * 2, 26), 9, hex("#0A0A0A"), 1);
  fr.circle(770, 436, 24, hex("#FFFFFF"), 1);
}
// 9 MICROPHONE
{
  // handle with metallic gradient: stacked segments
  const hx = [196, 322], hy = [1024, 648];
  for (let i = 0; i < 30; i++) {
    const t = i / 30, t2 = (i + 1) / 30;
    const col = mix(hex("#17171D"), hex("#4A4A55"), t);
    fr.line(hx[0] + (hx[1] - hx[0]) * t, hy[0] + (hy[1] - hy[0]) * t, hx[0] + (hx[1] - hx[0]) * t2, hy[0] + (hy[1] - hy[0]) * t2, 30 - 4 * t, col, 1);
  }
  fr.line(188, 1010, 310, 660, 3, hex("#FFFFFF"), 0.35);
  // flag rotated -6 degrees around (330,582)
  const rot = -6 * PI / 180, fcx = 330, fcy = 582;
  const corners = [[-59, -59], [59, -59], [59, 59], [-59, 59]].map(p => {
    const c = Math.cos(rot), s = Math.sin(rot);
    return [fcx + p[0] * c - p[1] * s, fcy + p[0] * s + p[1] * c];
  });
  fr.fillPoly(corners, () => hex("#14141C"));
  fr.strokePts(corners, 3, hex("#2E2E3A"), 1, true);
  fr.radial(330, 566, 40, [[0, hex("#FF5CA8")], [0.55, hex("#E6007A")], [1, hex("#A8005C")]]);
  fr.fillPoly(starPts(330, 566, 20, 9), () => hex("#FFFFFF"));
  drawTextPlain(fr, "make.fun", 330 - textWidth("make.fun", 21) / 2, 612, 21, hex("#FFFFFF"), 1);
  // foam head
  fr.circle(336, 472, 41, hex("#1C1C22"), 1);
  const mrng = mulberry32(0xBEEF);
  for (let i = 0; i < 260; i++) {
    const a2 = mrng() * PI * 2, rr = Math.sqrt(mrng()) * 36;
    fr.circle(336 + Math.cos(a2) * rr, 472 + Math.sin(a2) * rr, 1.6, mrng() < 0.5 ? hex("#000000") : hex("#3A3A44"), 0.5);
  }
  fr.strokePts(arcPts(336, 472, 38, 38, PI * 1.05, PI * 1.6, 12), 4, hex("#FF8A5B"), 0.5);
  fr.strokePts(arcPts(336, 472, 41, 41, 0, PI * 2, 30), 3, hex("#0A0A0A"), 0.8);
}

// ---- Downscale 2048 -> 1024 ----
const out = new Frame(1);
for (let y = 0; y < 1024; y++) for (let x = 0; x < 1024; x++) {
  let r = 0, g = 0, b = 0;
  for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
    const i = (((y * 2 + dy) * 2048) + (x * 2 + dx)) * 3;
    r += fr.d[i]; g += fr.d[i + 1]; b += fr.d[i + 2];
  }
  const o = (y * 1024 + x) * 3;
  out.d[o] = r / 4; out.d[o + 1] = g / 4; out.d[o + 2] = b / 4;
}
// FINISH part 1: grain + vignette (under overlay)
{
  const grng = mulberry32(0x6A17);
  for (let i = 0; i < out.d.length; i++) {
    const n = (grng() * 2 - 1) * 7;
    out.d[i] = Math.max(0, Math.min(255, out.d[i] + n));
  }
  for (let y = 0; y < 1024; y++) for (let x = 0; x < 1024; x++) {
    const dx = (x - 512) / 512, dy = (y - 512) / 512;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const a = 0.36 * Math.max(0, Math.min(1, (dist - 0.55) / 0.85));
    if (a > 0) { const o = (y * 1024 + x) * 3; out.d[o] *= (1 - a); out.d[o + 1] *= (1 - a); out.d[o + 2] *= (1 - a); }
  }
}
// 10 BROADCAST OVERLAY (on final 1024 frame, clean text)
for (let y = 0; y < 120; y++) out.rect(0, y, 1024, 1, hex("#000000"), 0.88 * (1 - y / 120));
out.rect(36, 44, 16, 16, hex("#FF2D95"), 1);
drawText(out, "VICE CITY NEWS", 66, 34, 43, hex("#FFFFFF"));
out.radial(920, 57, 70, [[0, [...hex("#E8112D"), 0.45]], [1, [...hex("#E8112D"), 0]]]);
out.vGrad(852, 28, 136, 58, [[0, hex("#E8112D")], [1, hex("#B30D22")]]);
out.rrect(852, 28, 136, 58, 10, hex("#E8112D"), 0.0);
out.circle(876, 57, 6, hex("#FFFFFF"), 1);
drawText(out, "LIVE", 892, 40, 33, hex("#FFFFFF"));
// lower third
out.rect(0, 856, 1024, 4, hex("#E8112D"), 1);
out.vGrad(0, 860, 252, 108, [[0, hex("#E8112D")], [1, hex("#B30D22")]]);
drawText(out, "BREAKING", 42, 873, 34, hex("#FFFFFF"));
drawText(out, "NEWS", 42, 921, 34, hex("#FFFFFF"));
out.vGrad(252, 860, 772, 108, [[0, hex("#0D1226")], [1, hex("#05070F")]], 0.97);
drawText(out, "GTA 6 DELAYED AGAIN", 284, 870, 50, hex("#FFFFFF"), 1, 4);
drawText(out, "LOCAL GHOST ALREADY EARNING ON MAKE.FUN", 284, 935, 24, hex("#FFC44D"));
out.rect(0, 968, 1024, 56, hex("#000000"), 1);
out.rect(0, 968, 1024, 1, hex("#FF2D95"), 0.6);
drawText(out, "LEONIDA • 13 YEARS SINCE GTA V • STILL NO RELEASE DATE • AGENTS GET PAID ON MAKE.FUN •", 24, 984, 24, hex("#FFFFFF"));
// ---- PNG encoder ----
function crc32(buf) {
  let table = crc32.t;
  if (!table) { table = crc32.t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; } }
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
{
  const raw = Buffer.alloc((1024 * 3 + 1) * 1024);
  for (let y = 0; y < 1024; y++) {
    raw[y * (1024 * 3 + 1)] = 0;
    Buffer.from(out.d.buffer, y * 1024 * 3, 1024 * 3).copy(raw, y * (1024 * 3 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1024, 0); ihdr.writeUInt32BE(1024, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  const botDir = process.env.MAKEFUN_BOT_DIR || ".";
  const outDir = process.env.MAKEFUN_OUTPUT_DIR || "out";
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "meme.png"), png);
  fs.copyFileSync(path.join(botDir, "POST.json"), path.join(outDir, "POST.json"));
}
