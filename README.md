# The Activision Decathlon (Atari 2600) — ROM translation

David Crane's *The Activision Decathlon* (Activision, 1983) for the browser:
the cartridge's 6502 program translated into JavaScript one instruction at a
time, with every cycle counted, running on a model of the 2600's TIA and RIOT
chips. A 6502 core runs the real ROM beside the translation to prove that the
two match frame by frame.

The ROM is not included. The tools expect the NTSC 8K cartridge (MD5
`525f2dfc8b21b0186cff2568e0509bfc`, the second release, which fixed the pole
vault bug) at `rom/decathlon.a26`.

## Controls

| Console / joystick | Keyboard | Gamepad |
|--------------------|----------|---------|
| Game Select        | `X`      | Back    |
| Game Reset         | `Enter`  | Start   |
| Joystick: left and right in turn to run | arrows / WASD | stick or D-pad |
| Button: jump, put, throw, vault | `Space` or `Z` | A/B/X/Y |

The cartridge reads only Game Select and Game Reset, and of the joystick only
left, right and the button (up and down only keep it from going idle). Left
and right together count as neither, as on a real joystick. On phones the page
has one ◀ ▶ pad (the half under a finger is pressed, so a thumb rubbed across
it runs) and a Fire button. The page's "How to play" has the rules for every
event, measured on the cartridge.

## How it was made

There was no published disassembly, so the cartridge was disassembled from scratch,
as for the [Space Shuttle port](https://github.com/Plicerin/spaceshuttle-rom-port):

1. `tools/coverage.mjs` (random input) and `tools/cov-play.mjs` (whole
   decathlons: the athlete runs by waggling the joystick, the button is pressed
   at random, for each player count) run the real cartridge and record every
   instruction executed and every ROM byte read as data.
2. `tools/disasm.mjs` writes DASM source from that, plus static tracing from
   the executed code. `tools/build-rom.ps1` reassembles it and checks the MD5:
   byte-identical.
3. `tools/recompile.mjs` translates every instruction into
   `src/decathlonRecomp.mjs` and puts the bytes no instruction occupies in
   `src/decathlonRomData.mjs`.
4. `tools/verify-recomp.mjs [frames] [seed] [random|play]` runs the
   translation and the ROM side by side and compares registers, bank, cycles,
   RAM, every TIA write and every pixel after each frame. 150,000 frames
   (whole decathlons for one and four athletes, and random input): no
   differences. `tools/verified-coverage.mjs`: 2,800 of the 2,846 instructions
   (98.4%) were executed in the comparisons.

`tools/gen-images.mjs` renders the site's pictures from the translation.

### FE bank switching

Decathlon is one of only two cartridges (with Robot Tank) that use
Activision's FE scheme. There are no hotspots: the cartridge watches the bus,
and the access right after one to `$01FE` picks the bank from bit 5 of its
data. With the stack pointer at `$FF`, a JSR pushes to `$01FF` and `$01FE` and
then fetches the high byte of its target, so a JSR to `$Dxxx` runs bank 1 and
one to `$Fxxx` bank 0; an RTS pulls `$01FE` then `$01FF` and switches back.

So the order of the processor's bus accesses decides the bank. The 6502 core
here (`src/cpu6502.mjs`) makes JSR's and RTS's accesses in the real chip's
order, and the bus (`src/vcsBus.mjs`, option `fe`) watches for `$01FE`.
`tools/fe-check.mjs` confirms that in this game only JSR with the stack at
`$FF` and RTS with it at `$FD` ever choose a bank, and the translation makes
exactly those accesses.

### Sound

The footsteps turn the volume on and off within a single frame, so the page
passes each frame's sound register writes to the audio worklet with their
cycle in the frame (`src/tiaAudio.mjs`, `src/tiaSound.worklet.js`), and the
worklet plays each one at its moment.

## The annotated disassembly

`decathlon.asm` is the disassembly with names: the TIA and RIOT registers, a
RAM map, some routines and section headers. It reassembles byte-identically,
and the translation takes its labels and comments from it. Names are given only
where the code and the running cartridge agree; the rest keep neutral names
(`ram_XX`, `LXXXX`), and comments marked "?" are leads, not facts. The names
live in `tools/annotations.mjs`. Because it reassembles to the cartridge, the
source isn't published here: `node tools/disasm.mjs` writes it from your own
cartridge in `rom/`.

*The Activision Decathlon* is © 1983 Activision. An unofficial preservation
project, not affiliated with Activision.
