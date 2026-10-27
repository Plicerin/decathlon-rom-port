// Dev: run the real cartridge with random input (joystick, fire, every
// console switch) and record which ROM bytes execute as instructions, per
// bank, for the disassembler. Writes tools/out/coverage.json.
// usage: node tools/coverage.mjs [frames] [seed]
import { writeFileSync, mkdirSync } from 'node:fs';
import { VCS, loadRom } from './atari/vcs.mjs';

const frames = Number(process.argv[2] ?? 60000);
let seed = Number(process.argv[3] ?? 1);
const rnd = (n) => { seed = (seed * 1103515245 + 12345) >>> 0; return (seed >>> 8) % n; };

const vcs = new VCS(loadRom());
const starts = [new Set(), new Set()]; // instruction start offsets (address & $FFF) per bank
const reads = [new Set(), new Set()];  // ROM bytes read as data (not an instruction's own bytes)
let insPc = 0;
const odd = new Set();
vcs.onRead = (a) => { if ((a & 0x1000) && ((a - insPc) & 0x1fff) > 2) reads[vcs.bank].add(a & 0xfff); };
let stick = 0xff, fire = false, swchb = 0x0b, hold = 0;
mkdirSync('tools/out', { recursive: true });
for (let f = 0; f < frames; f += 1) {
  if (hold-- <= 0) {
    hold = 4 + rnd(90);
    stick = [0xff, 0xef, 0xdf, 0xbf, 0x7f, 0xaf, 0x6f, 0x9f, 0x5f][rnd(9)];
    fire = rnd(3) === 0;
    // console switches: color/B&W (bit 3) and the difficulties (bits 6, 7) flip now and then;
    // reset (bit 0) and select (bit 1) are pressed briefly, rarely
    if (rnd(4) === 0) swchb ^= [0x08, 0x40, 0x80][rnd(3)];
  }
  let b = swchb | 0x03;
  if (rnd(400) === 0) b &= ~0x01;
  if (rnd(300) === 0) b &= ~0x02;
  vcs.swcha = stick; vcs.inpt4 = fire ? 0 : 0x80; vcs.swchb = b;
  const target = vcs.frame + 1;
  let guard = 0;
  while (vcs.frame < target) {
    starts[vcs.bank].add(vcs.cpu.pc & 0xfff);
    // FE: bank 0 code runs at $Fxxx, bank 1 at $Dxxx; anything else is worth knowing
    const hi = (vcs.cpu.pc >> 12) & 0xf;
    if (hi !== (vcs.bank ? 0xd : 0xf) && !odd.has(`${vcs.bank}:${hi}`)) { odd.add(`${vcs.bank}:${hi}`); console.log(`bank ${vcs.bank} running at ${vcs.cpu.pc.toString(16)}`); }
    insPc = vcs.cpu.pc & 0x1fff;
    vcs.cpu.step();
    if (++guard > 300000) throw new Error(`frame ${f} did not end (pc ${vcs.cpu.pc.toString(16)})`);
  }
  if (f % 10000 === 9999) console.log(`frame ${f + 1}: ${starts[0].size} + ${starts[1].size} instruction addresses`);
}
writeFileSync('tools/out/coverage.json', JSON.stringify({ code: starts.map((s) => [...s].sort((a, b) => a - b)), data: reads.map((s) => [...s].sort((a, b) => a - b)) }));
console.log('coverage written');
