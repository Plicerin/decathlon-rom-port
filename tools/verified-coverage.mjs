// Dev: combines the instruction sets that tools/verify-recomp.mjs runs saved
// (tools/out/verified-*.json) and reports how much of the translation the
// comparisons have executed.
// usage: node tools/verified-coverage.mjs
import { readFileSync, readdirSync } from 'node:fs';
const code = JSON.parse(readFileSync('tools/build/code.json', 'utf8')).code;
const all = new Set(code.flatMap((list, b) => list.map(([o]) => (b << 12) | o)));
const ran = new Set();
for (const f of readdirSync('tools/out').filter((n) => /^verified-.*\.json$/.test(n))) for (const k of JSON.parse(readFileSync(`tools/out/${f}`, 'utf8'))) if (all.has(k)) ran.add(k);
console.log(`compared against the cartridge: ${ran.size} of ${all.size} instructions (${(100 * ran.size / all.size).toFixed(1)}%)`);
