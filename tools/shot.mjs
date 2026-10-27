// Dev: run the real cartridge for a while and save frames as PNGs, with the
// frame's line count and the bank switches seen.
// usage: node tools/shot.mjs [frames...]  (env SWCHB=hex, e.g. 0b; STICK=hex SWCHA; FIRE=1)
import { mkdirSync } from 'node:fs';
import { VCS, loadRom } from './atari/vcs.mjs';
import { writeFramePng } from './atari/png.mjs';

const want = (process.argv.slice(2).length ? process.argv.slice(2) : ['1', '30', '120', '300']).map(Number);
const vcs = new VCS(loadRom());
let switches = 0, last = vcs.bank;
mkdirSync('tools/out', { recursive: true });
for (let f = 1; f <= Math.max(...want); f += 1) {
  if (process.env.SWCHB) vcs.swchb = parseInt(process.env.SWCHB, 16);
  if (process.env.STICK) vcs.swcha = parseInt(process.env.STICK, 16);
  if (process.env.FIRE) vcs.inpt4 = 0;
  const target = vcs.frame + 1;
  let guard = 0;
  while (vcs.frame < target) { vcs.cpu.step(); if (vcs.bank !== last) { switches += 1; last = vcs.bank; } if (++guard > 200000) throw new Error(`frame ${f} did not end (pc ${vcs.cpu.pc.toString(16)}, bank ${vcs.bank})`); }
  if (want.includes(f)) {
    const lines = Math.round(vcs.lastFrameWrites.at(-1)?.cycle / 76);
    writeFramePng(`tools/out/frame${f}.png`, vcs.tia.lastFrame.slice(0, 262), 2, 1);
    console.log(`frame ${f}: ~${lines} lines, bank switches so far ${switches}, pc ${vcs.cpu.pc.toString(16)} bank ${vcs.bank}`);
  }
}
