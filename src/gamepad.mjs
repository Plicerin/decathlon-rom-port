// Reads the first connected gamepad (standard mapping) as the Atari joystick
// and the console: left stick or D-pad to run, A/B/X/Y for the button, Start
// for Game Reset, Back/Select for Game Select. readGamepad() returns the
// current state; gamepadEdges() reports the presses since the last call.

const DEADZONE = 0.45;
const EDGES = ['start', 'back'];
const last = {};

export function readGamepad() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  const pad = [...pads].find((p) => p && p.connected);
  if (!pad) return null;
  const button = (i) => !!pad.buttons[i]?.pressed;
  const x = pad.axes[0] ?? 0, y = pad.axes[1] ?? 0;
  return {
    up: button(12) || y < -DEADZONE,
    down: button(13) || y > DEADZONE,
    left: button(14) || x < -DEADZONE,
    right: button(15) || x > DEADZONE,
    fire: button(0) || button(1) || button(2) || button(3),
    start: button(9),
    back: button(8),
  };
}

// presses of Start and Back since the last call
export function gamepadEdges(state) {
  const edges = {};
  for (const name of EDGES) {
    const now = !!state?.[name];
    edges[name] = now && !last[name];
    last[name] = now;
  }
  return edges;
}
