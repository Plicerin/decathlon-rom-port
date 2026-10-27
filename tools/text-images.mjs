// Dev: cuts letters out of the words the cartridge draws in its text row
// (lines 207-214, the row that shows "LONG JUMP" and then the result), for
// Decathlon Enhanced's in-game message. The game has no letter font: each
// word is a ready-drawn 48x8 picture in ROM ($DFxx), with proportional
// letters one pixel apart. This plays screens that show known words, splits
// each word at its blank columns and prints the letters as 8-row strings for
// src/enhanced.mjs.
// usage: node tools/text-images.mjs [LETTERS]   (default: the letters of PRESS FIRE but F, which none of its words has)
import { VCS, loadRom } from './atari/vcs.mjs';

const want = new Set((process.argv[2] ?? 'PRESI').split(''));
const frames = (v, n, swchb = 0x0b, swcha = 0xff) => { for (let i = 0; i < n; i += 1) { v.swchb = swchb; v.swcha = swcha; v.runFrames(1); } };
const select = (n) => (v) => { frames(v, 60); for (let k = 0; k < n; k += 1) { frames(v, 8, 0x09); frames(v, 30); } };
const scratch = (v) => { select(6)(v); frames(v, 8, 0x0a); frames(v, 30); for (let t = 0; t < 420; t += 1) frames(v, 1, 0x0b, (t >> 2) & 1 ? 0x7f : 0xbf); };
// [word shown, how to reach the screen]
const SCREENS = [['DECATHLON', select(1)], ['LONG JUMP', select(6)], ['SHOT PUT', select(7)], ['DISCUS', select(11)], ['SCRATCH', scratch]];

const letters = {};
for (const [word, reach] of SCREENS) {
  const v = new VCS(loadRom());
  reach(v);
  // the letters' colour ($0C); the row's left edge is the black HMOVE bar, not letters
  const fr = v.tia.lastFrame, ink = 0x0c;
  const rows = [];
  for (let y = 207; y <= 214; y += 1) rows.push([...fr[y].slice(0, 160)].map((c) => c === ink));
  // runs of non-blank columns are letters, in the word's order (spaces are wider gaps)
  const used = (x) => rows.some((r) => r[x]);
  const runs = [];
  for (let x = 0; x < 160;) {
    if (!used(x)) { x += 1; continue; }
    let e = x;
    while (e < 160 && used(e)) e += 1;
    runs.push([x, e]);
    x = e;
  }
  const chars = word.replace(/ /g, '').split('');
  if (runs.length !== chars.length) throw new Error(`${word}: ${runs.length} letters cut, ${chars.length} expected`);
  chars.forEach((ch, i) => {
    if (!want.has(ch) || letters[ch]) return;
    const [x0, x1] = runs[i];
    letters[ch] = { from: word, rows: rows.map((r) => r.slice(x0, x1).map((on) => (on ? '#' : '.')).join('')) };
  });
}
for (const ch of want) if (!letters[ch]) console.log(`// ${ch}: not found`);
for (const [ch, { from, rows }] of Object.entries(letters)) console.log(`  ${ch}: [${rows.map((r) => `'${r}'`).join(', ')}], // from ${from}`);
