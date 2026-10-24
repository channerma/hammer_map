// Map keys the app sends with tile requests. Empty in the repository on purpose, so no key sits in its history:
// the GitHub Pages workflow fills this file from the repository secret CARTO_KEY when it deploys, and `npm run build`
// fills www/js/keys.js from the CARTO_KEY environment variable (scripts/write-keys.mjs). A key saved in Settings
// replaces these on that phone.
export const BUILTIN_KEYS = { carto: '' };
