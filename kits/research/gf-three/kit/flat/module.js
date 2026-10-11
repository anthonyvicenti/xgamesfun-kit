// gf-three flat: the optional-module record (kit/vfx/module.js documents the contract). It is what makes `create` carry
// this folder into a flat game's gf/three/ and into no other game: gf-three.json → modules.extras lists "flat" exactly
// when the spec is a flat one. The flat look, world and body declare their slots through kit/flat/slots.js, which the
// slot assembler reads in place of the stand-ins' (tools/lib/slots-lib.mjs), so slotsFor has nothing to add.
export const id = 'flat';
export const describe = 'A flat (2D) game\'s look, world, picture bodies and camera (spec.engine "flat" with a plane)';
export const uses = spec => spec?.engine === 'flat';
export const configFor = () => null;
export const files = () => [];
export const slotsFor = () => [];
