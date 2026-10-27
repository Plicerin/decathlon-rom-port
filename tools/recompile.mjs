// Translates The Activision Decathlon cartridge (8K, FE bank switching) into
// JavaScript, instruction for instruction, with cycle counts:
// src/decathlonRecomp.mjs (code) and src/decathlonRomData.mjs (the bytes no
// instruction occupies: tables and graphics). The instruction list is the
// disassembler's (tools/build/code.json: executed or statically traced code);
// instructions are decoded from the cartridge bytes; labels and comments come
// from the assembled listing (tools/build/decathlon.lst: build decathlon.asm,
// the annotated source, with tools/build-rom.ps1 decathlon.asm).
//
// Banks: bank 0 is assembled at $F000, bank 1 at $D000. The FE cartridge has
// no hotspots: it watches the bus, and the access after one to $01FE picks
// the bank by its data's bit 5. In this game only two instructions do that
// (tools/fe-check.mjs): JSR with the stack pointer at $FF (it pushes to
// $01FF, $01FE, then fetches the target's high byte, so the target address
// names the bank) and RTS with it at $FD (it pulls $01FE, then $01FF, the
// return address's high byte). The translation makes JSR's and RTS's bus
// accesses in the hardware's order, as the 6502 core does, and the generated
// run() dispatches on (bank << 12 | pc & $FFF) after each of them.
//
// tools/verify-recomp.mjs checks the result against the cartridge frame by frame.
import { readFileSync, writeFileSync } from 'node:fs';
import { loadRom } from './atari/vcs.mjs';

const rom = loadRom();
const codeList = JSON.parse(readFileSync('tools/build/code.json', 'utf8'));
const listing = readFileSync('tools/build/decathlon.lst', 'latin1').split(/\r?\n/);
const hex = (v, n = 2) => v.toString(16).padStart(n, '0');
const $ = (v, n) => '0x' + hex(v, n);
const ORIGIN = [0xf000, 0xd000];

// official opcodes: [mnemonic, mode, cycles]
const OPC = {};
const add = (mn, list) => { for (const [op, mode, cyc] of list) OPC[op] = [mn, mode, cyc]; };
const rd = (imm, zp, zpx, abs, absx, absy, indx, indy) => [[imm, 'imm', 2], [zp, 'zp', 3], [zpx, 'zpx', 4], [abs, 'abs', 4], [absx, 'absx', 4], [absy, 'absy', 4], [indx, 'indx', 6], [indy, 'indy', 5]];
add('lda', rd(0xa9, 0xa5, 0xb5, 0xad, 0xbd, 0xb9, 0xa1, 0xb1));
add('adc', rd(0x69, 0x65, 0x75, 0x6d, 0x7d, 0x79, 0x61, 0x71));
add('sbc', rd(0xe9, 0xe5, 0xf5, 0xed, 0xfd, 0xf9, 0xe1, 0xf1));
add('and', rd(0x29, 0x25, 0x35, 0x2d, 0x3d, 0x39, 0x21, 0x31));
add('ora', rd(0x09, 0x05, 0x15, 0x0d, 0x1d, 0x19, 0x01, 0x11));
add('eor', rd(0x49, 0x45, 0x55, 0x4d, 0x5d, 0x59, 0x41, 0x51));
add('cmp', rd(0xc9, 0xc5, 0xd5, 0xcd, 0xdd, 0xd9, 0xc1, 0xd1));
add('ldx', [[0xa2, 'imm', 2], [0xa6, 'zp', 3], [0xb6, 'zpy', 4], [0xae, 'abs', 4], [0xbe, 'absy', 4]]);
add('ldy', [[0xa0, 'imm', 2], [0xa4, 'zp', 3], [0xb4, 'zpx', 4], [0xac, 'abs', 4], [0xbc, 'absx', 4]]);
add('sta', [[0x85, 'zp', 3], [0x95, 'zpx', 4], [0x8d, 'abs', 4], [0x9d, 'absx', 5], [0x99, 'absy', 5], [0x81, 'indx', 6], [0x91, 'indy', 6]]);
add('stx', [[0x86, 'zp', 3], [0x96, 'zpy', 4], [0x8e, 'abs', 4]]);
add('sty', [[0x84, 'zp', 3], [0x94, 'zpx', 4], [0x8c, 'abs', 4]]);
add('cpx', [[0xe0, 'imm', 2], [0xe4, 'zp', 3], [0xec, 'abs', 4]]);
add('cpy', [[0xc0, 'imm', 2], [0xc4, 'zp', 3], [0xcc, 'abs', 4]]);
add('bit', [[0x24, 'zp', 3], [0x2c, 'abs', 4]]);
for (const [mn, acc, zp, zpx, abs, absx] of [['asl', 0x0a, 0x06, 0x16, 0x0e, 0x1e], ['lsr', 0x4a, 0x46, 0x56, 0x4e, 0x5e], ['rol', 0x2a, 0x26, 0x36, 0x2e, 0x3e], ['ror', 0x6a, 0x66, 0x76, 0x6e, 0x7e]]) {
  add(mn, [[acc, 'acc', 2], [zp, 'zp', 5], [zpx, 'zpx', 6], [abs, 'abs', 6], [absx, 'absx', 7]]);
}
add('inc', [[0xe6, 'zp', 5], [0xf6, 'zpx', 6], [0xee, 'abs', 6], [0xfe, 'absx', 7]]);
add('dec', [[0xc6, 'zp', 5], [0xd6, 'zpx', 6], [0xce, 'abs', 6], [0xde, 'absx', 7]]);
for (const [mn, op, cyc] of [['inx', 0xe8, 2], ['dex', 0xca, 2], ['iny', 0xc8, 2], ['dey', 0x88, 2], ['tax', 0xaa, 2], ['txa', 0x8a, 2], ['tay', 0xa8, 2], ['tya', 0x98, 2], ['tsx', 0xba, 2], ['txs', 0x9a, 2],
  ['pha', 0x48, 3], ['pla', 0x68, 4], ['php', 0x08, 3], ['plp', 0x28, 4], ['clc', 0x18, 2], ['sec', 0x38, 2], ['cli', 0x58, 2], ['sei', 0x78, 2], ['clv', 0xb8, 2], ['cld', 0xd8, 2], ['sed', 0xf8, 2], ['nop', 0xea, 2], ['rts', 0x60, 6], ['rti', 0x40, 6], ['brk', 0x00, 7]]) add(mn, [[op, 'imp', cyc]]);
add('jmp', [[0x4c, 'abs', 3], [0x6c, 'ind', 5]]);
add('jsr', [[0x20, 'abs', 6]]);
for (const [mn, op] of [['bpl', 0x10], ['bmi', 0x30], ['bvc', 0x50], ['bvs', 0x70], ['bcc', 0x90], ['bcs', 0xb0], ['bne', 0xd0], ['beq', 0xf0]]) add(mn, [[op, 'rel', 2]]);
const OPC_NAMES = new Set(Object.values(OPC).map(([mn]) => mn));
const SIZE = { imp: 1, acc: 1, imm: 2, zp: 2, zpx: 2, zpy: 2, indx: 2, indy: 2, rel: 2, abs: 3, absx: 3, absy: 3, ind: 3 };

// --- the instructions (key = bank << 12 | offset) ---
const byteAt = (key) => rom[key & 0x1fff];
const instrs = new Map();
for (const b of [0, 1]) for (const [off, executed] of codeList.code[b]) {
  const key = (b << 12) | off;
  const op = byteAt(key);
  const def = OPC[op];
  if (!def) throw new Error(`no opcode at ${hex(ORIGIN[b] + off, 4)}`);
  const [mn, mode, cyc] = def;
  const size = SIZE[mode];
  const operand = size === 1 ? 0 : size === 2 ? byteAt(key + 1) : byteAt(key + 1) | (byteAt(key + 2) << 8);
  instrs.set(key, { op, mn, mode, cyc, size, operand, executed });
}

// --- labels and comments from the listing (its addresses are file offsets) ---
const labels = new Map(), comments = new Map(), notes = new Map(), sources = new Map();
let pendingNotes = [];
for (const line of listing) {
  const m = /^\s*\d+\s+([0-9a-f]{4})\s(.*)$/i.exec(line);
  if (!m) continue;
  const key = parseInt(m[1], 16);
  const src = m[2].replace(/^\s*(?:[0-9a-f]{2}[ \t]+)+/i, '').trim(); // (drop the listed bytes)
  const semi = src.indexOf(';');
  const code = (semi >= 0 ? src.slice(0, semi) : src).trim();
  const comment = semi >= 0 ? src.slice(semi + 1).replace(/\s+/g, ' ').trim() : '';
  if (code.includes('=')) { pendingNotes = []; continue; } // an equate (the RAM and register names)
  const lab = /^([A-Za-z_][\w.]*):?(?:\s|$)/.exec(code);
  if (lab && !OPC_NAMES.has(lab[1].toLowerCase()) && !/^(processor|org|rorg|seg|include|\.byte|\.word)$/i.test(lab[1])) {
    if (!labels.has(key)) labels.set(key, []);
    labels.get(key).push(lab[1] + (comment ? ` -- ${comment}` : ''));
    continue;
  }
  if (!code && comment) { pendingNotes.push(comment); continue; }
  if (instrs.has(key)) {
    if (code && !code.startsWith('.byte')) sources.set(key, code.replace(/\s+/g, ' ')); // the instruction as the listing writes it (with its names)
    // the listing's own comment, without the address and the coverage note
    const text = comment.replace(/^\$[0-9A-F]{4}\s*/, '').replace(/^\(not executed in the coverage run\)\s*/, '');
    if (text) comments.set(key, text);
    if (pendingNotes.length) notes.set(key, pendingNotes);
  }
  pendingNotes = [];
}

// --- data: every byte no instruction occupies ---
const isCode = new Uint8Array(8192);
for (const [key, ins] of instrs) for (let i = 0; i < ins.size; i += 1) isCode[key + i] = 1;
// bytes the cartridge also reads as data (the coverage runs saw them read) stay in the data image
for (const b of [0, 1]) for (const off of codeList.data[b]) isCode[(b << 12) | off] = 0;
const spans = [];
for (let i = 0; i < 8192;) {
  if (isCode[i]) { i += 1; continue; }
  let j = i;
  while (j < 8192 && !isCode[j] && (j & 0xfff || j === i)) j += 1; // spans don't cross banks
  spans.push([i, rom.subarray(i, j)]);
  i = j;
}

// --- code ---
const writesHardware = (ins) => {
  if (!['sta', 'stx', 'sty', 'inc', 'dec', 'asl', 'lsr', 'rol', 'ror'].includes(ins.mn) || ins.mode === 'acc') return false;
  if (ins.mode === 'zp') return ins.operand < 0x80;
  if (ins.mode === 'abs') return !(ins.operand >= 0x80 && ins.operand < 0x100);
  return true;
};
const ea = (ins, read) => {
  const o = ins.operand;
  switch (ins.mode) {
    case 'zp': return $(o);
    case 'abs': return $(o, 4);
    case 'zpx': return `(${$(o)} + c.x) & 0xff`;
    case 'zpy': return `(${$(o)} + c.y) & 0xff`;
    case 'absx': return read ? `c.indexed(${$(o, 4)}, c.x)` : `(${$(o, 4)} + c.x) & 0xffff`;
    case 'absy': return read ? `c.indexed(${$(o, 4)}, c.y)` : `(${$(o, 4)} + c.y) & 0xffff`;
    case 'indx': return `c.indirectX(${$(o)})`;
    case 'indy': return `c.indirectY(${$(o)}, ${read})`;
    default: throw new Error(ins.mode);
  }
};
const value = (ins) => (ins.mode === 'imm' ? $(ins.operand) : `c.read(${ea(ins, true)})`);
const FLAG = { bpl: '!(c.p & 0x80)', bmi: '(c.p & 0x80)', bvc: '!(c.p & 0x40)', bvs: '(c.p & 0x40)', bcc: '!(c.p & 0x01)', bcs: '(c.p & 0x01)', bne: '!(c.p & 0x02)', beq: '(c.p & 0x02)' };
const SIMPLE = {
  inx: 'c.x = c.setNZ((c.x + 1) & 0xff);', dex: 'c.x = c.setNZ((c.x - 1) & 0xff);', iny: 'c.y = c.setNZ((c.y + 1) & 0xff);', dey: 'c.y = c.setNZ((c.y - 1) & 0xff);',
  tax: 'c.x = c.setNZ(c.a);', txa: 'c.a = c.setNZ(c.x);', tay: 'c.y = c.setNZ(c.a);', tya: 'c.a = c.setNZ(c.y);', tsx: 'c.x = c.setNZ(c.s);', txs: 'c.s = c.x;',
  pha: 'c.push(c.a);', pla: 'c.a = c.setNZ(c.pull());', php: 'c.push(c.p | 0x30);', plp: 'c.p = (c.pull() & ~0x10) | 0x20;',
  clc: 'c.p &= ~0x01;', sec: 'c.p |= 0x01;', cli: 'c.p &= ~0x04;', sei: 'c.p |= 0x04;', clv: 'c.p &= ~0x40;', cld: 'c.p &= ~0x08;', sed: 'c.p |= 0x08;', nop: '',
};
const at = (off) => `hi | ${$(off & 0xfff, 3)}`; // a real address with the CPU's current high nibble
const body = (key, ins) => {
  const off = key & 0xfff, next = off + ins.size;
  const { mn, mode } = ins;
  if (SIMPLE[mn] !== undefined) return SIMPLE[mn];
  switch (mn) {
    case 'lda': return `c.a = c.setNZ(${value(ins)});`;
    case 'ldx': return `c.x = c.setNZ(${value(ins)});`;
    case 'ldy': return `c.y = c.setNZ(${value(ins)});`;
    case 'sta': return `c.write(${ea(ins, false)}, c.a);`;
    case 'stx': return `c.write(${ea(ins, false)}, c.x);`;
    case 'sty': return `c.write(${ea(ins, false)}, c.y);`;
    case 'adc': return `c.adc(${value(ins)});`;
    case 'sbc': return `c.sbc(${value(ins)});`;
    case 'and': return `c.a = c.setNZ(c.a & ${value(ins)});`;
    case 'ora': return `c.a = c.setNZ(c.a | ${value(ins)});`;
    case 'eor': return `c.a = c.setNZ(c.a ^ ${value(ins)});`;
    case 'cmp': return `c.cmp(c.a, ${value(ins)});`;
    case 'cpx': return `c.cmp(c.x, ${value(ins)});`;
    case 'cpy': return `c.cmp(c.y, ${value(ins)});`;
    case 'bit': return `c.bit(${value(ins)});`;
    case 'asl': case 'lsr': case 'rol': case 'ror':
      return mode === 'acc' ? `c.a = c.${mn}(c.a);` : `c.rmw(${ea(ins, false)}, (v) => c.${mn}(v));`;
    case 'inc': return `c.rmw(${ea(ins, false)}, (v) => c.setNZ((v + 1) & 0xff));`;
    case 'dec': return `c.rmw(${ea(ins, false)}, (v) => c.setNZ((v - 1) & 0xff));`;
    case 'jmp':
      if (mode === 'abs') return `pc = ${$(ins.operand, 4)}; continue;`;
      return `pc = c.read(${$(ins.operand, 4)}) | (c.read(${$((ins.operand & 0xff00) | ((ins.operand + 1) & 0xff), 4)}) << 8); continue;`;
    // JSR: operand low byte, a dummy stack read, the return address pushed,
    // then the target's high byte fetched (the access FE watches after $01FE)
    case 'jsr': return `c.read(0x100 | c.s); { const r = ${at(next - 1)}; c.push(r >> 8); c.push(r & 0xff); } bus.feAccess(${$((ORIGIN[key >> 12] + off + 2) & 0x1fff, 4)}, ${$(ins.operand >> 8)}); pc = ${$(ins.operand, 4)}; continue;`;
    // RTS: a dummy fetch, a dummy stack read, the return address pulled ($01FF last, if the stack was at $FD), a dummy fetch there
    case 'rts': return `bus.feAccess((${at(off + 1)}) & 0x1fff, 0); c.read(0x100 | c.s); pc = c.pull() | (c.pull() << 8); bus.feAccess(pc & 0x1fff, 0); pc = (pc + 1) & 0xffff; continue;`;
    case 'brk': case 'rti': return `throw new Error('${mn} at $' + (${at(off)}).toString(16) + ': the cartridge never executes one');`;
    default:
      if (mode === 'rel') {
        const target = (next + ((ins.operand ^ 0x80) - 0x80)) & 0xfff;
        const extra = (target & 0xf00) !== (next & 0xf00) ? 2 : 1;
        return `if (${FLAG[mn]}) { c.cycles += ${extra}; pc = ${at(target)}; continue; }`;
      }
      throw new Error(`unsupported ${mn} at ${hex(key, 4)}`);
  }
};

const keys = [...instrs.keys()].sort((a, b) => a - b);
const out = [];
out.push(`// GENERATED by tools/recompile.mjs from The Activision Decathlon cartridge and its
// disassembly -- do not edit. Each case is one instruction, keyed by bank and
// offset (bank << 12 | address & $FFF), with the cycles it takes; labels and
// comments are the disassembly's. \`hi\` is the CPU's address high nibble
// ($F000 in bank 0, $D000 in bank 1).
//
// run(c, bus): executes from c.pc until the frame's VSYNC write (or until the
// cycle budget runs out) and leaves c.pc at the next instruction.

export function run(c, bus, maxCycles = 400000) {
  const frame = bus.frame;
  const stop = c.cycles + maxCycles;
  let pc = c.pc, hi;
  for (;;) {
    if (c.cycles > stop) { c.pc = pc; return false; }
    hi = pc & 0xf000;
    switch ((bus.bank << 12) | (pc & 0xfff)) {`);
for (let i = 0; i < keys.length; i += 1) {
  const key = keys[i], ins = instrs.get(key);
  const b = key >> 12, off = key & 0xfff, next = off + ins.size;
  for (const n of notes.get(key) ?? []) out.push(`      // ${n}`);
  for (const name of labels.get(key) ?? []) out.push(`      // ${name}`);
  const src = `${ins.mn} ${ins.mode === 'imp' || ins.mode === 'acc' ? '' : '$' + hex(ins.operand, ins.size === 2 && ins.mode !== 'rel' ? 2 : 4)}`.trim();
  let line = `      case ${$(key, 4)}: c.cycles += ${ins.cyc}; ${body(key, ins)}`;
  if (writesHardware(ins)) line += ` if (bus.frame !== frame) { c.pc = ${at(next)}; return true; }`;
  const ends = ['jmp', 'rts', 'rti', 'brk'].includes(ins.mn);
  if (!ends) {
    // fall through only into the case for the very next instruction of the same bank
    const fall = keys[i + 1] === ((b << 12) | next) && next < 0x1000;
    if (!fall) line += ` pc = ${at(next)}; continue;`;
    if (!instrs.has((b << 12) | next)) line += ` /* next: data */`;
  }
  out.push(`${line} // ${hex(ORIGIN[b] + off, 4)} ${sources.get(key) ?? src}${ins.executed ? '' : ' (traced, not executed)'}${comments.has(key) ? ' ; ' + comments.get(key) : ''}`);
}
out.push(`      default: throw new Error('no instruction at $' + pc.toString(16) + ' in bank ' + bus.bank);
    }
  }
}
`);
writeFileSync('src/decathlonRecomp.mjs', out.join('\n'));

const data = [`// GENERATED by tools/recompile.mjs: The Activision Decathlon cartridge's tables and
// graphics (every byte no instruction occupies), by file offset (bank 0:
// $0000-$0FFF, bank 1: $1000-$1FFF). The code itself is translated in
// decathlonRecomp.mjs; the cartridge image is not included.

export const ROM_DATA = [`];
for (const [at0, bytes] of spans) data.push(`  [${$(at0, 4)}, '${Buffer.from(bytes).toString('hex')}'],`);
data.push(`];

// 8K image with the data in place; code bytes read as 0
export function romImage() {
  const rom = new Uint8Array(8192);
  for (const [at, hexBytes] of ROM_DATA) {
    for (let i = 0; i < hexBytes.length / 2; i += 1) rom[at + i] = parseInt(hexBytes.substr(i * 2, 2), 16);
  }
  return rom;
}
`);
writeFileSync('src/decathlonRomData.mjs', data.join('\n'));
const dataBytes = spans.reduce((n, [, b]) => n + b.length, 0);
console.log(`${instrs.size} instructions, ${labels.size} labelled addresses, ${dataBytes} data bytes in ${spans.length} spans`);
