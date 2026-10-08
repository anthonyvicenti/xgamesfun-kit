# gf-humanoid-1: the games.fun character standard

Every player character is a GLB on one skeleton standard. Bodies swap freely, all bodies play the same clips, and any GLB that passes `tools/rig-check.mjs` is a valid body or skin. The data lives in `rig.js` (shared by the runtime and the tools), so this page and the code can't drift.

## 1. Space and units

| Rule | Value |
|---|---|
| Units | metres |
| Up | +Y |
| Forward | +Z (the character faces +Z) |
| Left | +X (the character's own left hand is on +X) |
| Origin | between the feet, on the ground (y = 0) |
| Height | 0.5–3 m standing (players are 1–2 m; `rig-check` warns outside 0.9–2.2) |

## 2. Bones

Names are the Mixamo-style names Meshy's auto-rig emits, so a Meshy body needs no renaming. Fingers use Mixamo names.

| Bone | Parent | Required |
|---|---|---|
| `Hips` | (root of the skeleton) | yes |
| `Spine02` | `Hips` | |
| `Spine01` | `Spine02` | |
| `Spine` | `Spine01` (the chest: it parents the neck and shoulders) | yes |
| `neck` | `Spine` | |
| `Head` | `neck` | yes |
| `head_end`, `headfront` | `Head` | |
| `LeftShoulder` | `Spine` | |
| `LeftArm` | `LeftShoulder` | yes |
| `LeftForeArm` | `LeftArm` | yes |
| `LeftHand` | `LeftForeArm` | yes |
| `LeftHand{Thumb,Index,Middle,Ring,Pinky}{1,2,3}` | `LeftHand`, then each other | |
| `LeftUpLeg` | `Hips` | yes |
| `LeftLeg` | `LeftUpLeg` | yes |
| `LeftFoot` | `LeftLeg` | yes |
| `LeftToeBase` | `LeftFoot` | |
| `Right…` | the same on the right | as left |

- **Parents.** When an optional bone is missing, a bone hangs under its nearest existing canonical ancestor. `rig-check` checks this.
- **Extra bones** are allowed: tails, ears, hair, accessories. The clips don't move them, so they ride along with their parent.
- **Other rigs** are renamed by `optimize.mjs --normalize`, which recognises:
  - Mixamo (`mixamorig:` prefix; `Spine`, `Spine1`, `Spine2` become `Spine02`, `Spine01`, `Spine`);
  - Rigify `DEF-*` (Quaternius UAL);
  - Quaternius (`Abdomen`, `Torso`, `Chest`, `UpperArm.L`, `LowerArm.L`, `Wrist.L`, `UpperLeg.L`, …).
  
  It also re-hangs bones in the standard tree and drops unweighted IK helpers. A weighted bone above the hips (Quaternius `Body`) is merged into `Hips`.

## 3. Rest pose and bone frames

- **A body may rest in any reasonable pose,** A-pose or T-pose, with any bone frames. At load, `rig.js` measures two things per bone:
  - its bind rotation `B`;
  - a swing `R` that lines the upper arm, forearm, thigh and shin up with the standard's T-pose. Hands, fingers, feet and toes inherit their parent's swing; the spine, neck, head and shoulders keep the body's own posture.
  
  Each frame, `world = D · R · B`, where `D` is the clip's rotation of that bone from the T-pose. The hips move by the clip's hip offset, scaled by the body's hip height. This costs two constant quaternions per bone.
- **The bind frame is recovered from the hips:** `frame = hipsNodeWorld · IBM(hips)`, per skinned mesh. That covers files exported under a scaled or rotated armature (Quaternius), and per-mesh quantisation, where gltf-transform puts the dequantisation into each skin's IBMs.
- **Library bodies are normalised** (`optimize.mjs --normalize`). Joints have identity rest rotations, the skinned meshes sit at identity under one root node `gf_body`, and there is one skeleton.
- **`rig-check` warns** when a limb rests more than 70° from the T-pose, because lining it up stretches the skin there.
- **Leg scale.** The hips move by the clip's offset times `k`, the body's straight-leg reach (hip drop, thigh, shin and ankle height) over the standard's. A body resting with its legs apart therefore keeps its feet on the ground.
- **Body extras** (on the `gf_body` node):
  - `gfSpineBend` (0–1, default 1) damps the clip's spine and head bend relative to the hips. One-piece bodies fold at the waist otherwise, and their face slides off the body; the beans use 0.4.
  - `gfTint` and `gfTintMix` control tinting (§8).
  - `gfFaces` (optional) lists expressions, each as the material names it shows and hides: the beans carry `{ "hurt": { "show": ["face_hurt", "mouth_hurt"], "hide": ["eye_white", "eye_dark", "mouth"] } }` (eyes squeezed shut as > <, an open mouth). The `show` meshes stay hidden until `character.express(name)`; a knocked-down body shows `hurt` by itself. A body without `gfFaces` keeps one face.

## 4. Clips (`library/clips/gf-humanoid-1.glb`)

The clip file holds the *standard skeleton*: canonical names, identity rest rotations, and UAL's T-pose proportions with the hips at 0.917 m. On it are a rotation track for every standard bone and a translation track for the hips, so any clip blends with any other. Metadata for each clip is in the `gf_humanoid_1` node's extras, `gfClips[name]`:
- `loop`;
- `layer` (`base` or `upper`);
- `duration`;
- `speed` (gait clips, m/s at the standard's size);
- `start` (get-ups: where the hips begin);
- `source`.

| Clip | From | Layer | Notes |
|---|---|---|---|
| `idle` `walk` `run` | UAL Idle_Loop, Walk_Loop, Jog_Fwd_Loop | base | walk 1.04 m/s measured; run 3.9 m/s |
| `jump` `fall` `land` | Jump_Start, Jump_Loop, Jump_Land | base | the runtime skips the jump's crouch and plays it at 1.6× |
| `hit` | Hit_Chest | upper | |
| `knockdown` | Death01 | base | falls on its back, about 0.5 m backward |
| `getup` | authored | base | from lying on the back (head toward −Z) to standing at the origin |
| `aim` | Pistol_Aim_Neutral | upper | `aim_up` and `aim_down` blend by `setAim(pitch)` |
| `carry` | authored on Idle_Loop | upper | both hands in front of the chest |
| `interact` | Interact | upper | |
| `emote_wave` `emote_cheer` | authored on Idle_Loop | base | cancelled when the character moves |

**Extra clips:**

| Clip | From |
|---|---|
| `sprint` | Sprint_Loop, 6.6 m/s |
| `getup_front` | authored, from face down |
| `hit_head` | Hit_Head |
| `throw` | Spell_Simple_Shoot (upper) |
| `punch` | Punch_Jab (upper) |
| `pickup` | PickUp_Table |
| `push` | Push_Loop |
| `crouch`, `crouch_walk` | Crouch_Idle_Loop, Crouch_Fwd_Loop |
| `roll` | Roll |
| `sit` | Sitting_Idle_Loop |
| `swim`, `swim_idle` | Swim_Fwd_Loop, Swim_Idle_Loop |
| `emote_dance` | Dance_Loop |
| `emote_talk` | Idle_Talking_Loop |

The file is about 0.5 MB: rotation keys are normalised int16, and it is meshopt-compressed. `tools/retarget.mjs` rebuilds it from the pinned UAL source (`pmndrs/ecctrl@e2cab80`, sha-checked). Licence: CC0 (Quaternius); the authored clips are games.fun's.

## 5. Sockets

`character.socket(name)` returns an `Object3D` on a bone. Its frame is aligned with the character at the standard rest pose (+Z forward, +Y up), and its scale is in metres whatever the bone's own scale. A body may place its own socket by adding an empty node named `socket_<name>` under the bone.

| Socket | Bone | Where |
|---|---|---|
| `head` | `Head` | top of the head; a hat's origin goes here |
| `hand_r`, `hand_l` | `RightHand`, `LeftHand` | the palm; +Z runs along the hand, so a held item points where the hand points |
| `back` | `Spine` | the back's surface at chest height (backpacks, tanks) |

## 6. Ragdoll

The ragdoll has 11 Rapier bodies:

| Part | Bone it drives | Shape and joint |
|---|---|---|
| `pelvis` | `Hips` | capsule to `Spine01` |
| `torso` | `Spine01` | capsule to `neck`; spherical joint at the pelvis, ±0.4 rad per axis |
| `head` | `Head` | ball; spherical joint at the neck, ±0.35 rad per axis |
| upper arms | `LeftArm`, `RightArm` | spherical joint at the shoulder, ±1.1 rad per axis |
| forearms | `LeftForeArm`, `RightForeArm` | revolute elbow, 0–143° from the knock pose |
| thighs | `LeftUpLeg`, `RightUpLeg` | spherical joint at the hip, ±0.9 rad per axis |
| shins | `LeftLeg`, `RightLeg` | revolute knee |

- **Radii** are the 70th percentile of the skin's distance to each segment, so a bean gets a fat torso and a soldier gets thin arms.
- **Joint limits** are relative to the pose the body was knocked in (Rapier's per-axis angular limits, set through the
  joint's raw set because its JS API only limits revolute joints). Free ball joints let a head spin up to 180° on the
  neck, which looked like the head tearing off the body (`character.js` `SWING`; `tests/p-character.test.mjs`).
- **Launch velocity** is the knock plus the body's own movement, which the character measures from `object3d`. A jump
  of more than 2.5 m or 40 m/s between two updates is a placement (spawn, respawn, a get-up, a first pose), not motion;
  what a ragdoll inherits is capped at 14 m/s and a part never leaves faster than 30 m/s. (Spawning at the origin, then
  being placed at a spawn point, used to read as ~300 m/s: a knock in the next frames threw the ragdoll hundreds of metres.)
- **Knocked again while down**, the ragdoll it is gets the shove; it is not rebuilt.
- **Physics shape:** `ctx.physics` may be the bare Rapier `World` (with `ctx.RAPIER`, K1's boot) or `{ RAPIER, world }`;
  it is read through `kit/core/util.js` `physicsOf(ctx)`.
- **Look:** `spawnCharacter` runs the body through `ctx.look.adoptMaterials(model, 'character')` (the house character
  material) before it clones the `tint_*` materials, and a hat through `'prop'`. Without a look, the GLB's own materials stay.
- **Collision groups** (RAPIER `InteractionGroups`, membership << 16 | filter):

  | Group | Bit |
  |---|---|
  | `WORLD` | 0x1 |
  | `PLAYERS` | 0x2 |
  | `PROPS` | 0x4 |
  | `RAGDOLL` | 0x8 |

  Ragdoll parts are members of `RAGDOLL` and collide with `WORLD | PROPS` only.
- **Getting up:**
  1. Once the ragdoll settles (fastest part under 0.35 m/s, after at least 0.7 s, at most 4 s), the character picks `getup` (on its back) or `getup_front` (face down).
  2. It turns the clip so the head points where the ragdoll's head lies.
  3. It blends from the ragdoll pose over 0.38 s.
  4. While it stands up, the model drifts from where it lay onto `object3d`, the capsule's spot.

## 7. Budget (rig-check)

| Measure | Target (warn) | Limit (fail) |
|---|---|---|
| File | 2.5 MB | 6 MB |
| Triangles | 30k | 60k |
| Texture side | 1024 px | 2048 px |
| Joints | 90 | 160 |
| Materials | 8 | 24 |

- Influences: 4 per vertex, and no `JOINTS_1`.
- `optimize.mjs` gets there:
  - textures go to 1024 px JPEG;
  - Meshy's emissive copy of the albedo is stripped;
  - quantise and meshopt (the kit's GLTFLoader has the meshopt decoder).
- KTX2 is not produced yet, because `toktx` is not installed.

## 8. Tint

- Materials named `tint_*`, or listed in the `gf_body` node's `gfTint` extras, are cloned per character. `setTint(c)` moves them toward `c` by `gfTintMix` (0–1, default 1).
- Beans and the mannequin tint fully. The SWAT body uses 0.4. A Meshy body uses 0, because its texture is its identity; the nameplate and the kit's ring carry the player's colour.

## 9. Runtime API (`character.js`)

```js
const c = await spawnCharacter(ctx, { player, bodySlot: 'character.body.player', tint, local, height, clipsSlot, plate: null | 'sprite', onState });
c.object3d                       // place it (the controller sets position and rotation.y every frame)
c.update(dt)                     // every frame, after placing it
c.locomotion(speed, grounded, vy)// idle/walk/run/sprint by speed at this body's stride; jump/fall/land from grounded and vy
c.play(name, {loop, fade, hold, rate, layer})  c.stop(name | 'upper' | 'base')  c.setAim(pitch)
c.knock({x, y, z})               // ragdoll with this velocity, then get up; ragdoll(true|false) for the controller's 'knockdown' word
c.socket('head' | 'hand_r' | 'hand_l' | 'back')   c.setTint(color)   c.nameplate(text, color)   c.dispose()
c.express('hurt', seconds)       // a face from gfFaces (§3) for a while; calling again keeps it; null for the neutral face
c.height  c.hipHeight  c.state ('anim' | 'ragdoll' | 'getup')  c.anim  c.face  c.faces  c.clips  c.meta  c.bones  c.plate {text, color}
```

`slotsFor(cfg)` declares, for each role in `config/characters.json`:

| Slot | What it is |
|---|---|
| `character.body.<role>` | model (`constraints.rig: "gf-humanoid-1"`, `animations: CLIPS`, a `generate` hint for `meshy-character.mjs`) |
| `character.tint.<role>` | colours |
| `character.height.<role>` | the height |
| `character.hat.<role>` | a hat (optional) |
| `character.clips` | the shared clips (read-only) |
