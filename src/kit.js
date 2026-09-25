// RideRash — what each rider RIDES and WEARS: bike class, livery, helmet, torso gear.
//
// WHY THIS EXISTS. Every rival was the same bike and the same rider recoloured, so the
// pack read as six copies of one object. Road Rash's grid was visibly mixed -- rat bikes,
// sport bikes, superbikes -- and the riders were individuals. This module deals the
// machines (assets/bike*.js, four classes sharing one joint and contact contract) and the
// cosmetics (assets/gear_*.js) and applies them, so rivals.js / player.js / cops.js each
// make one call instead of three copies of the recolour-and-mount logic.
//
// NOTHING HERE ADDS A DRAW CALL THE MERGE CANNOT FOLD. Bikes are recoloured BEFORE
// mergeJoints (colour becomes a vertex attribute), and gear meshes are re-parented
// DIRECTLY onto the rider's head / torso joint before that rider is merged. The gear is
// built from the rider's own material classes (see the kit comment in the gear modules),
// so it fuses into the joint's existing buckets. MEASURED numbers are in the report of the
// change that introduced this file.
import * as THREE from 'three';
import gearHelmetRace from '../assets/gear_helmet_race.js';
import gearHelmetOpen from '../assets/gear_helmet_open.js';
import gearBackpack from '../assets/gear_backpack.js';
import gearVest from '../assets/gear_vest.js';

export const BIKE_KINDS = ['sport', 'naked', 'super', 'muscle'];

// The career garage (career.js BIKES) -> the machine you see. The rat is a rat bike;
// the brawler is the heavy one; works and super are race replicas.
export const BIKE_FOR_TIER = { rat: 'naked', racer: 'sport', brawler: 'muscle', works: 'super', super: 'super', mono: 'mono' };

// AUTHORED, not rolled: the pack is five slots and each one is a look someone chose, so
// the same slot is the same silhouette every race and no two neighbours match. The
// bodywork colour stays RIVAL_COLORS[slot] (the radar dot and the HUD use it); these add
// the second colour, the machine class and the kit.
const PACK = [
  { bike: 'super',  accent: 0xd8d2c4, helmet: 'race', shell: 0xf0efe8, hAccent: 0x2a6bd4, visor: 0x2a4a7a, torso: 'vest', vest: 0x1f2b3a, vAccent: 0xd8d2c4 },
  { bike: 'naked',  accent: 0x1b1b1e, helmet: 'open', shell: 0x3a2a1c, hAccent: 0x8a1f1f, torso: 'backpack', pack: 0x6b4a2e },
  { bike: 'muscle', accent: 0x17191b, helmet: 'race', shell: 0x1a1d20, hAccent: 0xd4622a, visor: 0x8a6a2a, torso: null },
  { bike: 'sport',  accent: 0x17191b, helmet: 'race', shell: 0xb9a44a, hAccent: 0x1a1d20, visor: 0x2a333c, torso: 'backpack', pack: 0x3a2a12 },
  { bike: 'super',  accent: 0x17191b, helmet: 'open', shell: 0x1a1d20, hAccent: 0x3f5a3a, torso: 'vest', vest: 0x4a1f1f, vAccent: 0xd4622a },
  { bike: 'naked',  accent: 0xd8d2c4, helmet: 'race', shell: 0x8a1f1f, hAccent: 0xf0efe8, visor: 0x2a333c, torso: null },
  { bike: 'muscle', accent: 0x17191b, helmet: 'open', shell: 0x6b6259, hAccent: 0x2f4a6b, torso: 'backpack', pack: 0x2a2624 },
];
/** Gear module ids a kit puts on ('gear_helmet_race', 'gear_vest', ...), for display. */
export function gearIds(kit) {
  const ids = [];
  if (kit && (kit.helmet === 'race' || kit.helmet === 'open')) ids.push(`gear_helmet_${kit.helmet}`);
  if (kit && kit.torso) ids.push(`gear_${kit.torso}`);
  return ids;
}
/** Human-facing names of the bike classes, for cards and menus (shape, not text in-world). */
export const BIKE_CLASS_NAMES = { sport: 'Sport-tourer', naked: 'Standard', super: 'Superbike', muscle: 'Power cruiser' };
export function packKit(slot) { return PACK[((slot % PACK.length) + PACK.length) % PACK.length]; }

/** The bike prototype for a class, falling back to the hero if that class failed to load. */
export function bikeSource(assets, kind) {
  return (assets.bikes && assets.bikes[kind]) || assets.bike;
}

/**
 * Recolour a (cloned, not yet merged) bike's livery. The bike modules tag their paint
 * materials `userData.livery = 'body' | 'accent'`, so this touches exactly those and
 * never the chrome, rubber or copper -- the old rule was a list of hexes to SKIP, which
 * silently painted any colour a new part introduced. Materials are shared between clones,
 * so each is cloned once per bike before it is changed.
 */
export function paintBike(bike, body, accent) {
  const done = new Map();
  let tagged = 0;
  bike.traverse((n) => {
    if (!n.isMesh || !n.material || Array.isArray(n.material)) return;
    const m = n.material, tag = m.userData && m.userData.livery;
    if (!tag) return;
    tagged++;
    const hex = tag === 'body' ? body : tag === 'accent' ? accent : null;
    if (hex == null) return;
    if (!done.has(m)) { const c = m.clone(); c.color.setHex(hex); done.set(m, c); }
    n.material = done.get(m);
  });
  return tagged;
}

/**
 * Put gear on a rider: build the module for this body, re-parent its meshes straight onto
 * the target joint (so the rider's per-joint merge folds them in), and -- for a helmet --
 * remove the base helmet first. Call BEFORE mergeJoints(rider).
 *
 * The head joint's own meshes are all helmet in assets/rider.js (shell, visor, chin bar,
 * stripe; the neck is on the neck joint), so a replacement helmet removes them all. The
 * open-face helmet brings its own face and scarf for that reason.
 */
export function dressRider(rider, kit) {
  const j = rider && rider.userData && rider.userData.joints;
  const spec = rider && rider.userData && rider.userData.spec;
  if (!j || !kit) return 0;
  let n = 0;
  if (kit.helmet === 'race' || kit.helmet === 'open') {
    const build = kit.helmet === 'race' ? gearHelmetRace : gearHelmetOpen;
    const gear = build(THREE, { spec, shell: kit.shell, accent: kit.hAccent, visor: kit.visor });
    if (j.head) {
      for (const c of [...j.head.children]) if (c.isMesh) j.head.remove(c);
      n += mount(j.head, gear);
    }
  }
  if (kit.torso === 'backpack' && j.torso) n += mount(j.torso, gearBackpack(THREE, { spec, leather: kit.pack }));
  if (kit.torso === 'vest' && j.torso) n += mount(j.torso, gearVest(THREE, { spec, leather: kit.vest, accent: kit.vAccent }));
  // DATA API for UI (character cards, showroom): what this rider is wearing and riding.
  rider.userData.gearIds = gearIds(kit);
  rider.userData.bikeClass = kit.bike || null;
  return n;
}

const _inv = new THREE.Matrix4(), _rel = new THREE.Matrix4();
function mount(joint, gear) {
  const at = gear.userData && gear.userData.mount;
  if (at && at.position) gear.position.fromArray(at.position);
  joint.add(gear);
  joint.updateMatrixWorld(true);
  _inv.copy(joint.matrixWorld).invert();
  const meshes = [];
  gear.traverse((o) => { if (o.isMesh) meshes.push(o); });
  for (const m of meshes) {
    _rel.multiplyMatrices(_inv, m.matrixWorld);
    _rel.decompose(m.position, m.quaternion, m.scale);
    joint.add(m);           // re-parent flat onto the joint: same pose, mergeable
  }
  joint.remove(gear);
  return meshes.length;
}
