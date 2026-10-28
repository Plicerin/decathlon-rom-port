// Decathlon Enhanced: quality-of-life additions layered on the verified
// translation. The cartridge's code is not changed; Enhanced only reads its
// RAM, runs its frames faster, or adjusts one RAM byte at a moment the game
// itself is about to decide something. With Enhanced off the player does none
// of this and the game is the original.
//
// The game's waits are one countdown, $F3: after an event's result (about
// 13.7 s) and between field attempts (about 4 s). Every 4th frame it ticks
// down, and on the way it fires milestones: at $C0 the event's points join the
// athlete's total, at $40 the next athlete or event is chosen ($F660-$F6F7).
// So a wait is skipped by running its frames, never by clearing the counter.

const EVENT = 0x80 & 0x7f;     // the event, 0-9
const WAIT = 0xf3 & 0x7f;      // the countdown
const ATHLETES = 0x82 & 0x7f;  // athletes - 1 in a decathlon; 4 in a single event (four athletes)
const ATHLETE = 0x83 & 0x7f;   // whose turn it is, from 0
const POINTS = 0x95 & 0x7f;    // the event's points, BCD, high byte then low ($95, $96)
const TOTALS = 0x97 & 0x7f;    // running totals, BCD, two bytes per athlete (high, low) from $97

export const ENHANCED_OPTIONS = {
  skipWaits: { label: 'Skip the waits: press the button to move on', default: true },
  soloEvents: { label: 'Single events for one athlete', default: true },
  // pushes a second while a direction is held (0: off). The game's speed comes
  // in steps: 12 a second runs the 100 m in about 11.3 s, 16 in 10.2, 20 in 10.1
  runAssist: { label: 'Run assist', default: 0 },
  bests: { label: 'Keep personal bests', default: true },
  stadium: { label: 'Stadium sound: starting gun and crowd', default: true },
};

// Run assist: holding one direction (key, half of the touch pad, stick) makes
// the pushes at a steady rate, as alternating left and right by hand would.
// The game counts a stride for each change of direction (tools/annotations:
// $86), so the athlete runs exactly as a player waggling at that rate.
export class RunAssist {
  constructor() { this.phase = 0; this.right = true; }
  // rate: pushes a second; returns 'left' or 'right' for this frame
  next(rate) {
    this.phase += rate / 60;
    if (this.phase >= 1) { this.phase -= 1; this.right = !this.right; }
    return this.right ? 'right' : 'left';
  }
}

// The stadium: when the starting gun fires and how loud the crowd is, from
// the game's RAM each frame. In a race the distance run is $E4:$E5, which
// reaches the same value at the line whatever the speed (measured): 258 in
// the 100 m, 1026 in the 400 m, 281 in the hurdles, 5378 in the 1500 m. Each
// athlete's race opens when the opening countdown ($F3, from $0F) reaches 0
// (the clock then starts with the first push): the gun. The finish is where
// the result countdown starts ($F3 above $0F): the roar.
const DISTANCE = 0xe4 & 0x7f;
const RACE_LENGTH = { 0: 258, 4: 1026, 5: 281, 9: 5378 };
// Field events: an attempt ends where the countdown starts (above $0F). Its
// result is $8F-$91, six BCD digits in thousandths of a metre (8.66 m is
// 00 86 60), and $F4 says how it went: $00 a mark (or the bar cleared), $44
// SCRATCH or a foul, $51 MISSED (the bar down; the game itself tests $51 at
// $F70D). A javelin landing behind the line is 0.00 with $00: no mark either.
// The cheer grows with the mark against a strong one for the event (squared,
// so a weak mark gets polite applause and a great one the full roar).
const RESULT = 0x8f & 0x7f, MESSAGE = 0xf4 & 0x7f;
const FIELD_MARK = { 1: 8, 2: 18, 3: 2.2, 6: 55, 7: 5, 8: 80 };
const resultMetres = (ram) => Number([0, 1, 2].map((i) => ram[RESULT + i].toString(16).padStart(2, '0')).join('')) / 1000;
const TITLE = 0xc5 & 0x7f;     // nonzero on the title screen: no game under way
export class Stadium {
  constructor() { this.lastWait = 0; this.roar = 0; this.runUp = 0; }
  // after every frame: { gun: fire it now, groan: a groan now, crowd: 0-1 }
  update(ram) {
    const wait = ram[WAIT], event = ram[EVENT], length = RACE_LENGTH[event], mark = FIELD_MARK[event];
    const distance = ram[DISTANCE] * 256 + ram[DISTANCE + 1];
    const gun = !!length && this.lastWait === 1 && wait === 0 && distance === 0;
    const ended = wait > 0x0f && this.lastWait <= 0x0f; // a finish, or a field attempt's end
    if (length && ended && distance >= length * 0.95) this.roar = 1;
    let groan = false;
    if (mark && ended) {
      const metres = resultMetres(ram);
      if (ram[MESSAGE] !== 0 || metres === 0) groan = true;
      else this.roar = Math.max(this.roar, 0.3 + 0.7 * Math.min(1, metres / mark) ** 2);
    }
    // a field event's run-up: the crowd leans in over about four seconds
    this.runUp = mark && wait === 0 && !ram[TITLE] ? Math.min(1, this.runUp + 1 / 240) : 0;
    this.lastWait = wait;
    this.roar *= 0.993; // about 1.6 s to halve
    let crowd;
    if (ram[TITLE]) crowd = 0;
    else if (!length) crowd = 0.1 + 0.25 * this.runUp;   // field events: a murmur that builds with the run-up
    else if (wait > 0x0f || distance === 0) crowd = 0.14; // before the start, and the result
    else {
      const p = Math.min(1, distance / length);           // the race: builds, then surges to the line
      crowd = Math.min(1, 0.22 + 0.4 * p + Math.max(0, p - 0.75) * 1.6);
    }
    return { gun, groan, crowd: groan ? 0.08 : Math.max(crowd, this.roar) };
  }
}

// Personal bests: the game's own points for each event (they rise with every
// better time, distance or height) and the best decathlon total, kept in this
// browser; runs with run assist are kept apart. Points are read on the frame
// the countdown passes $C0: the milestone where the game adds the event's
// points to the athlete's total, once per athlete per event (between-attempt
// waits start below it).
const bcd = (hi, lo) => [hi >> 4, hi & 15, lo >> 4, lo & 15].reduce((n, d) => n * 10 + d, 0);
export class Bests {
  constructor(saved) {
    const empty = () => ({ events: Array(10).fill(0), total: 0 });
    this.own = { ...empty(), ...(saved?.own ?? {}) };
    this.assisted = { ...empty(), ...(saved?.assisted ?? {}) };
    this.lastWait = 0;
  }
  // after every frame; returns what was beaten this frame (or null)
  update(ram, assisted) {
    const scored = this.lastWait === 0xc0 && ram[WAIT] === 0xbf;
    this.lastWait = ram[WAIT];
    if (!scored) return null;
    const event = ram[EVENT], athlete = ram[ATHLETE] & 3;
    const points = bcd(ram[POINTS], ram[POINTS + 1]);
    const total = bcd(ram[TOTALS + 2 * athlete], ram[TOTALS + 2 * athlete + 1]);
    const table = assisted ? this.assisted : this.own;
    const beaten = {};
    if (points > table.events[event]) { table.events[event] = points; beaten.event = event; }
    // the last event of a decathlon: the athlete's final total
    if (!singleEvent(ram) && event === 9 && total > table.total) { table.total = total; beaten.total = true; }
    return Object.keys(beaten).length ? { ...beaten, assisted } : null;
  }
  clear() { this.own = { events: Array(10).fill(0), total: 0 }; this.assisted = { events: Array(10).fill(0), total: 0 }; }
  toJSON() { return { own: this.own, assisted: this.assisted }; }
}

export const waiting = (ram) => ram[WAIT] !== 0;
// a wait worth skipping: each event's opening second also counts down, from $0F
export const longWait = (ram) => ram[WAIT] > 0x0f;
export const singleEvent = (ram) => ram[ATHLETES] === 4;

// The in-game message for a skippable wait, "PRESS FIRE", in the cartridge's
// own lettering: the game has no font, only ready-drawn words, so these
// letters are cut from its words (tools/text-images.mjs). None of its words
// has an F, so F is its E without the bottom bar. It goes in the text row
// (frame lines 207-214), right of the result, in the row's colour ($0C).
const LETTERS = {
  E: ['###', '###', '#..', '##.', '##.', '#..', '###', '###'], // from DECATHLON
  F: ['###', '###', '#..', '##.', '##.', '#..', '#..', '#..'], // the E above without its bottom bar
  P: ['##.', '###', '#.#', '#.#', '###', '##.', '#..', '#..'], // from LONG JUMP
  S: ['###', '###', '#..', '###', '###', '..#', '###', '###'], // from SHOT PUT
  I: ['###', '###', '.#.', '.#.', '.#.', '.#.', '###', '###'], // from DISCUS
  R: ['###.', '####', '#..#', '#..#', '####', '###.', '#.##', '#..#'], // from SCRATCH
};
export const MESSAGE_INK = 0x0c;
export const MESSAGE_TOP = 207;
// letters one pixel apart, words four (as in the cartridge's LONG JUMP); right edge at x 152
function layout(text, right) {
  const words = text.split(' ').map((w) => w.split('').map((ch) => LETTERS[ch]));
  const width = (w) => w.reduce((n, g) => n + g[0].length, 0) + w.length - 1;
  let x = right - (words.reduce((n, w) => n + width(w), 0) + 4 * (words.length - 1));
  const pixels = [];
  for (const w of words) {
    for (const g of w) {
      g.forEach((row, y) => [...row].forEach((c, dx) => { if (c === '#') pixels.push([x + dx, MESSAGE_TOP + y]); }));
      x += g[0].length + 1;
    }
    x += 3;
  }
  return pixels;
}
export const CONTINUE_PIXELS = layout('PRESS FIRE', 152);

// after every frame (played or fast-forwarded). Solo single events: a single
// event is a four-athlete game; just before the $40 milestone of athlete 1's
// last wait, mark athlete 1 as athlete 4, so the milestone's "next athlete"
// finds none left and ends the event, as it does after athlete 4.
export function afterFrame(ram, options) {
  if (options.soloEvents && singleEvent(ram) && ram[ATHLETE] === 0 && ram[WAIT] === 0x40) ram[ATHLETE] = 3;
}
