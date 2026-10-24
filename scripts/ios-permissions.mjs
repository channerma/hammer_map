// Adds the texts iOS shows when the app first asks for location, the camera and photos (npm run ios:add runs it
// after `cap add ios`). Without them iOS stops the app the moment the page asks. Safe to run again.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLIST = join(fileURLToPath(new URL('..', import.meta.url)), 'ios', 'App', 'App', 'Info.plist');
const KEYS = {
  NSLocationWhenInUseUsageDescription: 'Hammer Map shows where you are on the map and places pins at your location.',
  NSCameraUsageDescription: 'Hammer Map takes photos to attach to your pins.',
  NSPhotoLibraryUsageDescription: 'Hammer Map attaches photos you choose to your pins.',
};

const s = readFileSync(PLIST, 'utf8');
const end = s.lastIndexOf('</dict>');
if (end < 0) throw new Error(`no </dict> in ${PLIST}`);
const missing = Object.entries(KEYS).filter(([k]) => !s.includes(`<key>${k}</key>`));
const add = missing.map(([k, v]) => `\t<key>${k}</key>\n\t<string>${v}</string>\n`).join('');
writeFileSync(PLIST, s.slice(0, end) + add + s.slice(end));
console.log(`ios-permissions: ${missing.length} added, ${Object.keys(KEYS).length - missing.length} already there (${PLIST})`);
