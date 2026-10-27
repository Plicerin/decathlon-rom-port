// Playable Decathlon for the site: the translated cartridge
// (decathlonMachine.mjs) on a canvas, keyboard input while the game has focus,
// a gamepad (Start = Game Reset, Back = Game Select), on phones a left/right
// pad to rub or tap and a Fire button,
// the TIA sound worklet, and the two console buttons the cartridge reads:
// Game Select and Game Reset (it ignores Color/B&W and the difficulty switches).
// Two versions: Original (the cartridge as it is) and Enhanced (enhanced.mjs:
// quality-of-life options layered on the same translated game).
// Mount with mountPlayer(root); root holds the canvas and the [data-*] controls.
import { DecathlonMachine } from './decathlonMachine.mjs';
import { NTSC_PALETTE_RGB } from './palette.mjs';
import { createTiaAudio } from './tiaAudio.mjs';
import { readGamepad, gamepadEdges } from './gamepad.mjs';
import { ENHANCED_OPTIONS, waiting, longWait, singleEvent, afterFrame, CONTINUE_PIXELS, MESSAGE_INK, RunAssist, Bests } from './enhanced.mjs';

export const FIRST_LINE = 41;    // VBLANK goes off in frame line 41 and back on in line 231
export const VISIBLE_LINES = 190;
const FRAME_MS = 1000 / 60;
const KEYS = {
  ArrowRight: 'right', KeyD: 'right', ArrowLeft: 'left', KeyA: 'left',
  ArrowDown: 'down', KeyS: 'down', ArrowUp: 'up', KeyW: 'up', Space: 'fire', KeyZ: 'fire',
};
// the pad's console buttons: Start presses Game Reset, Back presses Game Select
const PAD = { reset: 'start', select: 'back' };
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { /* fine */ } } };

// the events in order, as the cartridge numbers them ($80 = 0-9)
const EVENTS = [
  ['100 metres', 'Run: move the joystick left and right as fast as you can.'],
  ['Long jump', 'Run, and press the button as close to the scratch line as you dare: the later the take-off, the longer the jump.'],
  ['Shot put', 'Run at full speed and press the button before the scratch line: the speed decides the distance.'],
  ['High jump', 'Run, and press the button a stride before the bar: the window is tiny. A faster run-up clears higher bars.'],
  ['400 metres', 'Run: keep moving the joystick left and right.'],
  ['110 m hurdles', 'Keep running all the way, in the air too, and press the button a stride before each hurdle: a little early is fine, too late hits it.'],
  ['Discus', 'Run at full speed and press the button before the scratch line: the speed decides the distance.'],
  ['Pole vault', 'Once the box is on screen, press the button to lower the pole (it plants itself), keep running, and press again as the pole straightens: don\'t wait to see the top.'],
  ['Javelin', 'Run, and throw as close to the scratch line as you dare: the closer, the longer.'],
  ['1500 metres', 'There is no stamina: keep a steady run, then sprint the final stretch, where speed counts most.'],
];

export function mountPlayer(root) {
  const canvas = root.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const playButton = root.querySelector('[data-play]');
  const poster = root.querySelector('[data-poster]');
  const hint = root.querySelector('[data-hint]');
  const note = root.querySelector('[data-note]');
  const muteButtons = root.querySelectorAll('[data-mute]');
  const pauseButtons = root.querySelectorAll('[data-pause]');
  const volumeSliders = root.querySelectorAll('[data-volume]'); // the tray's and the fullscreen bar's

  const game = new DecathlonMachine();
  const held = new Set();
  // keys down, by key code: two keys for one direction (D and ArrowRight) hold it until both are up
  const keysDown = new Set();
  // a key or button released before the next frame still counts for that frame
  const tapped = new Set();
  const touch = matchMedia('(pointer: coarse)').matches;
  const audio = createTiaAudio(new URL('./tiaSound.worklet.js', import.meta.url).href);
  const screen = document.createElement('canvas');
  screen.width = 160;
  screen.height = VISIBLE_LINES;
  const screenCtx = screen.getContext('2d');
  const image = screenCtx.createImageData(160, VISIBLE_LINES);

  let started = false, paused = false, muted = false;
  const down = { select: false, reset: false };
  let last = 0, acc = 0, pad = null, frames = 0, padShown = false, padWake = false, frameStart = 0;
  // the version: 'original' or 'enhanced', and Enhanced's options
  let version = store.get('decathlon-version') === 'enhanced' ? 'enhanced' : 'original';
  const options = Object.fromEntries(Object.entries(ENHANCED_OPTIONS).map(([k, o]) => [k, o.default]));
  try { Object.assign(options, JSON.parse(store.get('decathlon-enhanced') ?? '{}')); } catch { /* defaults */ }
  const enhanced = (option) => version === 'enhanced' && options[option];
  let lastFire = false, skipping = false;
  const assist = new RunAssist();
  let assistUsed = false; // run assist made pushes since this athlete's last score
  let bests;
  try { bests = new Bests(JSON.parse(store.get('decathlon-bests') ?? 'null')); } catch { bests = new Bests(null); }

  const setHint = (text) => { if (hint && hint.textContent !== text) hint.textContent = text; };
  const name = (what) => {
    if (touch) return what === 'select' ? 'Game Select' : 'Game Reset';
    if (pad) return what === 'select' ? 'Game Select (Back)' : 'Game Reset (Start)';
    return what === 'select' ? 'Game Select (X)' : 'Game Reset (Enter)';
  };
  // the hint follows the event the cartridge is on ($80) once a game is under
  // way ($C5 is nonzero on the title screen and after Game Select, 0 from Game
  // Reset), and with more than one athlete ($82 = athletes - 1) whose turn it is ($83, from 0)
  function eventHint() {
    const ram = game.bus.ram;
    if (ram[0xc5 & 0x7f]) return '';
    const ev = EVENTS[ram[0x80 & 0x7f]];
    if (!ev) return '';
    const solo = enhanced('soloEvents') && singleEvent(ram);
    const who = ram[0x82 & 0x7f] && !solo ? `Player ${ram[0x83 & 0x7f] + 1}, ` : '';
    return `${who}${ev[0]}: ${ev[1]}`;
  }
  function showNote() {
    if (!note) return;
    const text = paused ? 'PAUSED' : started && !touch && !pad && document.activeElement !== canvas ? 'Click the screen to use the keyboard' : '';
    note.textContent = text;
    note.hidden = !text;
    placeNote();
  }
  // keep the note in the part of the picture that is on screen
  function placeNote() {
    if (!note || note.hidden) return;
    const box = canvas.getBoundingClientRect();
    const top = Math.min(Math.max(10, 10 - box.top), box.height - note.offsetHeight - 10);
    note.style.top = `${Math.max(10, top)}px`;
  }
  addEventListener('scroll', placeNote, { passive: true });
  addEventListener('resize', placeNote);
  const silence = () => audio.setSilent(muted || paused || !started);

  // one frame; quiet: a fast-forwarded frame (neutral controls, its sound
  // writes collected into audioCarry instead of played)
  let audioCarry = null;
  function step(quiet = false) {
    const on = (control) => !quiet && (held.has(control) || [...keysDown].some((code) => KEYS[code] === control) || tapped.has(control) || !!down[control] || !!(PAD[control] ? !padWake && pad?.[PAD[control]] : pad?.[control]));
    let swcha = 0xff;
    // a joystick can't push left and right at once: both together count as
    // neither (the game counts every push from neutral as a stride, so holding
    // one and tapping the other would otherwise double the running rate)
    let left = on('left'), right = on('right');
    // Enhanced run assist: one direction held makes the pushes at the chosen rate
    const rate = version === 'enhanced' ? Number(options.runAssist) || 0 : 0;
    if (rate && left !== right) { const dir = assist.next(rate); left = dir === 'left'; right = dir === 'right'; assistUsed = true; }
    if (right && !left) swcha &= ~0x80;
    if (left && !right) swcha &= ~0x40;
    if (on('down')) swcha &= ~0x20;
    if (on('up')) swcha &= ~0x10;
    game.bus.swcha = swcha;
    game.bus.inpt4 = on('fire') ? 0x00 : 0x80;
    // SWCHB: bit 0 Game Reset, bit 1 Game Select (low = pressed); Color, both difficulties B
    game.bus.swchb = 0x08 | (on('reset') ? 0 : 0x01) | (on('select') ? 0 : 0x02);
    const fire = on('fire');
    game.runFrame();
    if (version === 'enhanced') {
      afterFrame(game.bus.ram, options);
      if (options.bests) {
        const beaten = bests.update(game.bus.ram, assistUsed);
        if (bests.lastWait === 0xbf) assistUsed = false; // scored: the next athlete or event starts clean
        if (beaten) { store.set('decathlon-bests', JSON.stringify(bests)); showBests(beaten); }
      }
    }
    // Enhanced: a press of the button during a wait fast-forwards it
    if (!quiet && fire && !lastFire && enhanced('skipWaits') && longWait(game.bus.ram)) skipping = true;
    if (!quiet) lastFire = fire;
    tapped.clear();
    // the frame's sound register writes ($15-$1A) with their cycles, and the frame's length
    const bus = game.bus;
    const writes = bus.lastFrameWrites.filter((w) => w.reg >= 0x15 && w.reg <= 0x1a).map((w) => [w.reg, w.value, w.cycle]);
    if (quiet) {
      // keep only each register's last value, played when the fast-forward ends
      audioCarry ??= new Map();
      for (const [reg, value] of writes) audioCarry.set(reg, value);
    } else {
      if (audioCarry) { writes.unshift(...[...audioCarry].map(([reg, value]) => [reg, value, 0])); audioCarry = null; }
      audio.frame(writes, bus.frameStart - frameStart || 262 * 76);
    }
    frameStart = bus.frameStart;
    frames += 1;
    if (started && frames % 30 === 0) setHint(eventHint() || startHint());
  }
  const startHint = () => `Press ${name('select')} to pick a game, then ${name('reset')} to start.`;

  function draw() {
    const rows = game.bus.tia.lastFrame;
    if (!rows) return;
    const data = image.data;
    for (let y = 0; y < VISIBLE_LINES; y += 1) {
      const row = rows[FIRST_LINE + y];
      for (let x = 0; x < 160; x += 1) {
        const rgb = NTSC_PALETTE_RGB[(row[x] >> 1) & 0x7f];
        const o = (y * 160 + x) * 4;
        data[o] = rgb >> 16; data[o + 1] = (rgb >> 8) & 0xff; data[o + 2] = rgb & 0xff; data[o + 3] = 255;
      }
    }
    // Enhanced: during a skippable wait, PRESS TO CONTINUE in the game's text row
    if (enhanced('skipWaits') && !skipping && longWait(game.bus.ram)) {
      const rgb = NTSC_PALETTE_RGB[(MESSAGE_INK >> 1) & 0x7f];
      for (const [x, y] of CONTINUE_PIXELS) {
        const o = ((y - FIRST_LINE) * 160 + x) * 4;
        data[o] = rgb >> 16; data[o + 1] = (rgb >> 8) & 0xff; data[o + 2] = rgb & 0xff;
      }
    }
    screenCtx.putImageData(image, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(screen, 0, 0, canvas.width, canvas.height);
  }

  function frame(t) {
    if (!last) last = t;
    const dt = Math.min(100, t - last);
    last = t;
    pad = readGamepad();
    const edges = gamepadEdges(pad);
    // the Start or Back press that powers on doesn't also press Game Reset or Game Select
    if ((edges.start || edges.back) && !started) { play(); padWake = true; }
    if (padWake && !pad?.start && !pad?.back) padWake = false;
    // the hint names the pad's buttons or the keys, so it changes even while paused
    if (!!pad !== padShown) { padShown = !!pad; showNote(); if (started) setHint(eventHint() || startHint()); }
    if (!paused && !document.hidden) {
      acc += dt;
      while (acc >= FRAME_MS) { step(); acc -= FRAME_MS; }
      // Enhanced skip: run the wait's frames, as fast as about 10 ms a display frame allows
      if (skipping) {
        const until = performance.now() + 10;
        while (waiting(game.bus.ram) && performance.now() < until) step(true);
        if (!waiting(game.bus.ram)) { skipping = false; setHint(eventHint() || startHint()); }
      }
    }
    draw();
    requestAnimationFrame(frame);
  }

  async function play() {
    started = true;
    if (poster) poster.hidden = true;
    canvas.focus({ preventScroll: true });
    setHint(startHint());
    showNote();
    await audio.start();
    silence();
  }

  function togglePause() {
    paused = !paused;
    pauseButtons.forEach((b) => { b.textContent = paused ? 'Resume' : 'Pause'; });
    showNote();
    silence();
  }

  function toggleMute() {
    muted = !muted;
    muteButtons.forEach((b) => {
      b.textContent = muted ? 'Sound on' : 'Mute';
      b.setAttribute('aria-pressed', String(muted));
    });
    silence();
  }

  // the console buttons
  root.querySelectorAll('[data-press]').forEach((button) => {
    const control = button.dataset.press;
    const press = (event) => { event.preventDefault(); if (!started) play(); down[control] = true; tapped.add(control); try { button.setPointerCapture(event.pointerId); } catch { /* fine */ } };
    const release = () => { down[control] = false; };
    button.addEventListener('pointerdown', press);
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(ev, release);
  });

  function setVolume(v) {
    audio.setVolume(v / 100);
    volumeSliders.forEach((s) => { s.value = String(v); });
    store.set('decathlon-volume', String(v));
  }
  setVolume(Number(store.get('decathlon-volume') ?? 70));
  volumeSliders.forEach((s) => {
    s.addEventListener('input', () => setVolume(Number(s.value)));
    // after a drag or click with the mouse; the keyboard keeps the slider for its arrows
    s.addEventListener('pointerup', () => refocus());
  });

  playButton?.addEventListener('click', play);
  // the tray controls hand the keys back to the game, or Space would press them again
  const refocus = () => { if (started) canvas.focus({ preventScroll: true }); };
  pauseButtons.forEach((b) => b.addEventListener('click', () => { if (started) togglePause(); refocus(); }));
  muteButtons.forEach((b) => b.addEventListener('click', () => { toggleMute(); refocus(); }));

  canvas.addEventListener('keydown', (event) => {
    const control = KEYS[event.code];
    if (control) { event.preventDefault(); keysDown.add(event.code); tapped.add(control); }
    if (event.code === 'Enter') { event.preventDefault(); if (!started) play(); down.reset = true; tapped.add('reset'); }
    if (event.code === 'KeyX') { down.select = true; tapped.add('select'); }
    if (event.code === 'KeyP') togglePause();
    if (event.code === 'KeyM') toggleMute();
  });
  canvas.addEventListener('keyup', (event) => {
    const control = KEYS[event.code];
    if (control) keysDown.delete(event.code);
    if (event.code === 'Enter') down.reset = false;
    if (event.code === 'KeyX') down.select = false;
  });
  canvas.addEventListener('blur', () => { held.clear(); keysDown.clear(); down.select = down.reset = false; showNote(); });
  canvas.addEventListener('focus', showNote);
  canvas.addEventListener('pointerdown', () => { if (!started) play(); });

  // touch controls: hold to press
  root.querySelectorAll('[data-hold]').forEach((button) => {
    const control = button.dataset.hold;
    const press = (event) => {
      event.preventDefault();
      held.add(control);
      tapped.add(control);
      if (!started) play();
      try { button.setPointerCapture(event.pointerId); } catch { /* finger already lifted: the press still counts */ }
    };
    const up = () => held.delete(control);
    button.addEventListener('pointerdown', press);
    button.addEventListener('pointerup', up);
    button.addEventListener('pointercancel', up);
    button.addEventListener('lostpointercapture', up);
  });

  // the touch joystick: one pad, the half under each finger pressed. The game
  // reads only left, right and the button (up and down only wake it from its
  // attract mode), and counts strides from changes between left and right,
  // so a thumb rubbed across the pad runs like a waggled joystick
  const rocker = root.querySelector('[data-rocker]');
  if (rocker) {
    const fingers = new Map(); // pointerId -> 'left' | 'right'
    const halves = { left: rocker.querySelector('[data-side="left"]'), right: rocker.querySelector('[data-side="right"]') };
    const sideOf = (event) => { const box = rocker.getBoundingClientRect(); return event.clientX < box.left + box.width / 2 ? 'left' : 'right'; };
    const show = () => {
      for (const side of ['left', 'right']) {
        const on = [...fingers.values()].includes(side);
        if (on && !held.has(side)) tapped.add(side);
        if (on) held.add(side); else held.delete(side);
        halves[side]?.classList.toggle('on', on);
      }
    };
    rocker.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      if (!started) play();
      try { rocker.setPointerCapture(event.pointerId); } catch { /* finger already lifted: the press still counts */ }
      fingers.set(event.pointerId, sideOf(event));
      show();
    });
    rocker.addEventListener('pointermove', (event) => {
      if (!fingers.has(event.pointerId)) return;
      fingers.set(event.pointerId, sideOf(event));
      show();
    });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) rocker.addEventListener(ev, (event) => { fingers.delete(event.pointerId); show(); });
  }

  // the version switch (Original / Enhanced) and Enhanced's options, remembered in this browser
  const versionButtons = root.querySelectorAll('[data-version]');
  const optionsPanel = root.querySelector('[data-options]');
  const showVersion = () => {
    versionButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.version === version)));
    if (optionsPanel) optionsPanel.hidden = version !== 'enhanced';
    root.dataset.mode = version;
  };
  versionButtons.forEach((b) => b.addEventListener('click', () => {
    version = b.dataset.version;
    store.set('decathlon-version', version);
    if (version !== 'enhanced') skipping = false;
    showVersion();
    if (started) setHint(eventHint() || startHint());
    refocus();
  }));
  root.querySelectorAll('[data-option]').forEach((box) => {
    const key = box.dataset.option;
    const isCheck = box.type === 'checkbox';
    if (isCheck) box.checked = !!options[key]; else box.value = String(options[key]);
    box.addEventListener('change', () => {
      options[key] = isCheck ? box.checked : Number(box.value);
      if (key === 'bests') showBests();
      store.set('decathlon-enhanced', JSON.stringify(options));
      if (key === 'skipWaits' && !box.checked) skipping = false;
      refocus();
    });
  });
  showVersion();

  // the personal bests panel: points per event and the decathlon total, yours and with run assist
  const bestsPanel = root.querySelector('[data-bests]');
  function showBests(beaten = null) {
    if (!bestsPanel) return;
    bestsPanel.hidden = !(version === 'enhanced' && options.bests);
    const cell = (n, isNew) => `<td${isNew ? ' class="new"' : ''}>${n ? n.toLocaleString('en-US') : '–'}</td>`;
    const row = (name, i) => {
      const fresh = (assisted) => beaten && beaten.assisted === assisted && (i === 'total' ? beaten.total : beaten.event === i);
      const pick = (t) => (i === 'total' ? t.total : t.events[i]);
      return `<tr><th>${name}</th>${cell(pick(bests.own), fresh(false))}${cell(pick(bests.assisted), fresh(true))}</tr>`;
    };
    bestsPanel.querySelector('tbody').innerHTML = EVENTS.map(([name], i) => row(name, i)).join('') + row('Decathlon total', 'total');
  }
  bestsPanel?.querySelector('[data-clear-bests]')?.addEventListener('click', () => {
    if (!confirm('Clear your personal bests in this browser?')) return;
    bests.clear();
    store.set('decathlon-bests', JSON.stringify(bests));
    showBests();
  });
  versionButtons.forEach((b) => b.addEventListener('click', () => showBests()));
  showBests();

  document.addEventListener('visibilitychange', () => (document.hidden ? audio.suspend() : audio.resume()));

  step();
  draw();
  requestAnimationFrame(frame);

  // dev hook for headless checks: runs frames without the animation loop
  return {
    machine: game,
    step(n = 1) { for (let i = 0; i < n; i += 1) step(); draw(); },
    hold(control, on) { if (on) held.add(control); else held.delete(control); },
    press(control, on) { down[control] = on; },
    // Enhanced's fast-forward without the animation loop
    skip() { while (skipping && waiting(game.bus.ram)) step(true); skipping = false; setHint(eventHint() || startHint()); },
    get skipping() { return skipping; },
    play,
  };
}
