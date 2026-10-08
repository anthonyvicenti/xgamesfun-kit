// gf-three ui: slot declarations for the words and colours of the HUD and cards. Pure (Node imports it).
const G = 'config/game.json';
const TEXT = [
  ['title', 'Game title', 'main', 99, 40, 'The lobby card, the results and the browser tab'],
  ['hook', 'Tagline', 'main', 92, 200, 'Under the title on the lobby card'],
  ['play', 'Play button', 'advanced', 12, 24],
  ['again', 'Play again button', 'advanced', 12, 24],
  ['waiting', 'Waiting line', 'advanced', 8, 60],
  ['you', 'Your name when playing alone', 'advanced', 8, 24],
  ['wins', 'Winner line ({name} is the winner)', 'advanced', 9, 60],
  ['draw', 'No-winner line', 'advanced', 8, 60],
];

export function slotsFor(cfg) {
  const g = cfg.game ?? {}, out = [];
  for (const [k, label, tier, rank, maxLength, description] of TEXT) {
    if (g.text?.[k] === undefined) continue;
    out.push({ id: `ui.${k}`, group: 'text', label, type: 'text', source: { file: G, pointer: `/text/${k}` }, constraints: { maxLength, ...(maxLength > 80 ? { multiline: true } : {}) }, tier, facet: 'text', rank, ...(description ? { description } : {}) });
  }
  for (const k of Object.keys(g.controls ?? {})) {
    out.push({ id: `ui.controls.${k}`, group: 'text', label: `What ${k === 'primary' ? 'the main button' : k === 'secondary' ? 'the second button' : k} does`, type: 'text', source: { file: G, pointer: `/controls/${k}` }, constraints: { maxLength: 80 }, tier: 'advanced', facet: 'text', rank: 11, description: 'The controls line on the lobby card and the touch button label' });
  }
  const COLORS = [['accent', 'Accent colour (buttons, bars)', 'main', 74, '--gf-accent'], ['panel', 'Panel colour', 'advanced', 18, '--gf-panel'], ['text', 'Text colour', 'advanced', 16, '--gf-text'], ['crosshair', 'Crosshair colour', 'advanced', 15, '--gf-cross']];
  for (const [k, label, tier, rank, css] of COLORS) if (g.ui?.[k] !== undefined) out.push({ id: `ui.${k}`, group: 'ui', label, type: 'color', source: { file: G, pointer: `/ui/${k}` }, css, tier, facet: 'look', rank });
  return out;
}
