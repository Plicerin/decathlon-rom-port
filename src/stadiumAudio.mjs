// Decathlon Enhanced's stadium: a starting gun, a crowd and its groan, synthesised with
// Web Audio (no recordings), beside the TIA sound. The crowd is pink noise
// through the formants of an open "ah" (the sound of many voices at once),
// slowly swelling, at a level the player sets each frame; the gun is a noise
// crack with a low thump. Both go through a generated stadium echo.
// Call start() from a user gesture; setVolume(0-1) and setSilent() follow the
// page's volume, mute and pause.

export function createStadiumAudio() {
  let ctx = null, master = null, crowdGain = null, crowdTone = null, echo = null;
  let volume = 1, silent = true, level = 0;

  const pink = (seconds) => {
    // Paul Kellet's pink noise filter over white noise
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < d.length; i += 1) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
    return buf;
  };
  // a stadium's echo: two seconds of decaying noise, a little later on the right
  const echoImpulse = () => {
    const len = Math.floor(ctx.sampleRate * 2);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch += 1) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i += 1) {
        const t = i / ctx.sampleRate - ch * 0.012;
        d[i] = t < 0.02 ? 0 : (Math.random() * 2 - 1) * Math.exp(-t * 3.2) * 0.5;
      }
    }
    return buf;
  };

  function build() {
    master = ctx.createGain();
    master.gain.value = silent ? 0 : volume;
    master.connect(ctx.destination);
    echo = ctx.createConvolver();
    echo.buffer = echoImpulse();
    const echoLevel = ctx.createGain();
    echoLevel.gain.value = 0.35;
    echo.connect(echoLevel).connect(master);

    // the crowd: looping pink noise, three vowel formants, slow swells
    const noise = ctx.createBufferSource();
    noise.buffer = pink(6);
    noise.loop = true;
    crowdTone = ctx.createBiquadFilter(); // opens up as the crowd gets excited
    crowdTone.type = 'lowpass';
    crowdTone.frequency.value = 1400;
    const mix = ctx.createGain();
    for (const [freq, q, gain] of [[650, 2.5, 1], [1150, 3, 0.7], [2500, 4, 0.35]]) {
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain(); g.gain.value = gain;
      noise.connect(f).connect(g).connect(mix);
    }
    const swell = ctx.createGain();
    swell.gain.value = 0.8;
    // two slow, out-of-step swells, as voices come and go
    for (const [rate, depth] of [[0.21, 0.18], [0.53, 0.1]]) {
      const lfo = ctx.createOscillator(); lfo.frequency.value = rate;
      const amount = ctx.createGain(); amount.gain.value = depth;
      lfo.connect(amount).connect(swell.gain);
      lfo.start();
    }
    crowdGain = ctx.createGain();
    crowdGain.gain.value = 0;
    mix.connect(crowdTone).connect(swell).connect(crowdGain);
    crowdGain.connect(master);
    crowdGain.connect(echo);
    noise.start();
  }

  return {
    async start() {
      if (ctx) { if (ctx.state === 'suspended') await ctx.resume(); return; }
      try { ctx = new AudioContext(); build(); } catch (error) { console.warn('Stadium sound unavailable:', error); ctx = null; }
    },
    // the crowd's level, 0 (silent) to 1 (a roar); eased so changes swell rather than jump
    crowd(target) {
      if (!ctx || Math.abs(target - level) < 0.005) return;
      level = target;
      const now = ctx.currentTime;
      crowdGain.gain.setTargetAtTime(level * 0.45, now, 0.35);
      crowdTone.frequency.setTargetAtTime(1200 + level * 2600, now, 0.35);
    },
    gun() {
      if (!ctx) return;
      const now = ctx.currentTime;
      // the crack: a short burst of bright noise
      const crack = ctx.createBufferSource();
      crack.buffer = pink(0.4);
      const bright = ctx.createBiquadFilter(); bright.type = 'highpass'; bright.frequency.value = 900;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, now);
      env.gain.linearRampToValueAtTime(1.3, now + 0.002);
      env.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
      crack.connect(bright).connect(env);
      env.connect(master); env.connect(echo);
      crack.start(now); crack.stop(now + 0.4);
      // the thump: a falling low tone
      const thump = ctx.createOscillator();
      thump.frequency.setValueAtTime(140, now); thump.frequency.exponentialRampToValueAtTime(45, now + 0.18);
      const tenv = ctx.createGain();
      tenv.gain.setValueAtTime(0.45, now); tenv.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
      thump.connect(tenv).connect(master);
      thump.start(now); thump.stop(now + 0.25);
    },
    // a groan, "aww": a chorus of voices, each at its own pitch (men's and
    // women's), starting a moment apart and sliding down about a fifth,
    // through the fixed resonances of the vowel "aw" (about 570, 840 and
    // 2400 Hz), with a little breath. The vowel stays put while the voices
    // fall, which is what makes it a crowd and not a filter sweep.
    groan() {
      if (!ctx) return;
      const now = ctx.currentTime;
      const voices = ctx.createGain();
      voices.gain.value = 1;
      for (let i = 0; i < 36; i += 1) {
        const f0 = i % 2 ? 180 + Math.random() * 90 : 100 + Math.random() * 60;
        const start = now + Math.random() * 0.22;
        const length = 1.0 + Math.random() * 0.5;
        const v = ctx.createOscillator();
        v.type = 'sawtooth';
        v.frequency.setValueAtTime(f0 * (1.04 + Math.random() * 0.04), start);
        v.frequency.exponentialRampToValueAtTime(f0 * (0.72 + Math.random() * 0.08), start + length);
        // a slow wobble, as a held voice has
        const wobble = ctx.createOscillator(); wobble.frequency.value = 4 + Math.random() * 2;
        const wobbleDepth = ctx.createGain(); wobbleDepth.gain.value = f0 * 0.012;
        wobble.connect(wobbleDepth).connect(v.frequency);
        const g = ctx.createGain();
        const peak = (0.5 + Math.random() * 0.5) / 36;
        g.gain.setValueAtTime(0, start);
        g.gain.linearRampToValueAtTime(peak, start + 0.12 + Math.random() * 0.1);
        g.gain.setTargetAtTime(0, start + length * 0.6, 0.18);
        v.connect(g).connect(voices);
        v.start(start); v.stop(start + length + 0.8);
        wobble.start(start); wobble.stop(start + length + 0.8);
      }
      // breath: a little noise under the voices
      const breath = ctx.createBufferSource();
      breath.buffer = pink(1.8);
      const breathLevel = ctx.createGain();
      breathLevel.gain.setValueAtTime(0, now);
      breathLevel.gain.linearRampToValueAtTime(0.05, now + 0.15);
      breathLevel.gain.setTargetAtTime(0, now + 0.8, 0.3);
      breath.connect(breathLevel).connect(voices);
      breath.start(now); breath.stop(now + 1.8);
      // the vowel "aw"
      const vowel = ctx.createGain();
      vowel.gain.value = 1.4;
      for (const [freq, q, gain] of [[570, 6, 1], [840, 7, 0.75], [2400, 9, 0.22]]) {
        const f = ctx.createBiquadFilter();
        f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
        const g = ctx.createGain(); g.gain.value = gain;
        voices.connect(f).connect(g).connect(vowel);
      }
      vowel.connect(master); vowel.connect(echo);
    },
    setVolume(v) { if (!Number.isFinite(v)) return; volume = Math.max(0, Math.min(1, v)); if (master) master.gain.setTargetAtTime(silent ? 0 : volume, ctx.currentTime, 0.02); },
    setSilent(s) { silent = s; if (master) master.gain.setTargetAtTime(silent ? 0 : volume, ctx.currentTime, 0.02); },
    suspend() { ctx?.suspend(); },
    resume() { ctx?.resume(); },
  };
}
