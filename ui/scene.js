// Postcard scenes: a small illustrated landscape for a trip, a stop or a country, drawn as SVG from its name, so every
// place gets its own picture without loading images. The kind sets the subject (an island in the sea, a beach with a
// palm, a skyline, layered hills), the name seeds the shapes and picks one of a few skies. Same name, same picture.
import { s } from './dom.js';

let uid = 0;
const hash = (str) => { let x = 2166136261; for (const c of String(str)) x = Math.imul(x ^ c.charCodeAt(0), 16777619); return x >>> 0; };
function rng(seed) {
  let a = hash(seed);
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Skies: top and bottom of the sky, the sun, three hill tones far to near, the sea top and bottom, and sand
export const SKIES = {
  golden: { sky: ['#f4b680', '#fde9cf'], sun: '#fff4dc', hills: ['#eab08f', '#cf7f68', '#8a4f55'], sea: ['#5aa6b8', '#2d7088'], sand: '#f3d9ae', glow: '#ffd39b' },
  tropic: { sky: ['#6ec3e0', '#dff4f7'], sun: '#fffbe8', hills: ['#a5d3c9', '#4f9d8a', '#1f5e4f'], sea: ['#33bccb', '#0f7590'], sand: '#f6e6c4', glow: '#ffffff' },
  dusk: { sky: ['#3e3f78', '#f2a07f'], sun: '#ffdcae', hills: ['#a0688a', '#66436f', '#2c2342'], sea: ['#5a5f8f', '#2a2f57'], sand: '#d9a98d', glow: '#ffb38a' },
  morning: { sky: ['#9fd1ec', '#fdf1e3'], sun: '#fffbe9', hills: ['#bcd3db', '#7fa8b6', '#3e6d7e'], sea: ['#63b6cb', '#2a86a0'], sand: '#f4e3c6', glow: '#fff1d6' },
};
const SKY_NAMES = Object.keys(SKIES);

// What a stop looks like, from what the trip knows about it
export function kindOf(x = {}, i = 0, n = 1) {
  const name = `${x.place || x.name || ''} ${x.region || ''}`;
  if (x.island) return 'island';
  if (/\b(bangkok|city|town|kuala lumpur|singapore|tokyo|hanoi|saigon|ho chi minh|seoul|hong kong|taipei|dubai|muscat|lisbon|rome|paris|london|new york|mexico city|delhi|mumbai|colombo|istanbul|cairo|marrakech|barcelona|madrid|berlin|frankfurt|munich|chiang mai)\b/i.test(name)) return 'city';
  if ((i === 0 || i === n - 1) && !x.nights) return 'city';
  if (/\b(beach|bay|ao|lak|nang|coast|sands?|shore|cove|lagoon|playa|praia)\b/i.test(name)) return 'beach';
  return 'nature';
}
// A country's picture from its tags: beaches first, then nature, then cities
export const kindOfTags = (tags = []) => (tags.includes('beach') ? 'beach' : tags.includes('nature') ? 'nature' : tags.includes('city') ? 'city' : 'nature');

// A wavy ridge across the width: y around `base`, `amp` high, smooth
function ridge(r, w, h, base, amp, step = 40) {
  const pts = [];
  for (let x = -step; x <= w + step; x += step) pts.push([x, base - r() * amp]);
  let d = `M${-step},${h} L${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
    d += ` Q${x0 + step / 2},${y0} ${(x0 + x1) / 2},${(y0 + y1) / 2}`;
    if (i === pts.length - 1) d += ` T${x1},${y1}`;
  }
  return `${d} L${w + step},${h} Z`;
}
// A limestone island: steep sides, a rounded top, the way they rise out of the Andaman sea
function karst(cx, base, wd, ht) {
  const l = cx - wd / 2, r = cx + wd / 2;
  return `M${l - wd * 0.15},${base} C${l},${base - ht * 0.35} ${l - wd * 0.05},${base - ht * 0.9} ${cx - wd * 0.15},${base - ht} C${cx + wd * 0.1},${base - ht * 1.05} ${r + wd * 0.05},${base - ht * 0.7} ${r},${base - ht * 0.3} C${r + wd * 0.08},${base - ht * 0.1} ${r + wd * 0.2},${base} ${r + wd * 0.2},${base} Z`;
}
function palm(g, x, y, size, fill, lean = 1) {
  const t = size;
  g.append(s('path', { d: `M${x},${y} C${x + 4 * lean},${y - t * 0.5} ${x + 10 * lean},${y - t * 0.85} ${x + 16 * lean},${y - t}`, stroke: fill, 'stroke-width': Math.max(2, t * 0.06), fill: 'none', 'stroke-linecap': 'round' }));
  const tx = x + 16 * lean, ty = y - t;
  for (const [dx, dy] of [[-1, 0.15], [-0.7, 0.55], [0.1, 0.7], [0.8, 0.5], [1, 0.1], [0.3, -0.25], [-0.45, -0.2]]) {
    const ex = tx + dx * t * 0.45, ey = ty + dy * t * 0.35;
    g.append(s('path', { d: `M${tx},${ty} Q${(tx + ex) / 2},${Math.min(ty, ey) - t * 0.12} ${ex},${ey} Q${(tx + ex) / 2 + 2},${Math.min(ty, ey) - t * 0.04} ${tx},${ty + 1} Z`, fill }));
  }
}

// opts: { w, h, sky, title } — the picture fills its box (slice), so one drawing fits a banner and a thumbnail
export function scene(seed, kind = 'nature', opts = {}) {
  const r = rng(`${seed}|${kind}`);
  const W = opts.w || 400, H = opts.h || 200;
  const P = SKIES[opts.sky] || SKIES[SKY_NAMES[hash(seed) % SKY_NAMES.length]];
  const id = `sc${++uid}`;
  const svg = s('svg', { class: 'scene', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'xMidYMid slice', 'aria-hidden': 'true', focusable: 'false' });
  const defs = s('defs');
  const lin = (gid, a, b, x2 = 0, y2 = 1) => { const g = s('linearGradient', { id: gid, x1: 0, y1: 0, x2, y2 }); g.append(s('stop', { offset: 0, 'stop-color': a }), s('stop', { offset: 1, 'stop-color': b })); defs.append(g); return `url(#${gid})`; };
  const sky = lin(`${id}s`, P.sky[0], P.sky[1]);
  const sea = lin(`${id}w`, P.sea[0], P.sea[1]);
  const glow = s('radialGradient', { id: `${id}g` });
  glow.append(s('stop', { offset: 0, 'stop-color': P.glow, 'stop-opacity': 0.9 }), s('stop', { offset: 1, 'stop-color': P.glow, 'stop-opacity': 0 }));
  const mist = lin(`${id}m`, '#ffffff', '#ffffff');
  defs.append(glow);
  svg.append(defs, s('rect', { width: W, height: H, fill: sky }));

  // the sun with its glow, clouds
  const horizon = kind === 'nature' ? H * 0.5 : kind === 'city' ? H * 0.7 : H * 0.6;
  const sx = W * (0.2 + r() * 0.6), sy = horizon - H * (0.12 + r() * 0.28);
  svg.append(s('circle', { cx: sx, cy: sy, r: H * 0.34, fill: `url(#${id}g)`, class: 'sc-glow' }), s('circle', { cx: sx, cy: sy, r: H * 0.075, fill: P.sun }));
  for (let i = 0; i < 3; i++) {
    const cx = r() * W, cy = H * (0.1 + r() * 0.25), cw = 30 + r() * 50;
    const c = s('g', { class: 'sc-cloud', opacity: 0.55 + r() * 0.3 });
    c.append(s('ellipse', { cx, cy, rx: cw, ry: cw * 0.16, fill: '#fff' }), s('ellipse', { cx: cx - cw * 0.25, cy: cy - cw * 0.1, rx: cw * 0.45, ry: cw * 0.2, fill: '#fff' }));
    svg.append(c);
  }

  if (kind === 'nature') {
    // far peaks with sharp tops, then rounder hills, then the near slope
    let d = `M0,${H}`;
    for (let x = -20, up = true; x <= W + 40; x += 18 + r() * 34, up = !up) d += ` L${x},${up ? horizon - H * (0.12 + r() * 0.3) : horizon - H * (0.02 + r() * 0.08)}`;
    svg.append(s('path', { d: `${d} L${W + 40},${H} Z`, fill: P.hills[0], 'stroke-linejoin': 'round' }));
    svg.append(s('rect', { y: horizon - H * 0.04, width: W, height: H * 0.1, fill: P.sky[1], opacity: 0.35 }));
    svg.append(s('path', { d: ridge(r, W, H, horizon + H * 0.14, H * 0.2, 70), fill: P.hills[1] }));
    svg.append(s('path', { d: ridge(r, W, H, horizon + H * 0.34, H * 0.12, 110), fill: P.hills[2] }));
    const g = s('g');
    for (let i = 0; i < 14; i++) {                                   // a few trees on the nearest ridge
      const x = r() * W, y = H - r() * H * 0.12, t = H * (0.08 + r() * 0.07);
      g.append(s('path', { d: `M${x},${y - t} L${x - t * 0.32},${y} L${x + t * 0.32},${y} Z`, fill: P.hills[2] }));
    }
    svg.append(g);
  } else if (kind === 'city') {
    svg.append(s('path', { d: ridge(r, W, H, horizon, H * 0.1), fill: P.hills[0], opacity: 0.7 }));
    for (const [layer, fill] of [[0, P.hills[1]], [1, P.hills[2]]]) {
      const g = s('g');
      let x = -10;
      while (x < W) {
        const bw = 14 + r() * 26, bh = H * (0.08 + r() * (layer ? 0.22 : 0.3));
        const top = horizon + layer * H * 0.12 - bh;
        if (r() < 0.12 && layer === 0) {                              // a temple spire now and then
          g.append(s('path', { d: `M${x},${horizon} L${x},${top + bh * 0.5} Q${x + bw / 2},${top + bh * 0.2} ${x + bw / 2},${top - bh * 0.35} Q${x + bw / 2},${top + bh * 0.2} ${x + bw},${top + bh * 0.5} L${x + bw},${horizon} Z`, fill }));
        } else g.append(s('rect', { x, y: top, width: bw, height: H, fill, rx: 1.5 }));
        if (layer) for (let wy = top + 6; wy < H - 4; wy += 8) for (let wx = x + 4; wx < x + bw - 3; wx += 6) if (r() < 0.28) g.append(s('rect', { x: wx, y: wy, width: 2.2, height: 3, fill: P.glow, opacity: 0.85 }));
        x += bw + 2 + r() * 6;
      }
      svg.append(g);
    }
    svg.append(s('rect', { y: H * 0.92, width: W, height: H * 0.08, fill: sea }));
  } else {
    // the sea, with far islands, light on the water, and for a beach the sand and a palm
    svg.append(s('path', { d: ridge(r, W, H, horizon + 1, H * 0.08, 60), fill: P.hills[0], opacity: 0.8 }));
    svg.append(s('rect', { y: horizon, width: W, height: H - horizon, fill: sea }));
    for (let i = 0; i < 6; i++) {                                    // the sun's path on the water
      const y = horizon + 4 + i * (H - horizon) * 0.11, l = W * (0.1 - i * 0.012);
      svg.append(s('rect', { x: sx - l / 2 + (r() - 0.5) * 6, y, width: l, height: 1.6, rx: 0.8, fill: P.sun, opacity: 0.55 - i * 0.07, class: 'sc-glint' }));
    }
    const isl = s('g');
    const n = kind === 'island' ? 2 + Math.floor(r() * 3) : 1 + Math.floor(r() * 2);
    for (let i = 0; i < n; i++) {
      const cx = W * (0.1 + r() * 0.8), wd = W * (0.06 + r() * (kind === 'island' ? 0.12 : 0.06)), ht = H * (0.12 + r() * (kind === 'island' ? 0.26 : 0.1));
      isl.append(s('path', { d: karst(cx, horizon + 2, wd, ht), fill: i % 2 ? P.hills[1] : P.hills[2], opacity: i % 2 ? 0.85 : 1 }));
      if (kind === 'island' && r() < 0.6) palm(isl, cx - wd * 0.1, horizon - ht * 0.92, ht * 0.4, P.hills[2], r() < 0.5 ? -1 : 1);
    }
    svg.append(isl);
    for (let i = 0; i < 9; i++) {                                    // wave lines
      const y = horizon + 6 + r() * (H - horizon - 10), x = r() * W, l = 10 + r() * 26;
      svg.append(s('path', { d: `M${x},${y} q${l / 4},-2 ${l / 2},0 t${l / 2},0`, stroke: '#ffffff', 'stroke-width': 1.2, fill: 'none', opacity: 0.35, 'stroke-linecap': 'round', class: 'sc-wave' }));
    }
    if (kind === 'beach') {
      const sand = `M0,${H * 0.82} C${W * 0.3},${H * (0.74 + r() * 0.06)} ${W * 0.6},${H * 0.86} ${W},${H * (0.78 + r() * 0.06)} L${W},${H} L0,${H} Z`;
      svg.append(s('path', { d: `M0,${H * 0.8} C${W * 0.3},${H * 0.72} ${W * 0.6},${H * 0.84} ${W},${H * 0.76} L${W},${H * 0.8} C${W * 0.6},${H * 0.88} ${W * 0.3},${H * 0.76} 0,${H * 0.84} Z`, fill: '#ffffff', opacity: 0.5 }));
      svg.append(s('path', { d: sand, fill: P.sand }));
      const g = s('g');
      const left = r() < 0.5;
      palm(g, left ? W * 0.12 : W * 0.86, H * 0.9, H * 0.62, P.hills[2], left ? 1 : -1);
      if (r() < 0.6) palm(g, left ? W * 0.2 : W * 0.78, H * 0.92, H * 0.42, P.hills[2], left ? 1.2 : -1.2);
      svg.append(g);
    } else if (r() < 0.7) {                                          // a long-tail boat
      const bx = W * (0.15 + r() * 0.7), by = horizon + (H - horizon) * (0.45 + r() * 0.3), bl = W * 0.07;
      svg.append(s('path', { d: `M${bx},${by} q${bl / 2},${bl * 0.18} ${bl},0 l${-bl * 0.12},${bl * 0.12} l${-bl * 0.78},0 Z`, fill: P.hills[2] }));
    }
  }
  if (opts.title) svg.append(s('title', {}, opts.title));
  return svg;
}
