// Annotations for The Activision Decathlon disassembly, applied by
// tools/disasm.mjs to write decathlon.asm. Names are given only where the code
// and a check against the running cartridge agree; everything else keeps a
// neutral name (ram_XX, LXXXX) and, where something is known about it, a
// comment with a "?".
//
// Sources of the facts: reading the code; the running cartridge with RAM read
// each frame (the playtest's measurements: which byte holds the event, the
// athlete, the shown result and points, the totals); RAM compared between the
// title screen, after Game Select and in a game; a whole decathlon replayed
// with up or down held (only $85 differs).

// ---- RAM ($80-$FF): [name, comment]
export const RAM = {
  0x80: ['event', 'the event, 0-9: 100 m, long jump, shot put, high jump, 400 m, 110 m hurdles, discus, pole vault, javelin, 1500 m; on the title screen the game Game Select shows'],
  0x81: ['frameCount', 'counts frames (+1 at each VSYNC, $F934); every 8th frame runs the title timer ($C5)'],
  0x82: ['athletesLess1', 'athletes in a decathlon minus 1: 0-3 for one to four athletes; 4 in the single events (always four athletes)'],
  0x83: ['athlete', 'whose turn it is, 0-3; Game Reset sets 0'],
  0x85: ['controls', 'the controls this frame: bits 0-3 the joystick (SWCHA high nibble, ANDed with the low nibble, the second port, when INPT3 bit 7 is set: see ReadJoystick; 0 = pushed: bit 3 right, 2 left, 1 down, 0 up), bit 7 the button (0 = pressed; forced to 1 while $DB is 0)'],
  0x86: ['strideLatch', 'the left/right bits ($85 & $0C) last frame: a change between pushed states, or a push from neutral, is a stride ($D518)'],
  0x87: ['buttonLatch', 'the button bit ($85 & $80) last frame: a press is a change ($D1FE)'],
  0x95: ['pointsLo', 'points for the event just shown, BCD (low byte)'],
  0x96: ['pointsHi', 'points shown, BCD (high byte)'],
  0x97: ['totals', 'running totals, two BCD bytes per athlete from $97 ($97, $99, $9B, $9D); Game Select fills $97-$9F with $AA (blank digits)'],
  0xC3: ['idleTimer', 'cleared whenever the joystick is pushed (any direction, $F99A); counts up while idle. Up and down matter only here: they keep the game out of its idle state'],
  0xC4: ['titleMode', 'bit 7 set at power-on ($F011) and when the title timer runs out ($F971): the title/demo state; Game Reset clears it. Bits 0-2 count every 256 frames'],
  0xC5: ['titleTimer', 'nonzero on the title screen and after Game Select (counts down every 8 frames, $F963; at 0 the game returns to the title: $C4 bit 7, scores cleared); 0 from Game Reset through the game'],
  0xE8: ['toMark', 'distance left to the scratch line, the bar or the box in the field events'],
};

// ---- hardware
export const TIA_WRITE = ['VSYNC', 'VBLANK', 'WSYNC', 'RSYNC', 'NUSIZ0', 'NUSIZ1', 'COLUP0', 'COLUP1', 'COLUPF', 'COLUBK', 'CTRLPF', 'REFP0', 'REFP1', 'PF0', 'PF1', 'PF2',
  'RESP0', 'RESP1', 'RESM0', 'RESM1', 'RESBL', 'AUDC0', 'AUDC1', 'AUDF0', 'AUDF1', 'AUDV0', 'AUDV1', 'GRP0', 'GRP1', 'ENAM0', 'ENAM1', 'ENABL',
  'HMP0', 'HMP1', 'HMM0', 'HMM1', 'HMBL', 'VDELP0', 'VDELP1', 'VDELBL', 'RESMP0', 'RESMP1', 'HMOVE', 'HMCLR', 'CXCLR'];
export const TIA_READ = ['CXM0P', 'CXM1P', 'CXP0FB', 'CXP1FB', 'CXM0FB', 'CXM1FB', 'CXBLPF', 'CXPPMM', 'INPT0', 'INPT1', 'INPT2', 'INPT3', 'INPT4', 'INPT5'];
export const RIOT = { 0x280: 'SWCHA', 0x281: 'SWACNT', 0x282: 'SWCHB', 0x283: 'SWBCNT', 0x284: 'INTIM', 0x294: 'TIM1T', 0x295: 'TIM8T', 0x296: 'TIM64T', 0x297: 'T1024T' };


// ---- routines and branch targets: address -> [name, comment]
export const LABELS = {
  0xF000: ['Start', 'power-on: clears the TIA, RAM and stack page ($00-$FF) and leaves the stack pointer at $FF, where JSR and RTS switch FE banks'],
  0xF039: ['PictureStart', 'waits for the vertical blank timer, then HMOVE and VBLANK off: the picture begins'],
  0xF910: ['ReadJoystick', 'the left joystick (SWCHA high nibble, shifted down); the right one (low nibble) is ANDed in only when INPT3 bit 7 is set. This port model reads INPT0-3 as $80, so here both count (the page never moves the right one). On a console INPT3 bit 7 rises only as the paddle capacitor charges, which needs a paddle on that pin, so with joysticks the right port is probably ignored (?: inferred from the paddle circuit, not confirmed)'],
  0xF924: ['VerticalSync', 'end of frame: VBLANK and VSYNC on, three lines, frame counter $81'],
  0xF9AC: ['ConsoleSwitches', 'reads SWCHB: bit 0 Game Reset, bit 1 Game Select. No other console switch is read anywhere'],
  0xD000: ['ResetEvent', 'clears $C3-$F4 and the result digits, silences AUDV1: called at power-on, by Game Reset and Game Select, and when the next event starts ($F6E0, $F723)'],
};

// ---- comments on single instructions
export const COMMENTS = {
  0xF00B: 'the first call into bank 1: the JSR to $Dxxx switches banks, the RTS switches back',
  0xF9B0: 'carry set: Game Reset not pressed',
  0xF9D7: 'carry set: Game Select not pressed',
};

// ---- section headers before an address
export const SECTIONS = {
  0xF000: ['bank 0 ($F000-$FFFF): power-on, the frame loop, the screen and the console switches', 'FE bank switching: the cartridge watches the bus, and the access after one to $01FE picks the bank by its data bit 5. With the stack at $FF a JSR writes $01FF, $01FE and then fetches the target address high byte, so a JSR to $Dxxx selects bank 1 and one to $Fxxx bank 0; an RTS (stack at $FD) reads $01FE then $01FF, the return address high byte, and switches back'],
  0xF910: ['end of frame: joystick, vertical sync, title timer, console switches'],
  0xD000: ['bank 1 ($D000-$DFFF): routines called from bank 0 with JSR; the call switches to this bank and its RTS switches back'],
};

// ---- data tables: address -> [name, comment]
export const DATA = {
};
