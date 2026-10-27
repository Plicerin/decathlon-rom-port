// Dev: play whole decathlons and add every executed instruction (and ROM byte
// read as data) to tools/out/coverage.json. Game Select is pressed `selects`
// times first (the game number: players and events), then Game Reset; the
// athlete runs by waggling the joystick left/right every `period` frames and
// the button is pressed at random (4% of frames start a press of 1-40 frames).
// usage: node tools/cov-play.mjs frames period seed selects [every]
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { VCS, loadRom } from './atari/vcs.mjs';
import { writeFramePng } from './atari/png.mjs';

const [frames, period, seed0, selects] = process.argv.slice(2, 6).map(Number);
const every = Number(process.argv[6] ?? 0);
let seed = seed0;
const rnd = (n) => { seed = (seed * 1103515245 + 12345) >>> 0; return (seed >>> 8) % n; };
const path = 'tools/out/coverage.json';
const old = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { code: [[], []], data: [[], []] };
const starts = [new Set(old.code[0]), new Set(old.code[1])];
const reads = [new Set(old.data[0]), new Set(old.data[1])];
const before = starts[0].size + starts[1].size;
const vcs = new VCS(loadRom());
let insPc = 0;
vcs.onRead = (a) => { if ((a & 0x1000) && ((a - insPc) & 0x1fff) > 2) reads[vcs.bank].add(a & 0xfff); };
mkdirSync('tools/out', { recursive: true });
const startAt = 60 + selects * 30;
let fire = 0;
for (let f = 1; f <= frames; f += 1) {
  let b = 0x0b;
  if (f >= 60 && f < startAt && (f - 60) % 30 < 8) b &= ~0x02;  // Game Select
  if (f >= startAt && f < startAt + 8) b &= ~0x01;               // Game Reset
  vcs.swchb = b;
  vcs.swcha = f > startAt + 30 ? (Math.floor(f / period) & 1 ? 0x7f : 0xbf) : 0xff;
  if (fire > 0) fire -= 1; else if (rnd(25) === 0) fire = 1 + rnd(40);
  vcs.inpt4 = fire ? 0 : 0x80;
  const target = vcs.frame + 1;
  while (vcs.frame < target) { starts[vcs.bank].add(vcs.cpu.pc & 0xfff); insPc = vcs.cpu.pc & 0x1fff; vcs.cpu.step(); }
  if (every && f % every === 0) writeFramePng(`tools/out/p${f}.png`, vcs.tia.lastFrame.slice(0, 262), 2, 1);
}
writeFileSync(path, JSON.stringify({ code: starts.map((s) => [...s].sort((a, b) => a - b)), data: reads.map((s) => [...s].sort((a, b) => a - b)) }));
console.log(`${frames} frames (period ${period}, seed ${seed0}, ${selects} selects); coverage ${before} -> ${starts[0].size + starts[1].size} (${starts[0].size} + ${starts[1].size})`);
