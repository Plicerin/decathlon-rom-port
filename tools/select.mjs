// Dev: what Game Select shows: press it n times and save the picture after each press
import { VCS, loadRom } from './atari/vcs.mjs';
import { writeFramePng } from './atari/png.mjs';
const vcs = new VCS(loadRom());
let f = 0;
const step = (n, swchb) => { for (let i = 0; i < n; i += 1) { vcs.swchb = swchb; vcs.runFrames(1); f += 1; } };
step(60, 0x0b);
for (let k = 1; k <= 10; k += 1) { step(8, 0x09); step(40, 0x0b); writeFramePng(`tools/out/sel${k}.png`, vcs.tia.lastFrame.slice(0, 262), 2, 1); }
