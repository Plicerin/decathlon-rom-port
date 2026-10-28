// Atari 2600 bus shared by the game and the dev oracle: 4K ROM, 8K F8, 8K FE
// (Activision) or 16K F6 bank-switched ROM, 128 bytes
// RAM, RIOT timer and switches, and the TIA model (tia.mjs), which rasterizes
// frames and latches collisions. this.cpu is attached by the owner and only
// its cycle counter is read here.
import { TIA as TiaChip, CYCLES_PER_LINE } from './tia.mjs?v=a4de5feb';

export { CYCLES_PER_LINE };

export const TIA = Object.freeze({
  VSYNC: 0x00, VBLANK: 0x01, WSYNC: 0x02, NUSIZ0: 0x04, NUSIZ1: 0x05, COLUP0: 0x06, COLUP1: 0x07,
  COLUPF: 0x08, COLUBK: 0x09, CTRLPF: 0x0a, REFP0: 0x0b, REFP1: 0x0c, PF0: 0x0d, PF1: 0x0e, PF2: 0x0f,
  RESP0: 0x10, RESP1: 0x11, RESM0: 0x12, GRP0: 0x1b, GRP1: 0x1c, ENAM0: 0x1d, HMP0: 0x20, HMP1: 0x21,
  HMM0: 0x22, VDELP0: 0x25, VDELP1: 0x26, HMOVE: 0x2a, HMCLR: 0x2b, CXCLR: 0x2c,
});

const AUDIO_REGS = ['c0', 'c1', 'f0', 'f1', 'v0', 'v1'];

export class VcsBus {
  // rom: 4K image indexed by address & $FFF; 8K F8 (two 4K banks, an access
  // to $1FF8/$1FF9 selects bank 0/1); or 16K F6 (four banks, $1FF6-$1FF9
  // select 0-3). It powers up in the last bank (options.bank overrides: real
  // carts can start in any bank, so games put a reset stub in each).
  // Super Chip (SC): 128 bytes of cartridge RAM over the first 256 bytes of
  // every bank, written at $x000-$x07F and read at $x080-$x0FF. Detected as
  // Stella does: the first 256 bytes of every bank are identical (the RAM
  // window), or forced with options.superchip. Reading the write port or
  // writing the read port corrupts the RAM on real hardware; here it is
  // counted in scViolations so tests can insist on zero.
  // FE (options.fe): no hotspots; the cartridge watches the bus, and the data
  // on the access after one to $01FE (the stack's top two bytes, written by
  // JSR and read by RTS with the stack pointer at $FF) picks the bank: bit 5
  // set (an address in $F000-$FFFF) bank 0, clear ($D000-$DFFF) bank 1. It
  // powers up in bank 0.
  constructor(rom, options = {}) {
    this.rom = rom;
    this.fe = options.fe ?? false;
    this.lastAccess = -1;
    this.banks = rom.length >= 4096 ? rom.length / 4096 : 1;
    if (![1, 2, 4].includes(this.banks)) throw new Error(`unsupported ROM size ${rom.length}`);
    this.bank = options.bank ?? (this.fe ? 0 : this.banks - 1);
    const first = (b) => rom.subarray(b * 4096, b * 4096 + 256).join();
    this.superchip = options.superchip ?? (!this.fe && this.banks >= 2 && [...Array(this.banks).keys()].every((b) => first(b) === first(0)));
    this.scram = new Uint8Array(128).map(() => (Math.random() * 256) | 0); // powers up random
    this.scViolations = 0;
    this.ram = new Uint8Array(128);
    this.swcha = 0xff;
    this.swchb = 0x0b;          // reset/select released, color, both difficulties B
    this.inpt4 = 0x80;          // fire released
    this.inpt5 = 0x80;
    this.collisions = options.collisions ?? null; // (reg) => byte
    // the RIOT timer powers up holding some value and counting every 1024
    // cycles (Stella starts it random); a fixed $FF keeps runs reproducible.
    // Berzerk waits on it before it ever sets it.
    this.timer = { value: 0xff, interval: 1024, setAt: 0 };
    this.frame = 0;
    this.frameStart = 0;
    this.writes = [];           // current frame's TIA writes: {reg, value, cycle}
    this.lastFrameWrites = [];
    this.audio = { c0: 0, f0: 0, v0: 0, c1: 0, f1: 0, v1: 0 }; // latest AUDC/AUDF/AUDV values
    this.onFrame = null;
    this.tia = new TiaChip();
  }

  // RIOT timer as Stella models it: the written value is decremented on the
  // cycle after the write and then once per interval; after it passes 0 it
  // wraps to $FF and counts down once per cycle. cycles is the CPU count after
  // the reading instruction, whose read is on its last cycle.
  intim(cycles) {
    const { value, interval, setAt } = this.timer;
    const d = cycles - 1 - setAt;
    const ticks = Math.floor((d + interval - 1) / interval);
    if (ticks <= value) return value - ticks;
    return (0xff - (d - (value * interval + 1))) & 0xff;
  }

  read(addr) {
    const a = addr & 0x1fff;
    if (!this.fe) return this.readBus(a);
    const v = this.readBus(a);
    this.feAccess(a, v);
    return v;
  }

  // FE: the access after one to $01FE selects the bank from its data's bit 5
  feAccess(a, value) {
    if (this.lastAccess === 0x1fe) this.bank = (value & 0x20) ? 0 : 1;
    this.lastAccess = a;
  }

  readBus(a) {
    if (this.onRead) this.onRead(a, this.cpu);
    if (a & 0x1000) return this.romRead(a);
    if ((a & 0x280) === 0x80) return this.ram[a & 0x7f];
    if ((a & 0x280) === 0x280) {
      switch (a & 0x7) {
        case 0x0: return this.swcha;
        case 0x2: return this.swchb;
        case 0x4: case 0x6: return this.intim(this.cpu.cycles);
        default: return 0;
      }
    }
    const reg = a & 0x0f;
    if (reg <= 0x07) {
      if (this.onCollisionRead) this.onCollisionRead(reg, this.cpu.cycles - 1 - this.frameStart);
      const cycle = this.cpu.cycles - 1 - this.frameStart;
      return (this.collisions ? this.collisions(reg, cycle) : this.tia.readCollision(reg, cycle)) & 0xc0;
    }
    if (reg === 0x0c) return this.inpt4;
    if (reg === 0x0d) return this.inpt5;
    return 0x80;
  }

  write(addr, value, endCycles) {
    // a store writes on its last cycle; the CPU's counter is already past it
    const cycles = endCycles - 1;
    const a = addr & 0x1fff;
    if (this.fe) this.feAccess(a, value);
    if (a & 0x1000) {
      const off = a & 0x0fff;
      if (this.superchip && off < 0x80) this.scram[off] = value;
      else if (this.superchip && off < 0x100) this.scViolations += 1;
      this.hotspot(a);
      return;
    }
    if ((a & 0x280) === 0x80) { this.ram[a & 0x7f] = value; return; }
    if ((a & 0x280) === 0x280) {
      const intervals = { 0x14: 1, 0x15: 8, 0x16: 64, 0x17: 1024 };
      const iv = intervals[a & 0x17];
      if (iv) this.timer = { value, interval: iv, setAt: cycles };
      return;
    }
    const reg = a & 0x3f;
    this.writes.push({ reg, value, cycle: cycles - this.frameStart });
    if (reg >= 0x15 && reg <= 0x1a) this.audio[AUDIO_REGS[reg - 0x15]] = value;
    this.tia.write(reg, value, cycles - this.frameStart);
    if (reg === TIA.WSYNC) {
      this.cpu.cycles = (Math.floor(cycles / CYCLES_PER_LINE) + 1) * CYCLES_PER_LINE;
    } else if (reg === TIA.VSYNC && (value & 0x02)) {
      // the new frame counts from the start of this line: the beam keeps its place in it
      const lineStart = cycles - (cycles % CYCLES_PER_LINE);
      this.tia.endFrame(cycles - this.frameStart, cycles - lineStart);
      this.lastFrameWrites = this.writes;
      this.writes = [];
      this.frame += 1;
      this.frameStart = lineStart;
      if (this.onFrame) this.onFrame(this);
    }
  }

  // F8 hotspots switch on any access; the read itself returns the byte from
  // the bank selected before it
  romRead(a) {
    const off = a & 0x0fff;
    if (this.superchip && off < 0x100) {
      if (off >= 0x80) return this.scram[off & 0x7f];
      this.scViolations += 1;
      return 0;
    }
    const v = this.rom[this.bank * 4096 + off];
    this.hotspot(a);
    return v;
  }

  hotspot(a) {
    if (this.fe) return;
    const off = a & 0x0fff;
    if (this.banks === 2 && (off === 0xff8 || off === 0xff9)) this.bank = off - 0xff8;
    else if (this.banks === 4 && off >= 0xff6 && off <= 0xff9) this.bank = off - 0xff6;
  }

  runFrames(n, hook) {
    const target = this.frame + n;
    while (this.frame < target) {
      if (hook) hook(this.cpu, this);
      this.cpu.step();
    }
  }

  ramByte(zpAddr) { return this.ram[zpAddr & 0x7f]; }
  zeroPage() { const zp = new Uint8Array(256); zp.set(this.ram, 0x80); return zp; }
}
