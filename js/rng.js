// Seeded RNG (mulberry32) so a body wiring is reproducible from its seed.
// Seeds are short base36 strings shown in the HUD; two players with the same
// seed fight the same scrambled nervous system.

export function hashSeedString(seedString) {
  /** FNV-1a hash of a seed string into a uint32 for mulberry32. */
  let hash = 2166136261;
  for (let i = 0; i < seedString.length; i++) {
    hash ^= seedString.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function createRng(seedString) {
  /** Returns a () => float in [0,1) stream deterministic in the seed string. */
  let state = hashSeedString(seedString);
  return function next() {
    state |= 0;
    state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomSeedString() {
  /** Short human-shareable seed, e.g. "k3v9qz". Uses Math.random on purpose: only run
   *  reproducibility needs determinism, not seed generation itself. */
  return Math.random().toString(36).slice(2, 8);
}

export function shuffleInPlace(array, rng) {
  /** Fisher-Yates using the provided seeded rng stream. */
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}
