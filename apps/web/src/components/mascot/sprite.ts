/**
 * Gus — the Constella workshop mascot, drawn as 16×24 pixel art.
 *
 * Frames are composed procedurally from parts (hat, face, eyes, mouth, arms, legs) so a handful of
 * poses combine into many animations without hand-drawing every frame. Everything is authored
 * here, pixel by pixel: no external sprite sheet.
 */

export const SPRITE_W = 16;
export const SPRITE_H = 24;

const PALETTE = {
  k: '#1b1e25', // ink outline
  y: '#f5cb1f', // hard hat — signal yellow
  Y: '#c99812', // hat shade / brim
  h: '#fff3a6', // hat highlight
  s: '#f3c29c', // skin
  S: '#d99b73', // skin shade
  c: '#ee8b80', // cheeks
  b: '#2f5ec0', // "bleu de travail" jacket
  B: '#1f3f88', // jacket shade
  r: '#e8ebf1', // reflective stripe
  w: '#ffffff',
  m: '#9b2f2f', // mouth inside
  p: '#2a3247', // trousers
  o: '#5b3b22', // boots
  O: '#3a2514', // soles
} as const;

type Ink = keyof typeof PALETTE;

export type Eyes = 'open' | 'closed' | 'happy' | 'wide' | 'up';
export type Mouth = 'neutral' | 'smile' | 'open' | 'o' | 'flat';
export type Arms = 'down' | 'wave1' | 'wave2' | 'up' | 'think' | 'swing1' | 'swing2';
export type Legs = 'stand' | 'stepL' | 'stepR' | 'crouch' | 'tuck';

export interface Pose {
  eyes: Eyes;
  mouth: Mouth;
  arms: Arms;
  legs: Legs;
  /** horizontal gaze offset (-1 | 0 | 1) */
  look?: number;
  cheeks?: boolean;
}

type Put = (x: number, y: number, c: Ink) => void;

function rect(put: Put, x: number, y: number, w: number, h: number, c: Ink) {
  for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) put(x + i, y + j, c);
}

function drawHat(put: Put, dy: number) {
  rect(put, 5, 1 + dy, 6, 1, 'k');
  put(4, 2 + dy, 'k');
  put(11, 2 + dy, 'k');
  rect(put, 5, 2 + dy, 6, 1, 'y');
  put(6, 2 + dy, 'h');
  put(7, 2 + dy, 'h');
  put(3, 3 + dy, 'k');
  put(12, 3 + dy, 'k');
  rect(put, 4, 3 + dy, 8, 1, 'y');
  put(5, 3 + dy, 'h');
  put(2, 4 + dy, 'k');
  put(13, 4 + dy, 'k');
  rect(put, 3, 4 + dy, 10, 1, 'y');
  // the little white star on the front of the helmet — Constella's mark
  put(8, 3 + dy, 'w');
  rect(put, 7, 4 + dy, 3, 1, 'w');
  // brim
  put(1, 5 + dy, 'k');
  put(14, 5 + dy, 'k');
  rect(put, 2, 5 + dy, 12, 1, 'Y');
}

function drawFace(put: Put, dy: number, pose: Pose) {
  for (let y = 6; y <= 10; y++) {
    put(2, y + dy, 'k');
    put(13, y + dy, 'k');
    rect(put, 3, y + dy, 10, 1, 's');
  }
  put(3, 11 + dy, 'k');
  put(12, 11 + dy, 'k');
  rect(put, 4, 11 + dy, 8, 1, 'S');
  rect(put, 4, 12 + dy, 8, 1, 'k');

  const look = pose.look ?? 0;
  const lx = 5 + look;
  const rx = 10 + look;
  for (const ex of [lx, rx]) {
    switch (pose.eyes) {
      case 'open':
        rect(put, ex, 7 + dy, 1, 2, 'k');
        break;
      case 'up':
        rect(put, ex, 6 + dy, 1, 2, 'k');
        break;
      case 'closed':
        rect(put, ex - 1, 8 + dy, 3, 1, 'k');
        break;
      case 'happy':
        put(ex - 1, 8 + dy, 'k');
        put(ex, 7 + dy, 'k');
        put(ex + 1, 8 + dy, 'k');
        break;
      case 'wide':
        rect(put, ex, 7 + dy, 2, 2, 'k');
        put(ex, 7 + dy, 'w');
        break;
    }
  }

  if (pose.cheeks) {
    put(3, 9 + dy, 'c');
    put(12, 9 + dy, 'c');
  }

  const mx = 7 + look;
  switch (pose.mouth) {
    case 'neutral':
      rect(put, mx, 10 + dy, 2, 1, 'k');
      break;
    case 'flat':
      rect(put, mx - 1, 10 + dy, 4, 1, 'k');
      break;
    case 'smile':
      put(mx - 1, 9 + dy, 'k');
      rect(put, mx, 10 + dy, 2, 1, 'k');
      put(mx + 2, 9 + dy, 'k');
      break;
    case 'open':
      rect(put, mx - 1, 9 + dy, 4, 2, 'k');
      rect(put, mx, 10 + dy, 2, 1, 'm');
      break;
    case 'o':
      rect(put, mx, 9 + dy, 2, 2, 'k');
      break;
  }
}

function drawBody(put: Put, dy: number) {
  put(3, 13 + dy, 'k');
  rect(put, 4, 13 + dy, 3, 1, 'b');
  rect(put, 7, 13 + dy, 2, 1, 'w');
  rect(put, 9, 13 + dy, 3, 1, 'b');
  put(12, 13 + dy, 'k');
  for (const y of [14, 15, 17]) {
    put(3, y + dy, 'k');
    put(12, y + dy, 'k');
    rect(put, 4, y + dy, 8, 1, 'b');
  }
  put(3, 16 + dy, 'k');
  put(12, 16 + dy, 'k');
  rect(put, 4, 16 + dy, 8, 1, 'r');
  put(3, 18 + dy, 'k');
  put(12, 18 + dy, 'k');
  rect(put, 4, 18 + dy, 8, 1, 'B');
}

/** one arm hanging down; side = -1 left, +1 right */
function armDown(put: Put, dy: number, side: -1 | 1, swing = 0) {
  const x = side < 0 ? 2 : 13;
  const ox = side < 0 ? 1 : 14;
  const top = 14 + dy + swing;
  rect(put, ox, top, 1, 4, 'k');
  rect(put, x, top, 1, 3, 'b');
  put(x, top + 3, 's');
  put(x, top + 4, 'k');
}

/** one arm raised beside the head; tilt nudges the hand outward */
function armUp(put: Put, dy: number, side: -1 | 1, tilt = 0) {
  const x = side < 0 ? 2 - tilt : 13 + tilt;
  const ox = side < 0 ? x - 1 : x + 1;
  rect(put, ox, 8 + dy, 1, 6, 'k');
  rect(put, x, 9 + dy, 1, 5, 'b');
  put(x, 8 + dy, 's');
  put(x, 7 + dy, 'k');
}

function drawArms(put: Put, dy: number, arms: Arms) {
  switch (arms) {
    case 'down':
      armDown(put, dy, -1);
      armDown(put, dy, 1);
      break;
    case 'swing1':
      armDown(put, dy, -1, -1);
      armDown(put, dy, 1, 0);
      break;
    case 'swing2':
      armDown(put, dy, -1, 0);
      armDown(put, dy, 1, -1);
      break;
    case 'wave1':
      armDown(put, dy, -1);
      armUp(put, dy, 1, 0);
      break;
    case 'wave2':
      armDown(put, dy, -1);
      armUp(put, dy, 1, 1);
      break;
    case 'up':
      armUp(put, dy, -1, 1);
      armUp(put, dy, 1, 1);
      break;
    case 'think':
      armDown(put, dy, -1);
      // forearm bent up, fist under the chin
      rect(put, 14, 12 + dy, 1, 4, 'k');
      rect(put, 13, 13 + dy, 1, 3, 'b');
      put(12, 12 + dy, 'b');
      rect(put, 10, 11 + dy, 2, 1, 's');
      put(12, 11 + dy, 'k');
      put(13, 12 + dy, 'k');
      break;
  }
}

function leg(put: Put, side: -1 | 1, lift: number, short: boolean) {
  // trouser leg 3px wide with outline, boot 4px, sole
  const x0 = side < 0 ? 3 : 8;
  const legRows = short ? 0 : 1;
  const bootY = 21 - lift - (short ? 1 : 0);
  for (let i = 0; i < legRows; i++) {
    put(x0, 21 + i - lift, 'k');
    rect(put, x0 + 1, 21 + i - lift, 3, 1, 'p');
    put(x0 + 4, 21 + i - lift, 'k');
  }
  const bx = side < 0 ? x0 - 1 : x0;
  put(bx, bootY + 1, 'k');
  rect(put, bx + 1, bootY + 1, 4, 1, 'o');
  put(bx + 5, bootY + 1, 'k');
  rect(put, bx, bootY + 2, 6, 1, 'O');
}

function drawLegs(put: Put, dy: number, legs: Legs) {
  // hips
  put(3, 19 + dy, 'k');
  rect(put, 4, 19 + dy, 8, 1, 'p');
  put(12, 19 + dy, 'k');
  put(3, 20 + dy, 'k');
  rect(put, 4, 20 + dy, 3, 1, 'p');
  rect(put, 7, 20 + dy, 2, 1, 'k');
  rect(put, 9, 20 + dy, 3, 1, 'p');
  put(12, 20 + dy, 'k');
  switch (legs) {
    case 'stand':
      leg(put, -1, 0, false);
      leg(put, 1, 0, false);
      break;
    case 'stepL':
      leg(put, -1, 1, false);
      leg(put, 1, 0, false);
      break;
    case 'stepR':
      leg(put, -1, 0, false);
      leg(put, 1, 1, false);
      break;
    case 'crouch':
      leg(put, -1, 0, true);
      leg(put, 1, 0, true);
      break;
    case 'tuck':
      leg(put, -1, 2, true);
      leg(put, 1, 2, true);
      break;
  }
}

/** Paint one frame onto a 2D context sized SPRITE_W × SPRITE_H (scale with CSS / setTransform). */
export function paintFrame(ctx: CanvasRenderingContext2D, pose: Pose, facing: 1 | -1) {
  ctx.clearRect(0, 0, SPRITE_W, SPRITE_H);
  const put: Put = (x, y, c) => {
    if (x < 0 || y < 0 || x >= SPRITE_W || y >= SPRITE_H) return;
    const px = facing === 1 ? x : SPRITE_W - 1 - x;
    ctx.fillStyle = PALETTE[c];
    ctx.fillRect(px, y, 1, 1);
  };
  // crouching drops the whole upper body by one pixel
  const dy = pose.legs === 'crouch' ? 1 : 0;
  drawLegs(put, 0, pose.legs);
  drawBody(put, dy);
  drawArms(put, dy, pose.arms);
  drawHat(put, dy);
  drawFace(put, dy, pose);
}
