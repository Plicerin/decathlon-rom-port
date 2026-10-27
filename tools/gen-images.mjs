// Dev: renders the site's pictures from the translation (img/*.png, 640x380:
// the visible lines doubled across and down): the title screen, and a frame
// AFTER frames into four events of a played decathlon (the athlete waggling
// every 4 frames, the button pressed at random, as tools/verify-recomp.mjs's
// 'play' mode). usage: node tools/gen-images.mjs [after]
import { mkdirSync } from 'node:fs';
import { DecathlonMachine } from '../src/decathlonMachine.mjs';
import { FIRST_LINE, VISIBLE_LINES } from '../src/decathlonPlayer.mjs';
import { writeFramePng } from './atari/png.mjs';

const after = Number(process.argv[2] ?? 240);
const m = new DecathlonMachine();
const bus = m.bus;
mkdirSync('img', { recursive: true });
const save = (name) => writeFramePng(`img/${name}.png`, bus.tia.lastFrame.slice(FIRST_LINE, FIRST_LINE + VISIBLE_LINES), 4, 2);
let s = 1, press = 0, event = -1, since = 0;
const rand = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
for (let f = 0; f < 60000; f += 1) {
  bus.swchb = 0x0b & (f >= 60 && f < 68 ? ~0x01 : 0xff);
  bus.swcha = f > 90 ? (Math.floor(f / 4) & 1 ? 0x7f : 0xbf) : 0xff;
  if (press > 0) press -= 1; else if (rand() < 0.04) press = 1 + Math.floor(rand() * 40);
  bus.inpt4 = press ? 0x00 : 0x80;
  m.runFrame();
  if (f === 40) save('start');
  const ev = bus.ram[0];
  if (f > 60 && ev !== event) { event = ev; since = 0; console.log(`frame ${f}: event ${ev}`); }
  since += 1;
  const NAMES = { 0: 'dash', 5: 'hurdles', 7: 'polevault', 8: 'javelin' };
  if (since === after && NAMES[event]) save(NAMES[event]);
}
