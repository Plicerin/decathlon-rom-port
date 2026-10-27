// Dev: which instructions make the FE cartridge decide a bank (an access right
// after one to $01FE), with the stack pointer at the time, over a played game.
// The translation relies on these being only JSR (target high byte) and RTS
// (the pull from $01FF). usage: node tools/fe-check.mjs frames period
import { VCS, loadRom } from './atari/vcs.mjs';
const frames = Number(process.argv[2] ?? 20000), period = Number(process.argv[3] ?? 4);
const vcs = new VCS(loadRom());
let op = 0, s = 0, pc = 0;
const seen = new Map();
const fe = vcs.feAccess.bind(vcs);
vcs.feAccess = (a, v) => {
  if (vcs.lastAccess === 0x1fe) { const k = `op ${op.toString(16)} s ${s.toString(16)} access ${a.toString(16)}`; seen.set(k, (seen.get(k) ?? 0) + 1); }
  fe(a, v);
};
let seed = 1, fire = 0;
const rnd = (n) => { seed = (seed * 1103515245 + 12345) >>> 0; return (seed >>> 8) % n; };
for (let f = 1; f <= frames; f += 1) {
  vcs.swchb = f >= 60 && f < 70 ? 0x0a : (rnd(500) === 0 ? 0x09 : 0x0b);
  vcs.swcha = f > 100 ? (Math.floor(f / period) & 1 ? 0x7f : 0xbf) : 0xff;
  if (fire > 0) fire -= 1; else if (rnd(25) === 0) fire = 1 + rnd(40);
  vcs.inpt4 = fire ? 0 : 0x80;
  const target = vcs.frame + 1;
  while (vcs.frame < target) { pc = vcs.cpu.pc; op = vcs.rom[vcs.bank * 4096 + (pc & 0xfff)]; s = vcs.cpu.s; vcs.cpu.step(); }
}
console.log([...seen].map(([k, n]) => `${k}: ${n}`).join('\n'));
