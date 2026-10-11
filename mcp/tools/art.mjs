// Art MCP tools: who makes a piece of art (and why), the request a session draws from, and the intake that checks an
// answer before it is written through a slot. None of these calls a model. gamesfun_art_make calls a paid service
// only with the person's own key and only with `yes: true`, which the session passes after the person agreed.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveGame } from '../../lib/games.mjs';
import { KIT_ROOT } from '../../lib/paths.mjs';
import { chooseMaker, detectAgent, keyState, KINDS, loadProviders } from '../../lib/art/providers.mjs';
import { artMake, artRequest, artTake } from '../../lib/art/session.mjs';

const inKit = p => (p ? path.resolve(KIT_ROOT, p) : null);
const withLook = async r => {
  const content = [{ type: 'text', text: JSON.stringify(r, null, 2) }];
  if (r.look) { try { content.push({ type: 'image', data: (await readFile(r.look)).toString('base64'), mimeType: 'image/png' }); } catch { /* the text names the file */ } }
  return { content, isError: false };
};

export const tools = [
  {
    name: 'gamesfun_art_makers',
    description: 'Which maker each kind of art (picture, sheet, tile, model) would come from on this machine now, and why, with the makers passed over. The order is fixed: art the person provided → a connection they offered (a key in the environment, or GF_ART_<KIND>=connection:<name>) → your own session → the kit\'s stand-ins. `table: true` adds every maker\'s cost and licence note (quoted and dated: re-read before relying on them).',
    inputSchema: { type: 'object', properties: { style: { type: 'string', enum: ['pixel', 'drawn'] }, table: { type: 'boolean' } } },
    async handler({ style, table }, ctx) {
      const data = loadProviders(), agent = detectAgent({ client: ctx.client });
      const out = { agent, order: data.order, choice: KINDS.map(kind => { const c = chooseMaker({ kind, style: style ?? null, agent: agent ?? undefined, data }); return { kind, maker: c.maker.id, name: c.connection ? `connection "${c.connection}"` : c.maker.name, why: c.why, passedOver: c.passedOver }; }) };
      if (table) out.makers = data.providers.map(p => ({ id: p.id, name: p.name, tier: p.tier, kinds: p.kinds, styles: p.styles ?? null, reach: p.reach.via === 'env' ? { key: p.reach.env, set: keyState(p).set } : { via: p.reach.via }, can: p.can, cost: p.cost, licence: p.licence, run: p.run }));
      return out;
    },
  },
  {
    name: 'gamesfun_art_request',
    description: 'Start a piece of 2D art (or a 3D model) for a game\'s slot. Decides the maker by the fixed order and returns a ticket. When YOU (the session) are the maker, `request` is the exact brief to draw from: answer it yourself as one SVG (drawn style) or a pixel grid (pixel style), then call gamesfun_art_take with the ticket. When the maker is a paid service, it returns the cost: tell the person and ask before gamesfun_art_make. The first request for a game fixes its style, palette and one line of art direction; later requests reuse them.',
    inputSchema: {
      type: 'object', required: ['subject'],
      properties: {
        game: { type: 'string', description: 'The game folder, relative to the kit root. Optional when there is only one game.' },
        slot: { type: 'string', description: 'The slot to fill (an image or model file slot), e.g. character.body.player' },
        out: { type: 'string', description: 'Instead of game and slot: a file to write, relative to the kit root (needs kind)' },
        subject: { type: 'string', description: 'What to draw, in a sentence' },
        kind: { type: 'string', enum: KINDS, description: 'Normally read from the slot' },
        style: { type: 'string', enum: ['pixel', 'drawn'] },
        plane: { type: 'string', enum: ['side', 'top'], description: 'For a body sheet: how the game sees the character (default side)' },
        palette: { type: 'array', items: { type: 'string' }, description: 'Colours as #rrggbb' },
        direction: { type: 'string', description: 'One line of art direction for every picture in this game' },
        provided: { type: 'string', description: 'A file the person gave for this (a path): then it is used, whatever else is connected' },
      },
    },
    async handler(a, ctx) {
      const game = a.out && !a.slot ? null : await resolveGame(a.game, { cwd: KIT_ROOT });
      return artRequest({ game, slot: a.slot ?? null, out: inKit(a.out), kind: a.kind ?? null, style: a.style ?? null, plane: a.plane ?? 'side', subject: a.subject, palette: a.palette ?? null, direction: a.direction ?? null, provided: a.provided ?? null, agent: detectAgent({ client: ctx.client }) ?? undefined });
    },
  },
  {
    name: 'gamesfun_art_take',
    description: 'Hand back the answer for an art ticket: `svg` (the SVG text), `grid` (the pixel grid JSON text) or `file` (a PNG or GLB path, e.g. from your own image tool, a connection or the person). It is drawn to a PNG, checked against the ticket (size, see-through ground, the six frames, feet and centre, seams, triangle budget) and only when it passes written through the slot. A refusal lists what to change: redraw and call again with the same ticket. The result includes the picture: LOOK at it; the checks do not see whether it is good.',
    inputSchema: { type: 'object', required: ['ticket'], properties: { ticket: { type: 'string' }, svg: { type: 'string' }, grid: { type: 'string' }, file: { type: 'string' }, write: { type: 'boolean', description: 'false checks and shows without writing (default true)' } } },
    async handler({ ticket, svg, grid, file, write }) { return withLook(await artTake(ticket, { svg: svg ?? null, grid: grid ?? null, file: inKit(file), write: write !== false })); },
  },
  {
    name: 'gamesfun_art_make',
    description: 'Make a ticket\'s art with a key-based maker (the person\'s own key, from their environment). Without `yes` nothing is called: it returns the request that would be sent and the cost, as a step for the person. Pass `yes: true` only after the person agreed to the spend. For a 3D model, `image` is a concept picture: it is checked first, and a bad one stops the call before anything is paid for.',
    inputSchema: { type: 'object', required: ['ticket'], properties: { ticket: { type: 'string' }, yes: { type: 'boolean' }, image: { type: 'string' } } },
    async handler({ ticket, yes, image }, ctx) { return withLook(await artMake(ticket, { yes: yes === true, image: inKit(image), log: m => ctx.progress(m) })); },
  },
];
