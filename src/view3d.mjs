// Decathlon Enhanced's 3D view: the 2600's side view rebuilt as a small
// stadium seen from a raised camera, after Activision's own box and catalogue
// art of the time. The picture's bands are the same in every event:
//   lines  41-70   sky and stands: a backdrop standing at the far side, each
//                  row carried on sideways by its own repeat (the lights every
//                  32 pixels, the crowd every 30)
//   lines  71-159  far straight and infield: the ground, laid flat from far
//                  to near and carried on sideways in each line's colour
//   lines 160-189  the near track: four lanes of dirt with white lines, wider
//                  than on the 2600; the athlete runs in his own lane, or
//                  in the jumps and throws (no lanes) down the middle
//   lines 191-192  the front grass, on toward the camera
//   lines 193-230  speed bar, result, logo: laid over the bottom of the view
// Every sprite pixel above the athlete's feet (the TIA's players, missiles
// and ball, from its object layer: tia.mjs recordObjects) stands up as a box
// in the athlete's lane, at its height above the feet, a few pixels thick,
// lit from the front right; together they cast a shadow back and to the left
// on the ground (each spot darkened once: a stencil); the athlete leaves a
// pale streak per row of the figure, as long as he is fast. In races with
// more than one athlete, the ones who have run already (recorded) run beside
// him in their own lanes. Some of the game's pictures are things on the
// ground or on a sign, not figures, and are kept flat: a ball or missile
// column running to the track's foot (the finish, a scratch line) is painted
// across the lanes, the track's markers (the 100 m signs) and a landing mat
// are painted on the track, and a result's scoreboard is laid over the view.
// The hurdles, and the high jump's and pole vault's standards, are built as
// two uprights and a crossbar. Plain WebGL2, no library.

import { OBJECT } from './tia.mjs?v=a4de5feb';

// the picture's bands, in rows from the first visible line (41)
const WALL = [0, 30];          // lines 41-70
const GROUND = [30, 119];      // lines 71-159
const FAR_STRAIGHT = [30, 37]; // lines 71-77, track
const TRACK = [119, 149];      // lines 160-189
const GRASS = 150;             // line 191
const HUD = [152, 190];        // lines 193-230
const LOGO_ROWS = 175;         // from line 216: the logo
const SCOREBOARD = [30, 82];   // lines 71-122: during a result or on the title, the scoreboard's rows, one per athlete at lines 75, 88, 101 and 114 (laid over the view)
const DECALS = 130;            // from line 171: sprite pixels on the near track are markers (the 100 m signs), painted on it
const TRACK_FOOT = 144;        // line 185: a ball or missile column reaching it is a line on the track (the finish, a scratch line), painted
const FEET = 126;              // line 167: the ground the figures stand on (the athlete's lowest pixels are just above)
const LANES = 4, LANE_LINES = 8; // each lane as deep as 8 of the picture's lines
const DIRT = [178, 96, 64], LINE = [236, 232, 220];
const STEEL = [0.13, 0.13, 0.14]; // the standards and the javelin: black, a little lifted so their faces show
const WALL_W = 4096, WALL_AT = 1968; // the backdrop texture: the picture's x 0 is at 1968
const AIM_X = 85; // the camera's aim: a little ahead of the athlete (who runs at picture x 16-28, world 32-56)

const VERT_TEX = `#version 300 es
in vec3 p; in vec2 t; uniform mat4 m; out vec2 uv;
void main() { uv = t; gl_Position = m * vec4(p, 1.0); }`;
const FRAG_TEX = `#version 300 es
precision mediump float; in vec2 uv; uniform sampler2D tex; out vec4 o;
void main() { o = texture(tex, uv); if (o.a < 0.5) discard; }`;
// a unit box per instance: x, y (pixel), colour; faces shaded by their normal (light from the front right, high)
const VERT_BOX = `#version 300 es
in vec3 p; in vec3 n; in vec2 at; in vec3 c; uniform mat4 m; uniform float depth; uniform float feet; uniform vec2 place; out vec3 col;
void main() {
  float light = n.z > 0.5 ? 1.0 : n.y > 0.5 ? 1.2 : n.y < -0.5 ? 0.55 : n.x > 0.5 ? 0.92 : 0.66;
  col = min(c * light, vec3(1.0));
  gl_Position = m * vec4((at.x + p.x) * 2.0 + place.x, feet - at.y - 1.0 + p.y, place.y + (p.z - 0.5) * depth, 1.0);
}`;
const FRAG_BOX = `#version 300 es
precision mediump float; in vec3 col; out vec4 o; void main() { o = vec4(col, 1.0); }`;
// shadows: each box's footprint thrown on the ground, away from the light: back and to the left
const VERT_SHADOW = `#version 300 es
in vec2 q; in vec2 at; uniform mat4 m; uniform float feet; uniform vec2 place; uniform vec2 throwBy;
void main() {
  float h = feet - at.y - 1.0 + q.y;
  gl_Position = m * vec4((at.x + q.x) * 2.0 + place.x - h * throwBy.x, 0.05, place.y - h * throwBy.y, 1.0);
}`;
const FRAG_SHADOW = `#version 300 es
precision mediump float; out vec4 o; void main() { o = vec4(0.0, 0.0, 0.0, 0.4); }`;
// trails: one quad per row of the figure, fading out behind it
const VERT_TRAIL = `#version 300 es
in vec2 q; in vec3 row; uniform mat4 m; uniform float feet; uniform vec2 place; out float fade;
void main() {
  fade = q.x;
  float x = row.x - (1.0 - q.x) * row.z;
  gl_Position = m * vec4(x * 2.0 + place.x, feet - row.y - 1.0 + q.y, place.y, 1.0);
}`;
const FRAG_TRAIL = `#version 300 es
precision mediump float; in float fade; uniform float strength; out vec4 o;
void main() { o = vec4(1.0, 1.0, 0.96, fade * fade * strength); }`;

function program(gl, vs, fs) {
  const p = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}

// 4x4 matrices, column-major
const mul = (a, b) => { const o = new Float32Array(16); for (let c = 0; c < 4; c += 1) for (let r = 0; r < 4; r += 1) { let s = 0; for (let k = 0; k < 4; k += 1) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; };
const perspective = (fovy, aspect, near, far) => { const f = 1 / Math.tan(fovy / 2); return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0]); };
const lookAt = (eye, at) => {
  const sub = (a, b) => a.map((v, i) => v - b[i]), norm = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const z = norm(sub(eye, at)), x = norm(cross([0, 1, 0], z)), y = cross(z, x);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]);
};
const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

// a unit box: 6 faces, positions and normals (y up, z toward the camera)
const BOX = (() => {
  const v = [], face = (n, corners) => { for (const i of [0, 1, 2, 0, 2, 3]) v.push(...corners[i], ...n); };
  face([0, 0, 1], [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]]);
  face([0, 0, -1], [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]]);
  face([0, 1, 0], [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]]);
  face([0, -1, 0], [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]]);
  face([-1, 0, 0], [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]]);
  face([1, 0, 0], [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]]);
  return new Float32Array(v);
})();

// the shortest repeat of a row of the picture (x 8-159), or 0 if it has none
function period(row) {
  for (let p = 4; p <= 80; p += 1) {
    let same = true;
    for (let x = 8; x + p < 160 && same; x += 1) same = row[x] === row[x + p];
    if (same) return p;
  }
  return 0;
}

// Feet: the figures stop a line above the ground (the game's lowest lines
// there are its own line under the athlete, left out), so a leg standing on
// that line ends in a stub. Each one gets a foot: a pixel in front of it
// (the athletes face right), in the leg's colour. pixels: [x, row, r, g, b, ...]
function addFeet(pixels) {
  const ground = new Map();
  for (let i = 0; i < pixels.length; i += 5) if (pixels[i + 1] === FEET - 1) ground.set(pixels[i], i);
  for (const [x, i] of ground) {
    if (ground.has(x + 1)) continue; // the front of a leg two pixels wide
    pixels.push(x + 1, FEET - 1, pixels[i + 2], pixels[i + 3], pixels[i + 4]);
  }
}

export function createView3D(canvas) {
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, stencil: true });
  if (!gl) return null;
  const texProg = program(gl, VERT_TEX, FRAG_TEX), box = program(gl, VERT_BOX, FRAG_BOX);
  const shadow = program(gl, VERT_SHADOW, FRAG_SHADOW), trail = program(gl, VERT_TRAIL, FRAG_TRAIL);
  const loc = (p, n) => gl.getAttribLocation(p, n), uni = (p, n) => gl.getUniformLocation(p, n);

  // textured quads (positions set per frame)
  const quadVao = gl.createVertexArray(), quadBuf = gl.createBuffer();
  gl.bindVertexArray(quadVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.enableVertexAttribArray(loc(texProg, 'p')); gl.vertexAttribPointer(loc(texProg, 'p'), 3, gl.FLOAT, false, 20, 0);
  gl.enableVertexAttribArray(loc(texProg, 't')); gl.vertexAttribPointer(loc(texProg, 't'), 2, gl.FLOAT, false, 20, 12);
  // far textures are smoothed as they shrink (mipmaps), so distant dots don't flicker into lines
  const makeTexture = (smoothFar) => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, smoothFar ? gl.LINEAR_MIPMAP_LINEAR : gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); // each line's edge colour carries on to the horizon
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };
  const groundTex = makeTexture(true), trackTex = makeTexture(true), wallTex = makeTexture(true);
  const hudTex = makeTexture(false), solidTex = makeTexture(false), scoreTex = makeTexture(false), decalTex = makeTexture(false), matTex = makeTexture(false); // solidTex: one colour, for the grass and the lane lines

  // the boxes: shared geometry, per-instance pixel and colour
  const boxVao = gl.createVertexArray();
  gl.bindVertexArray(boxVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, BOX, gl.STATIC_DRAW);
  for (const [name, size, offset] of [['p', 3, 0], ['n', 3, 12]]) { gl.enableVertexAttribArray(loc(box, name)); gl.vertexAttribPointer(loc(box, name), size, gl.FLOAT, false, 24, offset); }
  const instances = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, instances);
  for (const [name, size, offset] of [['at', 2, 0], ['c', 3, 8]]) { gl.enableVertexAttribArray(loc(box, name)); gl.vertexAttribPointer(loc(box, name), size, gl.FLOAT, false, 20, offset); gl.vertexAttribDivisor(loc(box, name), 1); }

  // the shadows: a quad per box, from the same instance buffer
  const unitQuad = new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]);
  const shadowVao = gl.createVertexArray();
  gl.bindVertexArray(shadowVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, unitQuad, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(loc(shadow, 'q')); gl.vertexAttribPointer(loc(shadow, 'q'), 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, instances);
  gl.enableVertexAttribArray(loc(shadow, 'at')); gl.vertexAttribPointer(loc(shadow, 'at'), 2, gl.FLOAT, false, 20, 0); gl.vertexAttribDivisor(loc(shadow, 'at'), 1);

  // the trails: a quad per row
  const trailVao = gl.createVertexArray();
  gl.bindVertexArray(trailVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, unitQuad, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(loc(trail, 'q')); gl.vertexAttribPointer(loc(trail, 'q'), 2, gl.FLOAT, false, 0, 0);
  const rows = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, rows);
  gl.enableVertexAttribArray(loc(trail, 'row')); gl.vertexAttribPointer(loc(trail, 'row'), 3, gl.FLOAT, false, 12, 0); gl.vertexAttribDivisor(loc(trail, 'row'), 1);
  gl.bindVertexArray(null);

  const groundPx = new Uint8Array(160 * (GROUND[1] - GROUND[0]) * 4);
  const trackPx = new Uint8Array(160 * (TRACK[1] - TRACK[0]) * 4);
  const wallPx = new Uint8Array(WALL_W * (WALL[1] - WALL[0]) * 4);
  const hudPx = new Uint8Array(160 * (HUD[1] - HUD[0]) * 4);
  const scorePx = new Uint8Array(160 * (SCOREBOARD[1] - SCOREBOARD[0]) * 4);
  const decalPx = new Uint8Array(160 * (TRACK[1] - DECALS) * 4);
  const matPx = new Uint8Array(160 * (FEET + 1 - TRACK[0]) * 4);
  const cameras = new Map();
  let aimX = AIM_X; // the camera's aim along the track (world x), eased in the high jump and the pole vault
  const upload = (texture, px, width, lines, mip) => {
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, lines, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
    if (mip) gl.generateMipmap(gl.TEXTURE_2D);
  };
  const solid = ([r, g, b]) => upload(solidTex, new Uint8Array([r, g, b, 255]), 1, 1, false);
  const quad = (corners) => { // [x, y, z, u, v] x4, drawn as two triangles
    const [a, b, c, d] = corners;
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([...a, ...b, ...c, ...a, ...c, ...d]), gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  };

  return {
    // the camera: aimed a little ahead of the athlete (he runs at the
    // picture's left, and what comes at him comes from the right), from above
    // (pitch), turned (yaw: negative stands to his left, so the track runs
    // away to the right), at a distance (zoom: smaller is closer). A shift
    // lens: the camera looks level and the picture is shifted down to the
    // target, so uprights stay upright across the view (looking down would
    // lean them out toward the edges); the lens is lengthened to keep the
    // target's size
    camera(pitch, yaw, zoom, aimZ, aspect, aim = AIM_X) {
      const key = `${pitch.toFixed(3)}:${yaw.toFixed(3)}:${zoom.toFixed(1)}:${aimZ.toFixed(1)}:${aspect.toFixed(3)}:${aim.toFixed(1)}`;
      if (cameras.has(key)) return cameras.get(key);
      if (cameras.size > 400) cameras.clear(); // a moving aim makes many
      const target = [aim, 14, aimZ];
      const eye = [target[0] + zoom * Math.sin(yaw) * Math.cos(pitch), target[1] + zoom * Math.sin(pitch), target[2] + zoom * Math.cos(yaw) * Math.cos(pitch)];
      const lens = perspective(0.7, aspect, 5, 9000), f = lens[5];
      lens[0] *= Math.cos(pitch); lens[5] *= Math.cos(pitch);
      lens[9] = -f * Math.sin(pitch); // the shift: the target, below the level view, at the picture's middle
      const mvp = mul(lens, lookAt(eye, [target[0], eye[1], target[2]]));
      cameras.set(key, mvp);
      return mvp;
    },
    // rgba: the picture (160 x 190 lines from line 41, as drawn on the flat
    // canvas); objects: the TIA object rows from line 41; lane: the running
    // athlete's lane (0 innermost); ghosts: [{ lane, dx (pixels ahead), pixels:
    // [x, y, r, g, b, ...] }] for athletes who have run; speed 0-1; race: the
    // hurdles and posts stand in every lane; hurdles: the 110 m hurdles, each
    // hurdle built in every lane as two uprights and a crossbar; bars: the high
    // jump or pole vault, whose standard (the ball) becomes two uprights and a
    // crossbar at its top, with the landing mat (missile 0) flat on the track;
    // scoreboard: a result or the title is showing, so the sprites at the top
    // of the infield are the scoreboard's digits; field: an event without
    // lanes (the jumps and throws), held in the middle of the track, the
    // standards and the landing mat across its middle two lanes; javelin: the
    // javelin event, whose javelin (missile 1) is drawn black; prompt: the
    // player's PRESS FIRE pixels [x, row], kept in the bottom strip
    draw(rgba, objects, { pitch = 0.55, yaw = -0.35, zoom = 190, stretch = 1.4, depth = 3, speed = 0, trails = true, shadows = true, lane = 0, ghosts = [], race = false, hurdles = false, bars = false, scoreboard = false, field = false, javelin = false, prompt = null }) {
      const W = canvas.width, H = canvas.height;
      gl.viewport(0, 0, W, H);
      gl.clearColor(0, 0, 0, 1);
      gl.clearStencil(0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);

      // what each sprite pixel becomes: 'box' (stands up), 'flat' (stays in the
      // ground's picture: track markers, a landing mat), 'over' (the scoreboard,
      // laid over the view), 'gone' (the game's own line under the athlete,
      // lines 167-172, whose place the 3D shadow takes; the foot of a hurdle
      // or a high jump's standard, built anew) or 'down' (a ball or missile just under
      // the feet line: the discus or javelin landed, lying on the ground)
      const role = (x, y) => {
        const ob = objects[y][x];
        if (ob < OBJECT.p0) return null;
        if (scoreboard && y >= SCOREBOARD[0] && y < SCOREBOARD[1]) return 'over';
        if (bars && ob === OBJECT.ball && y >= FEET) return 'gone';
        // on the near track only the markers (player sprites) stay; a hurdle's
        // foot and the line under the athlete (missiles) are built anew or shadowed
        if (y >= DECALS) return ob <= OBJECT.p1 ? 'flat' : 'gone';
        if (bars && ob === OBJECT.m0) return 'flat';
        if (y >= FEET) return ob <= OBJECT.p1 ? 'gone' : 'down';
        return 'box';
      };
      // the markers, and the landing mat (missile 0 and the playfield, lines
      // 160-167), are lifted out of the track's picture too, to be painted
      // where the athlete is
      const marker = (x, y) => y >= DECALS && objects[y][x] <= OBJECT.p1 && role(x, y) === 'flat';
      const mat = (x, y) => bars && y >= TRACK[0] && y <= FEET && (objects[y][x] === OBJECT.m0 || objects[y][x] === OBJECT.playfield);
      const figure = (x, y) => { const r = role(x, y); return r === 'box' || r === 'over' || r === 'gone' || r === 'down' || marker(x, y) || mat(x, y); };
      const lineColour = (y, x) => { // the line's own colour beside a figure pixel
        let k = x; while (k >= 8 && figure(k, y)) k -= 1;
        if (k < 8) { k = x; while (k < 160 && figure(k, y)) k += 1; }
        return Math.min(159, Math.max(8, k));
      };
      // the figures: every sprite pixel of the ground rows above the feet. The
      // athlete is the two player sprites; the hurdles and posts are the ball
      // and missiles (scenery), which in a race stand in every lane
      const boxes = [], scenery = [], trailRows = [];
      // painted lines: the columns of ball or missile that run down to the track's foot
      const painted = [];
      if (!bars) for (let x = 8; x < 160; x += 1) if (objects[TRACK_FOOT][x] >= OBJECT.m0) painted.push(x);
      const isPainted = (x) => painted.includes(x);
      for (let y = GROUND[0]; y < DECALS; y += 1) {
        let left = -1;
        for (let x = 8; x < 160; x += 1) {
          const r = role(x, y);
          if (r !== 'box' && r !== 'down') continue;
          const o = (y * 160 + x) * 4, ob = objects[y][x];
          if (ob > OBJECT.p1 && isPainted(x)) continue;
          // the javelin (missile 1) in black, as the standards
          const c = javelin && ob === OBJECT.m1 ? STEEL : [rgba[o] / 255, rgba[o + 1] / 255, rgba[o + 2] / 255];
          (ob <= OBJECT.p1 ? boxes : scenery).push(x, r === 'down' ? FEET - 1 : y, ...c);
          if (left < 0 && ob <= OBJECT.p1) left = x;
        }
        // the athlete runs on the left of the picture: streaks behind what is there
        if (trails && speed > 0.05 && left >= 0 && left < 48 && y >= 95) trailRows.push(left, y, speed * 60);
      }
      // a band of the picture as a texture: figures lifted out (their pixels take the
      // line's colour), the HMOVE bar (x 0-7) filled from x 8, track rows in dirt
      const band = (px, [from, to], dirtRows) => {
        for (let y = from; y < to; y += 1) {
          const dirt = y >= dirtRows[0] && y < dirtRows[1];
          for (let x = 0; x < 160; x += 1) {
            const o = ((y - from) * 160 + x) * 4;
            const sx = x < 8 ? 8 : figure(x, y) ? lineColour(y, x) : x;
            const s = (y * 160 + sx) * 4;
            if (dirt && objects[y][sx] === OBJECT.background) { px[o] = DIRT[0]; px[o + 1] = DIRT[1]; px[o + 2] = DIRT[2]; } else { px[o] = rgba[s]; px[o + 1] = rgba[s + 1]; px[o + 2] = rgba[s + 2]; }
            px[o + 3] = 255;
          }
        }
      };
      band(groundPx, GROUND, FAR_STRAIGHT);
      band(trackPx, TRACK, TRACK);
      // the backdrop: each row carried on sideways by its own repeat
      for (let y = WALL[0]; y < WALL[1]; y += 1) {
        const ids = [];
        for (let x = 0; x < 160; x += 1) { const o = (y * 160 + x) * 4; ids.push((rgba[o] << 16) | (rgba[o + 1] << 8) | rgba[o + 2]); }
        const p = period(ids);
        for (let j = 0; j < WALL_W; j += 1) {
          let x = j - WALL_AT;
          if (x < 8 || x >= 160) x = p ? 8 + (((x - 8) % p) + p) % p : (x < 8 ? 8 : 159);
          const s = (y * 160 + x) * 4, o = ((y - WALL[0]) * WALL_W + j) * 4;
          wallPx[o] = rgba[s]; wallPx[o + 1] = rgba[s + 1]; wallPx[o + 2] = rgba[s + 2]; wallPx[o + 3] = 255;
        }
      }
      // the bottom strip: only its marks (the bar, the digits, the logo); its
      // background, the black of its sprites and all black in the logo's rows
      // (lines 216-230: a block of black playfield beside the logo) show the scene
      for (let y = HUD[0]; y < HUD[1]; y += 1) {
        for (let x = 0; x < 160; x += 1) {
          const o = ((y - HUD[0]) * 160 + x) * 4, s = (y * 160 + x) * 4;
          const ob = objects[y][x], black = !rgba[s] && !rgba[s + 1] && !rgba[s + 2];
          hudPx[o] = rgba[s]; hudPx[o + 1] = rgba[s + 1]; hudPx[o + 2] = rgba[s + 2];
          hudPx[o + 3] = x >= 8 && ob !== OBJECT.background && !(black && (ob >= OBJECT.p0 || y >= LOGO_ROWS)) ? 255 : 0;
        }
      }
      // the player's PRESS FIRE, painted into the picture over the background: shown too
      if (prompt) for (const [x, y] of prompt) if (y >= HUD[0] && y < HUD[1]) hudPx[((y - HUD[0]) * 160 + x) * 4 + 3] = 255;
      upload(groundTex, groundPx, 160, GROUND[1] - GROUND[0], true);
      upload(trackTex, trackPx, 160, TRACK[1] - TRACK[0], true);
      upload(wallTex, wallPx, WALL_W, WALL[1] - WALL[0], true);
      upload(hudTex, hudPx, 160, HUD[1] - HUD[0], false);
      if (scoreboard) {
        for (let y = SCOREBOARD[0]; y < SCOREBOARD[1]; y += 1) {
          for (let x = 0; x < 160; x += 1) {
            const o = ((y - SCOREBOARD[0]) * 160 + x) * 4, s = (y * 160 + x) * 4;
            scorePx[o] = rgba[s]; scorePx[o + 1] = rgba[s + 1]; scorePx[o + 2] = rgba[s + 2];
            scorePx[o + 3] = role(x, y) === 'over' ? 255 : 0;
          }
        }
        upload(scoreTex, scorePx, 160, SCOREBOARD[1] - SCOREBOARD[0], false);
      }
      // a picture of what is lifted out of rows [from, to): returns [first, last + 1] of its rows, from `from`
      const lift = (px, texture, [from, to], on) => {
        let rows = null;
        for (let y = from; y < to; y += 1) {
          for (let x = 0; x < 160; x += 1) {
            const o = ((y - from) * 160 + x) * 4, s = (y * 160 + x) * 4, lifted = x >= 8 && on(x, y);
            px[o] = rgba[s]; px[o + 1] = rgba[s + 1]; px[o + 2] = rgba[s + 2]; px[o + 3] = lifted ? 255 : 0;
            if (lifted) rows = rows ? [rows[0], y - from + 1] : [y - from, y - from + 1];
          }
        }
        if (rows) upload(texture, px, 160, to - from, false);
        return rows;
      };
      const decalRows = lift(decalPx, decalTex, [DECALS, TRACK[1]], marker);
      const matRows = lift(matPx, matTex, [TRACK[0], FEET + 1], mat);

      // the world: x = picture x * 2; y up; z toward the camera, 0 at the feet line
      const z = (row) => (row - FEET) * stretch;
      const laneW = LANE_LINES * stretch;
      const track0 = z(TRACK[0]), track1 = track0 + LANES * laneW;
      const laneZ = (k) => track0 + laneW * (k + 0.5);
      const at = field ? track0 + LANES * laneW / 2 : laneZ(lane); // where the athlete is: his lane, or the middle of the track
      // the high jump and the pole vault: the athlete runs across the picture to
      // the bar, at its right, out of the usual view. The camera follows, aimed
      // 40% of the way from the athlete to the far end of the bar (at first the
      // pole he carries), eased, so the bar is seen coming and the jump is in the middle
      if (bars) {
        let a = 160, s = -1;
        for (let i = 0; i < boxes.length; i += 5) a = Math.min(a, boxes[i]);
        for (let i = 0; i < scenery.length; i += 5) s = Math.max(s, scenery[i]);
        const aimTo = boxes.length && s >= 0 ? Math.max(AIM_X, 2 * (a + 0.4 * (s - a))) : aimX; // world x = picture x * 2
        aimX += (aimTo - aimX) * 0.08;
      } else aimX = AIM_X;
      const m = this.camera(pitch, yaw, zoom, at - 6, W / H, Math.round(aimX * 2) / 2);
      const far = 4000, u = (x) => x / 320;
      gl.enable(gl.DEPTH_TEST);
      gl.useProgram(texProg);
      gl.uniformMatrix4fv(uni(texProg, 'm'), false, m);
      gl.bindVertexArray(quadVao);
      // the far straight and the infield
      gl.bindTexture(gl.TEXTURE_2D, groundTex);
      quad([[-far, 0, z(GROUND[0]), u(-far), 0], [far, 0, z(GROUND[0]), u(far), 0], [far, 0, track0, u(far), 1], [-far, 0, track0, u(-far), 1]]);
      // the near track, four lanes deep
      gl.bindTexture(gl.TEXTURE_2D, trackTex);
      quad([[-far, 0, track0, u(-far), 0], [far, 0, track0, u(far), 0], [far, 0, track1, u(far), 1], [-far, 0, track1, u(-far), 1]]);
      // the front grass, on toward the camera, in the colour of the picture's line 191
      const g = (GRASS * 160 + 80) * 4;
      solid([rgba[g], rgba[g + 1], rgba[g + 2]]);
      quad([[-far, 0, track1, 0, 0], [far, 0, track1, 1, 0], [far, 0, track1 + far, 1, 1], [-far, 0, track1 + far, 0, 1]]);
      // the lane lines
      solid(LINE);
      for (let k = 0; k <= LANES; k += 1) {
        const lz = track0 + k * laneW, w = 0.45;
        quad([[-far, 0.03, lz - w, 0, 0], [far, 0.03, lz - w, 1, 0], [far, 0.03, lz + w, 1, 1], [-far, 0.03, lz + w, 0, 1]]);
      }
      // the painted lines, across every lane, in their own colour
      for (const x of painted) {
        const o = (TRACK_FOOT * 160 + x) * 4;
        solid([rgba[o], rgba[o + 1], rgba[o + 2]]);
        quad([[x * 2, 0.04, track0, 0, 0], [x * 2 + 2, 0.04, track0, 1, 0], [x * 2 + 2, 0.04, track1, 1, 1], [x * 2, 0.04, track1, 0, 1]]);
      }
      // what was lifted, painted where the athlete is, reaching `half` either side of him
      const paint = (texture, rows, lines, half) => {
        gl.bindTexture(gl.TEXTURE_2D, texture);
        const v0 = rows[0] / lines, v1 = rows[1] / lines;
        quad([[0, 0.05, at - half, 0, v0], [320, 0.05, at - half, 1, v0], [320, 0.05, at + half, 1, v1], [0, 0.05, at + half, 0, v1]]);
      };
      // the markers (the 100 m signs), as deep as they are tall, inside a lane
      if (decalRows) paint(decalTex, decalRows, TRACK[1] - DECALS, Math.min(0.42 * laneW, decalRows[1] - decalRows[0]));
      // the landing mat, across the two lanes of the standard
      if (matRows) paint(matTex, matRows, FEET + 1 - TRACK[0], (field ? 0.95 : 0.42) * laneW);
      // the backdrop: the sky and stands standing at the far side, a little over twice as tall as their lines
      gl.bindTexture(gl.TEXTURE_2D, wallTex);
      const wallH = (WALL[1] - WALL[0]) * 2.2, wz = z(GROUND[0]) - 0.5;
      const wu = (x) => (x / 2 + WALL_AT) / WALL_W;
      quad([[-far, wallH, wz, wu(-far), 0], [far, wallH, wz, wu(far), 0], [far, 0, wz, wu(far), 1], [-far, 0, wz, wu(-far), 1]]);
      // and the sky on above them, in the colour of the picture's top line, so a far or low camera sees no edge
      const sky = (WALL[0] * 160 + 80) * 4;
      solid([rgba[sky], rgba[sky + 1], rgba[sky + 2]]);
      quad([[-far, far, wz, 0, 0], [far, far, wz, 1, 0], [far, wallH - 0.01, wz, 1, 1], [-far, wallH - 0.01, wz, 0, 1]]);

      // everyone on the track: the running athlete (and what he meets) in his
      // lane, the athletes who have run in theirs
      addFeet(boxes);
      for (const r of ghosts) addFeet(r.pixels);
      const runners = [{ place: [0, at], pixels: boxes }];
      if (hurdles) {
        // each hurdle (the game's post: ball and missile pixels) as uprights at the
        // lane's edges and, from its top two rows, a crossbar across the lane
        const top = new Map(); // the post's top row, by column
        for (let i = 0; i < scenery.length; i += 5) top.set(scenery[i], Math.min(top.get(scenery[i]) ?? 999, scenery[i + 1]));
        const bar = [];
        for (let i = 0; i < scenery.length; i += 5) if (scenery[i + 1] <= top.get(scenery[i]) + 1) bar.push(...scenery.slice(i, i + 5));
        for (let k = 0; k < LANES; k += 1) {
          for (const side of [-0.38, 0.38]) runners.push({ place: [0, laneZ(k) + side * laneW], pixels: scenery, depth: 1.2 });
          runners.push({ place: [0, laneZ(k)], pixels: bar, depth: laneW * 0.8 });
        }
      } else if (bars) {
        // the standard (the ball) as two uprights and a crossbar at its top, across the middle
        // two lanes (or, in a lane of his own, at its edges);
        // anything else of the scenery (the vaulting pole: missile 1) stays in the athlete's hands
        const standard = [], rest = [];
        let topY = 999, topX = 0;
        for (let i = 0; i < scenery.length; i += 5) {
          const x = scenery[i], y = scenery[i + 1];
          if (objects[y][x] === OBJECT.ball) { standard.push(...scenery.slice(i, i + 5)); if (y < topY) { topY = y; topX = x; } } else rest.push(...scenery.slice(i, i + 5));
        }
        if (standard.length) {
          const c = STEEL;
          const post = [], bar = [];
          for (let y = topY; y < FEET; y += 1) post.push(topX, y, ...c);
          bar.push(topX, topY, ...c, topX, topY + 1, ...c);
          const side = (field ? 0.95 : 0.42) * laneW;
          for (const s of [-side, side]) runners.push({ place: [0, at + s], pixels: post, depth: 1.2 });
          runners.push({ place: [0, at], pixels: bar, depth: side * 2 });
        }
        runners.push({ place: [0, at], pixels: rest });
      } else if (race) {
        for (let k = 0; k < LANES; k += 1) runners.push({ place: [0, laneZ(k)], pixels: scenery });
      } else {
        runners.push({ place: [0, at], pixels: scenery });
      }
      for (const r of ghosts) runners.push({ place: [r.dx * 2, laneZ(r.lane)], pixels: r.pixels });
      for (const r of runners) {
        if (!r.pixels.length) continue;
        gl.bindBuffer(gl.ARRAY_BUFFER, instances);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(r.pixels), gl.DYNAMIC_DRAW);
        if (shadows) {
          // shadows on the ground, each spot darkened once (stencil)
          gl.enable(gl.STENCIL_TEST);
          gl.stencilFunc(gl.EQUAL, 0, 0xff);
          gl.stencilOp(gl.KEEP, gl.KEEP, gl.INCR);
          gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
          gl.depthMask(false);
          gl.useProgram(shadow);
          gl.uniformMatrix4fv(uni(shadow, 'm'), false, m);
          gl.uniform1f(uni(shadow, 'feet'), FEET);
          gl.uniform2f(uni(shadow, 'place'), r.place[0], r.place[1]);
          gl.uniform2f(uni(shadow, 'throwBy'), 0.6, 0.5); // the sun to the front right: shadows fall back and left
          gl.bindVertexArray(shadowVao);
          gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, r.pixels.length / 5);
          gl.depthMask(true);
          gl.disable(gl.BLEND);
          gl.disable(gl.STENCIL_TEST);
        }
        gl.useProgram(box);
        gl.uniformMatrix4fv(uni(box, 'm'), false, m);
        gl.uniform1f(uni(box, 'depth'), r.depth ?? depth);
        gl.uniform1f(uni(box, 'feet'), FEET);
        gl.uniform2f(uni(box, 'place'), r.place[0], r.place[1]);
        gl.bindVertexArray(boxVao);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, r.pixels.length / 5);
      }

      // the trail, in the running athlete's lane
      if (trailRows.length) {
        gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.depthMask(false);
        gl.useProgram(trail);
        gl.uniformMatrix4fv(uni(trail, 'm'), false, m);
        gl.uniform1f(uni(trail, 'feet'), FEET);
        gl.uniform2f(uni(trail, 'place'), 0, at);
        gl.uniform1f(uni(trail, 'strength'), 0.55);
        gl.bindVertexArray(trailVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, rows);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(trailRows), gl.DYNAMIC_DRAW);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, trailRows.length / 3);
        gl.depthMask(true);
        gl.disable(gl.BLEND);
      }

      // the bottom strip's marks, over the bottom of the view (as on the flat picture)
      gl.disable(gl.DEPTH_TEST);
      gl.viewport(0, 0, W, Math.round(H * (HUD[1] - HUD[0]) / 190));
      gl.useProgram(texProg);
      gl.uniformMatrix4fv(uni(texProg, 'm'), false, IDENTITY);
      gl.bindVertexArray(quadVao);
      gl.bindTexture(gl.TEXTURE_2D, hudTex);
      quad([[-1, 1, 0, 0, 0], [1, 1, 0, 1, 0], [1, -1, 0, 1, 1], [-1, -1, 0, 0, 1]]);
      // the scoreboard's digits, where they sit on the flat picture
      if (scoreboard) {
        const y0 = Math.round(H * (1 - SCOREBOARD[1] / 190)), y1 = Math.round(H * (1 - SCOREBOARD[0] / 190));
        gl.viewport(0, y0, W, y1 - y0);
        gl.bindTexture(gl.TEXTURE_2D, scoreTex);
        quad([[-1, 1, 0, 0, 0], [1, 1, 0, 1, 0], [1, -1, 0, 1, 1], [-1, -1, 0, 0, 1]]);
      }
      gl.bindVertexArray(null);
    },
  };
}
