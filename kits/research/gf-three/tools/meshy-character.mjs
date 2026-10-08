#!/usr/bin/env node
// meshy-character.mjs: a reference image or a sentence → a gf-humanoid-1 body (rigged by Meshy, our clips, lean GLB).
//
//   node research/gf-three/tools/meshy-character.mjs --image ref.png --out body.glb [--describe "what to keep"] [--enemy] [--no-concept]
//   node research/gf-three/tools/meshy-character.mjs --prompt "a chunky robot chef" --out body.glb
//        [--id my-body] [--label "My body"] [--height 1.7] [--polycount 12000] [--library] [--dry-run]
//   import { generateCharacter } from './meshy-character.mjs';   // track S's worker calls this
//   const r = await generateCharacter({ image: 'ref.png' | prompt: '…', out: 'assets/models/body-player.glb' });
//
// Steps (lessons from research/foundations/STUDIO_BUILD_PLAYBOOK.md §5, Gecko Zombies):
//   1. concept: a full-body, front-view, A-pose picture on a plain background (image-to-image from the reference, or
//      text-to-image from the prompt). A head-only reference otherwise forces image-to-3D to invent a body.
//      --no-concept sends the image straight to image-to-3D (only for a clean full-body A-pose picture).
//   2. image-to-3D: remeshed triangles (~12k), textured, A-pose.
//   3. rigging (Meshy's auto-rig emits the Mixamo-style names gf-humanoid-1 uses). Meshy's own clips are NOT used:
//      the body plays the shared gf-humanoid-1 clip file like every other body.
//   4. optimize.mjs --normalize: strip Meshy's emissive copy of the albedo, drop its clip0 pose, metres/+Z/feet at 0,
//      1024 px JPEG, meshopt. 5. rig-check. 6. a sidecar <out>.json (licence, tasks, credits) for library/bodies.json.
// Cost: about 41 credits (6 + 30 + 5); every task is in library/meshy-ledger.jsonl, and the wave's 150-credit cap is
// enforced before each paid call. Licence: Meshy output, unconfirmed tier → recorded as CC BY 4.0 crediting Meshy.
// Props: meshy-prop.mjs (the same steps without the rig). Exit 0 made, 1 failed, 2 bad usage, 3 refused (cap or no key).
import './lib/char-node.mjs';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import * as meshy from './lib/char-meshy.mjs';
import { optimizeBody } from './optimize.mjs';
import { rigCheck } from './rig-check.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const sha = b => createHash('sha256').update(b).digest('hex');
const mime = p => ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }[extname(p).toLowerCase()] ?? 'image/png');

// A reference body follows `describe` (what the pitch said to keep: outfit, accessories, colours, proportions, art
// style). From people in a reference it keeps their look, except for an enemy (`enemy`, the worker's --enemy: a role a
// mechanic sends against the players), which takes clothing, props and style only, never a group's ethnic features
// (PLAN §7; creator 2026-10-07 relaxed the rest: "I will manually review the games"). A zombie or creature version is
// a transformation and gets its own skin.
export function conceptPrompt({ describe, prompt, enemy = false } = {}) {
  const what = prompt ? `a game character: ${prompt}` : 'a game character based on the reference picture';
  return [`Full-body 3D game character concept of ${what}.`,
    'It stands upright on two legs like a humanoid, in a relaxed A-pose with the arms held away from the body, front view, the entire body visible from head to feet, feet flat on the ground.',
    ...(prompt ? (describe ? [`Keep these details: ${describe}.`] : []) : [
      describe ? `Make it: ${describe}. From the reference keep the colours, markings and accessories of the clothing and props, and the art style and body proportions.` : 'From the reference keep the colours, markings and accessories of the clothing and props, and the art style and body proportions.',
      enemy ? 'If the reference shows people, take only their clothing, accessories, props and art style: this character is an enemy, so do not copy their skin tone, ethnicity or facial features; give the face a neutral cartoon look (a zombie or creature version gets its own skin).'
        : 'If the reference shows people, keep their look as stylised game art: hair, skin tones and the style of their faces, as well as their clothing (a zombie or creature version gets its own skin).']),
    `${prompt ? 'Chunky, friendly party-game proportions; c' : 'C'}lear separate arms and legs; hands with distinct fingers or mittens; no tail touching the ground, no cape, nothing held in the hands.`,
    'Clean stylised game art, even soft lighting, plain white background, no other objects or text.'].join(' ').slice(0, 1500);
}

/**
 * { image | prompt, out, id, label, describe, concept = true, height = 1.7, polycount = 12000, dryRun, onProgress }
 * → { ok, file, sidecar, id, credits, tasks, rigCheck, report, work }
 */
export async function generateCharacter(opts) {
  const { image = null, prompt = null, out, describe = null, enemy = false, concept = true, height = 1.7, polycount = 12000, dryRun = false, onProgress = m => process.stderr.write(`\r${m}      `) } = opts;
  if (!image && !prompt) throw new Error('generateCharacter: give image or prompt');
  if (!out) throw new Error('generateCharacter: give out (a .glb path)');
  const id = opts.id ?? basename(out, '.glb');
  const work = resolve(here, '../.cache/meshy', id);
  mkdirSync(work, { recursive: true });
  const plan = [...(prompt || concept ? [prompt && !image ? 'text-to-image' : 'image-to-image'] : []), 'image-to-3d', 'rigging'];
  const estimate = plan.reduce((a, k) => a + meshy.COST[k], 0);
  const before = meshy.spent();
  if (before + estimate > meshy.CAP) throw new Error(`Meshy cap: ${before} spent + ~${estimate} for this body would pass ${meshy.CAP}. Stopped before any call.`);
  if (dryRun) return { ok: true, dryRun: true, plan, estimate, spent: before, cap: meshy.CAP, conceptPrompt: conceptPrompt({ describe, prompt, enemy }) };

  const tasks = {};
  const refBytes = image ? readFileSync(image) : null;
  // 1. concept
  let conceptTask = null;
  if (prompt && !image) {
    conceptTask = await meshy.create('text-to-image', '/v1/text-to-image', { ai_model: 'nano-banana-2', prompt: conceptPrompt({ describe, prompt, enemy }), aspect_ratio: '3:4', pose_mode: 'a-pose', remove_background: true }, `${id}:concept`);
    const t = await meshy.wait('/v1/text-to-image', conceptTask, `${id}:concept`, { onProgress });
    tasks.concept = { id: conceptTask, endpoint: 'text-to-image', credits: t.consumed_credits };
    await meshy.download(t.image_urls[0], resolve(work, 'concept.png'));
  } else if (concept) {
    conceptTask = await meshy.create('image-to-image', '/v1/image-to-image', { ai_model: 'nano-banana-2', prompt: conceptPrompt({ describe, prompt, enemy }), reference_image_urls: [meshy.dataUri(refBytes, mime(image))], aspect_ratio: '3:4', remove_background: true }, `${id}:concept`);
    const t = await meshy.wait('/v1/image-to-image', conceptTask, `${id}:concept`, { onProgress });
    tasks.concept = { id: conceptTask, endpoint: 'image-to-image', credits: t.consumed_credits };
    await meshy.download(t.image_urls[0], resolve(work, 'concept.png'));
  }
  // 2. image to 3D
  const to3dBody = { ai_model: 'latest', should_remesh: true, topology: 'triangle', target_polycount: polycount, should_texture: true, enable_pbr: false, pose_mode: 'a-pose',
    ...(conceptTask ? { input_task_id: conceptTask } : { image_url: meshy.dataUri(refBytes, mime(image)) }) };
  const to3d = await meshy.create('image-to-3d', '/v1/image-to-3d', to3dBody, `${id}:image-to-3d`);
  const t3 = await meshy.wait('/v1/image-to-3d', to3d, `${id}:image-to-3d`, { onProgress });
  tasks.to3d = { id: to3d, credits: t3.consumed_credits };
  await meshy.download(t3.model_urls.glb, resolve(work, 'model.glb'));
  if (t3.thumbnail_url) await meshy.download(t3.thumbnail_url, resolve(work, 'model-thumb.png'));
  // 3. rig
  const rigId = await meshy.create('rigging', '/v1/rigging', { input_task_id: to3d, height_meters: height }, `${id}:rigging`);
  const tr = await meshy.wait('/v1/rigging', rigId, `${id}:rigging`, { onProgress });
  tasks.rig = { id: rigId, credits: tr.consumed_credits };
  const rigged = await meshy.download(tr.result.rigged_character_glb_url, resolve(work, 'rigged.glb'));
  process.stderr.write('\n');
  // 4. our clips, lean file
  const r = await optimizeBody(rigged, { normalize: true, height, texture: 1024, rough: 0.8, extras: { gfBody: id, gfSource: 'meshy', gfTintMix: 0 } });
  mkdirSync(dirname(resolve(out)), { recursive: true });
  writeFileSync(resolve(out), r.bytes);
  // 5. check
  const check = await rigCheck(resolve(out));
  const credits = Object.values(tasks).reduce((a, t) => a + (t.credits ?? 0), 0);
  // 6. sidecar
  const sidecar = {
    id, label: opts.label ?? id, file: `bodies/${basename(out)}`, from: image ? 'reference' : 'generate', kind: 'meshy', tags: ['generated', 'meshy', ...(opts.tags ?? [])],
    describe: describe ?? prompt ?? 'generated from a reference image',
    license: { spdx: 'CC-BY-4.0', author: 'Meshy AI (generated for games.fun)', url: 'https://www.meshy.ai',
      note: 'Meshy output; the account plan (and so the licence) is unconfirmed, so it is treated as CC BY 4.0 with Meshy credited (STUDIO_BUILD_PLAYBOOK §5)' },
    meshy: { tasks, credits, polycount, height, concept: !!conceptTask, generated: new Date().toISOString() },
    reference: image ? { file: image, sha256: sha(refBytes) } : null, prompt: prompt ?? null,
  };
  const sidecarPath = resolve(out).replace(/\.glb$/, '.json');
  writeFileSync(sidecarPath, JSON.stringify(sidecar, null, 2) + '\n');
  return { ok: check.ok, file: resolve(out), sidecar: sidecarPath, id, credits, tasks, rigCheck: check, report: r.report, work };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = process.argv.slice(2);
  const val = k => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
  const out = val('--out');
  if (!(val('--image') || val('--prompt')) || !out) { console.error('usage: meshy-character.mjs (--image <png>|--prompt "<text>") --out <glb> [--describe ..] [--enemy] [--id ..] [--label ..] [--no-concept] [--dry-run]'); process.exit(2); }
  // exit 1 failed (Meshy or the network: the worker retries once), 3 refused by the cap or no key (no retry)
  const r = await generateCharacter({ image: val('--image') && resolve(val('--image')), prompt: val('--prompt'), out, id: val('--id'), label: val('--label'), describe: val('--describe'), enemy: a.includes('--enemy'),
    concept: !a.includes('--no-concept'), height: val('--height') ? +val('--height') : 1.7, polycount: val('--polycount') ? +val('--polycount') : 12000, dryRun: a.includes('--dry-run') })
    .catch(e => { console.error(`\nmeshy-character: ${e.message}`); process.exit(/Meshy cap|MESHY_API_KEY/.test(e.message) ? 3 : 1); });
  if (r.dryRun) { console.log(JSON.stringify(r, null, 1)); process.exit(0); }
  console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.file}  ${r.credits} credits  (ledger total ${meshy.spent()} / ${meshy.CAP})`);
  for (const e of r.rigCheck.errors) console.log(`  error: ${e}`);
  for (const w of r.rigCheck.warnings) console.log(`  warn:  ${w}`);
  console.log(`  work files: ${r.work}`);
  process.exit(r.ok ? 0 : 1);
}
