// RideRash — rain. One draw call, no per-frame CPU work beyond two uniforms.
//
// WHY IT EXISTS. WorldSpine rolls a weather front in over the last third of a
// race and the sky, fog and road wetness all followed it -- but nothing fell.
// A dark sky over a glossy road with no rain reads as a rendering fault, not as
// weather. This is the missing visible cause.
//
// HOW. A fixed box of streaks is built once. The vertex shader scrolls every
// streak down and wraps it inside a box centred on the camera, so the field is
// infinite without ever touching the buffer. Each streak is a line segment whose
// tail is offset along the fall velocity MINUS the rider's velocity, so at speed
// the rain slants toward the camera the way it does through a visor.
import * as THREE from 'three';

const COUNT = 2600;
const BOX = new THREE.Vector3(36, 22, 60);   // metres around the camera

const VERT = `
  uniform float uTime;
  uniform vec3  uCam;
  uniform vec3  uBox;
  uniform vec3  uSlant;     // streak direction * length, world space
  attribute float aTail;    // 0 = head, 1 = tail
  attribute float aSeed;
  varying float vA;
  void main() {
    // Scroll down, then wrap inside a box that follows the camera.
    vec3 p = position;
    p.y -= uTime * (26.0 + aSeed * 8.0);
    vec3 rel = p - uCam;
    rel = mod(rel + uBox * 0.5, uBox) - uBox * 0.5;
    vec3 w = uCam + rel + uSlant * aTail;
    // Fade near the box edges so the wrap never pops.
    vec3 e = abs(rel) / (uBox * 0.5);
    vA = (1.0 - smoothstep(0.7, 1.0, max(e.x, max(e.y, e.z)))) * (1.0 - aTail * 0.85);
    gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
  }`;

const FRAG = `
  uniform float uAmount;
  uniform vec3  uColour;
  varying float vA;
  void main() {
    float a = vA * uAmount;
    if (a < 0.01) discard;
    gl_FragColor = vec4(uColour, a);
  }`;

export class Rain {
  constructor(scene) {
    const pos = new Float32Array(COUNT * 2 * 3);
    const tail = new Float32Array(COUNT * 2);
    const seed = new Float32Array(COUNT * 2);
    // Deterministic layout: the harness compares frames, so no Math.random().
    let h = 0x9e3779b9;
    const rnd = () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 100000) / 100000; };
    for (let i = 0; i < COUNT; i++) {
      const x = (rnd() - 0.5) * BOX.x, y = (rnd() - 0.5) * BOX.y, z = (rnd() - 0.5) * BOX.z;
      const s = rnd();
      for (let k = 0; k < 2; k++) {
        const j = i * 2 + k;
        pos[j * 3] = x; pos[j * 3 + 1] = y; pos[j * 3 + 2] = z;
        tail[j] = k; seed[j] = s;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aTail', new THREE.BufferAttribute(tail, 1));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.uniforms = {
      uTime: { value: 0 },
      uCam: { value: new THREE.Vector3() },
      uBox: { value: BOX.clone() },
      uSlant: { value: new THREE.Vector3(0, 0.9, 0) },
      uAmount: { value: 0 },
      uColour: { value: new THREE.Color(0xb8c4d0) },
    };
    const m = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, fog: false,
    });
    this.mesh = new THREE.LineSegments(g, m);
    this.mesh.name = 'rain';
    this.mesh.frustumCulled = false;      // the shader places it; the bbox is meaningless
    this.mesh.renderOrder = 5;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this._t = 0;
  }

  // amount 0..1 (spine.weather); vel is the rider's world velocity, m/s.
  update(dt, camera, amount, vel) {
    const a = Math.max(0, Math.min(1, (amount - 0.15) / 0.6));
    this.uniforms.uAmount.value = a * 0.42;
    this.mesh.visible = a > 0.01;
    if (!this.mesh.visible) return;
    this._t += dt;
    this.uniforms.uTime.value = this._t;
    this.uniforms.uCam.value.copy(camera.position);
    // Streak = where the drop was ~1/30 s ago relative to the rider: up, plus
    // the rider's own velocity, so rain rakes toward the lens at speed.
    const k = 1 / 30;
    this.uniforms.uSlant.value.set(vel ? vel.x * k : 0, 30 * k, vel ? vel.z * k : 0);
  }

  reset() { this.uniforms.uAmount.value = 0; this.mesh.visible = false; }
}
