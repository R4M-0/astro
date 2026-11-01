// Renders Gus's animations into PPM frames with the real sprite painter (docs/assets/gus.gif).
// node apps/web/scripts/render-gus-gif.mjs <frames-dir> && magick -dispose background -delay 9 -loop 0 <frames-dir>/f*.ppm -transparent '#ff00ff' -layers Optimize docs/assets/gus.gif
import { writeFileSync } from 'node:fs';
import { paintFrame, SPRITE_W, SPRITE_H } from '../src/components/mascot/sprite.ts';

const OUT = process.argv[2];
const SW = 60, SH = 80, S = 6; // portrait scene in pixel units, upscaled ×6 → 360×480
const FLOOR = 62; // floor-tape row: keeps Gus and his bubbles vertically centred
// BG is a key colour made transparent when the GIF is assembled (`-transparent '#ff00ff'`);
// everything else stays legible on both GitHub's light and dark themes
const BG = [255, 0, 255], INK = [27, 30, 37], YEL = [245, 203, 31], WHITE = [255, 255, 255], SHADOW = [128, 134, 148], BLUE = [47, 94, 192];
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

function sprite(pose, facing) {
  const buf = Array.from({ length: SPRITE_H }, () => Array(SPRITE_W).fill(null));
  let fill = null;
  const ctx = {
    clearRect() {},
    set fillStyle(v) { fill = hex(v); },
    fillRect(x, y) { buf[y][x] = fill; },
  };
  paintFrame(ctx, pose, facing);
  return buf;
}

let n = 0;
function frame({ x, y = 0, pose, facing = 1, extras = [] }) {
  const px = Array.from({ length: SH }, () => Array.from({ length: SW }, () => BG));
  const put = (X, Y, c) => { if (X >= 0 && Y >= 0 && X < SW && Y < SH) px[Y][X] = c; };
  // floor tape between two posts
  for (let X = 4; X < SW - 4; X++) for (let Y = FLOOR; Y < FLOOR + 2; Y++) put(X, Y, Math.floor((X - 4) / 3) % 2 ? INK : YEL);
  for (const X of [3, SW - 4]) for (let Y = FLOOR - 3; Y < FLOOR + 2; Y++) put(X, Y, INK);
  // shadow shrinks while airborne
  const w = Math.max(4, 10 + Math.round(y / 2));
  for (let X = 0; X < w; X++) put(x + 8 - Math.floor(w / 2) + X, FLOOR - 1, SHADOW);
  const spr = sprite(pose, facing);
  const top = FLOOR - SPRITE_H + y;
  spr.forEach((row, j) => row.forEach((c, i) => c && put(x + i, top + j, c)));
  for (const draw of extras) draw(put, x, top);
  const data = Buffer.alloc(SW * S * SH * S * 3);
  for (let Y = 0; Y < SH * S; Y++) for (let X = 0; X < SW * S; X++) {
    const c = px[Math.floor(Y / S)][Math.floor(X / S)];
    data.set(c, (Y * SW * S + X) * 3);
  }
  writeFileSync(`${OUT}/f${String(n++).padStart(4, '0')}.ppm`, Buffer.concat([Buffer.from(`P6 ${SW * S} ${SH * S} 255\n`), data]));
}

// --- little pixel props ---------------------------------------------------------------
const box = (put, x, y, w, h) => { for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) put(x + i, y + j, (i === 0 || j === 0 || i === w - 1 || j === h - 1) ? INK : WHITE); };
const thought = (k) => (put, x, top) => {
  box(put, x + 12, top - 9, 13, 7);
  for (let d = 0; d < 3; d++) if (k % 3 >= d) { put(x + 15 + d * 3, top - 6, INK); put(x + 16 + d * 3, top - 6, INK); }
  put(x + 12, top - 1, INK); put(x + 13, top - 2, INK);
};
const bang = (put, x, top) => { box(put, x + 13, top - 10, 5, 9); for (let j = 0; j < 4; j++) put(x + 15, top - 8 + j, [205, 43, 43]); put(x + 15, top - 3, [205, 43, 43]); };
const heart = (put, x, top) => {
  const R = [214, 64, 80];
  [[1,0],[2,0],[4,0],[5,0],[0,1],[1,1],[2,1],[3,1],[4,1],[5,1],[6,1],[1,2],[2,2],[3,2],[4,2],[5,2],[2,3],[3,3],[4,3],[3,4]].forEach(([i, j]) => put(x + 14 + i, top - 7 + j, R));
};
const Z = (put, X, Y, s) => { for (let i = 0; i < s; i++) { put(X + i, Y, BLUE); put(X + i, Y + s - 1, BLUE); put(X + s - 1 - i, Y + i, BLUE); } };
const zzz = (k) => (put, x, top) => { const r = k % 12; if (r > 1) Z(put, x + 13, top - 2, 4); if (r > 4) Z(put, x + 18, top - 8, 5); if (r > 7) Z(put, x + 24, top - 15, 6); };
const ha = (put, x, top) => {
  // "HA" in a 3×5 pixel font
  const H = [[0,0],[0,1],[0,2],[0,3],[0,4],[2,0],[2,1],[2,2],[2,3],[2,4],[1,2]];
  const A = [[1,0],[0,1],[2,1],[0,2],[1,2],[2,2],[0,3],[2,3],[0,4],[2,4]];
  box(put, x + 12, top - 9, 11, 9);
  H.forEach(([i, j]) => put(x + 14 + i, top - 7 + j, INK)); A.forEach(([i, j]) => put(x + 18 + i, top - 7 + j, INK));
};

const base = { eyes: 'open', mouth: 'smile', arms: 'down', legs: 'stand', look: 0 };
let x = 6;
const walkTo = (to, holding) => {
  const dir = to > x ? 1 : -1;
  let k = 0;
  while (x !== to) {
    x += dir * 2;
    const f = k++ % 4;
    frame({ x, facing: dir, pose: { ...base, mouth: 'neutral', look: 1, holding, legs: f === 1 ? 'stepL' : f === 3 ? 'stepR' : 'stand', arms: holding ? 'down' : f === 1 ? 'swing1' : f === 3 ? 'swing2' : 'down' } });
  }
};
const hold = (count, make) => { for (let k = 0; k < count; k++) frame(make(k)); };

walkTo(26);
hold(4, () => ({ x, pose: base }));
hold(1, () => ({ x, pose: { ...base, eyes: 'closed' } }));                                     // blink
hold(4, () => ({ x, pose: base }));
hold(10, (k) => ({ x, pose: { ...base, cheeks: true, arms: k % 4 < 2 ? 'wave1' : 'wave2' } })); // wave
hold(15, (k) => ({ x, facing: 1, pose: { ...base, eyes: 'up', arms: 'think', look: -1, mouth: k % 8 < 4 ? 'o' : 'flat' }, extras: [thought(Math.floor(k / 3))] }));
const jump = (h, pose, extras = []) => {                                                          // generic hop
  const N = 8;
  for (let k = 0; k < N; k++) {
    const r = k / (N - 1);
    const air = k > 0 && k < N - 1;
    frame({ x, y: air ? -Math.round(Math.sin(r * Math.PI) * h) : 0, pose: { ...pose, legs: air ? 'tuck' : 'crouch' }, extras });
  }
};
jump(7, { ...base, eyes: 'wide', mouth: 'o', arms: 'up' }, [bang]);                              // surprised: mail!
hold(10, (k) => ({ x, pose: { ...base, mouth: k % 2 ? 'open' : 'neutral', holding: 'envelope' } })); // postman
hold(3, () => ({ x, pose: base }));
jump(10, { ...base, eyes: 'happy', mouth: 'open', arms: 'up' });                                  // jump
hold(12, (k) => ({ x: x + (k % 2 ? 1 : -1) * (k < 11 ? 1 : 0), pose: { ...base, eyes: 'happy', cheeks: true, mouth: k % 2 ? 'open' : 'smile', arms: k % 4 < 2 ? 'swing1' : 'swing2' }, extras: [ha] })); // laugh
walkTo(4, 'clipboard');                                                                           // the daily round
walkTo(36, 'clipboard');
hold(8, (k) => ({ x, pose: { ...base, holding: 'clipboard', mouth: k % 2 ? 'open' : 'neutral' } }));
for (let r = 0; r < 2; r++) jump(6, { ...base, eyes: 'happy', mouth: 'open', cheeks: true, arms: 'up' }, [heart]); // celebrate
walkTo(20);
hold(26, (k) => ({ x, pose: { ...base, eyes: 'closed', legs: 'crouch', mouth: Math.floor(k / 8) % 2 ? 'o' : 'neutral' }, extras: [zzz(Math.floor(k / 2))] })); // nap
hold(1, () => ({ x, pose: { ...base, eyes: 'wide', mouth: 'o' } }));
walkTo(6);
console.log('frames', n);
