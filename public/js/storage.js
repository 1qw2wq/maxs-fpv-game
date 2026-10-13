// Storage that can never throw.
//
// Every read and write of localStorage / sessionStorage in the game goes
// through here. Reason: a page shown inside a sandboxed preview pane (an
// iframe without allow-same-origin) has an opaque origin, and simply *touching*
// window.localStorage raises a SecurityError there. The map pick was read
// straight out of localStorage inside boot(), so that single throw killed the
// whole start-up and left the game on the loading screen with nothing but a
// "正在装载战场数据…" caption and no error -- which reads exactly like a hang.
// Now a refused store behaves like an empty one that lasts for the session:
// reads fall back to memory, writes are dropped instead of throwing.

function usable(name) {
  try {
    const s = window[name];
    if (!s) return null;
    const probe = '__tf_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

function make(name) {
  const real = usable(name);
  const memory = new Map();
  return {
    /** false when the browser refused the store (opaque origin / blocked data) */
    persistent: !!real,
    get(key) {
      if (real) {
        try { return real.getItem(key); } catch { /* fall through to memory */ }
      }
      return memory.has(key) ? memory.get(key) : null;
    },
    set(key, value) {
      const text = String(value);
      memory.set(key, text);
      if (!real) return;
      try { real.setItem(key, text); } catch { /* dropped: memory keeps it */ }
    },
    remove(key) {
      memory.delete(key);
      if (!real) return;
      try { real.removeItem(key); } catch { /* nothing to drop */ }
    },
  };
}

/** localStorage replacement: survives reloads when the browser allows it. */
export const store = make('localStorage');

/** sessionStorage replacement: one id per tab, still one id when storage is off. */
export const session = make('sessionStorage');
