// Copies the web app into www/ for Capacitor (npm run build). The site itself stays at the repository root,
// so GitHub Pages is unchanged. In the copy, MapLibre comes from node_modules instead of the CDN, so the map
// library is inside the native app and the app starts with no signal.
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'www');
const FILES = ['index.html', 'style.css', 'sw.js', 'manifest.webmanifest', 'rules.json', 'icons', 'js', 'workers'];
const CDN = 'https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/5.24.0/';
const VENDOR = 'vendor/maplibre-gl/';

const walk = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? walk(p) : [p];
});

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, VENDOR), { recursive: true });
FILES.forEach((f) => cpSync(join(ROOT, f), join(OUT, f), { recursive: true }));
['maplibre-gl.js', 'maplibre-gl.css'].forEach((f) =>
  cpSync(join(ROOT, 'node_modules', 'maplibre-gl', 'dist', f), join(OUT, VENDOR, f)));

const code = walk(OUT).filter((p) => ['.html', '.js'].includes(extname(p)) && !p.includes(VENDOR));
const rewritten = code.filter((p) => {
  const s = readFileSync(p, 'utf8');
  if (s.includes(CDN)) writeFileSync(p, s.split(CDN).join(VENDOR));
  return s.includes(CDN);
});
const left = code.filter((p) => readFileSync(p, 'utf8').includes('cdnjs.cloudflare.com'));
if (left.length) {
  console.error(`build: a CDN address is still in ${left.join(', ')}; the app would need a signal to start`);
  process.exit(1);
}
console.log(`build: www/ holds ${walk(OUT).length} files; MapLibre bundled, CDN addresses rewritten in ${rewritten.length} files`);
