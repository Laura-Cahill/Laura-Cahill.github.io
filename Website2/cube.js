/*
 * Picture Cube - cube.js
 * Edit log:
 *   v1  first version: folder picker, NxN picture cube drawn with CSS 3D,
 *       drag and keyboard turns, scramble, undo, reset, timer, solved check
 *   v2  live drag turns that follow the mouse and snap on release, orbit with
 *       right drag or Shift drag anywhere, wheel zoom, double click or Home
 *       to reset the view
 *   v3  auto-solve: stops the timer and plays back the undo of every move
 *       since the solved state (scramble plus your turns), simplified
 *   v4  encoded puzzle files: the player opens one PCUBE1 file (image plus
 *       size and id, XOR-ed with DATA_KEY, FNV-1a checksum, base64, the same
 *       scheme as Signal Tuner) instead of a folder. After a solve, Save result
 *       writes a result file that tools/verify.sh grades. Folder picker, faces
 *       mode, New image and the size menu are gone: the puzzle sets the size.
 *   v5  Auto-solve removed (button, playback and the auto-solve result method);
 *       the grader accepts only hand solves
 *   v6  Reset returns to the starting scramble of this attempt (not to
 *       solved), and clears moves, timer, undo history and the last result
 */
'use strict';

/* ---------- 3x3 math, row-major flat arrays ---------- */
const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
function mul3(a, b) {
  const r = new Array(9);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  return r;
}
function mulv(m, v) {
  return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
          m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
          m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
}
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const scale = (v, s) => [v[0] * s, v[1] * s, v[2] * s];
const eq3 = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
const rnd = (n) => Math.floor(Math.random() * n);
function axisVec(k, s = 1) { const v = [0, 0, 0]; v[k] = s; return v; }
function rot(axis, ang) {
  const c = Math.cos(ang), s = Math.sin(ang);
  if (axis === 0) return [1, 0, 0, 0, c, -s, 0, s, c];
  if (axis === 1) return [c, 0, s, 0, 1, 0, -s, 0, c];
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}
const quarter = (axis, sign) => rot(axis, sign * Math.PI / 2).map(Math.round);
function fromCols(u, v, n) { return [u[0], v[0], n[0], u[1], v[1], n[1], u[2], v[2], n[2]]; }
function orthonormalize(m) {
  const norm = (v) => scale(v, 1 / Math.hypot(v[0], v[1], v[2]));
  const r0 = norm([m[0], m[1], m[2]]);
  let r1 = [m[3], m[4], m[5]];
  r1 = norm([r1[0] - dot(r1, r0) * r0[0], r1[1] - dot(r1, r0) * r0[1], r1[2] - dot(r1, r0) * r0[2]]);
  const r2 = cross(r0, r1);
  return [...r0, ...r1, ...r2];
}
function css(m, t) {
  const f = (x) => +x.toFixed(5);
  return `matrix3d(${f(m[0])},${f(m[3])},${f(m[6])},0,${f(m[1])},${f(m[4])},${f(m[7])},0,` +
         `${f(m[2])},${f(m[5])},${f(m[8])},0,${f(t[0])},${f(t[1])},${f(t[2])},1)`;
}

/* ---------- faces ----------
 * CSS axes: x right, y down, z toward the viewer.
 * n = outward normal, u = picture right, v = picture down.
 * u x v = n on every face, so no picture is ever mirrored, and a
 * positive turn about a face's outward normal looks clockwise from outside. */
const FACES = [
  { name: 'Front',  n: [0, 0, 1],  u: [1, 0, 0],  v: [0, 1, 0] },
  { name: 'Back',   n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
  { name: 'Right',  n: [1, 0, 0],  u: [0, 0, -1], v: [0, 1, 0] },
  { name: 'Left',   n: [-1, 0, 0], u: [0, 0, 1],  v: [0, 1, 0] },
  { name: 'Top',    n: [0, -1, 0], u: [1, 0, 0],  v: [0, 0, 1] },
  { name: 'Bottom', n: [0, 1, 0],  u: [1, 0, 0],  v: [0, 0, -1] },
];
const FACE_KEY = { F: 0, B: 1, R: 2, L: 3, U: 4, D: 5 };

/* ---------- model ----------
 * Positions use doubled coordinates so even sizes stay integer:
 * a layer sits at -(a-1), -(a-3), ..., a-1. A move is
 * { axis: 0|1|2, coord: layer coordinate, sign: +1|-1 }. */
function coords(a) { const r = []; for (let i = 0; i < a; i++) r.push(2 * i - (a - 1)); return r; }

function buildModel(a, urls) {
  const lim = a - 1, cs = coords(a), cubies = [];
  for (const x of cs) for (const y of cs) for (const z of cs) {
    if (Math.abs(x) !== lim && Math.abs(y) !== lim && Math.abs(z) !== lim) continue; // hidden inside
    const home = [x, y, z];
    const c = { home, pos: home.slice(), rot: I3.slice(), stickers: [], el: null, faces: [] };
    FACES.forEach((F, fi) => {
      if (dot(home, F.n) === lim) {
        c.stickers.push({ fi, img: urls[fi], col: (dot(home, F.u) + lim) / 2, row: (dot(home, F.v) + lim) / 2 });
      }
    });
    cubies.push(c);
  }
  return cubies;
}

const layerOf = (cubies, m) => cubies.filter((c) => c.pos[m.axis] === m.coord);

function applyMove(m, layer) {
  const R = quarter(m.axis, m.sign);
  for (const c of layer) { c.pos = mulv(R, c.pos); c.rot = mul3(R, c.rot); }
}

/* Solved when every face shows one picture, upright relative to itself and
 * with every piece in place. Whole-cube rotations still count as solved, and
 * identical pictures on several faces may trade pieces freely. */
function isSolved(cubies) {
  const seen = new Map();
  for (const c of cubies) {
    for (const s of c.stickers) {
      const F = FACES[s.fi];
      const n = mulv(c.rot, F.n), u = mulv(c.rot, F.u), v = mulv(c.rot, F.v);
      const key = n.join(',');
      const want = seen.get(key);
      if (!want) seen.set(key, { img: s.img, u });
      else if (want.img !== s.img || !eq3(want.u, u)) return false;
      if (dot(c.pos, u) !== dot(c.home, F.u) || dot(c.pos, v) !== dot(c.home, F.v)) return false;
    }
  }
  return true;
}

function randomMoves(a, count) {
  const out = [];
  let prev = null;
  while (out.length < count) {
    const m = { axis: rnd(3), coord: 2 * rnd(a) - (a - 1), sign: Math.random() < 0.5 ? 1 : -1 };
    if (prev && prev.axis === m.axis && prev.coord === m.coord && prev.sign === -m.sign) continue;
    out.push(m);
    prev = m;
  }
  return out;
}

/* ---------- puzzle files ----------
 * File: "PCUBE1:" + 8 hex digits (FNV-1a of the plain payload bytes), a newline,
 * then base64 of the payload with each byte XOR-ed with DATA_KEY (key repeating).
 * Whitespace inside the base64 is ignored.
 * Payload: "PICTURE CUBE PUZZLE\n" + "key=value" lines + a blank line + image bytes.
 *   size=3        cube size, 2 to 7 (default 3)
 *   id=alice-01   optional label, letters digits . _ - (up to 32)
 * tools/encode_puzzle.py reads DATA_KEY from this file, so the two always match.
 * If you change the key, re-encode every puzzle before handing any out. */
const DATA_KEY = 'q7-Lumen-orbit-4k';
const ENC_HEAD = 'PCUBE1:';
const PAYLOAD_HEAD = 'PICTURE CUBE PUZZLE';
const ID_RE = /^[A-Za-z0-9._-]{1,32}$/;
const MAX_PUZZLE_TEXT = 40 * 1024 * 1024;

function xorBytes(bytes) {
  const out = new Uint8Array(bytes.length), k = [];
  for (let i = 0; i < DATA_KEY.length; i++) k.push(DATA_KEY.charCodeAt(i) & 255);
  for (let i = 0; i < bytes.length; i++) out[i] = bytes[i] ^ k[i % k.length];
  return out;
}
function fnv1a(bytes) {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 0x01000193) >>> 0;
  return ('00000000' + h.toString(16)).slice(-8);
}
const utf8 = (str) => new TextEncoder().encode(String(str));
function b64ToBytes(b64) {
  if (typeof atob !== 'function') return new Uint8Array(Buffer.from(b64, 'base64'));
  const bin = atob(b64), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64(bytes) {
  if (typeof btoa !== 'function') return Buffer.from(bytes).toString('base64');
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function sniffType(b) {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'image/png';
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'image/jpeg';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45) return 'image/webp';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  if (b[0] === 0x42 && b[1] === 0x4D) return 'image/bmp';
  return '';
}

/* Short code for a puzzle: the size, the id, and a checksum of the image bytes. */
function fingerprint(p) {
  return fnv1a(utf8(`pcube;s=${p.size};i=${p.id || ''};img=${fnv1a(p.image)}`));
}

/* Used by tests; the author's encoder is tools/encode_puzzle.py. */
function encodePuzzle(image, size, id) {
  const head = utf8(`${PAYLOAD_HEAD}\nsize=${size}\n` + (id ? `id=${id}\n` : '') + '\n');
  const raw = new Uint8Array(head.length + image.length);
  raw.set(head, 0);
  raw.set(image, head.length);
  const b64 = bytesToB64(xorBytes(raw));
  return ENC_HEAD + fnv1a(raw) + '\n' + (b64.match(/.{1,64}/g) || []).join('\n') + '\n';
}

/* Returns { size, id, image, fp } or { error }. */
function parsePuzzle(text) {
  const t = String(text).replace(/^﻿/, '').trim();
  if (t.length > MAX_PUZZLE_TEXT) return { error: 'this file is too large to be a puzzle' };
  if (t.slice(0, ENC_HEAD.length) !== ENC_HEAD) return { error: 'not a Picture Cube puzzle file (no PCUBE1: header)' };
  const sum = t.slice(ENC_HEAD.length, ENC_HEAD.length + 8);
  const b64 = t.slice(ENC_HEAD.length + 8).replace(/\s+/g, '');
  if (!/^[0-9a-f]{8}$/.test(sum) || !b64 || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) {
    return { error: 'this puzzle file is damaged' };
  }
  let raw;
  try { raw = xorBytes(b64ToBytes(b64)); } catch (e) { return { error: 'this puzzle file is damaged' }; }
  if (fnv1a(raw) !== sum) return { error: 'this puzzle file is damaged, or was made with a different key' };

  let end = -1;
  for (let i = 0; i + 1 < raw.length && i < 4096; i++) {
    if (raw[i] === 10 && raw[i + 1] === 10) { end = i; break; }
  }
  if (end < 0) return { error: 'this puzzle file has no settings block' };
  const lines = new TextDecoder().decode(raw.subarray(0, end)).split('\n');
  if (lines[0] !== PAYLOAD_HEAD) return { error: 'this puzzle file has an unknown layout' };
  const p = { size: 3, id: '', image: raw.subarray(end + 2) };
  for (const line of lines.slice(1)) {
    const eq = line.indexOf('=');
    const key = line.slice(0, eq).trim(), val = line.slice(eq + 1).trim();
    if (key === 'size') {
      if (!/^[2-7]$/.test(val)) return { error: `size must be 2 to 7, not "${val}"` };
      p.size = +val;
    } else if (key === 'id') {
      if (!ID_RE.test(val)) return { error: 'id must be up to 32 letters, digits, . _ or -' };
      p.id = val;
    }
  }
  if (!p.image.length) return { error: 'this puzzle file has no picture in it' };
  p.fp = fingerprint(p);
  return p;
}

/* ---------- result files ----------
 * A short readable text file. tools/verify.sh compares its puzzle code with
 * your copy of the puzzle file. There is no seal: anyone can edit it, so this
 * is an honest-player check. */
const RESULT_HEAD = 'PICTURE CUBE RESULT';

function fmt(ms) {
  const s = Math.max(0, Number(ms) || 0) / 1000;
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
}

/* f: { fp, id, size, method: 'hand', moves, timeMs, saved } */
function buildResult(f) {
  return `${RESULT_HEAD}\n` +
    `puzzle: ${f.fp}\n` +
    `id: ${f.id || '-'}\n` +
    `size: ${f.size}\n` +
    `method: ${f.method}\n` +
    `moves: ${f.moves}\n` +
    `time: ${fmt(f.timeMs)}\n` +
    `saved: ${f.saved}\n`;
}

/* text: a result file; p: parsePuzzle() of YOUR copy of the puzzle file.
 * Only hand solves pass. */
function verifyResult(text, p) {
  const m = String(text).replace(/\r\n/g, '\n').replace(/^﻿/, '').replace(/\n*$/, '\n')
    .match(/^PICTURE CUBE RESULT\n((?:[a-z]+: [^\n]*\n)+)$/);
  if (!m) return { ok: false, errors: ['not a Picture Cube result file'], fields: {} };
  const fields = {}, errors = [];
  for (const line of m[1].split('\n').slice(0, -1)) {
    const i = line.indexOf(': ');
    fields[line.slice(0, i)] = line.slice(i + 2);
  }
  if (fields.puzzle !== p.fp) errors.push('this result is for a different puzzle (or a different id or size)');
  if (fields.method !== 'hand') errors.push(`method is "${fields.method || ''}", not a hand solve`);
  return { ok: errors.length === 0, errors, fields };
}

/* ---------- app ---------- */
const MAX_TEX = 1024;

const state = {
  urls: [], puzzle: null, result: null, start: null,
  a: 3,
  cubies: [], S: 40,
  view: null, zoom: 1, dragging: false,
  queue: [], animating: false, gen: 0,
  history: [], moves: 0,
  scrambled: false, timerOn: false, startTime: 0, elapsed: 0,
  depth: 1,
};
const DEFAULT_VIEW = () => mul3(rot(0, -0.44), rot(1, -0.61));
state.view = DEFAULT_VIEW();
let stage, cubeEl, caps = [], tick = null, reduceMotion = false;
const $ = (id) => document.getElementById(id);
const ready = () => state.urls.length > 0;

function setStatus(msg) { $('status').textContent = msg; }

/* ----- drawing ----- */
function buildDOM() {
  cubeEl.textContent = '';
  const a = state.a, lim = a - 1;
  state.cubies.forEach((c, ci) => {
    c.el = document.createElement('div');
    c.el.className = 'cubie';
    c.faces = FACES.map((F, fi) => {
      const f = document.createElement('div');
      f.className = 'face';
      f.dataset.ci = ci;
      f.dataset.fi = fi;
      const s = c.stickers.find((st) => st.fi === fi);
      if (s) {
        const p = document.createElement('div');
        p.className = 'sticker';
        p.style.backgroundImage = `url("${s.img}")`;
        p.style.backgroundSize = `${a * 100}% ${a * 100}%`;
        p.style.backgroundPosition = `${s.col / lim * 100}% ${s.row / lim * 100}%`;
        f.appendChild(p);
      }
      c.el.appendChild(f);
      return f;
    });
    cubeEl.appendChild(c.el);
  });
  caps = [0, 1, 2, 3].map(() => {
    const d = document.createElement('div');
    d.className = 'cap';
    cubeEl.appendChild(d);
    return d;
  });
  layout();
}

function layout() {
  const r = stage.getBoundingClientRect();
  state.S = Math.max(8, Math.floor(Math.min(r.width, r.height) * 0.5 / state.a));
  const S = state.S, h = S / 2;
  cubeEl.style.setProperty('--s', `${S}px`);
  stage.style.perspective = `${S * state.a * 5}px`;
  for (const c of state.cubies) {
    c.faces.forEach((f, fi) => {
      const F = FACES[fi];
      f.style.transform = css(fromCols(F.u, F.v, F.n), scale(F.n, h));
    });
    place(c);
  }
  applyView();
}

function place(c, A) {
  let m = c.rot, t = scale(c.pos, state.S / 2);
  if (A) { m = mul3(A, m); t = mulv(A, t); }
  c.el.style.transform = css(m, t);
}

function applyView() { cubeEl.style.transform = css(state.view.map((x) => x * state.zoom), [0, 0, 0]); }

function resetView() {
  state.view = DEFAULT_VIEW();
  state.zoom = 1;
  applyView();
}

function zoomBy(f) {
  state.zoom = Math.min(2.5, Math.max(0.4, state.zoom * f));
  applyView();
}

function orbit(ax, ay) {
  state.view = orthonormalize(mul3(rot(0, -ay), mul3(rot(1, ax), state.view)));
  applyView();
}

/* Dark planes that hide the hollow inside while a layer is turning. */
function showCaps(m) {
  const a = state.a, S = state.S, k = m.axis;
  const [ui, vi] = [[1, 2], [2, 0], [0, 1]][k];
  const base = fromCols(axisVec(ui), axisVec(vi), axisVec(k));
  const size = a * S - 2;
  const list = [];
  let i = 0;
  for (const b of [m.coord - 1, m.coord + 1]) {
    if (Math.abs(b) >= a) continue; // outer surface, nothing to hide
    const t = scale(axisVec(k), b * S / 2);
    for (const moving of [false, true]) {
      const d = caps[i++];
      d.style.display = 'block';
      d.style.width = d.style.height = `${size}px`;
      d.style.left = d.style.top = `${-size / 2}px`;
      d.style.transform = css(base, t);
      list.push({ d, base, t, moving });
    }
  }
  return list;
}

/* ----- turning ----- */
function setLayerAngle(layer, capList, axis, ang) {
  const A = rot(axis, ang);
  for (const c of layer) place(c, A);
  for (const cp of capList) if (cp.moving) cp.d.style.transform = css(mul3(A, cp.base), mulv(A, cp.t));
}

function hideCaps(capList) { for (const cp of capList) cp.d.style.display = 'none'; }

/* Ease a layer from one angle to another, then call done(). */
function animateLayer(layer, capList, axis, from, to, dur, done) {
  const gen = state.gen, t0 = performance.now();
  const step = (now) => {
    if (gen !== state.gen) return; // cube was rebuilt mid-turn
    const p = dur > 0 ? Math.min(1, (now - t0) / dur) : 1;
    if (p < 1) {
      const e = 1 - (1 - p) * (1 - p);
      setLayerAngle(layer, capList, axis, from + (to - from) * e);
      requestAnimationFrame(step);
      return;
    }
    done();
  };
  requestAnimationFrame(step);
}

function enqueue(m) {
  state.queue.push(m);
  if (!state.animating && !state.dragging) runNext();
}

function runNext() {
  if (state.dragging) return;
  const m = state.queue.shift();
  if (!m) { state.animating = false; afterMoves(); return; }
  state.animating = true;
  const layer = layerOf(state.cubies, m);
  const capList = showCaps(m);
  const dur = reduceMotion ? 0 : (state.queue.length > 1 ? 70 : 170);
  animateLayer(layer, capList, m.axis, 0, m.sign * Math.PI / 2, dur, () => {
    applyMove(m, layer);
    for (const c of layer) place(c);
    hideCaps(capList);
    runNext();
  });
}

function recordMove(m) {
  if (state.scrambled && !state.timerOn) startTimer();
  state.moves++;
  state.history.push(m);
  updateMoves();
}

function userMove(m) {
  if (!ready()) return;
  recordMove(m);
  enqueue(m);
}

function undo() {
  const m = state.history.pop();
  if (!m) { setStatus('Nothing to undo.'); return; }
  state.moves++;
  updateMoves();
  enqueue({ axis: m.axis, coord: m.coord, sign: -m.sign });
}

function afterMoves() {
  if (state.scrambled && isSolved(state.cubies)) {
    state.scrambled = false;
    stopTimer();
    setResult('hand', state.moves, state.elapsed);
    setStatus(`Solved in ${state.moves} moves, ${fmt(state.elapsed)}. Press Save result to keep a record.`);
    stage.classList.add('solved');
    setTimeout(() => stage.classList.remove('solved'), 2400);
  }
}

function faceMove(letter, ccw) {
  const F = FACES[FACE_KEY[letter]];
  const k = F.n.findIndex((x) => x !== 0), s = F.n[k];
  const a = state.a, d = Math.min(state.depth, a);
  state.depth = 1;
  userMove({ axis: k, coord: s * (a - 1) - s * 2 * (d - 1), sign: ccw ? -s : s });
}

/* ----- live drag turns -----
 * When a drag on a sticker passes a few pixels, pick the in-face axis whose
 * on-screen direction best matches it. The layer turns about (normal x that
 * axis) and follows the mouse; on release it snaps to the nearest quarter. */
function beginTurn(drag, dx, dy) {
  const c = state.cubies[+drag.face.dataset.ci];
  const n = mulv(c.rot, FACES[+drag.face.dataset.fi].n);
  const nk = n.findIndex((x) => x !== 0);
  const dl = Math.hypot(dx, dy);
  let best = null;
  for (let j = 0; j < 3; j++) {
    if (j === nk) continue;
    const sx = state.view[j], sy = state.view[3 + j], len = Math.hypot(sx, sy);
    if (len < 0.15) continue; // this axis points almost straight at the screen
    const score = Math.abs(sx * dx + sy * dy) / (len * dl);
    if (!best || score > best.score) best = { j, score, dir: [sx / len, sy / len] };
  }
  if (!best) return false;
  const w = cross(n, axisVec(best.j));
  const k = w.findIndex((x) => x !== 0);
  const T = { axis: k, coord: c.pos[k], sigma: Math.sign(w[k]), dir: best.dir, ang: 0 };
  T.layer = layerOf(state.cubies, T);
  T.caps = showCaps(T);
  drag.turn = T;
  state.dragging = true;
  updateTurn(drag, dx, dy);
  return true;
}

function updateTurn(drag, dx, dy) {
  const T = drag.turn;
  const quarterPx = Math.max(60, state.S * state.a * state.zoom * 0.7);
  T.ang = T.sigma * (dx * T.dir[0] + dy * T.dir[1]) / quarterPx * Math.PI / 2;
  setLayerAngle(T.layer, T.caps, T.axis, T.ang);
}

function endTurn(drag) {
  const T = drag.turn;
  const frac = T.ang / (Math.PI / 2);
  // past a third of a quarter turn counts, so short flicks still turn
  let q = Math.trunc(frac) + (Math.abs(frac % 1) > 0.33 ? Math.sign(frac) : 0);
  q = Math.max(-2, Math.min(2, q));
  const to = q * Math.PI / 2;
  const dur = reduceMotion ? 0 : 60 + 140 * Math.abs(to - T.ang) / (Math.PI / 2);
  state.animating = true;
  animateLayer(T.layer, T.caps, T.axis, T.ang, to, dur, () => {
    const m = { axis: T.axis, coord: T.coord, sign: Math.sign(q) || 1 };
    for (let i = 0; i < Math.abs(q); i++) { applyMove(m, T.layer); recordMove(m); }
    for (const c of T.layer) place(c);
    hideCaps(T.caps);
    state.dragging = false;
    runNext(); // runs queued key turns, or finishes and checks for a solve
  });
}

/* ----- puzzle lifecycle ----- */
function rebuild() {
  state.gen++;
  state.queue = [];
  state.animating = false;
  state.dragging = false;
  state.cubies = buildModel(state.a, state.urls);
  buildDOM();
}

function setResult(method, moves, timeMs) {
  state.result = { method, moves, timeMs };
  $('save').hidden = false;
}

function clearResult() {
  state.result = null;
  $('save').hidden = true;
}

function saveResult() {
  const r = state.result, p = state.puzzle;
  if (!r || !p) return;
  const text = buildResult({ fp: p.fp, id: p.id, size: p.size, method: r.method, moves: r.moves,
    timeMs: r.timeMs, saved: new Date().toISOString().replace(/\.\d+Z$/, 'Z') });
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `picture-cube-result-${p.fp}.txt`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 500);
  setStatus(`Saved ${a.download}`);
}

function resetPuzzle(msg) {
  clearResult();
  state.history = [];
  state.moves = 0;
  state.depth = 1;
  updateMoves();
  resetTimer();
  if (msg) setStatus(msg);
}

function scramble() {
  if (!ready()) return;
  rebuild();
  do {
    for (const c of state.cubies) { c.pos = c.home.slice(); c.rot = I3.slice(); }
    for (const m of randomMoves(state.a, 7 * state.a + 4)) applyMove(m, layerOf(state.cubies, m));
  } while (isSolved(state.cubies));
  // remember this scramble so Reset can return to it (buildModel always lists cubies in the same order)
  state.start = state.cubies.map((c) => ({ pos: c.pos.slice(), rot: c.rot.slice() }));
  state.cubies.forEach((c) => place(c));
  state.scrambled = true;
  resetPuzzle('Scrambled. The timer starts on your first turn.');
}

function reset() {
  if (!ready() || !state.start) return;
  rebuild();
  state.cubies.forEach((c, i) => {
    c.pos = state.start[i].pos.slice();
    c.rot = state.start[i].rot.slice();
    place(c);
  });
  state.scrambled = true;
  resetPuzzle('Back to the starting scramble. The timer starts on your first turn.');
}

/* ----- images ----- */
/* Center-crop to a square (at most MAX_TEX px). Returns null if the browser
 * cannot decode the image. */
async function squareURL(blob) {
  let bmp;
  try { bmp = await createImageBitmap(blob); } catch (err) { return null; }
  const m = Math.min(bmp.width, bmp.height), size = Math.min(m, MAX_TEX);
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  cv.getContext('2d').drawImage(bmp, (bmp.width - m) / 2, (bmp.height - m) / 2, m, m, 0, 0, size, size);
  if (bmp.close) bmp.close();
  const out = await new Promise((res) => cv.toBlob(res, 'image/png'));
  return out ? URL.createObjectURL(out) : null;
}

async function loadPuzzleText(text, name) {
  const p = parsePuzzle(text);
  if (p.error) { setStatus(`${name}: ${p.error}`); return; }
  setStatus('Loading...');
  const url = await squareURL(new Blob([p.image], { type: sniffType(p.image) || 'application/octet-stream' }));
  if (!url) {
    setStatus(`${name}: this browser could not decode the picture inside (${sniffType(p.image) || 'unknown type'}, ${p.image.length} bytes)`);
    return;
  }
  new Set(state.urls).forEach((u) => URL.revokeObjectURL(u));
  p.name = name;
  p.image = null;               // the cropped copy is all the page needs now
  state.puzzle = p;
  state.urls = Array(6).fill(url);
  state.a = p.size;
  $('fileinfo').textContent = p.id ? `${name} (id ${p.id})` : name;
  $('sizeOut').textContent = `${p.size} x ${p.size}`;
  $('empty').hidden = true;
  ['scramble', 'undo', 'reset'].forEach((id) => { $(id).disabled = false; });
  showThumbs();
  scramble();
}

function showThumbs() {
  const box = $('thumbs'), p = state.puzzle;
  box.textContent = '';
  const fig = document.createElement('figure');
  const img = document.createElement('img');
  img.src = state.urls[0];
  img.alt = 'The finished picture';
  const cap = document.createElement('figcaption');
  cap.textContent = p.id || p.name;
  cap.title = cap.textContent;
  fig.append(img, cap);
  box.appendChild(fig);
}

/* ----- HUD ----- */
function updateMoves() { $('moves').textContent = state.moves; }
function updateTime() {
  $('time').textContent = fmt(state.timerOn ? performance.now() - state.startTime : state.elapsed);
}
function startTimer() {
  state.timerOn = true;
  state.startTime = performance.now();
  tick = setInterval(updateTime, 100);
}
function stopTimer() {
  if (state.timerOn) state.elapsed = performance.now() - state.startTime;
  state.timerOn = false;
  clearInterval(tick);
  updateTime();
}
function resetTimer() {
  clearInterval(tick);
  state.timerOn = false;
  state.elapsed = 0;
  updateTime();
}

/* ----- wiring ----- */
function init() {
  stage = $('stage');
  cubeEl = $('cube');
  reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const picker = $('picker');
  ['scramble', 'undo', 'reset'].forEach((id) => { $(id).disabled = true; });

  $('pick').addEventListener('click', () => picker.click());
  picker.addEventListener('change', () => {
    const f = picker.files && picker.files[0];
    picker.value = '';
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => loadPuzzleText(String(rd.result), f.name);
    rd.onerror = () => setStatus(`Could not read ${f.name}`);
    rd.readAsText(f);
  });
  $('save').addEventListener('click', saveResult);
  $('scramble').addEventListener('click', scramble);
  $('undo').addEventListener('click', undo);
  $('reset').addEventListener('click', reset);

  let drag = null;
  stage.addEventListener('contextmenu', (e) => e.preventDefault());
  stage.addEventListener('pointerdown', (e) => {
    if (!ready() || drag || e.button > 2) return;
    stage.focus({ preventScroll: true });
    const face = e.target.closest('.face');
    const orbiting = !face || e.button !== 0 || e.shiftKey;
    drag = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, face, mode: orbiting ? 'orbit' : 'pending' };
    stage.setPointerCapture(e.pointerId);
    stage.classList.toggle('orbiting', orbiting);
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (drag.mode === 'orbit') {
      orbit((e.clientX - drag.lx) * 0.008, (e.clientY - drag.ly) * 0.008);
      drag.lx = e.clientX;
      drag.ly = e.clientY;
    } else if (drag.mode === 'pending') {
      if (Math.hypot(dx, dy) < 8) return;
      // a turn is still playing: ignore this drag rather than fight it
      if (state.animating || state.queue.length || !beginTurn(drag, dx, dy)) { drag.mode = 'none'; return; }
      drag.mode = 'turn';
      stage.classList.add('turning');
    } else if (drag.mode === 'turn') {
      updateTurn(drag, dx, dy);
    }
  });
  const endDrag = () => {
    if (drag && drag.mode === 'turn') endTurn(drag);
    drag = null;
    stage.classList.remove('orbiting', 'turning');
  };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);
  stage.addEventListener('wheel', (e) => {
    if (!ready()) return;
    e.preventDefault();
    zoomBy(Math.exp(-e.deltaY * 0.0015));
  }, { passive: false });
  stage.addEventListener('dblclick', (e) => {
    if (ready() && !e.target.closest('.face')) resetView();
  });

  document.addEventListener('keydown', (e) => {
    if (e.target.matches('select, input, textarea')) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const arrows = { ArrowLeft: [-0.2, 0], ArrowRight: [0.2, 0], ArrowUp: [0, -0.2], ArrowDown: [0, 0.2] };
    if (arrows[e.key]) { e.preventDefault(); if (ready()) orbit(...arrows[e.key]); return; }
    if (e.key === 'Home') { e.preventDefault(); if (ready()) resetView(); return; }
    if (e.key === '+' || e.key === '=') { if (ready()) zoomBy(1.15); return; }
    if (e.key === '-') { if (ready()) zoomBy(1 / 1.15); return; }
    if (!ready()) return;
    if (/^[1-9]$/.test(e.key)) {
      state.depth = +e.key;
      setStatus(`Next face turn uses layer ${e.key} from the outside.`);
      return;
    }
    const k = e.key.toUpperCase();
    if (k in FACE_KEY) { e.preventDefault(); faceMove(k, e.shiftKey); }
  });

  window.addEventListener('resize', () => { if (ready()) layout(); });
  setStatus('Open a puzzle file to begin.');
}

if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', init);
if (typeof module !== 'undefined') {
  module.exports = { buildModel, applyMove, layerOf, isSolved, randomMoves, quarter, FACES,
    DATA_KEY, fnv1a, encodePuzzle, parsePuzzle, fingerprint, buildResult, verifyResult };
}
