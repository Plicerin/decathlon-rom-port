// Dev oracle: the real cartridge interpreted by the 6502 core on the shared
// bus. Not used by the game itself.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { M6502 } from '../../src/cpu6502.mjs';
import { VcsBus, TIA, CYCLES_PER_LINE } from '../../src/vcsBus.mjs';

export { TIA, CYCLES_PER_LINE };

// The Activision Decathlon (Activision, 1983), NTSC, 8K FE (banks switched by
// JSR and RTS: code at $Dxxx runs in bank 1, $Fxxx in bank 0)
export const ROM_MD5 = '525f2dfc8b21b0186cff2568e0509bfc';

export function loadRom(path = 'rom/decathlon.a26') {
  const rom = readFileSync(path);
  const md5 = createHash('md5').update(rom).digest('hex');
  if (md5 !== ROM_MD5) throw new Error(`unexpected ROM md5 ${md5}`);
  return rom;
}

export class VCS extends VcsBus {
  constructor(rom, options = {}) {
    super(rom, { fe: true, ...options });
    this.cpu = new M6502(this);
    this.cpu.reset();
  }
}
