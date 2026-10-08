#!/usr/bin/env node
// cc0-bodies.mjs: the CC0 humanoid bodies of the library (library/body-sources.json) → library/bodies/<id>.glb + sidecar.
//
//   node research/gf-three/tools/cc0-bodies.mjs [--fetch] [--only id,id] [--dry]
//   then: node research/gf-three/tools/lib/char-bodies.mjs --write          (bodies.json, sidecars merged in)
//         node research/gf-three/lookdev/tools/merge-licences.mjs           (LICENSES.json)
//         node research/gf-three/character-bench/previews.mjs               (previews; real GPU, one browser job)
//
// --fetch downloads each source GLB from its Poly Pizza page into research/gf-three/.cache/bodies/ (gitignored) and
// refuses one whose sha256 differs from the record. Downloads are data: nothing in them is run.
// Each body:
//   1. bind pose: every joint node is reset to its bind pose (from the inverse bind matrices). Quaternius exports keep a
//      posed rest (Body/Hips turned 27°), and normalizeBody reads the facing from the hips' rest, so without this the
//      body would face 27° off +Z.
//   2. drop: nodes that are not the body (held weapons); recolor: material base colours (sRGB hex) for a variant.
//   3. tools/optimize.mjs (normalize onto gf-humanoid-1, its own clips dropped, tint materials renamed tint_*), then
//      rig-check. 4. library/bodies/<id>.glb and the sidecar <id>.json (licence, source, steps) for bodies.json.
import './lib/char-node.mjs';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { io, THREE } from './lib/char-deps.mjs';
import { optimizeBody } from './optimize.mjs';
import { rigCheck } from './rig-check.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const LIB = join(here, '../library');
const CACHE = join(here, '../.cache/bodies');
const { Matrix4, Vector3, Quaternion, Color } = THREE;
const sha = b => createHash('sha256').update(b).digest('hex');

/** Resets every joint of the first skin to its bind pose. The bind frame is the top joint's rest · its IBM. */
export function bindPose(doc) {
  const root = doc.getRoot();
  const skin = root.listSkins()[0];
  if (!skin) throw new Error('not rigged: no skin');
  const joints = skin.listJoints(), set = new Set(joints), acc = skin.getInverseBindMatrices();
  const parents = new Map(); for (const n of root.listNodes()) for (const c of n.listChildren()) parents.set(c, n);
  const worldOf = n => { const m = new Matrix4().fromArray(n.getMatrix()); for (let p = parents.get(n); p; p = parents.get(p)) m.premultiply(new Matrix4().fromArray(p.getMatrix())); return m; };
  const IBM = joints.map((_, i) => new Matrix4().fromArray(acc.getElement(i, [])));
  const top = joints.findIndex(j => !set.has(parents.get(j)));
  const frame = worldOf(joints[top]).multiply(IBM[top]);
  const bind = new Map(joints.map((j, i) => [j, frame.clone().multiply(IBM[i].clone().invert())]));
  let moved = 0;
  for (const j of joints) {
    const p = parents.get(j);
    const pw = set.has(p) ? bind.get(p) : p ? worldOf(p) : new Matrix4();
    const local = pw.clone().invert().multiply(bind.get(j));
    const t = new Vector3(), q = new Quaternion(), s = new Vector3();
    local.decompose(t, q, s);
    const before = new Quaternion().fromArray(j.getRotation());
    if (before.angleTo(q) > 1e-3) moved++;
    j.setTranslation(t.toArray()).setRotation(q.toArray()).setScale(s.toArray());
  }
  return moved;
}

/**
 * Rigs with no wrist (Quaternius' Post-Apocalypse characters: the fingers hang off LowerArm) get a weightless
 * Wrist.L/.R joint, 80% of the way from the forearm to the knuckles, that the fingers then hang off; gf-humanoid-1
 * needs a hand bone (the forearm's direction, the hand sockets). Run after bindPose. → the sides that got one.
 */
export function addWrists(doc) {
  const root = doc.getRoot();
  const parents = new Map(); for (const n of root.listNodes()) for (const c of n.listChildren()) parents.set(c, n);
  const worldOf = n => { const m = new Matrix4().fromArray(n.getMatrix()); for (let p = parents.get(n); p; p = parents.get(p)) m.premultiply(new Matrix4().fromArray(p.getMatrix())); return m; };
  const byName = new Map(root.listNodes().map(n => [n.getName(), n]));
  const added = [];
  for (const s of ['L', 'R']) {
    const lower = byName.get(`LowerArm.${s}`);
    if (!lower || byName.has(`Wrist.${s}`)) continue;
    const fingers = lower.listChildren().filter(c => new RegExp(`^(Thumb|Index|Middle|Ring|Pinky)1\\.${s}$`).test(c.getName()));
    const knuckles = fingers.filter(f => !/^Thumb/.test(f.getName()));
    if (!knuckles.length) continue;
    const lw = worldOf(lower), lp = new Vector3().setFromMatrixPosition(lw);
    const kc = knuckles.reduce((a, f) => a.add(new Vector3().setFromMatrixPosition(worldOf(f))), new Vector3()).multiplyScalar(1 / knuckles.length);
    const ww = lw.clone().setPosition(lp.clone().lerp(kc, 0.8));
    const fingerWorld = new Map(fingers.map(f => [f, worldOf(f)]));
    const wrist = doc.createNode(`Wrist.${s}`).setMatrix(lw.clone().invert().multiply(ww).toArray());
    lower.addChild(wrist);
    for (const f of fingers) { lower.removeChild(f); wrist.addChild(f); f.setMatrix(ww.clone().invert().multiply(fingerWorld.get(f)).toArray()); }
    for (const skin of root.listSkins()) {
      const joints = skin.listJoints();
      const li = joints.indexOf(lower);
      if (li < 0) continue;
      const acc = skin.getInverseBindMatrices();
      const frame = lw.clone().multiply(new Matrix4().fromArray(acc.getElement(li, [])));   // bind frame of this skin
      const ibm = ww.clone().invert().multiply(frame);
      const arr = new Float32Array((joints.length + 1) * 16);
      for (let i = 0; i < joints.length; i++) arr.set(acc.getElement(i, []), i * 16);
      arr.set(ibm.toArray(), joints.length * 16);
      skin.setInverseBindMatrices(doc.createAccessor().setType('MAT4').setBuffer(acc.getBuffer()).setArray(arr));
      skin.addJoint(wrist);
    }
    added.push(s);
  }
  return added;
}

const srgbToLinear = hex => { const c = new Color(hex); return [c.r, c.g, c.b]; };   // three's Color stores linear values

export async function buildBody(entry, src, { dry = false } = {}) {
  const nio = await io();
  const bytes = readFileSync(join(CACHE, `${entry.source}.glb`));
  if (src.sha256 && sha(bytes) !== src.sha256) throw new Error(`${entry.id}: source sha256 differs from body-sources.json`);
  const doc = await nio.readBinary(new Uint8Array(bytes));
  const moved = bindPose(doc);
  const wrists = addWrists(doc);
  const dropped = [];
  for (const name of entry.drop ?? []) for (const n of doc.getRoot().listNodes().filter(n => n.getName() === name)) { n.dispose(); dropped.push(name); }
  for (const name of entry.drop ?? []) if (!dropped.includes(name)) throw new Error(`${entry.id}: drop ${name}: no such node`);
  for (const [mat, hex] of Object.entries(entry.recolor ?? {})) {
    const m = doc.getRoot().listMaterials().find(x => x.getName() === mat);
    if (!m) throw new Error(`${entry.id}: recolor ${mat}: no such material`);
    m.setBaseColorFactor([...srgbToLinear(hex), m.getBaseColorFactor()[3]]);
  }
  const pre = await nio.writeBinary(doc);
  const r = await optimizeBody(pre, { normalize: true, height: entry.height, tint: entry.tint ?? [], tintMix: entry.tintMix, rough: 0.8,
    extras: { gfBody: entry.id, gfSource: `polypizza:${entry.source}` } });
  const out = join(LIB, 'bodies', `${entry.id}.glb`);
  const steps = [`posed at its bind pose (${moved} joints reset)`, ...(wrists.length ? [`wrist joints added (${wrists.join(', ')}; the rig had none)`] : []), ...(dropped.length ? [`removed ${dropped.join(', ')}`] : []),
    ...(entry.recolor ? [`recoloured ${Object.entries(entry.recolor).map(([k, v]) => `${k} ${v}`).join(', ')}`] : []),
    `normalised onto gf-humanoid-1 by tools/optimize.mjs --normalize${entry.tint?.length ? ` --tint ${entry.tint.join(',')}` : ''}${entry.tintMix != null ? ` --tint-mix ${entry.tintMix}` : ''}; its own clips dropped`];
  if (dry) return { id: entry.id, report: r.report, stats: r.stats, steps, bytes: r.bytes };
  writeFileSync(out, r.bytes);
  const check = await rigCheck(out);
  const sidecar = {
    id: entry.id, label: entry.label, file: `bodies/${entry.id}.glb`, from: 'library', kind: 'cc0', tags: entry.tags, describe: entry.describe,
    ...(entry.fits ? { fits: entry.fits } : {}),
    license: { spdx: src.spdx, author: src.author, url: src.page,
      source: `${src.page} "${src.title}" (${src.pack}), ${src.download} (sha256 ${src.sha256.slice(0, 8)}…${src.sha256.slice(-4)}, retrieved ${src.retrieved})`,
      note: `made by research/gf-three/tools/cc0-bodies.mjs: ${steps.join('; ')}` },
  };
  writeFileSync(out.replace(/\.glb$/, '.json'), JSON.stringify(sidecar, null, 2) + '\n');
  return { id: entry.id, ok: check.ok, errors: check.errors, warnings: check.warnings, report: r.report, bytes: r.bytes.length, height: check.metrics.height };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null;
  const list = JSON.parse(readFileSync(join(LIB, 'body-sources.json'), 'utf8'));
  const bodies = list.bodies.filter(b => !only || only.includes(b.id));
  if (args.includes('--fetch')) {
    mkdirSync(CACHE, { recursive: true });
    for (const id of new Set(bodies.map(b => b.source))) {
      const s = list.sources[id], f = join(CACHE, `${id}.glb`);
      if (!s) throw new Error(`source ${id} is not in body-sources.json`);
      if (!existsSync(f)) { console.log('fetch', s.download); writeFileSync(f, Buffer.from(await (await fetch(s.download)).arrayBuffer())); }
      const got = sha(readFileSync(f));
      if (got !== s.sha256) throw new Error(`${id}: sha256 ${got} differs from the record ${s.sha256}`);
    }
  }
  let bad = 0;
  for (const b of bodies) {
    const r = await buildBody(b, list.sources[b.source], { dry: args.includes('--dry') });
    if (r.stats) { console.log(`DRY  ${b.id.padEnd(30)} ${JSON.stringify(r.report.fix)} ${r.report.height} m`); continue; }
    if (!r.ok) bad++;
    console.log(`${r.ok ? 'PASS' : 'FAIL'} ${b.id.padEnd(30)} ${(r.bytes / 1e6).toFixed(2)} MB  ${r.height} m  facing fix ${r.report.fix.yawDeg}°${r.errors.length ? `\n  error: ${r.errors.join('\n  error: ')}` : ''}${r.warnings.length ? `\n  warn:  ${r.warnings.join('\n  warn:  ')}` : ''}`);
  }
  process.exitCode = bad ? 1 : 0;
}
