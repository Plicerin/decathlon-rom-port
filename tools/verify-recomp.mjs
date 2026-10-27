// Differential test of the translated cartridge (src/decathlonMachine.mjs)
// against the real ROM interpreted on the 6502 core: both get the same inputs
// each frame, and after every frame the CPU registers, the bank, the cycle
// count, RAM, the TIA write log and the finished picture must be identical,
// and every ROM read the translation makes must land on a byte of its data
// image.
// Inputs ('random'): joystick, button and every console switch at random,
// Game Select and Game Reset now and then. ('play'): Game Select pressed
// SELECTS times, Game Reset, then the athlete runs (the joystick waggled
// left/right every PERIOD frames) and the button is pressed at random, so
// whole decathlons get played.
// usage: node tools/verify-recomp.mjs [frames] [seed] [random|play]   (env PERIOD, SELECTS)
import { writeFileSync as saveFile, mkdirSync } from 'node:fs';
import { VCS, loadRom } from './atari/vcs.mjs';
import { DecathlonMachine } from '../src/decathlonMachine.mjs';
import { ROM_DATA } from '../src/decathlonRomData.mjs';

const frames = Number(process.argv[2] ?? 3000), seed = Number(process.argv[3] ?? 1), mode = process.argv[4] ?? 'random';
const PERIOD = Number(process.env.PERIOD ?? 4), SELECTS = Number(process.env.SELECTS ?? 0);
const rom = new VCS(loadRom());
// every instruction the cartridge executes during the comparison (bank << 12 | offset), saved to
// tools/out/verified-<mode>-<seed>.json so tools/verified-coverage.mjs can combine the runs
const ran = new Set();
const romStep = rom.cpu.step.bind(rom.cpu);
rom.cpu.step = () => { ran.add((rom.bank << 12) | (rom.cpu.pc & 0xfff)); return romStep(); };
const js = new DecathlonMachine();
const mapped = new Uint8Array(8192);
for (const [at, h] of ROM_DATA) for (let i = 0; i < h.length / 2; i += 1) mapped[at + i] = 1;
const unmapped = new Set();
const busRead = js.bus.readBus.bind(js.bus);
js.bus.readBus = (a) => {
  if ((a & 0x1000) && !mapped[(js.bus.bank << 12) | (a & 0xfff)]) unmapped.add(`bank ${js.bus.bank} $${(a & 0x1fff).toString(16)}`);
  return busRead(a);
};
let s = seed >>> 0;
const rand = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
const hex = (v) => v.toString(16);

// switches: bit 0 Reset, bit 1 Select (low = pressed), bit 3 Color/B&W, bits 6/7 the difficulties
let stick = 0xff, fire = 0x80, held = 0x0b, bad = 0, press = 0;
const startAt = 60 + SELECTS * 30;
for (let f = 0; f < frames; f += 1) {
  let swchb = held;
  if (mode === 'play') {
    swchb = 0x0b;
    if (f >= 60 && f < startAt && (f - 60) % 30 < 8) swchb &= ~0x02;
    if (f >= startAt && f < startAt + 8) swchb &= ~0x01;
    stick = f > startAt + 30 ? (Math.floor(f / PERIOD) & 1 ? 0x7f : 0xbf) : 0xff;
    if (press > 0) press -= 1; else if (rand() < 0.04) press = 1 + Math.floor(rand() * 40);
    fire = press ? 0x00 : 0x80;
  } else {
    if (f % 30 === 0) {
      stick = [0x7f, 0xbf, 0xdf, 0xef, 0x5f, 0x6f, 0x9f, 0xaf, 0xff][Math.floor(rand() * 9)];
      fire = rand() < 0.35 ? 0x00 : 0x80;
      if (rand() < 0.2) held ^= [0x08, 0x40, 0x80][Math.floor(rand() * 3)];
    }
    swchb = held;
    const t = f % 6000;
    if (t < 160 && rand() < 0.5) swchb &= ~0x02;
    if (t >= 300 && t < 306) swchb &= ~0x01;
    if (t > 400 && rand() < 0.002) swchb &= ~0x02;
  }
  for (const m of [rom, js.bus]) { m.swcha = stick; m.inpt4 = fire; m.swchb = swchb; }
  rom.runFrames(1);
  js.runFrame();
  const diffs = [];
  for (const r of ['a', 'x', 'y', 's', 'p', 'pc', 'cycles']) if (rom.cpu[r] !== js.cpu[r]) diffs.push(`${r} rom ${hex(rom.cpu[r])} js ${hex(js.cpu[r])}`);
  if (rom.bank !== js.bus.bank) diffs.push(`bank rom ${rom.bank} js ${js.bus.bank}`);
  for (let i = 0; i < 128; i += 1) if (rom.ram[i] !== js.bus.ram[i]) diffs.push(`$${hex(0x80 + i)} rom ${hex(rom.ram[i])} js ${hex(js.bus.ram[i])}`);
  const wr = rom.lastFrameWrites, wj = js.bus.lastFrameWrites;
  if (wr.length !== wj.length) diffs.push(`writes rom ${wr.length} js ${wj.length}`);
  for (let i = 0; i < Math.min(wr.length, wj.length); i += 1) {
    if (wr[i].reg !== wj[i].reg || wr[i].value !== wj[i].value || wr[i].cycle !== wj[i].cycle) { diffs.push(`write ${i} rom ${JSON.stringify(wr[i])} js ${JSON.stringify(wj[i])}`); break; }
  }
  const pr = rom.tia.lastFrame, pj = js.bus.tia.lastFrame;
  if (pr && pr.some((row, y) => row.some((c, x) => c !== pj[y][x]))) diffs.push('picture differs');
  if (diffs.length) { bad += 1; if (bad <= 5) console.log(`frame ${f}: ${diffs.slice(0, 8).join(', ')}`); if (bad === 5) break; }
}
mkdirSync('tools/out', { recursive: true });
saveFile(`tools/out/verified-${mode}${mode === 'play' ? `-${PERIOD}-${SELECTS}` : ''}-${seed}.json`, JSON.stringify([...ran]));
if (unmapped.size) console.log('reads outside the data image:', [...unmapped].slice(0, 20).join(', '));
console.log({ frames, mode, seed, ...(mode === 'play' ? { period: PERIOD, selects: SELECTS } : {}), bad, unmapped: unmapped.size });
process.exit(bad || unmapped.size ? 1 : 0);
