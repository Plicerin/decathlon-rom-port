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
import { ENHANCED_OPTIONS, waiting, longWait, singleEvent, afterFrame, CONTINUE_PIXELS, MESSAGE_INK, RunAssist, Bests, cleanInitials, Stadium, SPEED, SideBySide, isRace } from './enhanced.mjs';
import { createStadiumAudio } from './stadiumAudio.mjs';
import { createView3D } from './view3d.mjs';

export const FIRST_LINE = 41;    // VBLANK goes off in frame line 41 and back on in line 231
export const VISIBLE_LINES = 190;
const FRAME_MS = 1000 / 60;
const PROMPT_ROWS = CONTINUE_PIXELS.map(([x, y]) => [x, y - FIRST_LINE]); // PRESS FIRE in the picture's rows, for the 3D view
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
  const canvas = root.querySelector('canvas:not([data-view3d])');
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
  const stadiumAudio = createStadiumAudio(); // Enhanced: the starting gun and the crowd
  const stadium = new Stadium();
  const screen = document.createElement('canvas');
  screen.width = 160;
  screen.height = VISIBLE_LINES;
  const screenCtx = screen.getContext('2d');
  const image = screenCtx.createImageData(160, VISIBLE_LINES);
  // Enhanced's 3D view draws on its own canvas over this one (which keeps the keyboard focus)
  const glCanvas = root.querySelector('[data-view3d]');
  let view3d = null, view3dTried = false;
  const view3dNote = root.querySelector('[data-view3d-note]'); // "not available in this browser"
  // a lost WebGL context (the GPU reset, too many contexts): back to the flat
  // picture until the browser restores it, then build the view again
  glCanvas?.addEventListener('webglcontextlost', (event) => { event.preventDefault(); view3d = null; });
  glCanvas?.addEventListener('webglcontextrestored', () => { view3dTried = false; });
  const sideBySide = new SideBySide(); // the 3D view's athletes who have run, in their lanes

  let started = false, paused = false, muted = false;
  const down = { select: false, reset: false };
  let last = 0, acc = 0, pad = null, frames = 0, padShown = false, padWake = false, frameStart = 0;
  // the version: 'original' or 'enhanced', and Enhanced's options
  let version = store.get('decathlon-version') === 'enhanced' ? 'enhanced' : 'original';
  const options = Object.fromEntries(Object.entries(ENHANCED_OPTIONS).map(([k, o]) => [k, o.default]));
  // saved options: only the known ones, each of its default's type (the sliders and list then bring them within their limits)
  try {
    const saved = JSON.parse(store.get('decathlon-enhanced') ?? '{}');
    for (const key of Object.keys(options)) {
      const v = saved?.[key];
      if (typeof options[key] === 'boolean' ? typeof v === 'boolean' : Number.isFinite(v)) options[key] = v;
    }
  } catch { /* defaults */ }
  const enhanced = (option) => version === 'enhanced' && options[option];
  let lastFire = false, skipping = false;
  // frames a skippable wait has been on screen: the button skips it only after
  // SKIP_AFTER of them, so a late press (just over the line, just after a foul)
  // doesn't skip the very result or message it caused
  let waitShown = 0;
  const SKIP_AFTER = 60;
  const assist = new RunAssist();
  let assistUsed = false; // run assist made pushes in this athlete's turn at this event
  const assistedAthletes = new Set(); // athletes with an assisted event in this game: their totals are assisted too
  let lastTurn = '', scoreWait = 0;
  // Enhanced best scores: each athlete's initials, asked for as a game starts
  // (the game waits meanwhile) and remembered for the next one
  let initials = ['', '', '', ''];
  try { const saved = JSON.parse(store.get('decathlon-initials') ?? '[]'); initials = initials.map((_, i) => cleanInitials(saved?.[i])); } catch { /* none yet */ }
  let asking = false, wasTitle = true;
  let bests;
  const savedBests = () => { try { return JSON.parse(store.get('decathlon-bests') ?? 'null'); } catch { return null; } };
  bests = new Bests(savedBests());
  // saved with what another tab may have saved since, so neither loses the other's records
  const saveBests = () => { bests.merge(savedBests()); store.set('decathlon-bests', JSON.stringify(bests)); };

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
    const assisted = version === 'enhanced' && Number(options.runAssist) ? ` (Run assist on: hold ← or →.)` : '';
    return `${who}${ev[0]}: ${ev[1]}${assisted}`;
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
  const silence = () => { const off = muted || paused || asking || !started; audio.setSilent(off); stadiumAudio.setSilent(off); };

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
    if (rate && left !== right) {
      const dir = assist.next(rate); left = dir === 'left'; right = dir === 'right';
      // it counts only while an athlete is under way (not on the title or in a wait)
      if (!waiting(game.bus.ram) && !game.bus.ram[0xc5 & 0x7f]) assistUsed = true;
    }
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
    // the stadium follows the game every frame; it is heard only in Enhanced with the option on
    const crowd = stadium.update(game.bus.ram);
    const loud = enhanced('stadium');
    stadiumAudio.crowd(loud ? crowd.crowd : 0);
    if (loud && crowd.gun && !quiet) stadiumAudio.gun();
    if (loud && crowd.groan && !quiet) stadiumAudio.groan();
    // the 3D view records each athlete's race (it needs the TIA's object layer, on while the view is)
    if (enhanced('view3d') && game.bus.tia.lastObjects) sideBySide.update(game.bus.ram, game.bus.tia.lastFrame, game.bus.tia.lastObjects, NTSC_PALETTE_RGB);
    const ram = game.bus.ram;
    // run assist, followed whatever the options: an athlete's score (the $C0
    // milestone) with assist marks his decathlon total as assisted; a new game clears that
    const scored = scoreWait === 0xc0 && ram[0xf3 & 0x7f] === 0xbf;
    scoreWait = ram[0xf3 & 0x7f];
    if (scored && assistUsed) assistedAthletes.add(ram[0x83 & 0x7f] & 3);
    if (ram[0xc5 & 0x7f]) assistedAthletes.clear();
    if (version === 'enhanced') {
      afterFrame(ram, options);
      if (options.bests) {
        const beaten = bests.update(ram, assistUsed, assistedAthletes.has(ram[0x83 & 0x7f] & 3), initials);
        if (beaten) { saveBests(); showBests(beaten); }
      }
    }
    // a game starting (Game Reset from the title): the athletes' initials first
    const title = !!ram[0xc5 & 0x7f];
    if (wasTitle && !title && enhanced('bests')) askInitials(singleEvent(ram) ? (options.soloEvents ? 1 : 4) : (ram[0x82 & 0x7f] & 3) + 1);
    wasTitle = title;
    // each athlete's turn at an event (and the title) starts with assist unused
    const turn = `${ram[0x80 & 0x7f]}:${ram[0x83 & 0x7f]}:${ram[0xc5 & 0x7f] ? 'title' : ''}`;
    if (turn !== lastTurn) { lastTurn = turn; assistUsed = false; }
    // Enhanced: a fresh press of the button, once a wait has shown for a second, fast-forwards it
    waitShown = longWait(ram) ? waitShown + 1 : 0;
    if (!quiet && fire && !lastFire && enhanced('skipWaits') && waitShown >= SKIP_AFTER) skipping = true;
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
    // Enhanced: once a wait can be skipped, PRESS FIRE in the game's text row
    const prompt = enhanced('skipWaits') && !skipping && waitShown >= SKIP_AFTER;
    if (prompt) {
      const rgb = NTSC_PALETTE_RGB[(MESSAGE_INK >> 1) & 0x7f];
      for (const [x, y] of CONTINUE_PIXELS) {
        const o = ((y - FIRST_LINE) * 160 + x) * 4;
        data[o] = rgb >> 16; data[o + 1] = (rgb >> 8) & 0xff; data[o + 2] = rgb & 0xff;
      }
    }
    // Enhanced 3D view: the same picture as a diorama on the WebGL canvas
    const tia = game.bus.tia;
    const want3d = enhanced('view3d') && glCanvas;
    tia.recordObjects = !!want3d;
    if (want3d && !view3dTried) {
      view3dTried = true;
      try { view3d = createView3D(glCanvas); } catch (error) { console.warn('3D view unavailable:', error); }
      if (view3dNote) view3dNote.hidden = !!view3d;
    }
    const show3d = !!(want3d && view3d && tia.lastObjects);
    if (glCanvas) glCanvas.hidden = !show3d;
    canvas.style.opacity = show3d ? '0' : '';
    if (show3d) {
      const rad = (deg) => (Number(deg) || 0) * Math.PI / 180;
      view3d.draw(data, tia.lastObjects.slice(FIRST_LINE, FIRST_LINE + VISIBLE_LINES), {
        pitch: rad(options.pitch), yaw: rad(options.yaw), zoom: Number(options.zoom) || 190, stretch: Number(options.stretch) || 1,
        depth: Number(options.depth) || 0,
        trails: !!options.trails,
        speed: Math.min(1, game.bus.ram[SPEED] / 84),
        // with more than one athlete each has a lane ($82: athletes - 1, 4 in a single event; $83: whose turn)
        lane: game.bus.ram[0x82 & 0x7f] && !(enhanced('soloEvents') && singleEvent(game.bus.ram)) ? game.bus.ram[0x83 & 0x7f] & 3 : 0,
        ghosts: sideBySide.beside(game.bus.ram, FIRST_LINE),
        race: isRace(game.bus.ram),
        field: !isRace(game.bus.ram),
        javelin: game.bus.ram[0x80 & 0x7f] === 8,
        hurdles: game.bus.ram[0x80 & 0x7f] === 5, // the event ($80): 5, the 110 m hurdles
        bars: [3, 7].includes(game.bus.ram[0x80 & 0x7f]), // the high jump, the pole vault
        // a result (the countdown above $0F) or the title ($C5) shows the scoreboard
        scoreboard: longWait(game.bus.ram) || game.bus.ram[0xc5 & 0x7f] !== 0,
        // the PRESS FIRE pixels (painted into the picture above), kept in the view's bottom strip
        prompt: prompt ? PROMPT_ROWS : null,
      });
      return;
    }
    screenCtx.putImageData(image, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(screen, 0, 0, canvas.width, canvas.height);
  }

  // the next frame is asked for whatever happens in this one, so an error can't stop the game
  function frame(t) {
    try { runFrame(t); } finally { requestAnimationFrame(frame); }
  }
  function runFrame(t) {
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
    if (asking && edges.start) endInitials(); // the pad's Start takes the initials as they are
    if (!paused && !asking && !document.hidden) {
      acc += dt;
      while (acc >= FRAME_MS && !asking) { step(); acc -= FRAME_MS; }
      // Enhanced skip: run the wait's frames, up to about 30 ms of them a display
      // frame, to the end of the result or attempt wait; the next race's opening
      // second ($0F down, with its starting gun) then plays as usual
      if (skipping) {
        const until = performance.now() + 30;
        while (longWait(game.bus.ram) && performance.now() < until) step(true);
        if (!longWait(game.bus.ram)) { skipping = false; setHint(eventHint() || startHint()); }
      }
    }
    draw();
  }

  async function play() {
    started = true;
    if (poster) poster.hidden = true;
    canvas.focus({ preventScroll: true });
    setHint(startHint());
    showNote();
    await audio.start();
    await stadiumAudio.start();
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
    stadiumAudio.setVolume(v / 100);
    volumeSliders.forEach((s) => { s.value = String(v); });
    store.set('decathlon-volume', String(v));
  }
  const savedVolume = Number(store.get('decathlon-volume') ?? 70);
  setVolume(Number.isFinite(savedVolume) ? Math.round(Math.max(0, Math.min(100, savedVolume))) : 70);
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
    if (event.code === 'KeyP' && started) togglePause();
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
    if (version !== 'enhanced') { skipping = false; endInitials(); }
    showVersion();
    if (started) setHint(eventHint() || startHint());
    refocus();
  }));
  root.querySelectorAll('[data-option]').forEach((box) => {
    const key = box.dataset.option;
    const isCheck = box.type === 'checkbox';
    if (isCheck) box.checked = !!options[key]; else box.value = String(options[key]);
    // a value saved from wider limits brought within them; one not in the list is off
    if (box.tagName === 'SELECT' && box.selectedIndex < 0) box.selectedIndex = 0;
    if (!isCheck) options[key] = Number(box.value);
    // sliders follow while they move
    if (box.type === 'range') box.addEventListener('input', () => { options[key] = Number(box.value); store.set('decathlon-enhanced', JSON.stringify(options)); });
    box.addEventListener('change', () => {
      options[key] = isCheck ? box.checked : Number(box.value);
      if (key === 'bests') { showBests(); if (!box.checked) endInitials(); }
      store.set('decathlon-enhanced', JSON.stringify(options));
      if (key === 'skipWaits' && !box.checked) skipping = false;
      if (key === 'view3d') showView3dSettings();
      refocus();
    });
  });
  // the camera settings only while the 3D view is on
  const view3dSettings = root.querySelector('[data-view3d-settings]');
  const showView3dSettings = () => { if (view3dSettings) view3dSettings.hidden = !options.view3d; };
  showView3dSettings();
  showVersion();

  const initialsForm = root.querySelector('[data-initials]');
  const initialsFields = root.querySelector('[data-initials-fields]');
  function askInitials(count) {
    if (!initialsForm) return;
    initialsFields.replaceChildren(...Array.from({ length: count }, (_, i) => {
      const label = document.createElement('label');
      label.append(count > 1 ? `Athlete ${i + 1}` : 'Athlete');
      const input = document.createElement('input');
      // no maxLength: a paste such as "a.b.c" is cleaned to three letters, not cut to "a.b" first
      Object.assign(input, { value: initials[i], autocomplete: 'off', spellcheck: false });
      input.setAttribute('autocapitalize', 'characters');
      input.setAttribute('aria-label', `Athlete ${i + 1}'s initials`);
      input.addEventListener('input', () => { const v = cleanInitials(input.value); if (input.value !== v) input.value = v; });
      label.append(input);
      return label;
    }));
    asking = true;
    initialsForm.hidden = false;
    silence();
    const first = initialsFields.querySelector('input');
    first.focus({ preventScroll: true });
    first.select();
  }
  function endInitials() {
    if (!asking) return;
    initialsFields.querySelectorAll('input').forEach((input, i) => { initials[i] = cleanInitials(input.value); });
    store.set('decathlon-initials', JSON.stringify(initials));
    asking = false;
    initialsForm.hidden = true;
    acc = 0;
    silence();
    refocus();
  }
  initialsForm?.addEventListener('submit', (event) => { event.preventDefault(); endInitials(); });
  // a held Enter (the Game Reset that started the game) repeating doesn't also answer
  initialsForm?.addEventListener('keydown', (event) => { if (event.key === 'Enter' && event.repeat) event.preventDefault(); });

  // the best scores panel: points per event and the decathlon total, with the
  // initials of who set them, without and with run assist
  const bestsPanel = root.querySelector('[data-bests]');
  function showBests(beaten = null) {
    if (!bestsPanel) return;
    bestsPanel.hidden = !(version === 'enhanced' && options.bests);
    const cell = (tag, text, isNew = false, who = null) => {
      const c = document.createElement(tag);
      c.textContent = text;
      if (isNew) c.className = 'new';
      if (who !== null) { const w = document.createElement('span'); w.className = 'who'; w.textContent = who; c.append(w); }
      return c;
    };
    const row = (name, i) => {
      const fresh = (assisted) => beaten && (i === 'total' ? beaten.total && beaten.totalAssisted === assisted : beaten.assisted === assisted && beaten.event === i);
      const score = (t, assisted) => {
        const n = i === 'total' ? t.total : t.events[i];
        return cell('td', n ? n.toLocaleString('en-US') : '–', fresh(assisted), n ? (i === 'total' ? t.totalName : t.names[i]) : '');
      };
      const tr = document.createElement('tr');
      tr.append(cell('th', name), score(bests.own, false), score(bests.assisted, true));
      return tr;
    };
    bestsPanel.querySelector('tbody').replaceChildren(...EVENTS.map(([name], i) => row(name, i)), row('Decathlon total', 'total'));
  }
  // another tab saved its bests (every save includes the stored ones, so this is the latest of both)
  window.addEventListener('storage', (event) => {
    if (event.key !== 'decathlon-bests') return;
    bests.load(savedBests());
    showBests();
  });
  bestsPanel?.querySelector('[data-clear-bests]')?.addEventListener('click', () => {
    if (confirm('Clear the best scores in this browser?')) {
      bests.clear();
      store.set('decathlon-bests', JSON.stringify(bests));
      showBests();
    }
    refocus(); // so the next Space is the button in the game, not this one again
  });
  versionButtons.forEach((b) => b.addEventListener('click', () => showBests()));
  showBests();

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { audio.suspend(); stadiumAudio.suspend(); } else { audio.resume(); stadiumAudio.resume(); }
  });
  // a game started from the gamepad starts its sound without a user gesture, which
  // browsers hold back: the first tap or key after it lets the sound play
  for (const type of ['pointerdown', 'keydown']) {
    window.addEventListener(type, () => { if (started && !document.hidden) { audio.resume(); stadiumAudio.resume(); } }, { capture: true });
  }

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
    skip() { while (skipping && longWait(game.bus.ram)) step(true); skipping = false; setHint(eventHint() || startHint()); },
    get skipping() { return skipping; },
    get asking() { return asking; },
    // the 3D view's state, for checks
    get view3d() { return { tried: view3dTried, ready: !!view3d, shown: glCanvas ? !glCanvas.hidden : false }; },
    play,
  };
}
