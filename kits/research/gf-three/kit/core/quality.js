// gf-three core: quality tiers. `?quality=low|high` picks one; otherwise the kit guesses from the device.
// The look module (track L) tunes its lighting and post stack per tier; the kit sets the pixel budget and shadows.
// The pixels drawn are the screen's real ones within pixelBudget (kit/core/resolution.js, since 2026-10-09: a fixed
// pixelRatio of 1 on this low tier made every phone draw a third of its resolution).
// Pure: the device facts are passed in, so tests can call it.
import { PIXEL_BUDGET } from './resolution.js';

export const TIERS = {
  low: { name: 'low', pixelBudget: PIXEL_BUDGET.low, antialias: false, shadows: false, shadowMapSize: 1024, post: false, maxBots: 3 },
  high: { name: 'high', pixelBudget: PIXEL_BUDGET.high, antialias: true, shadows: true, shadowMapSize: 2048, post: true, maxBots: 7 },
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

/**
 * Does this browser draw 3D on a graphics card? Asked the web's own way: a WebGL context with
 * failIfMajorPerformanceCaveat, which a browser refuses when it would draw on the processor (Chrome's SwiftShader on a
 * machine with no card: a virtual machine, a remote desktop, a blocked driver, a CI runner). No WebGL at all is a no.
 * The probe context is given back at once. `doc` is the page's document (tests pass their own).
 */
export function drawsOnCard(doc = globalThis.document) {
  try {
    const canvas = doc.createElement('canvas'), opts = { failIfMajorPerformanceCaveat: true };
    const gl = canvas.getContext('webgl2', opts) ?? canvas.getContext('webgl', opts);
    if (!gl) return false;
    try { gl.getExtension('WEBGL_lose_context')?.loseContext(); } catch {}
    return true;
  } catch { return false; }
}
