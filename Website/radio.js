/* Edit log:
   v1 (2026-11-14) first version: wave model, dials, scope, lock detection,
      auto-tune, optional sound, node-testable model (RadioModel)
   v2 (2026-11-14) Auto-tune button removed; Reset button now runs the auto-tune
   v3 (2026-11-14) Tolerance fixed to loose; normal/tight selector wiring commented out
   v4 (2026-11-14) Waves and cross-talk wiring commented out; fixed at 1 wave, no cross-talk
   v5 (2026-11-14) Target comes from a user-picked datafile.txt (file picker); New signal removed;
      parseDatafile, dialsFromValues, startFor added to the model
   v6 (2026-11-14) Turns display removed (still counted in st.moves); banner shows time only
   v7 (2026-11-14) Picture window: picture.png (or .jpg/.jpeg/.webp) beside index.html is pixelated
      and resolves as the match improves, fully sharp at lock
   v8 (2026-11-14) Difficulty E..A set in datafile.txt (E easiest, A hardest) controls lock tolerance
   v9 (2026-11-14) Themes: theme=cde|wizard in datafile.txt; theme text table, scope colors from CSS vars
   v10 (2026-11-14) Themes are files: theme=NAME loads theme.NAME.css (colors and --t-* wording);
      missing file or theme=default/cde uses the built-in default theme
   v11 (2026-11-14) One generic theme file: theme.css is always looked for at start; found = used,
      missing = built-in default. theme= in datafile.txt is no longer used (old lines are ignored)
   v13 (2026-11-14) 4th dial ANGLE (-60 to +60 degrees): the wave is drawn rotated about the scope
      center and the match compares the rotated curves; angle= in datafile.txt (default 0).
      Button to switch between theme.css and the built-in CDE look.
   v14 (2026-11-14) ANGLE is now a full 360 degree dial that spins forever like PHASE. Angle is
      clockwise degrees (matches turning the knob). Two tilts 180 apart can draw the same curve, so
      the match also tries the curve read backwards: overlapping curves count as a match.
   v15 (2026-11-14) Datafile can be encoded: a file starting with STUN1: holds the plain datafile text
      XOR-ed with DATA_KEY and written as base64, so players opening it see no numbers. Plain files
      still work. The header also carries a checksum, so a damaged copy is rejected instead of
      silently becoming a different puzzle. Make one with tools/encode_datafile.py (it reads DATA_KEY from this file).
      This only hides the answer from casual looking; the key is in this file.
   v16 (2026-11-14) The picture can be encoded too: picture.js (made by tools/encrypt.sh -p) holds the
      image bytes in the same STUN1 form. It is tried first; if it is missing or damaged the plain
      picture.png/.jpg/.jpeg/.webp beside index.html is used. Do not ship a plain picture file.
   v17 (2026-11-15) Result file: after a lock a Save result button writes a sealed text file (puzzle
      fingerprint, optional id= from the datafile, player name, time, dials, assist flag). Grade it with
      tools/verify.sh, which re-checks the dials against your datafile with the game's own distance().
      datafile.txt accepts an optional id= line. Tamper-evident only: SEAL_KEY is in this file.
   v18 (2026-11-15) Result file simplified: plain readable text (puzzle code, id, player, grade, method,
      time, saved), no seal or dial values. tools/verify.sh only checks the file is for your puzzle and
      was solved by hand. SHA-256/HMAC/SEAL_KEY removed. An honest-player check only.
   v19 (2026-11-15) Save result no longer asks for a name; the result file has no player line (the id=
      from the datafile says whose it is).
   v20 (2026-11-15) picture.js problems are no longer silent: the reason goes to the browser console, and
      to the message line when picture.js exists but cannot be used (damaged, other key, bad image).
*/
(function (root) {
  'use strict';

  var TAU = Math.PI * 2;
  var TOL = { loose: 0.10, normal: 0.06, tight: 0.03 };
  // Difficulty grades from the datafile, lowest to highest: the allowed RMS error to lock
  var GRADE_TOL = { E: 0.10, D: 0.08, C: 0.06, B: 0.045, A: 0.03 };
  var DEFAULT_GRADE = 'E';
  var DEFAULT_THEME = 'default';
  var CUSTOM_THEME = 'custom';   // value of body[data-theme] while theme.css is in use
  var COUPLE = 0.25;      // cross-talk strength between neighbouring dials
  var LOCK_MS = 800;      // time the match must hold before the signal locks
  var SWEEP = Math.PI * 1.5; // 270 degrees of travel for stop-to-stop dials
  var DPW = 4;            // dials per wave: FREQ, AMP, PHASE, ANGLE
  var SPAN = 5.48;        // length of the wave axis in amplitude units, used when comparing rotated waves

  /* ---------- model (no DOM) ---------- */
  // Dial layout: 4 dials per wave, in order FREQ, AMP, PHASE, ANGLE.
  // Dial values are 0..1. PHASE and ANGLE wrap around (spin forever), FREQ and AMP stop at 0 and 1.
  // ANGLE is clockwise degrees: 0 is flat, a quarter turn of the dial is a 90 degree tilt.

  function wrap01(v) { v = v % 1; return v < 0 ? v + 1 : v; }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function kindOf(i) { return i % DPW; }
  function wraps(kind) { return kind >= 2; }   // PHASE and ANGLE

  // What a dial "feeds" to its neighbour; PHASE goes through sin so it has no jump at the wrap.
  function drive(dials, j) {
    var v = dials[j];
    return wraps(kindOf(j)) ? 0.5 + 0.5 * Math.sin(TAU * v) : v;
  }

  function effective(dials, coupled) {
    var n = dials.length, out = new Array(n), i;
    for (i = 0; i < n; i++) {
      out[i] = dials[i] + (coupled ? COUPLE * (drive(dials, (i + 1) % n) - 0.5) : 0);
    }
    return out;
  }

  // Turns dial values into wave components [{f, a, p, th}]; th is the tilt in radians
  function params(dials, coupled) {
    var e = effective(dials, coupled), comps = [], k;
    for (k = 0; k < dials.length / DPW; k++) {
      comps.push({
        f: Math.max(0.2, 1 + 4 * e[DPW * k]),          // cycles across the screen
        a: Math.max(0.02, 0.25 + 0.75 * e[DPW * k + 1]),
        p: wrap01(e[DPW * k + 2]) * TAU,
        th: -wrap01(e[DPW * k + 3]) * TAU     // tilt in radians, counter-clockwise; the dial is clockwise
      });
    }
    return comps;
  }

  // One tilt for the whole signal (with a single wave this is just that wave's ANGLE)
  function angleOf(comps) {
    var sx = 0, sy = 0, i;
    for (i = 0; i < comps.length; i++) { sx += Math.cos(comps[i].th); sy += Math.sin(comps[i].th); }
    return Math.atan2(sy, sx);     // circular mean, because tilts wrap around
  }

  function waveAt(comps, x) {
    var s = 0, i;
    for (i = 0; i < comps.length; i++) {
      s += comps[i].a * Math.sin(TAU * comps[i].f * x + comps[i].p);
    }
    return s / comps.length;
  }

  // A point on the wave after tilting it about the middle of the screen
  function pointAt(comps, th, x) {
    var X = (x - 0.5) * SPAN, Y = waveAt(comps, x), c = Math.cos(th), s = Math.sin(th);
    return [X * c - Y * s, X * s + Y * c];
  }

  // RMS distance between two tilted waves, point by point along the wave (equal tilt gives the
  // same number as comparing the plain waves). A wave tilted 180 degrees more, with a matching
  // phase, draws the same curve walked from the other end, so B is also tried read backwards and
  // the better of the two counts. That way overlapping curves always match.
  function distance(A, B, samples) {
    samples = samples || 200;
    var ta = angleOf(A), tb = angleOf(B), s1 = 0, s2 = 0, i, x, p, q, r, dx, dy;
    for (i = 0; i < samples; i++) {
      x = i / (samples - 1);
      p = pointAt(A, ta, x); q = pointAt(B, tb, x); r = pointAt(B, tb, 1 - x);
      dx = p[0] - q[0]; dy = p[1] - q[1];
      s1 += dx * dx + dy * dy;
      dx = p[0] - r[0]; dy = p[1] - r[1];
      s2 += dx * dx + dy * dy;
    }
    return Math.sqrt(Math.min(s1, s2) / samples);
  }

  function strength(err) { return clamp(1 - err / 0.5, 0, 1); }

  function newPuzzle(K, coupled, rng) {
    rng = rng || Math.random;
    var n = K * DPW, target = [], start, tries = 0, i, tc;
    for (i = 0; i < n; i++) {
      target.push(wraps(kindOf(i)) ? rng() : 0.15 + 0.7 * rng());
    }
    tc = params(target, coupled);
    do {
      start = [];
      for (i = 0; i < n; i++) start.push(rng());
      tries++;
    } while (distance(params(start, coupled), tc) < TOL.loose * 3 && tries < 50);
    return { target: target, start: start };
  }

  /* ---------- datafile.txt ---------- */
  // Accepted formats (blank lines and # comments are ignored):
  //   freq=3.2        key=value lines in any order, ':' also works
  //   amp=0.7         freq 1..5 cycles, amp 0.25..1, phase 0..360 degrees
  //   phase=140
  //   angle=35        optional, clockwise tilt of the wave in degrees, -360 to 360 (default 0); 'direction=' also works
  //   difficulty=C    optional, E (easiest) D C B A (hardest), default E
  //   id=alice-01     optional label (letters, digits, . _ -, up to 32); goes into result files
  //   theme=anything  ignored (themes now come from theme.css, see loadThemeFile); old files still load
  // or bare values: three numbers in the order freq amp phase, plus an optional
  // letter, on one line or several (e.g. "3.2 0.7 140 C"); a 4th number is the angle ("3.2 0.7 140 35 C")
  var NUM = '(-?(?:\\d+\\.?\\d*|\\.\\d+))';
  var KEYED = new RegExp('^(freq|frequency|amp|amplitude|phase|angle|direction)\\s*[=:]\\s*' + NUM + '\\s*(?:\\u00b0|deg|degrees)?$', 'i');
  var DIFF = /^(?:difficulty|diff)\s*[=:]\s*([A-Ea-e])$/i;
  var IDKEY = /^id\s*[=:]\s*([A-Za-z0-9_.-]{1,32})$/i;
  var THEMEKEY = /^theme\s*[=:]\s*([A-Za-z][\w-]*)$/i;
  var BARE = new RegExp('^(?:' + NUM + '|[A-Ea-e])(?:[\\s,]+(?:' + NUM + '|[A-Ea-e]))*$');

  // ---- encoded datafiles -------------------------------------------------------------------
  // Format: "STUN1:" + 8 hex digits (FNV-1a checksum of the plain bytes), a newline, then base64 of (plain datafile text as UTF-8 bytes, each XOR-ed with the
  // matching DATA_KEY byte, key repeating). Whitespace inside the base64 is ignored.
  // Change DATA_KEY per puzzle set if you like; tools/encode_datafile.py reads it from here.
  var DATA_KEY = 'signal-tuner-key';
  var ENC_HEAD = 'STUN1:';

  function xorBytes(bytes) {
    var out = new Uint8Array(bytes.length), k = [], i;
    for (i = 0; i < DATA_KEY.length; i++) k.push(DATA_KEY.charCodeAt(i) & 255);
    for (i = 0; i < bytes.length; i++) out[i] = bytes[i] ^ k[i % k.length];
    return out;
  }
  function utf8Bytes(str) {
    var s = unescape(encodeURIComponent(str)), out = [], i;
    for (i = 0; i < s.length; i++) out.push(s.charCodeAt(i));
    return out;
  }
  function bytesUtf8(bytes) {
    var s = '', i;
    for (i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return decodeURIComponent(escape(s));       // throws if the bytes are not valid UTF-8
  }
  function fnv1a(bytes) {
    var h = 0x811c9dc5, i;
    for (i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 0x01000193) >>> 0;
    return ('00000000' + h.toString(16)).slice(-8);
  }
  function encodeDatafile(plain) {
    var raw = utf8Bytes(String(plain)), b = xorBytes(raw), s = '', i, b64;
    for (i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    b64 = (typeof btoa === 'function') ? btoa(s) : Buffer.from(s, 'binary').toString('base64');
    return ENC_HEAD + fnv1a(raw) + '\n' + (b64.match(/.{1,64}/g) || []).join('\n') + '\n';
  }
  // returns the decoded bytes (Uint8Array), or null when the text is not encoded, or throws when damaged
  function decodeBytes(text) {
    var t = String(text).replace(/^\uFEFF/, '').trim(), b64, bin, bytes, i, sum, raw;
    if (t.slice(0, ENC_HEAD.length) !== ENC_HEAD) return null;
    sum = t.slice(ENC_HEAD.length, ENC_HEAD.length + 8);
    if (!/^[0-9a-f]{8}$/.test(sum)) throw new Error('bad checksum field');
    b64 = t.slice(ENC_HEAD.length + 8).replace(/\s+/g, '');
    if (!b64 || !/^[A-Za-z0-9+\/]*={0,2}$/.test(b64)) throw new Error('bad base64');
    bin = (typeof atob === 'function') ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
    bytes = new Uint8Array(bin.length);
    for (i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    raw = xorBytes(bytes);
    if (fnv1a(raw) !== sum) throw new Error('checksum mismatch');
    return raw;
  }
  // returns the plain text, or null when the text is not encoded, or throws when it is damaged
  function decodeDatafile(text) {
    var raw = decodeBytes(text);
    return raw === null ? null : bytesUtf8(raw);
  }

  // ---- result files ------------------------------------------------------------------------
  // After a lock the game can save a short, readable text file. tools/verify.sh compares its puzzle
  // code with your datafile to answer "did they finish the puzzle I gave them?" (and whether they did
  // it by hand or with Reset). There is no seal: it is an honest-player check, anyone can edit the file.
  var RESULT_HEAD = 'SIGNAL TUNER RESULT';

  // short code for a puzzle: from the parsed values, so comments, spacing and 3.2 vs 3.20 do not matter
  function fingerprint(vals) {
    var canon = 'f=' + vals.freq + ';a=' + vals.amp + ';p=' + vals.phase + ';t=' + (vals.angle || 0) +
      ';d=' + (vals.diff || DEFAULT_GRADE) + ';i=' + (vals.id || '');
    return fnv1a(utf8Bytes(canon));
  }
  function oneLine(s, max) {
    s = String(s === undefined || s === null ? '' : s).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max);
    return s || '-';
  }
  function fmtMs(ms) {
    var s = Math.max(0, Number(ms) || 0) / 1000;
    return Math.floor(s / 60) + ':' + ('0' + (s % 60).toFixed(1)).slice(-4);
  }
  // f: { fp, id, grade, assist (bool), timeMs, saved }
  function buildResult(f) {
    return RESULT_HEAD + '\n' +
      'puzzle: ' + f.fp + '\n' +
      'id: ' + oneLine(f.id, 32) + '\n' +
      'grade: ' + f.grade + '\n' +
      'method: ' + (f.assist ? 'auto-tune' : 'hand') + '\n' +
      'time: ' + fmtMs(f.timeMs) + '\n' +
      'saved: ' + f.saved + '\n';
  }
  // text: a result file; vals: parseDatafile() of YOUR datafile for that puzzle (plain or encoded).
  // opts.allowAssist: also accept results where the player used Reset (auto-tune)
  function verifyResult(text, vals, opts) {
    var errors = [], fields = {}, m, lines, i, p, key;
    opts = opts || {};
    m = String(text).replace(/\r\n/g, '\n').replace(/^﻿/, '').replace(/\n+$/, '\n')
      .match(/^SIGNAL TUNER RESULT\n((?:[a-z]+: [^\n]*\n)+)$/);
    if (!m) return { ok: false, errors: ['not a Signal Tuner result file'], fields: {} };
    lines = m[1].split('\n');
    for (i = 0; i < lines.length - 1; i++) {
      p = lines[i].indexOf(': '); key = lines[i].slice(0, p);
      fields[key] = lines[i].slice(p + 2);
    }
    if (fields.puzzle !== fingerprint(vals)) errors.push('this result is for a different puzzle (or a different id)');
    if (fields.method === 'auto-tune') { if (!opts.allowAssist) errors.push('the player used Reset (auto-tune) instead of solving it'); }
    else if (fields.method !== 'hand') errors.push('method field is missing');
    return { ok: errors.length === 0, errors: errors, fields: fields };
  }

  function parseDatafile(text) {
    var plain;
    try { plain = decodeDatafile(text); } catch (e) { return { error: 'this datafile is damaged' }; }
    return parsePlain(plain === null ? text : plain);
  }

  function parsePlain(text) {
    var lines = String(text).replace(/^﻿/, '').split(/\r?\n/);
    var vals = {}, nums = [], keyed = 0, grade = null, theme = null, id = null, i, line, m, key, out, toks, t;
    for (i = 0; i < lines.length; i++) {
      line = lines[i].replace(/#.*$/, '').trim();
      if (!line) continue;
      m = line.match(KEYED);
      if (m) {
        key = m[1].toLowerCase();
        key = key === 'frequency' ? 'freq' : (key === 'amplitude' ? 'amp' : (key === 'direction' ? 'angle' : key));
        if (key in vals) return { error: 'value given twice: ' + key };
        vals[key] = parseFloat(m[2]); keyed++;
        continue;
      }
      m = line.match(IDKEY);
      if (m) {
        if (id !== null) return { error: 'id given twice' };
        id = m[1];
        continue;
      }
      m = line.match(THEMEKEY);
      if (m) {
        if (theme) return { error: 'theme given twice' };
        theme = m[1].toLowerCase();   // read and ignored
        continue;
      }
      m = line.match(DIFF);
      if (m) {
        if (grade) return { error: 'difficulty given twice' };
        grade = m[1].toUpperCase();
        continue;
      }
      if (!BARE.test(line)) return { error: 'cannot read line: ' + line };
      toks = line.split(/[\s,]+/);
      for (t = 0; t < toks.length; t++) {
        if (/^[A-Ea-e]$/.test(toks[t])) {
          if (grade) return { error: 'difficulty given twice' };
          grade = toks[t].toUpperCase();
        } else {
          nums.push(Number(toks[t]));
        }
      }
    }
    if (keyed && nums.length) return { error: 'mix of key=value lines and bare numbers' };
    if (keyed) {
      if (!('freq' in vals) || !('amp' in vals) || !('phase' in vals)) {
        return { error: 'need freq, amp and phase' };
      }
      out = vals;
    } else if (nums.length === 3 || nums.length === 4) {
      out = { freq: nums[0], amp: nums[1], phase: nums[2] };
      if (nums.length === 4) out.angle = nums[3];
    } else {
      return { error: 'need 3 or 4 values (freq amp phase [angle]), found ' + nums.length };
    }
    if (out.angle === undefined) out.angle = 0;
    if (!(out.freq >= 1 && out.freq <= 5)) return { error: 'freq must be 1 to 5' };
    if (!(out.amp >= 0.25 && out.amp <= 1)) return { error: 'amp must be 0.25 to 1' };
    if (!(out.phase >= 0 && out.phase <= 360)) return { error: 'phase must be 0 to 360' };
    if (!(out.angle >= -360 && out.angle <= 360)) return { error: 'angle must be -360 to 360' };
    out.diff = grade || DEFAULT_GRADE;
    out.id = id || '';
    return out;
  }

  // Real units to dial positions (valid while cross-talk is off)
  function dialsFromValues(v) {
    return [(v.freq - 1) / 4, (v.amp - 0.25) / 0.75, wrap01(v.phase / 360), wrap01((v.angle || 0) / 360)];
  }

  // Random starting dials that are not already near the target
  function startFor(target, coupled, rng) {
    rng = rng || Math.random;
    var tc = params(target, coupled), start, tries = 0, i;
    do {
      start = [];
      for (i = 0; i < target.length; i++) start.push(rng());
      tries++;
    } while (distance(params(start, coupled), tc) < TOL.loose * 3 && tries < 50);
    return start;
  }

  var M = {
    TAU: TAU, TOL: TOL, GRADE_TOL: GRADE_TOL, DEFAULT_GRADE: DEFAULT_GRADE,
    DEFAULT_THEME: DEFAULT_THEME, COUPLE: COUPLE, LOCK_MS: LOCK_MS, SWEEP: SWEEP,
    DPW: DPW, wraps: wraps, angleOf: angleOf, pointAt: pointAt,
    wrap01: wrap01, clamp: clamp, kindOf: kindOf, effective: effective,
    params: params, waveAt: waveAt, distance: distance, strength: strength,
    newPuzzle: newPuzzle, parseDatafile: parseDatafile, encodeDatafile: encodeDatafile, decodeDatafile: decodeDatafile, decodeBytes: decodeBytes,
    fingerprint: fingerprint, buildResult: buildResult, verifyResult: verifyResult, dialsFromValues: dialsFromValues,
    startFor: startFor
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = M;
  else root.RadioModel = M;

  if (typeof document === 'undefined') return;

  /* ---------- UI ---------- */
  var $ = function (id) { return document.getElementById(id); };
  var cv = $('scope'), cx = cv.getContext('2d');
  var banner = $('banner'), dialsEl = $('dials');
  var ledsEl = $('leds'), pctEl = $('pct'), lampEl = $('lamp');
  var timeEl = $('time'), stateEl = $('state'), gradeEl = $('grade'), btnTheme = $('btnTheme'), btnSave = $('btnSave'); // turnsEl = $('turns') disabled
  var WAVE_LETTERS = 'ABC';
  // Built-in default theme wording. A theme file can override any of it with --t-* variables.
  var DEFAULT_TEXT = {
    title: 'Signal Tuner', meter: 'SIGNAL', lamp: 'LOCK', yours: 'yours', station: 'station',
    names: ['FREQ', 'AMP', 'PHASE', 'ANGLE'], wave: 'WAVE ',
    none: 'NO STATION', locked: 'SIGNAL LOCKED', assist: 'AUTO-TUNED',
    states: { nofile: 'NO FILE', tuned: 'LOCKED', assisted: 'AUTO-TUNED', anim: 'AUTO-TUNING', locking: 'LOCKING', tuning: 'TUNING' }
  };
  var T = DEFAULT_TEXT;
  var themeLink = null, themeReq = 0;
  var scopeCol = {
    bg: '#06130c', grid: 'rgba(90,220,130,0.16)', gridMajor: 'rgba(90,220,130,0.40)',
    mine: '#6dff9a', target: '#e6b440', stat: 'rgba(170,255,190,0.45)'
  };
  var waveLabs = [];

  var st = {
    K: 1, coupled: false, grade: DEFAULT_GRADE, theme: DEFAULT_THEME, // lock tolerance comes from the datafile difficulty
    sound: false, hear: false,
    dials: [], target: [], startDials: [], tcomps: [],
    moves: 0, started: false, t0: 0, elapsed: 0,
    solved: false, assisted: false, lockMs: 0, anim: null, loaded: false,
    lastDial: -1, lastTouch: 0, err: 1,
    hasCustom: false, useCustom: true   // theme.css found / currently shown
  };
  var dialEls = [];
  var picWrap = $('picwrap'), picCv = $('pic'), picCx = picCv.getContext('2d');
  var pic = { img: null, p: 0, lastN: -1, small: document.createElement('canvas') };
  var PIC_NAMES = ['picture.png', 'picture.jpg', 'picture.jpeg', 'picture.webp'];
  var PIC_ENC = 'picture.js';
  var PIC_MIN_BLOCKS = 6;
  var leds = [];
  var litCount = -1;

  function fmtTime(ms) {
    var s = ms / 1000, m = Math.floor(s / 60);
    s = s - m * 60;
    return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1);
  }

  function fmtVal(kind, v) {
    var d;
    if (kind === 3) { d = Math.round(-v * 180 / Math.PI); return (((d % 360) + 360) % 360) + '°'; }
    return kind === 2 ? (Math.round(v / TAU * 360) % 360) + '°' : v.toFixed(2);
  }

  function pick(comps, i) {
    var c = comps[Math.floor(i / DPW)], k = i % DPW;
    return k === 0 ? c.f : (k === 1 ? c.a : (k === 2 ? c.p : c.th));
  }

  /* ----- dials ----- */
  function ticksSvg(kind) {
    var out = '<svg class="ticks" viewBox="-50 -50 100 100" aria-hidden="true">', i, a, r1, r2, n, x1, y1, x2, y2, major;
    n = wraps(kind) ? 12 : 11;
    for (i = 0; i < n; i++) {
      a = wraps(kind) ? i * 30 : -135 + i * 27;
      major = wraps(kind) ? i % 3 === 0 : (i === 0 || i === 5 || i === 10);
      r1 = major ? 36 : 40; r2 = 46;
      x1 = r1 * Math.sin(a * Math.PI / 180); y1 = -r1 * Math.cos(a * Math.PI / 180);
      x2 = r2 * Math.sin(a * Math.PI / 180); y2 = -r2 * Math.cos(a * Math.PI / 180);
      out += '<line x1="' + x1.toFixed(1) + '" y1="' + y1.toFixed(1) + '" x2="' + x2.toFixed(1) +
        '" y2="' + y2.toFixed(1) + '" stroke="currentColor" stroke-width="' + (major ? 2.4 : 1.4) + '"/>';
    }
    return out + '</svg>';
  }

  function buildDials() {
    dialsEl.innerHTML = '';
    dialEls = [];
    waveLabs = [];
    var k, j, row, lab, box, el, knob, name, out, i;
    for (k = 0; k < st.K; k++) {
      row = document.createElement('div'); row.className = 'wave';
      lab = document.createElement('div'); lab.className = 'wavelabel';
      lab.textContent = T.wave + WAVE_LETTERS[k];
      waveLabs.push({ el: lab, k: k });
      row.appendChild(lab);
      for (j = 0; j < DPW; j++) {
        i = k * DPW + j;
        box = document.createElement('div'); box.className = 'dialbox';
        el = document.createElement('div'); el.className = 'dial';
        el.tabIndex = 0; el.setAttribute('role', 'slider');
        el.setAttribute('aria-label', 'Wave ' + WAVE_LETTERS[k] + ' ' + T.names[j].toLowerCase());
        el.setAttribute('aria-valuemin', '0'); el.setAttribute('aria-valuemax', '100');
        el.innerHTML = ticksSvg(j);
        knob = document.createElement('div'); knob.className = 'knob';
        knob.innerHTML = '<div class="mark"></div>';
        el.appendChild(knob);
        name = document.createElement('div'); name.className = 'dlabel'; name.textContent = T.names[j];
        out = document.createElement('div'); out.className = 'readout';
        box.appendChild(el); box.appendChild(name); box.appendChild(out);
        row.appendChild(box);
        dialEls.push({ el: el, knob: knob, out: out, lab: name });
        attachDial(el, i);
      }
      dialsEl.appendChild(row);
    }
  }

  function refreshDials() {
    var mine = params(st.dials, st.coupled), i, kind, v, deg;
    for (i = 0; i < dialEls.length; i++) {
      kind = i % DPW; v = st.dials[i];
      deg = wraps(kind) ? v * 360 : -135 + v * 270;
      dialEls[i].knob.style.transform = 'rotate(' + deg + 'deg)';
      dialEls[i].el.setAttribute('aria-valuenow', String(Math.round(v * 100)));
      dialEls[i].out.textContent = st.loaded ?
        fmtVal(kind, pick(mine, i)) + ' / ' + fmtVal(kind, pick(st.tcomps, i)) : '';
    }
  }

  function inputLocked() { return !st.loaded || st.solved || !!st.anim; }

  function nudge(i, dv) {
    if (inputLocked() || !dv) return;
    var now = performance.now(), kind = i % DPW, old = st.dials[i];
    if (!st.started) { st.started = true; st.t0 = now; }
    st.dials[i] = wraps(kind) ? wrap01(old + dv) : clamp(old + dv, 0, 1);
    if (st.dials[i] === old) return;
    if (i !== st.lastDial || now - st.lastTouch > 500) st.moves++;
    st.lastDial = i; st.lastTouch = now;
    refreshDials();
  }

  function attachDial(el, i) {
    var last = null;
    var kind = i % DPW;
    var span = wraps(kind) ? TAU : SWEEP;
    function ang(e) {
      var r = el.getBoundingClientRect();
      return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2));
    }
    el.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      el.setPointerCapture(e.pointerId);
      last = ang(e);
      el.focus();
      e.preventDefault();
    });
    el.addEventListener('pointermove', function (e) {
      if (last === null) return;
      var a = ang(e), d = a - last;
      if (d > Math.PI) d -= TAU;
      if (d < -Math.PI) d += TAU;
      last = a;
      nudge(i, d / span * (e.shiftKey ? 0.1 : 1));
    });
    function end() { last = null; }
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('wheel', function (e) {
      e.preventDefault();
      var dy = e.deltaY || e.deltaX;
      nudge(i, (dy < 0 ? 1 : -1) * (e.shiftKey ? 0.001 : 0.005));
    }, { passive: false });
    el.addEventListener('keydown', function (e) {
      var step = e.shiftKey ? 0.001 : 0.005, dv = 0;
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') dv = step;
      else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') dv = -step;
      else if (e.key === 'PageUp') dv = 0.05;
      else if (e.key === 'PageDown') dv = -0.05;
      else return;
      e.preventDefault();
      nudge(i, dv);
    });
  }

  /* ----- game flow ----- */
  function resetState() {
    st.dials = st.startDials.slice();
    st.tcomps = params(st.target, st.coupled);
    st.moves = 0; st.started = false; st.elapsed = 0;
    st.solved = false; st.assisted = false; st.lockMs = 0; st.anim = null;
    st.lastDial = -1; st.lastTouch = 0;
    banner.hidden = true; btnSave.hidden = true; st.result = null;
    pic.p = 0; pic.lastN = -1;
    refreshDials();
    syncAudio();
  }

  // The target comes from the picked datafile; dial start positions are random each load
  function loadTarget(vals) {
    st.target = dialsFromValues(vals);
    st.startDials = startFor(st.target, st.coupled);
    st.grade = vals.diff || DEFAULT_GRADE;
    st.fp = fingerprint(vals); st.pid = vals.id || '';
    st.loaded = true;
    resetState();
  }

  function showPrompt() {
    banner.innerHTML = '<strong>' + T.none + '</strong><br>Load datafile.txt to begin';
    banner.hidden = false;
  }

  function finish(assisted) {
    st.solved = true; st.assisted = assisted; st.anim = null;
    if (!assisted) st.elapsed = performance.now() - st.t0;
    banner.innerHTML = '<strong>' + (assisted ? T.assist : T.locked) + '</strong><br>' +
      (assisted ? 'Solved by auto-tune, not your solve' :
        'Time ' + fmtTime(st.elapsed));
    banner.hidden = false;
    st.result = { assisted: assisted, timeMs: st.elapsed };
    btnSave.hidden = false;
    audioStop();
    ping(assisted);
  }

  function autoTune() {
    if (inputLocked()) return;
    if (st.started) st.elapsed = performance.now() - st.t0;
    st.assisted = true;
    st.anim = { t0: performance.now(), from: st.dials.slice(), to: st.target.slice() };
  }

  /* ----- audio (optional) ----- */
  var audio = { ctx: null, master: null, mine: [], tgt: [], on: false };

  function audioStop() {
    ['mine', 'tgt'].forEach(function (key) {
      audio[key].forEach(function (v) {
        try { v.osc.stop(); } catch (e) { /* already stopped */ }
        v.osc.disconnect(); v.g.disconnect();
      });
      audio[key] = [];
    });
    audio.on = false;
  }

  function audioCtx() {
    if (!audio.ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      audio.ctx = new AC();
      audio.master = audio.ctx.createGain();
      audio.master.gain.value = 0.12;
      audio.master.connect(audio.ctx.destination);
    }
    if (audio.ctx.state === 'suspended') audio.ctx.resume();
    return audio.ctx;
  }

  function voice() {
    var o = audio.ctx.createOscillator(), g = audio.ctx.createGain();
    o.type = 'sine'; g.gain.value = 0;
    o.connect(g); g.connect(audio.master); o.start();
    return { osc: o, g: g };
  }

  function syncAudio() {
    audioStop();
    if (!st.sound || st.solved || !st.loaded) return;
    if (!audioCtx()) return;
    var k;
    for (k = 0; k < st.K; k++) {
      audio.mine.push(voice());
      if (st.hear) audio.tgt.push(voice());
    }
    audio.on = true;
    updateAudio();
  }

  function updateAudio() {
    var t = audio.ctx.currentTime, mine = params(st.dials, st.coupled), k;
    for (k = 0; k < audio.mine.length; k++) {
      audio.mine[k].osc.frequency.setTargetAtTime(110 * mine[k].f, t, 0.03);
      audio.mine[k].g.gain.setTargetAtTime(mine[k].a / st.K * 0.5, t, 0.03);
    }
    for (k = 0; k < audio.tgt.length; k++) {
      audio.tgt[k].osc.frequency.setTargetAtTime(110 * st.tcomps[k].f, t, 0.03);
      audio.tgt[k].g.gain.setTargetAtTime(st.tcomps[k].a / st.K * 0.35, t, 0.03);
    }
  }

  function ping(assisted) {
    if (!st.sound || !audio.ctx) return;
    var t = audio.ctx.currentTime;
    [880, 1320].forEach(function (f, n) {
      var o = audio.ctx.createOscillator(), g = audio.ctx.createGain();
      o.type = 'sine'; o.frequency.value = assisted ? f / 2 : f;
      g.gain.setValueAtTime(0.0001, t + n * 0.12);
      g.gain.exponentialRampToValueAtTime(0.5, t + n * 0.12 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + n * 0.12 + 0.4);
      o.connect(g); g.connect(audio.master);
      o.start(t + n * 0.12); o.stop(t + n * 0.12 + 0.45);
    });
  }

  /* ----- drawing ----- */
  function fit() {
    var dpr = window.devicePixelRatio || 1;
    cv.width = Math.max(1, Math.round(cv.clientWidth * dpr));
    cv.height = Math.max(1, Math.round(cv.clientHeight * dpr));
    picCv.width = Math.max(1, Math.round(picCv.clientWidth * dpr));
    picCv.height = Math.max(1, Math.round(picCv.clientHeight * dpr));
    pic.lastN = -1;
  }

  // Draws the wave tilted about the middle of the scope; parts that leave the scope are clipped
  function trace(comps) {
    var w = cv.width, h = cv.height, n = 320, th = angleOf(comps), c = Math.cos(th), s = Math.sin(th);
    var u = h * 0.42, i, X, Y, px, py;
    cx.beginPath();
    for (i = 0; i <= n; i++) {
      X = (i / n - 0.5) * w; Y = waveAt(comps, i / n) * u;
      px = w / 2 + X * c - Y * s;
      py = h / 2 - (X * s + Y * c);
      if (i === 0) cx.moveTo(px, py); else cx.lineTo(px, py);
    }
    cx.stroke();
  }

  function draw(strengthNow) {
    var dpr = window.devicePixelRatio || 1, w = cv.width, h = cv.height, i, n, x, y;
    cx.clearRect(0, 0, w, h);
    cx.fillStyle = scopeCol.bg; cx.fillRect(0, 0, w, h);
    cx.lineWidth = dpr;
    for (i = 0; i <= 10; i++) {
      cx.strokeStyle = i === 5 ? scopeCol.gridMajor : scopeCol.grid;
      cx.beginPath(); cx.moveTo(i * w / 10, 0); cx.lineTo(i * w / 10, h); cx.stroke();
    }
    for (i = 0; i <= 8; i++) {
      cx.strokeStyle = i === 4 ? scopeCol.gridMajor : scopeCol.grid;
      cx.beginPath(); cx.moveTo(0, i * h / 8); cx.lineTo(w, i * h / 8); cx.stroke();
    }
    // station (target): dashed amber
    if (st.loaded) {
      cx.save();
      cx.setLineDash([7 * dpr, 6 * dpr]);
      cx.strokeStyle = scopeCol.target; cx.lineWidth = 2 * dpr;
      trace(st.tcomps);
      cx.restore();
    }
    // your signal: solid green with glow
    cx.save();
    cx.strokeStyle = scopeCol.mine; cx.lineWidth = 2.6 * dpr;
    cx.shadowColor = scopeCol.mine; cx.shadowBlur = 8 * dpr;
    trace(params(st.dials, st.coupled));
    cx.restore();
    // static: more of it the weaker the signal
    n = Math.floor((1 - strengthNow) * 140);
    cx.fillStyle = scopeCol.stat;
    for (i = 0; i < n; i++) {
      x = Math.random() * w; y = Math.random() * h;
      cx.fillRect(x, y, 1.5 * dpr, 1.5 * dpr);
    }
  }

  /* ----- themes ----- */
  function readScopeColors() {
    var cs = getComputedStyle(document.body);
    function v(name, fallback) { var s = cs.getPropertyValue(name).trim(); return s || fallback; }
    scopeCol.bg = v('--scope-bg', scopeCol.bg);
    scopeCol.grid = v('--scope-grid', scopeCol.grid);
    scopeCol.gridMajor = v('--scope-grid-major', scopeCol.gridMajor);
    scopeCol.mine = v('--trace-mine', scopeCol.mine);
    scopeCol.target = v('--trace-target', scopeCol.target);
    scopeCol.stat = v('--static', scopeCol.stat);
  }

  function cssStr(cs, name, fallback) {
    var s = cs.getPropertyValue(name).trim(), m;
    if (!s) return fallback;
    m = s.match(/^(["'])([\s\S]*)\1$/);
    return m ? m[2].replace(/\\(["'\\])/g, '$1') : s;
  }

  function textFromCss() {
    var cs = getComputedStyle(document.body), D = DEFAULT_TEXT;
    var names = cssStr(cs, '--t-names', D.names.join(',')).split(',').map(function (x) { return x.trim(); });
    if (names.length === 3) names = names.concat(D.names[3]);   // older themes list only 3 dial names
    if (names.length !== DPW || names.indexOf('') >= 0) names = D.names;
    return {
      title: cssStr(cs, '--t-title', D.title), meter: cssStr(cs, '--t-meter', D.meter),
      lamp: cssStr(cs, '--t-lamp', D.lamp), yours: cssStr(cs, '--t-yours', D.yours),
      station: cssStr(cs, '--t-station', D.station), names: names, wave: cssStr(cs, '--t-wave', D.wave),
      none: cssStr(cs, '--t-none', D.none), locked: cssStr(cs, '--t-locked', D.locked),
      assist: cssStr(cs, '--t-assist', D.assist),
      states: {
        nofile: cssStr(cs, '--t-st-nofile', D.states.nofile), tuned: cssStr(cs, '--t-st-tuned', D.states.tuned),
        assisted: cssStr(cs, '--t-st-assisted', D.states.assisted), anim: cssStr(cs, '--t-st-anim', D.states.anim),
        locking: cssStr(cs, '--t-st-locking', D.states.locking), tuning: cssStr(cs, '--t-st-tuning', D.states.tuning)
      }
    };
  }

  // Puts the current theme's wording and colors on the page
  function showTheme(name) {
    st.theme = name;
    if (name === DEFAULT_THEME) document.body.removeAttribute('data-theme');
    else document.body.setAttribute('data-theme', name);   // theme.css rules start with body[data-theme]
    T = name === DEFAULT_THEME ? DEFAULT_TEXT : textFromCss();
    document.title = T.title;
    $('ttl').textContent = T.title;
    $('mlabel').textContent = T.meter;
    $('lampText').textContent = T.lamp;
    $('lgMine').textContent = T.yours;
    $('lgTarget').textContent = T.station;
    dialEls.forEach(function (d, i) {
      d.lab.textContent = T.names[i % DPW];
      d.el.setAttribute('aria-label', 'Wave ' + WAVE_LETTERS[Math.floor(i / DPW)] + ' ' + T.names[i % DPW].toLowerCase());
    });
    waveLabs.forEach(function (w) { w.el.textContent = T.wave + WAVE_LETTERS[w.k]; });
    readScopeColors();
    if (!st.loaded) showPrompt();
  }

  // The button only shows when a theme.css was found; it switches between that and the CDE look
  function syncThemeButton() {
    btnTheme.hidden = !st.hasCustom;
    btnTheme.textContent = st.useCustom ? 'Use CDE theme' : 'Use custom theme';
  }

  // Always looks for theme.css next to index.html. Found = its colors and --t-* wording are used,
  // missing = the built-in default theme stays.
  function loadThemeFile() {
    var req = ++themeReq, link;
    if (themeLink) { themeLink.parentNode.removeChild(themeLink); themeLink = null; }
    link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'theme.css';
    link.onload = function () {
      if (req !== themeReq) return;
      st.hasCustom = true;
      showTheme(st.useCustom ? CUSTOM_THEME : DEFAULT_THEME);
      syncThemeButton();
    };
    link.onerror = function () {
      if (req !== themeReq) return;
      if (link.parentNode) link.parentNode.removeChild(link);
      themeLink = null;
      st.hasCustom = false;
      showTheme(DEFAULT_THEME);
      syncThemeButton();
    };
    themeLink = link;
    document.head.appendChild(link);
  }

  /* ----- picture window ----- */
  function tryImage(src, revoke, fail) {
    var im = new Image();
    im.onload = function () {
      if (revoke) URL.revokeObjectURL(src);
      pic.img = im; pic.lastN = -1;
      picWrap.classList.add('hasimg');
      fit();
    };
    im.onerror = function () { if (revoke) URL.revokeObjectURL(src); fail(); };
    im.src = src;
  }
  function loadPicture(k) {
    if (k >= PIC_NAMES.length) return;      // none found, the grille stays
    tryImage(PIC_NAMES[k], false, function () { loadPicture(k + 1); });
  }
  function sniffType(b) {
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'image/png';
    if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'image/jpeg';
    if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45) return 'image/webp';
    if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
    return 'application/octet-stream';
  }
  // picture.js sets window.STUN_PIC to an encoded string (a script tag is the way to read a data
  // file when the page is opened from file://). Any problem falls back to the plain picture files.
  function picNote(text, onScreen) {
    try { console.warn('Signal Tuner picture: ' + text); } catch (e) { /* no console */ }
    if (onScreen && $('msg')) $('msg').textContent = 'Picture: ' + text;
  }
  function loadPictureEncoded() {
    var s = document.createElement('script');
    function done() { if (s.parentNode) s.parentNode.removeChild(s); }
    s.onload = function () {
      var enc = window.STUN_PIC, raw = null, why = '';
      window.STUN_PIC = undefined;
      done();
      if (typeof enc !== 'string') why = 'picture.js loaded but did not set window.STUN_PIC';
      else {
        try { raw = decodeBytes(enc); if (!raw || !raw.length) why = 'picture.js has no image data'; }
        catch (e) { why = 'picture.js is damaged or was made with a different DATA_KEY (' + e.message + ')'; }
      }
      if (why) { picNote(why + '; trying the plain picture file', true); loadPicture(0); return; }
      tryImage(URL.createObjectURL(new Blob([raw], { type: sniffType(raw) })), true, function () {
        picNote('this browser could not decode the image inside picture.js (' + sniffType(raw) + ', ' + raw.length +
          ' bytes); trying the plain picture file', true);
        loadPicture(0);
      });
    };
    s.onerror = function () {                 // no picture.js beside index.html: normal when a plain picture is used
      done();
      try { console.info('Signal Tuner picture: no picture.js found, trying picture.png/.jpg/.jpeg/.webp'); } catch (e) { /* no console */ }
      loadPicture(0);
    };
    s.src = PIC_ENC;
    document.head.appendChild(s);
  }

  // p: 0 = coarse blocks, 1 = sharp
  function drawPicture(p) {
    if (!pic.img) return;
    var W = picCv.width, H = picCv.height;
    if (!W || !H) return;
    var d = Math.min(W, H), ox = (W - d) / 2, oy = (H - d) / 2;
    var n = p >= 0.995 ? 0 : Math.max(PIC_MIN_BLOCKS, Math.round(PIC_MIN_BLOCKS * Math.pow(d / PIC_MIN_BLOCKS, p)));
    if (n === pic.lastN) return;
    pic.lastN = n;
    var iw = pic.img.naturalWidth, ih = pic.img.naturalHeight, s = Math.min(iw, ih);
    var sx = (iw - s) / 2, sy = (ih - s) / 2, sm, sc;
    picCx.clearRect(0, 0, W, H);
    if (n === 0 || n >= d) {
      picCx.imageSmoothingEnabled = true;
      picCx.imageSmoothingQuality = 'high';
      picCx.drawImage(pic.img, sx, sy, s, s, ox, oy, d, d);
      return;
    }
    sm = pic.small; sm.width = n; sm.height = n;
    sc = sm.getContext('2d');
    sc.imageSmoothingEnabled = true;
    sc.imageSmoothingQuality = 'high';
    sc.drawImage(pic.img, sx, sy, s, s, 0, 0, n, n);
    picCx.imageSmoothingEnabled = false;
    picCx.drawImage(sm, 0, 0, n, n, ox, oy, d, d);
  }

  /* ----- main loop ----- */
  var prev = 0;
  function frame(now) {
    var dt = Math.min(100, now - (prev || now)), tol = GRADE_TOL[st.grade], a, k, e, i, delta, mineComps, s, lit, raw;
    prev = now;

    if (st.anim) {
      a = st.anim;
      k = Math.min(1, (now - a.t0) / 1500);
      e = k * k * (3 - 2 * k);
      for (i = 0; i < st.dials.length; i++) {
        if (wraps(i % DPW)) {
          delta = (((a.to[i] - a.from[i] + 0.5) % 1) + 1) % 1 - 0.5;
          st.dials[i] = wrap01(a.from[i] + delta * e);
        } else {
          st.dials[i] = a.from[i] + (a.to[i] - a.from[i]) * e;
        }
      }
      refreshDials();
      if (k >= 1) { st.dials = st.target.slice(); refreshDials(); finish(true); }
    }

    mineComps = params(st.dials, st.coupled);
    st.err = st.loaded ? distance(mineComps, st.tcomps) : 1;
    s = strength(st.err);

    if (!st.solved && !st.anim) {
      if (st.err < tol) st.lockMs += dt; else st.lockMs = 0;
      if (st.lockMs >= LOCK_MS) finish(false);
    }
    if (st.started && !st.solved && !st.anim) st.elapsed = now - st.t0;

    lit = Math.round(s * 10);
    if (lit !== litCount) {
      for (i = 0; i < leds.length; i++) leds[i].classList.toggle('lit', i < lit);
      litCount = lit;
    }
    pctEl.textContent = Math.round(s * 100) + '%';
    lampEl.classList.toggle('on', st.err < tol || st.solved);
    timeEl.textContent = fmtTime(st.elapsed);
    gradeEl.textContent = st.loaded ? st.grade : '-';
    // turnsEl.textContent = String(st.moves);
    stateEl.textContent = !st.loaded ? T.states.nofile : st.solved ? (st.assisted ? T.states.assisted : T.states.tuned) :
      (st.anim ? T.states.anim : (st.lockMs > 0 ? T.states.locking : T.states.tuning));

    // picture: err at 0.5 or worse = coarsest, err at the lock tolerance = sharp; eased over time
    raw = st.solved ? 1 : (st.loaded ? clamp((0.5 - st.err) / (0.5 - tol), 0, 1) : 0);
    raw = Math.pow(raw, 1.6);
    pic.p += (raw - pic.p) * (1 - Math.exp(-dt / 350));
    drawPicture(pic.p);

    if (audio.on) updateAudio();
    draw(st.solved ? 1 : s);
    requestAnimationFrame(frame);
  }

  /* ----- wiring ----- */
  (function initLeds() {
    var i, s;
    for (i = 0; i < 10; i++) {
      s = document.createElement('span');
      ledsEl.appendChild(s); leds.push(s);
    }
  })();

  var fileIn = $('fileIn'), msgEl = $('msg');
  $('btnLoad').addEventListener('click', function () { fileIn.click(); });
  fileIn.addEventListener('change', function () {
    var f = fileIn.files && fileIn.files[0];
    if (!f) return;
    var rd = new FileReader();
    rd.onload = function () {
      var r = parseDatafile(String(rd.result));
      if (r.error) { msgEl.textContent = f.name + ': ' + r.error; }
      else { msgEl.textContent = 'Loaded ' + f.name + ' (difficulty ' + r.diff + ')'; loadTarget(r); }
      fileIn.value = '';
    };
    rd.onerror = function () { msgEl.textContent = 'Could not read ' + f.name; fileIn.value = ''; };
    rd.readAsText(f);
  });
  $('btnReset').addEventListener('click', autoTune);
  // Save result: downloads the result file (works from file://)
  btnSave.addEventListener('click', function () {
    var r = st.result, text, a, url;
    if (!st.solved || !r) return;
    text = buildResult({ fp: st.fp, id: st.pid, grade: st.grade, assist: r.assisted,
      timeMs: r.timeMs, saved: new Date().toISOString().replace(/\.\d+Z$/, 'Z') });
    url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    a = document.createElement('a');
    a.href = url; a.download = 'signal-tuner-result-' + st.fp.slice(0, 8) + '.txt';
    document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 500);
    msgEl.textContent = 'Saved ' + a.download;
  });
  btnTheme.addEventListener('click', function () {
    st.useCustom = !st.useCustom;
    showTheme(st.useCustom ? CUSTOM_THEME : DEFAULT_THEME);
    syncThemeButton();
  });
  // Waves selector disabled, K stays 1:
  // $('selWaves').addEventListener('change', function (e) { st.K = +e.target.value; startPuzzle(); });
  // Tolerance selector removed: difficulty now comes from datafile.txt
  // Cross-talk disabled, coupled stays false:
  // $('chkCouple').addEventListener('change', function (e) { st.coupled = e.target.checked; startPuzzle(); });
  $('chkEasy').addEventListener('change', function (e) { document.body.classList.toggle('easy', e.target.checked); });
  $('chkSound').addEventListener('change', function (e) { st.sound = e.target.checked; syncAudio(); });
  $('chkHear').addEventListener('change', function (e) { st.hear = e.target.checked; syncAudio(); });
  window.addEventListener('resize', fit);

  fit();
  loadPictureEncoded();
  buildDials();
  st.dials = [0.5, 0.5, 0.5, 0.5];
  refreshDials();
  showTheme(DEFAULT_THEME);
  loadThemeFile();
  requestAnimationFrame(frame);
})(typeof window !== 'undefined' ? window : globalThis);
