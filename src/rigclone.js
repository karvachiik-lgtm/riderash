// Cloning an articulated asset.
//
// Object3D.clone() deep-copies the node tree, but userData is copied by value
// for plain data and by REFERENCE for object-valued keys. The rider publishes
// `userData.joints = { leftArm: <Object3D>, ... }` — so a plain clone leaves
// those keys pointing at the ORIGINAL tree's nodes. Setting a rotation on
// `clone.userData.joints.leftArm` then rotates the prototype, not the clone,
// and every clone in the scene moves together.
//
// It also throws the moment the prototype has been detached, which is how it
// reads in a console: "Cannot set properties of undefined (setting 'x')".
//
// So: clone, then walk both trees in lockstep and rebuild the joint map against
// the clone's own nodes. Any userData key that holds an Object3D is remapped.
import * as THREE from 'three';

export function cloneWithJoints(src) {
  const copy = src.clone(true);
  remapUserData(src, copy);
  return copy;
}

function remapUserData(origRoot, copyRoot) {
  // Build a path from the original tree to each node, so we can find the
  // corresponding node in the copy by the same path.
  const pathToCopy = new Map();
  (function walk(a, b, path) {
    pathToCopy.set(a, { node: b, path });
    const n = Math.min(a.children.length, b.children.length);
    for (let i = 0; i < n; i++) walk(a.children[i], b.children[i], path.concat(i));
  })(origRoot, copyRoot, []);

  const find = (path) => {
    let n = copyRoot;
    for (const i of path) n = n.children[i];
    return n;
  };

  // Remap to ANY DEPTH, not one level.
  //
  // This used to walk a single level of nesting, which covered `joints.torso`
  // but not `joints.arms.right.upper` -- and the rider's arms and legs are
  // exactly that shape:
  //
  //   joints = { torso, neck, head,            <- depth 1, worked
  //              arms: { left:  { shoulder, upper, elbow, fore },
  //                      right: { ... } },     <- depth 3, silently dropped
  //              legs: { ... },
  //              leftArm, rightArm, ... }      <- depth 2, silently dropped
  //
  // MEASURED on the live player: the clone's joint map came back holding only
  // `pelvis, torso, neck, head, chain` as real Object3Ds. Every arm and leg key
  // was gone. So `poseRider`'s arm and leg lines -- `rot(ra.upper, ...)`,
  // `rot(L.thigh, ...)` -- had been writing to nothing, and the rider had never
  // moved a limb. Nothing shows it: the rider renders perfectly, seated, and a
  // still frame of a bike at 100 mph looks exactly the same either way. It is
  // the failure docs/asset-contract.md warns about, arriving through the clone
  // rather than through the merge.
  //
  // three.js is what loses them: Object3D.copy() does
  // `JSON.parse(JSON.stringify(source.userData))`, so an Object3D stored in
  // userData comes back as a serialised {metadata, geometries, materials,
  // object} blob rather than a node. Rebuilding the whole structure against the
  // copy's own tree is the only thing that gives the clone working joints.
  const remap = (val, depth) => {
    if (!val || typeof val !== 'object' || depth > 6) return val;
    if (val.isObject3D) {
      const hit = pathToCopy.get(val);
      return hit ? find(hit.path) : val;
    }
    if (Array.isArray(val)) return val.map((v) => remap(v, depth + 1));
    const out = {};
    for (const k of Object.keys(val)) out[k] = remap(val[k], depth + 1);
    return out;
  };

  for (const [orig, { path }] of pathToCopy) {
    const ud = orig.userData;
    if (!ud) continue;
    const target = find(path);
    for (const key of Object.keys(ud)) {
      const val = ud[key];
      if (val && typeof val === 'object') target.userData[key] = remap(val, 0);
    }
  }
}
