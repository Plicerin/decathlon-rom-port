// Plays the ROM's TIA sound registers through tiaSound.worklet.js. Browsers
// only allow audio after a user gesture, so call start() from an input event.
// frame(writes, cycles) after each frame: the frame's sound register writes as
// [register, value, cycle in the frame] and the frame's length in CPU cycles,
// so the worklet plays each write at its moment in the frame (Decathlon turns
// sounds on and off within a frame). setSilent() mutes without losing the
// register state; setVolume(0-1) sets the output level.

export function createTiaAudio(workletUrl) {
  let ctx = null;
  let node = null;
  let silent = false;
  let gain = null, volume = 1;

  return {
    async start() {
      if (ctx) { if (ctx.state === 'suspended') await ctx.resume(); return; }
      try {
        ctx = new AudioContext();
        await ctx.audioWorklet.addModule(workletUrl);
        node = new AudioWorkletNode(ctx, 'tia-sound', { outputChannelCount: [2] });
        gain = ctx.createGain();
        gain.gain.value = volume;
        node.connect(gain);
        gain.connect(ctx.destination);
        node.port.postMessage({ silent });
      } catch (error) {
        console.warn('TIA sound unavailable:', error);
      }
    },
    frame(writes, cycles) {
      if (node) node.port.postMessage({ writes, cycles });
    },
    setVolume(value) {
      if (!Number.isFinite(value)) return;
      volume = Math.max(0, Math.min(1, value));
      if (gain) gain.gain.value = volume;
    },
    setSilent(value) {
      if (silent !== value) { silent = value; if (node) node.port.postMessage({ silent }); }
    },
    suspend() { if (ctx) ctx.suspend(); },
    resume() { if (ctx) ctx.resume(); },
  };
}
