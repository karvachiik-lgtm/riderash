/**
 * Loader for generated assets.
 *
 * Every asset in this system is a JavaScript module exporting a function of
 * THREE that returns a Group. This file turns one of those into something you
 * can place in a game: correctly scaled, sitting on the ground, and collapsed
 * to as few draw calls as the materials allow.
 *
 * COPY THIS FILE. Do not write your own.
 *
 * That is not stylistic advice. Each rule below is here because writing a
 * reasonable-looking loader without it silently destroyed a whole asset pack,
 * and the damage does not throw, does not warn, and does not show up until you
 * look at a screenshot and wonder why everything is a blob.
 *
 *  - An InstancedMesh is also an isMesh. Treat it as a plain mesh and you keep
 *    exactly one copy and delete the rest. A barrel built from instanced staves
 *    arrives as a smooth egg. See expandInstances below.
 *  - Merge by material VALUES, not identity. Generated assets build a fresh
 *    material object per part, so identity-merging merges nothing and a single
 *    prop arrives as forty draw calls.
 *  - Bucket by attribute signature too. Mixing geometry that carries a colour
 *    attribute with geometry that does not makes the merge drop colour, and a
 *    material with vertexColors renders the result black.
 *  - Scale by HEIGHT, never by fitting a bounding box. Fitting the smallest of
 *    three ratios silently halves anything whose proportions differ from what
 *    the caller assumed.
 */
import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { applySurfaces } from './surfaces.js';

const cache = new Map();   // url -> Promise<prototype>

function materialKey(m) {
  if (!m) return 'none';
  // Maps have to be part of the key. Two materials can agree on every scalar and
  // still carry different surfaces, and merging those produces an asset wearing
  // one part's texture on another part's geometry.
  const tex = (t) => (t ? `${t.uuid}:${t.repeat.x},${t.repeat.y}` : '-');
  return [
    m.type, m.color?.getHexString?.(), m.roughness, m.metalness, m.flatShading,
    m.transparent, m.opacity, m.side, m.emissive?.getHexString?.(), m.vertexColors,
    tex(m.map), tex(m.roughnessMap), tex(m.normalMap),
  ].join('|');
}

// materialKey without the colour: the bucket key for a vertex-colour merge.
function colourlessKey(m) {
  const tex = (t) => (t ? `${t.uuid}:${t.repeat.x},${t.repeat.y}` : '-');
  return [
    m.type, m.name, m.roughness, m.metalness, m.flatShading, m.transparent, m.opacity,
    m.side, m.emissive?.getHexString?.(), m.clearcoat ?? '-', m.clearcoatRoughness ?? '-',
    tex(m.roughnessMap), tex(m.normalMap),
  ].join('|');
}

/**
 * mergeGeometries refuses to combine geometries whose attribute sets differ
 * (some indexed and some not, some carrying uv). Generated assets build each
 * part independently, so one asset routinely mixes both. Normalise everything
 * to the same shape first: de-index, keep only shared attributes, drop morphs.
 */
function normaliseForMerge(geos) {
  const plain = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  let common = null;
  for (const g of plain) {
    const names = new Set(Object.keys(g.attributes));
    common = common ? new Set([...common].filter((n) => names.has(n))) : names;
  }
  if (!common || !common.has('position')) return null;
  for (const g of plain) {
    for (const name of Object.keys(g.attributes)) {
      if (!common.has(name)) g.deleteAttribute(name);
    }
    g.morphAttributes = {};
    g.clearGroups();
  }
  return plain;
}

/**
 * THE BUG THIS FILE EXISTS FOR.
 *
 * An InstancedMesh holds ONE prototype geometry plus a matrix per copy. Cloning
 * its geometry gives you the prototype at the origin and throws away every
 * placement. Expand it: one geometry per instance, instance matrix first, then
 * the mesh's own world matrix.
 */
function expandInstances(o, bucket) {
  const _m = new THREE.Matrix4();
  const _col = new THREE.Color();
  const ic = o.instanceColor;
  for (let i = 0; i < o.count; i++) {
    o.getMatrixAt(i, _m);
    const g = o.geometry.clone();
    g.applyMatrix4(_m);              // instance-local placement
    g.applyMatrix4(o.matrixWorld);   // then the mesh's own world transform
    // Instances can carry a per-instance colour via setColorAt. Merge without
    // baking it and every copy comes out the material's base colour.
    if (ic) {
      _col.fromArray(ic.array, i * 3);
      const n = g.attributes.position.count;
      const arr = new Float32Array(n * 3);
      for (let v = 0; v < n; v++) {
        arr[v * 3] = _col.r; arr[v * 3 + 1] = _col.g; arr[v * 3 + 2] = _col.b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    }
    bucket.geos.push(g);
  }
  if (ic && !bucket.mat.vertexColors) {
    bucket.mat = bucket.mat.clone();
    bucket.mat.vertexColors = true;   // or the bake above is wasted
  }
}

/**
 * Collapse a subtree to one mesh per distinct material value.
 *
 * Exported as bakeStatic() below, because the same operation is worth running a
 * second time at world scale. Each asset arrives already merged, but a city of
 * two hundred props is still two hundred separate objects and the draw calls
 * add up faster than the triangles do. Bake scenery that never moves.
 */
function mergeByMaterialValues(root) {
  const buckets = new Map();
  const skip = [];
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (o.isMesh && o.geometry) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      if (mats.length > 1) { skip.push(o); return; }   // multi-material: leave alone
      // BUCKET BY APPEARANCE ONLY -- NOT BY APPEARANCE AND ATTRIBUTE SIGNATURE.
      //
      // This key used to be `materialKey(mat) + '#' + signature`, where the
      // signature was the sorted attribute names. That split every material into
      // one bucket per attribute layout, so a part exported with a UV channel and
      // a part of the SAME material without one could never merge -- even though
      // `normaliseForMerge` below exists precisely to reconcile exactly that, by
      // keeping the attributes the geometries share and dropping the rest.
      //
      // The signature was therefore defeating the normaliser it sat in front of.
      // Measured on the rival bike: 38 meshes, 20 distinct materials, and TWO
      // materials carrying 9 meshes each. With the key fixed those 9-mesh groups
      // merge, and because there are 14 rivals the saving is multiplied by 14.
      //
      // The instanced-with-color flag is still part of the key: instanceColor is
      // not a geometry attribute `normaliseForMerge` can reconcile, so an
      // instanced mesh with per-instance colour and one without must not share a
      // bucket. Everything else is the normaliser's job.
      const k = materialKey(mats[0]) + (o.isInstancedMesh && o.instanceColor ? '#color' : '');
      if (!buckets.has(k)) buckets.set(k, { mat: mats[0], geos: [], cast: false, receive: false });
      const bucket = buckets.get(k);
      // Carry the shadow flags across the merge. A merged mesh is a NEW mesh and
      // castShadow defaults to false, so without this the merge silently switches
      // off every shadow its inputs had. Nothing throws, the scene still renders,
      // and nothing in it is attached to the ground any more. bakeStatic runs
      // over a whole dressed scene, which is exactly where it is most expensive
      // and hardest to spot.
      bucket.cast = bucket.cast || o.castShadow;
      bucket.receive = bucket.receive || o.receiveShadow;

      if (o.isInstancedMesh) { expandInstances(o, bucket); return; }

      const g = o.geometry.clone();
      g.applyMatrix4(o.matrixWorld);
      bucket.geos.push(g);
    } else if (o.isLight || o.isSprite || o.isPoints) {
      skip.push(o);
    }
  });

  const out = new THREE.Group();
  const shadowed = (m, cast, receive) => { m.castShadow = cast; m.receiveShadow = receive; return m; };
  for (const { mat, geos, cast, receive } of buckets.values()) {
    if (!geos.length) continue;
    let geo = geos.length === 1 ? geos[0] : null;
    if (!geo) {
      const ready = normaliseForMerge(geos);
      if (ready) {
        try { geo = BufferGeometryUtils.mergeGeometries(ready, false); }
        catch (err) {
          // Report the real reason instead of swallowing it. A merge that fails
          // silently is the difference between 200 draw calls and 900, and the
          // message costs nothing.
          if (!normaliseForMerge._warned) {
            normaliseForMerge._warned = true;
            console.warn('[assetlib] merge failed for', geos.length, 'geometries:', err && err.message);
          }
          geo = null;
        }
      }
      if (!geo) {
        // Merging is an optimisation, never a correctness requirement. If these
        // still will not combine, draw them separately rather than lose them.
        for (const g of geos) out.add(shadowed(new THREE.Mesh(g, mat), cast, receive));
        continue;
      }
    }
    out.add(shadowed(new THREE.Mesh(geo, mat), cast, receive));
  }
  for (const o of skip) {
    const c = o.clone();
    c.matrix.copy(o.matrixWorld);
    c.matrix.decompose(c.position, c.quaternion, c.scale);
    out.add(c);
  }
  return out;
}

// A deterministic, short serialisation of an options object, used only as a
// cache key. Sorted so two equal objects always produce the same string, and
// primitives only, so it cannot recurse into a three.js object graph.
function stableKey(o) {
  const parts = [];
  for (const k of Object.keys(o).sort()) {
    const v = o[k];
    if (v === null || v === undefined) { parts.push(`${k}:`); continue; }
    const t = typeof v;
    if (t === 'number' || t === 'string' || t === 'boolean') parts.push(`${k}:${v}`);
    else if (t === 'object') parts.push(`${k}:{${stableKey(v)}}`);
  }
  return parts.join(',');
}

async function loadPrototype(url, keepHierarchy = false, opts = null) {
  // THE CACHE KEY MUST INCLUDE THE OPTIONS. It used to be the URL and the
  // keepHierarchy flag only, and the builder was called as `fn(THREE)` with no
  // options at all. That is fine for scenery, which has none, but it made the
  // assets that DO take parameters unusable: the first rider built won the cache
  // and every later request got that same clone, and a caller passing
  // `{ spec }` had it silently dropped. Keying on a stable serialisation of the
  // options means each distinct body builds once and is then cloned cheaply,
  // which is the property the cache was for.
  const optKey = keepHierarchy ? '#tree' : '';
  const optSig = opts && Object.keys(opts).length
    ? '#' + stableKey(opts)
    : '';
  const key = url + optKey + optSig;
  if (cache.has(key)) return cache.get(key);
  const p = (async () => {
    const mod = await import(/* @vite-ignore */ new URL(url, location.href).href);
    const fn = mod.default || mod.build || mod.create;
    if (typeof fn !== 'function') throw new Error(`asset has no default export function: ${url}`);
    // Pass the options through. `fn(THREE, opts)` is the documented shape; a
    // builder that ignores its second argument is unaffected.
    const built = fn(THREE, opts || {});
    // Merging is what keeps the draw calls down and it is right for scenery. It
    // is also destructive: it collapses the hierarchy and drops everything the
    // asset attached to userData, so anything with moving parts arrives welded
    // solid, renders perfectly, and can never move. See keepHierarchy below.
    const merged = keepHierarchy ? built : mergeByMaterialValues(built);
    // Normalise so a placement coordinate means "put it here on the ground"
    // rather than "put its arbitrary origin here".
    //
    // UNLESS THE ASSET HAS ALREADY DONE IT. An articulated asset has to centre
    // itself anyway -- it needs its own rotation pivots to sit on a known origin
    // -- and it knows which pose means "standing". This loader does not: it
    // measures whatever pose the asset happened to be left in, and for the rider
    // that pose is the racing crouch, where the lowest point is the pelvis and not
    // a boot. Re-normalising then subtracts a number that means nothing and drops
    // the whole body below the saddle. Declaring `userData.grounded = true` says
    // "I have measured myself; trust my origin", and the loader honours it. Both
    // rider and bike declare it, so their origins are their own by contract and
    // the two normalisers cannot fight.
    const selfGrounded = !!(built && built.userData && built.userData.grounded);
    if (!selfGrounded) {
      const box = new THREE.Box3().setFromObject(merged);
      const c = box.getCenter(new THREE.Vector3());
      merged.position.set(-c.x, -box.min.y, -c.z);
    }
    const wrapper = new THREE.Group();
    wrapper.add(merged);
    wrapper.userData.nativeSize = new THREE.Box3().setFromObject(merged).getSize(new THREE.Vector3());
    wrapper.userData.grounded = selfGrounded;
    if (keepHierarchy) carryDeclarations(built, wrapper);
    return wrapper;
  })();
  cache.set(key, p);
  return p;
}

/**
 * An asset that moves names its moving parts on `userData`, as objects:
 *
 *   g.userData.joints = { leftUpperLeg, rightUpperLeg, head };
 *
 * Those references cannot survive a clone. `Object3D.copy` round-trips userData
 * through JSON, so a cloned instance's `userData.joints.head` is a plain object
 * with no methods, and code that rotates it changes nothing and throws nothing.
 * Copying the references onto the prototype and hoping is worse than dropping
 * them, because it looks like it worked.
 *
 * So the prototype records NAMES, and every instance resolves them against its
 * own tree. Parts without a name are given one, since most authors do not set it.
 */
const REF_PREFIX = '__part__';

/**
 * LOCAL MODIFICATION (RideRash): declare references at ANY DEPTH.
 *
 * The harness original handled two levels -- `userData.joints.torso`, and
 * `userData.joints.<sub>` where <sub> was itself a node. It skipped anything
 * deeper, and `assets/rider.js` publishes exactly that:
 *
 *   joints = { pelvis, torso, neck, head, chain,      <- depth 1, carried
 *              arms: { left: { shoulder, upper, elbow, fore }, right: {...} },
 *              legs: { ... },                          <- depth 3, DROPPED
 *              leftArm, rightArm, leftLeg, rightLeg }  <- depth 2, DROPPED
 *                      (these alias arms.left etc., so they are objects of
 *                       nodes, not nodes, and the old `some(isObject3D)` test
 *                       was false for them)
 *
 * MEASURED on the live player: the rider's resolved joint map came back with
 * only `pelvis, torso, neck, head, chain`. Every arm and leg key was gone, so
 * `poseRider`'s `rot(ra.upper, ...)` and `rot(L.thigh, ...)` had been writing to
 * undefined for the whole project and the rider had never moved a limb. Nothing
 * reveals it: the rider renders correctly, seated, and a still frame of a bike
 * at 100 mph looks identical either way. It is docs/asset-contract.md's
 * "renders perfectly and can never move a limb", arriving through the
 * declaration mechanism rather than through the merge.
 *
 * Within `refs`, a string is always a node NAME -- plain data never gets there,
 * because `declareRefs` returns undefined for it and the caller puts it straight
 * on the wrapper instead.
 */
function declareRefs(val, path) {
  if (val && val.isObject3D) {
    if (!val.name) val.name = `${REF_PREFIX}${path}`;
    return val.name;
  }
  // ARRAYS ARE REFERENCES TOO, and this branch did not exist. A list of nodes --
  // a chain's links, a row of chain joints, anything ordered and repeated -- fell
  // through to the `undefined` at the bottom and was silently dropped, so the
  // instance's `userData.chainJoints` was absent and any code posing it wrote to
  // undefined. It failed exactly like the depth-3 leg bug already documented
  // above: nothing throws, the asset renders, and only the motion is missing.
  //
  // Declared as an object with numeric keys and rebuilt as an array, because the
  // rebuild side has to know it is an array to return one.
  if (Array.isArray(val)) {
    const out = {};
    let any = false;
    for (let i = 0; i < val.length; i++) {
      const r = declareRefs(val[i], `${path}_${i}`);
      if (r !== undefined) { out[i] = r; any = true; }
    }
    return any ? { __array: true, items: out } : undefined;
  }
  if (val && typeof val === 'object') {
    const out = {};
    let any = false;
    for (const [k, v] of Object.entries(val)) {
      const r = declareRefs(v, `${path}_${k}`);
      if (r !== undefined) { out[k] = r; any = true; }
    }
    return any ? out : undefined;
  }
  return undefined;                     // plain data, not a reference
}

function carryDeclarations(src, wrapper) {
  const refs = {};
  for (const [key, val] of Object.entries(src.userData || {})) {
    if (key === 'nativeSize') continue;
    const r = declareRefs(val, key);
    if (r !== undefined) refs[key] = r;
    else wrapper.userData[key] = val;   // plain data survives a clone unharmed
  }
  if (Object.keys(refs).length) wrapper.userData[REF_PREFIX] = refs;
}

/** Rebuild the declared references against THIS instance's own nodes. */
function resolveDeclarations(inst) {
  const refs = inst.userData && inst.userData[REF_PREFIX];
  if (!refs) return;
  const byName = new Map();
  inst.traverse((o) => { if (o.name) byName.set(o.name, o); });
  // Mirrors declareRefs above: walk the same shape back, swapping each declared
  // NAME for this instance's own node. A whole branch that resolves to nothing
  // is dropped rather than left as a husk of nulls.
  const rebuild = (ref) => {
    if (typeof ref === 'string') return byName.get(ref) || undefined;
    if (ref && typeof ref === 'object') {
      // arrays come back as arrays, marked on the declare side
      if (ref.__array) {
        const items = [];
        for (const k of Object.keys(ref.items).sort((a, b) => (+a) - (+b))) {
          const r = rebuild(ref.items[k]);
          if (r !== undefined) items.push(r);
        }
        return items.length ? items : undefined;
      }
      const out = {};
      let any = false;
      for (const [k, v] of Object.entries(ref)) {
        const r = rebuild(v);
        if (r !== undefined) { out[k] = r; any = true; }
      }
      return any ? out : undefined;
    }
    return undefined;
  };
  for (const [key, val] of Object.entries(refs)) {
    const r = rebuild(val);
    if (r !== undefined) inst.userData[key] = r;
  }
  delete inst.userData[REF_PREFIX];
}

/**
 * ASSET(url, {height, surfaces, keepHierarchy}) -> a fresh Object3D you can
 * position and rotate.
 *
 * `height` is the finished height in metres; omit it to keep native scale.
 * `surfaces` applies procedural albedo, roughness and normal maps; see
 * docs/surfaces.md. Never throws into a game loop: an unloadable asset returns
 * an empty Group.
 *
 * `keepHierarchy: true` skips the merge. Use it for ANYTHING THAT MOVES.
 *
 * The default merge is what makes a two hundred prop street affordable, and it
 * is the wrong thing for a character, a door, a wheel or a lid. It welds every
 * part into one mesh per material and discards the asset's own userData with the
 * nodes it was attached to, so a figure exposing named limbs arrives with no
 * limbs to name. It renders perfectly. It simply never moves again, and no still
 * frame will ever show you that, which is why this option exists and why it is
 * documented here rather than in a footnote.
 *
 *   const crate  = await ASSET('assets/crate.js');                        // merged, cheap
 *   const person = await ASSET('assets/person.js', { keepHierarchy: true }); // articulated
 *
 * With keepHierarchy the asset's userData is copied onto the returned wrapper,
 * so `obj.userData.joints` works without knowing how the loader nested things.
 */
export async function ASSET(url, opts = {}) {
  let proto;
  try {
    proto = await loadPrototype(url, !!opts.keepHierarchy, opts);
  } catch (e) {
    console.warn('[assets]', url, e.message);
    return new THREE.Group();
  }
  const inst = proto.clone(true);
  if (opts.keepHierarchy) {
    // Name the joints FIRST, then merge within them. mergeJoints finds joints by
    // the `__part__` prefix that resolveDeclarations applies, so the order is not
    // optional -- merging before this would find no joints and do nothing.
    resolveDeclarations(inst);
    mergeJoints(inst);
  }
  const native = proto.userData.nativeSize;
  if (opts.height && native && native.y > 1e-6) {
    inst.scale.setScalar(opts.height / native.y);
  }
  inst.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  // Surfaces are applied per instance rather than on the cached prototype, so a
  // game can have a textured and an untextured copy of the same asset.
  if (opts.surfaces) applySurfaces(THREE, inst, opts.surfaces === true ? {} : opts.surfaces);
  return inst;
}

/** Preload in parallel so the first frame is not a slideshow. */
export async function preloadAssets(urls) {
  await Promise.all(urls.map((u) => loadPrototype(u).catch((e) => console.warn('[assets]', u, e.message))));
}

/**
 * bakeStatic(group) -> a new Group with the same appearance and far fewer draws.
 *
 * Shadow flags survive it. They did not always: a merged mesh is a new mesh and
 * `castShadow` defaults to false, so baking a dressed scene used to switch off
 * every shadow in it and leave nothing attached to the ground, with no error and
 * no warning. Only a critic sampling pixels under a counter leg found it.
 *
 * Use it on scenery that never moves, in chunks rather than all at once: one
 * bake per city block keeps frustum culling working, whereas baking the entire
 * world into one mesh means every block is drawn even when it is behind you.
 */
export function bakeStatic(root) {
  const baked = mergeByMaterialValues(root);
  // PRESERVE THE SOURCE ROOT'S OWN TRANSFORM.
  //
  // `mergeByMaterialValues` bakes each mesh's WORLD matrix into its geometry
  // and returns a fresh Group whose own transform is the identity. That is
  // correct only when the root you pass in is itself at the origin. Pass in a
  // root that is NOT -- and the bike asset is at (0.501, 0, 0.288) -- and the
  // baked result keeps the world offsets of the source geometry while losing
  // the transform that would have put it there.
  //
  // THE MEASURED SYMPTOM: the rider is placed at local (0, 0.62, -0.22) inside
  // the player group, but the baked bike's geometry sat at x +0.501 and
  // z +0.288, so the rider was seated half a metre OFF THE SIDE of the machine.
  // The bike looked right and the rider looked right in isolation; only their
  // relationship was wrong, which is why nothing threw and no scalar harness
  // noticed.
  //
  // The fix copies the root's local TRS onto the baked result, which restores
  // the contract callers already assume: "give me something that draws where the
  // thing you were given drew."
  baked.position.copy(root.position);
  baked.quaternion.copy(root.quaternion);
  baked.scale.copy(root.scale);
  return baked;
}

/** Native size of an already-loaded asset, for layout maths. */
export async function assetSize(url) {
  const p = await loadPrototype(url);
  return p.userData.nativeSize.clone();
}

/**
 * mergeJoints(root) -> the same rig with far fewer draws, still animatable.
 *
 * THE PROBLEM. The rider arrives with `keepHierarchy`, because it is a jointed
 * rig and the full merge would weld it solid. So it never got merged at all, and
 * a single rider costs ~38 draw calls. Fourteen of them is why the pack blew the
 * draw budget on its own.
 *
 * WHY THE OBVIOUS FIX DOES NOT WORK. Merging each joint's meshes by MATERIAL
 * OBJECT identity saves 3 draws (38 -> 35): the rig has 38 meshes carrying 35
 * distinct material objects. The meshes are not the problem.
 *
 * WHAT ACTUALLY WORKS, and the measurement that proves it: those 35 materials
 * have only **9 distinct APPEARANCES**. The rig is authored with many
 * duplicate-looking materials -- the chain alone is 7 meshes with 7 different
 * material objects that all look like the same metal. Keying the merge on
 * `materialKey` (appearance, the same key `mergeByMaterialValues` uses) instead:
 *
 *     per joint, by object identity ....... 38 -> 35   (saves 3)
 *     per joint, by APPEARANCE ............ 38 -> 27   (saves 11)
 *         ... and the chain:                     7 -> 1
 *
 * MEASURED on the live rider rig with `_drawcount` in the browser.
 *
 * WHY IT IS SAFE. The merge happens WITHIN a joint, and a joint's own meshes
 * never move relative to each other -- that is what a joint is. Merging across
 * joints would fuse an elbow to a shoulder and break the skinning, so this walks
 * the tree and merges only direct mesh children of each `__part__` node, leaving
 * the joint hierarchy itself untouched. It cannot make a rider unable to move,
 * which is the failure mode `keepHierarchy` exists to prevent.
 *
 * Joint nodes are found by the `__part__` name prefix, which is the same marker
 * `carryDeclarations` uses to publish them, so there is one definition of "this
 * is a joint" in the codebase.
 */
/**
 * `opts.vertexColors`: bucket by every material property EXCEPT colour, and bake
 * each part's colour into a per-vertex `color` attribute. Three.js issues one
 * draw call per material (and one per group of a multi-material mesh), so a
 * joint painted in six colours cost six draws even after merging -- measured,
 * ~50 meshes per vehicle. Colour is the property that varies most between the
 * parts of one joint and the only one a vertex attribute can carry for free.
 *
 * `opts.keepColour(hex)` returns true for colours that must stay a material of
 * their own (a game that looks a material up by its colour after the merge).
 */
export function mergeJoints(root, opts = {}) {
  const vc = !!opts.vertexColors;
  const keepColour = opts.keepColour || (() => false);
  // Collect the joint nodes first: merging mutates children, so the traversal
  // must not be walking the tree while it is edited.
  const joints = [];
  // `opts.allNodes`: every node, not only `__part__` joints. Direct mesh
  // children of ANY node share that node's transform, so fusing them can never
  // break articulation -- which is what makes it safe to include the bike's
  // chassis group (80 rigid meshes under one anonymous node, never merged
  // because it is not a joint). Anything the rig's joint map points at is
  // protected, in case a joint is a mesh itself.
  const pinned = new Set();
  if (opts.allNodes) {
    root.traverse((n) => {
      const j = n.userData && n.userData.joints;
      if (!j) return;
      const walk = (v) => {
        if (!v) return;
        if (v.isObject3D) pinned.add(v);
        else if (typeof v === 'object') for (const k in v) walk(v[k]);
      };
      walk(j);
    });
  }
  root.traverse((n) => {
    if (opts.allNodes ? !n.isMesh : (n.name && n.name.startsWith('__part__'))) joints.push(n);
  });

  for (const joint of joints) {
    // Only DIRECT mesh children. A child joint is left alone so its own subtree
    // stays articulated.
    const meshes = joint.children.filter((c) => c.isMesh && c.geometry && !c.isSkinnedMesh
      && !c.isInstancedMesh && !pinned.has(c));
    if (meshes.length < 2) continue;

    // Bucket by appearance, exactly as mergeByMaterialValues does.
    const buckets = new Map();
    for (const mesh of meshes) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      if (mats.length !== 1) continue;          // multi-material: leave it be
      const m0 = mats[0];
      const bakeable = vc && m0 && m0.color && !m0.map && !m0.vertexColors && !keepColour(m0.color.getHex());
      const k = bakeable ? 'vc|' + colourlessKey(m0) : materialKey(m0);
      if (!buckets.has(k)) buckets.set(k, { mat: m0, geos: [], cast: false, receive: false, meshes: [], vc: bakeable, cols: [] });
      const b = buckets.get(k);
      b.cast = b.cast || mesh.castShadow;
      b.receive = b.receive || mesh.receiveShadow;
      b.meshes.push(mesh);
      // Meshes are siblings under the joint, so their LOCAL matrices are already
      // in the joint's space -- no world bake needed, unlike the scene merge.
      const g = mesh.geometry.clone();
      g.applyMatrix4(mesh.matrix);
      b.geos.push(g);
      b.cols.push(m0.color);
    }

    const rebuilt = [];
    for (const { mat, geos, cast, receive, meshes: src, vc: bake, cols } of buckets.values()) {
      if (geos.length < 2) { rebuilt.push(...src); continue; }
      let geo = null;
      const ready = normaliseForMerge(geos);
      if (ready && bake) {
        // Colour as a vertex attribute, in the material's (linear) working space,
        // so material.color = white * attribute reproduces each part exactly.
        ready.forEach((g, i) => {
          const n = g.attributes.position.count, a = new Float32Array(n * 3), c = cols[i];
          for (let j = 0; j < n; j++) { a[j * 3] = c.r; a[j * 3 + 1] = c.g; a[j * 3 + 2] = c.b; }
          g.setAttribute('color', new THREE.BufferAttribute(a, 3));
        });
      }
      if (ready) {
        try { geo = BufferGeometryUtils.mergeGeometries(ready, false); }
        catch (err) { geo = null; }
      }
      if (!geo) { rebuilt.push(...src); continue; }   // never lose geometry
      let useMat = mat;
      if (bake) {
        useMat = mat.clone();
        useMat.color.setRGB(1, 1, 1);
        useMat.vertexColors = true;
        useMat.userData = { ...(mat.userData || {}), vertexColoured: true };
      }
      const merged = new THREE.Mesh(geo, useMat);
      merged.castShadow = cast;
      merged.receiveShadow = receive;
      merged.name = (joint.name || 'node') + '_merged';
      rebuilt.push(merged);
    }

    // Swap the joint's mesh children for the merged set, preserving anything
    // that is not a mesh (child joints, helpers).
    const keep = joint.children.filter((c) => !c.isMesh);
    for (const m of meshes) joint.remove(m);
    for (const m of rebuilt) joint.add(m);
    void keep;
  }
  return root;
}
