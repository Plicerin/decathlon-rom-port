// The Activision Decathlon running as the cartridge does: the translated code
// (decathlonRecomp.mjs) on the 2600 bus (vcsBus.mjs, 8K FE banks), with the
// cartridge's data tables in ROM space. runFrame() plays one frame, up to the
// next VSYNC; the finished picture is in bus.tia.lastFrame and the sound
// registers in bus.audio.
import { M6502 } from './cpu6502.mjs';
import { VcsBus } from './vcsBus.mjs';
import { romImage } from './decathlonRomData.mjs';
import { run } from './decathlonRecomp.mjs';

export class DecathlonMachine {
  constructor() {
    this.bus = new VcsBus(romImage(), { fe: true });
    this.cpu = new M6502(this.bus);
    this.bus.cpu = this.cpu;
    this.cpu.reset(); // bank 0's reset vector (a data byte pair)
  }

  runFrame() {
    if (!run(this.cpu, this.bus)) throw new Error(`frame did not end (pc $${this.cpu.pc.toString(16)})`);
  }
}
