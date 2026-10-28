// Stamps the page's module addresses with versions, so a browser never mixes a
// new page with modules it cached from an older one (GitHub Pages lets them be
// cached for about ten minutes). Every relative import in src/ and the page's
// script tag get "?v=" and the first 8 hex digits of the SHA-256 of the file
// they load, as stamped itself, so a change to a module changes the address of
// it and of everything that imports it, and an unchanged module keeps its
// address (and stays cached).
//
// usage: node tools/stamp.mjs          -> rewrites what changed
//        node tools/stamp.mjs --check  -> exit 1 if anything isn't stamped up to date
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

const check = process.argv.includes('--check');
const files = readdirSync('src').filter((f) => /\.m?js$/.test(f));
// './x.mjs' in an import, a dynamic import or new URL('./x.js', import.meta.url), with any old stamp
const REF = /((?:from\s+|import\s*\(\s*|new URL\(\s*)')\.\/([\w.-]+\.m?js)(?:\?v=[0-9a-f]+)?(')/g;

const stamped = new Map(); // file -> its text with its references stamped
// (of the text with LF line ends, as the repository keeps it, whatever the checkout's)
const version = (file) => createHash('sha256').update(stampFile(file).replace(/\r\n/g, '\n')).digest('hex').slice(0, 8);
function stampFile(file, path = []) {
  if (stamped.has(file)) return stamped.get(file);
  if (path.includes(file)) throw new Error(`import cycle: ${[...path, file].join(' -> ')}`);
  const text = readFileSync(`src/${file}`, 'utf8');
  const out = text.replace(REF, (all, head, name, tail) => {
    if (!files.includes(name)) throw new Error(`src/${file}: ./${name} isn't in src/`);
    stampFile(name, [...path, file]);
    return `${head}./${name}?v=${version(name)}${tail}`;
  });
  stamped.set(file, out);
  return out;
}

const changed = [];
for (const file of files) {
  const out = stampFile(file);
  if (out !== readFileSync(`src/${file}`, 'utf8')) changed.push(`src/${file}`);
  if (!check) writeFileSync(`src/${file}`, out);
}
const html = readFileSync('index.html', 'utf8');
const page = html.replace(/(src=")src\/page\.mjs(?:\?v=[0-9a-f]+)?(")/, (all, head, tail) => `${head}src/page.mjs?v=${version('page.mjs')}${tail}`);
if (page !== html) changed.push('index.html');
if (!check && page !== html) writeFileSync('index.html', page);

if (check) {
  if (changed.length) { console.error(`not stamped up to date: ${changed.join(', ')} (run node tools/stamp.mjs)`); process.exit(1); }
  console.log('stamps up to date');
} else console.log(changed.length ? `stamped: ${changed.join(', ')}` : 'stamps up to date');
