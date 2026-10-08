// gf-three core: quality tiers. `?quality=low|high` picks one; otherwise the kit guesses from the device.
// The look module (track L) tunes its lighting and post stack per tier; the kit only caps resolution and shadows.
// Pure: the device facts are passed in, so tests can call it.

export const TIERS = {
  low: { name: 'low', pixelRatio: 1, antialias: false, shadows: false, shadowMapSize: 1024, post: false, maxBots: 3 },
  high: { name: 'high', pixelRatio: 2, antialias: true, shadows: true, shadowMapSize: 2048, post: true, maxBots: 7 },
};

/**
 * pickQuality('low' | 'high' | null, { dpr, cores, touch, width }) → a tier object.
 * Auto: low on a touch device with a small screen or few cores, else high.
 */
export function pickQuality(param, env = {}) {
  if (param && TIERS[param]) return { ...TIERS[param], auto: false };
  const { cores = 8, touch = false, width = 1280 } = env;
  const low = (touch && width < 900) || cores < 4;
  return { ...TIERS[low ? 'low' : 'high'], auto: true };
}

/** The device facts pickQuality reads, from the browser. */
export function deviceFacts() {
  const g = globalThis;
  return {
    dpr: g.devicePixelRatio || 1,
    cores: g.navigator?.hardwareConcurrency || 8,
    touch: !!(g.matchMedia && g.matchMedia('(pointer: coarse)').matches),
    width: g.innerWidth || 1280,
  };
}
