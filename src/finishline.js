// RideRash — the finish line you can see coming.
//
// The race ended at a number (`state.finishS`) with nothing on the road to say
// so: no gantry, no chequer, no warning that the last corner was the last. A
// Road Rash finish is a banner you ride under. This builds one gantry and moves
// it to each race's finish in __START__; it is code-built (no assets, see
// HANDOFF §4.2) and costs a handful of draws.
import * as THREE from 'three';
import { CFG } from './config.js';
import { centreAt, headAt } from './level.js';
import { edgeAt } from './lanes.js';

function chequerTexture(cols = 16, rows = 2) {
  const c = document.createElement('canvas');
  c.width = cols * 16; c.height = rows * 16;
  const g = c.getContext('2d');
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      g.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f0';
      g.fillRect(x * 16, y * 16, 16, 16);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.anisotropy = 4;
  return t;
}

function textTexture(text) {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#b3121b'; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#fff';
  g.font = 'bold 92px Impact, "Arial Black", sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, c.width / 2, c.height / 2 + 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * THE START is a line on the road and a person with a flag (src/flagger.js),
 * as in Road Rash -- no gantry. The same chequered strip as the finish.
 */
export function buildStartLine() {
  const g = new THREE.Group();
  g.name = 'start';
  const strip = new THREE.Mesh(new THREE.PlaneGeometry(CFG.ROAD_W, 1.2),
    new THREE.MeshStandardMaterial({ map: chequerTexture(20, 2), roughness: 0.8, name: 'finish_strip' }));
  strip.rotation.x = -Math.PI / 2;
  strip.position.y = 0.03;
  strip.receiveShadow = true;
  g.add(strip);
  return g;
}

export function buildFinish(label = 'FINISH') {
  const g = new THREE.Group();
  g.name = label.toLowerCase();
  const span = CFG.ROAD_W + CFG.KERB_W * 2 + 1.6;
  const H = 6.2;
  const steel = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.45, metalness: 0.6, name: 'finish_steel' });
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.35, H, 0.35), steel);
    post.position.set(s * span / 2, H / 2, 0);
    g.add(post);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(span + 0.4, 0.3, 0.3), steel);
  beam.position.set(0, H, 0);
  g.add(beam);
  // banner: chequer band over a red FINISH board, readable from both sides
  const board = new THREE.Mesh(new THREE.PlaneGeometry(span * 0.8, 1.1),
    new THREE.MeshBasicMaterial({ map: textTexture(label), side: THREE.DoubleSide, fog: true, name: 'finish_board' }));
  board.position.set(0, H - 0.9, 0);
  board.rotation.y = Math.PI;   // front face toward the approaching rider (travel is local +z)
  g.add(board);
  const band = new THREE.Mesh(new THREE.PlaneGeometry(span * 0.8, 0.5),
    new THREE.MeshBasicMaterial({ map: chequerTexture(24, 2), side: THREE.DoubleSide, name: 'finish_band' }));
  band.position.set(0, H - 0.1, 0);
  band.rotation.y = Math.PI;
  g.add(band);
  // the line on the tarmac
  const strip = new THREE.Mesh(new THREE.PlaneGeometry(CFG.ROAD_W, 1.2),
    new THREE.MeshStandardMaterial({ map: chequerTexture(20, 2), roughness: 0.8, name: 'finish_strip' }));
  strip.rotation.x = -Math.PI / 2;
  strip.position.y = 0.03;
  g.add(strip);
  g.traverse((n) => { if (n.isMesh) { n.castShadow = false; n.receiveShadow = false; } });
  return g;
}

const _c = new THREE.Vector3(), _t = new THREE.Vector3();
/** Put the gantry across the road at distance `s` (the finish). */
export function placeFinish(g, s) {
  if (!g || !Number.isFinite(s)) return;
  centreAt(-s, _c);
  headAt(-s, _t);
  g.position.copy(_c);
  // the gantry's local X spans the road: face it along the travel direction
  g.rotation.set(0, Math.atan2(_t.x, _t.z), 0);
  // SPAN THE ROAD THAT IS THERE (lanes.js): stretch across a wider road and
  // shift to its middle when one side has more lanes than the other
  const eR = edgeAt(s, 1), eL = edgeAt(s, -1), base = CFG.ROAD_W / 2;
  g.scale.set((eR + eL) / (2 * base), 1, 1);
  const mid = (eR - eL) / 2, nx = -_t.z, nz = _t.x;
  g.position.x += nx * mid; g.position.z += nz * mid;
  g.visible = true;
}
