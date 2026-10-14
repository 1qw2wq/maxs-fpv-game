// Where the JSON endpoints live.
//
// Normally the page and the game server are the same origin, so /api/... is just
// a path. A static deployment (Vercel, Netlify, GitHub Pages) can only hand out
// files, though: the player points the game at a real server address (typed in
// the menu, or ?server=host:port in the URL), and then the room list, the
// character library and the upload endpoint have to follow that address instead
// of the page's own origin. Everything else -- the models, sounds and /shared
// JSON -- keeps coming from wherever the page was opened, which is what makes
// the static copy useful.
let base = '';

/** @param {string} url e.g. "https://trench.example.com:443"; '' = same origin. */
export function setApiBase(url) {
  base = (url || '').replace(/\/+$/, '');
}

export function apiBase() {
  return base;
}

/** '/api/rooms' -> '/api/rooms' (same origin) or 'https://host/api/rooms'. */
export function apiUrl(path) {
  return base + path;
}
