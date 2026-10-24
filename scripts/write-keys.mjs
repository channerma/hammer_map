// Writes <dir>/js/keys.js from the CARTO_KEY environment variable, so a key reaches the deployed site or the app build
// without being committed. The Pages workflow runs it on its fresh checkout (`node scripts/write-keys.mjs .`), and
// scripts/build-web.mjs runs it on www/. Do not run it on your own clone: js/keys.js there must stay empty.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function writeKeys(dir, env = process.env) {
  const keys = { carto: (env.CARTO_KEY || '').trim() };
  const body = `// Written by scripts/write-keys.mjs from the CARTO_KEY variable; never committed.\nexport const BUILTIN_KEYS = ${JSON.stringify(keys)};\n`;
  writeFileSync(join(dir, 'js', 'keys.js'), body);
  return Object.keys(keys).filter((k) => keys[k]);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) { console.error('usage: node scripts/write-keys.mjs DIR (the site folder whose js/keys.js to write)'); process.exit(2); }
  const set = writeKeys(process.argv[2]);
  console.log(`write-keys: ${join(process.argv[2], 'js', 'keys.js')} written; keys set: ${set.join(', ') || 'none'}`);
}
