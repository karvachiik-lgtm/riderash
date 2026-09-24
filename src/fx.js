// RideRash — effects. Sparks on a hit, dust when a rider goes off the road,
// a speed vignette, and the world-space streak that sells 60 m/s.
//
// Trap guarded here: bloom turns a two-pixel spark into a forty-pixel disc, so
// nothing in this file is emissive above 1.4, and there is no bloom pass.
import * as THREE from 'three';

export class FX {
  constructor(scene) {
    this.scene = scene;
    this.pool = [];
    this.active = [];

    // --- sparks: small, bright but capped, gravity-affected ---
    const sparkGeo = new THREE.BoxGeometry(0.035, 0.035, 0.22);
    const sparkMat = new THREE.MeshStandardMaterial({
      color: 0xffb45a, emissive: 0xff7a1e, emissiveIntensity: 1.25,
      roughness: 0.4, metalness: 0.2,
    });
    for (let i = 0; i < 160; i++) {
      const m = new THREE.Mesh(sparkGeo, sparkMat);
      m.visible = false; m.frustumCulled = false;
      scene.add(m);
      this.pool.push({ mesh: m, vel: new THREE.Vector3(), life: 0, max: 1, spin: new THREE.Vector3() });
    }

    // --- dust puffs: soft billboards, for the verge ---
    const dustTex = makePuffTexture();
    this.dustMat = new THREE.SpriteMaterial({
      map: dustTex, color: 0x9a8f78, transparent: true, opacity: 0.42,
      depthWrite: false, fog: true,
    });
    this.dustPool = [];
    for (let i = 0; i < 90; i++) {
      const s = new THREE.Sprite(this.dustMat.clone());
      s.visible = false; s.frustumCulled = false;
      scene.add(s);
      this.dustPool.push({ sp: s, vel: new THREE.Vector3(), life: 0, max: 1, scale: 1 });
    }

    // --- speed streaks: thin ribbons laid ALONG the direction of travel ---
    //
    // WHY THEY WERE REWRITTEN. The old streak was a PlaneGeometry(0.03, 3.2) --
    // long axis local +Y, i.e. world UP -- turned with lookAt() to face the
    // player, and placed at `playerPos.z - s`, i.e. down world -Z whatever the
    // road was doing. So every streak was a 3 m VERTICAL stick, up to 5.4 m off
    // the ground, and most of them stood against the sky. MEASURED in the chase
    // view at s = 4500: thin vertical lines from screen row 90 to 270 over the
    // clouds, which read as rain, or as the sky flickering, and they popped in
    // and out as each one wrapped from 300 m straight back to 0.
    //
    // Now: the long axis is the direction of travel (measured from the rider's
    // own motion, so they follow the road round a bend), the ribbon is turned
    // about that axis to face the camera so it never goes edge-on, they sit in
    // a sleeve AROUND the camera path -- 2.8-9 m to the side and 0.15-2.6 m up,
    // which projects to the lower and side periphery against road and verge,
    // not the sky -- and each one fades in far ahead and out as it passes the
    // camera, so none of them pops.
    const streakGeo = new THREE.PlaneGeometry(0.035, 1);
    streakGeo.rotateX(-Math.PI / 2);          // length along local Z, normal +Y
    const streakMat = new THREE.MeshBasicMaterial({
      color: 0xe8e2d4, transparent: true, opacity: 0, depthWrite: false, fog: false,
      side: THREE.DoubleSide,
    });
    this.streaks = [];
    const srand = (a, b) => a + Math.random() * (b - a);
    this._respawnStreak = (st, ahead) => {
      st.ahead = ahead;
      const side = Math.random() < 0.5 ? -1 : 1;
      st.lat = side * srand(2.8, 9.0);
      st.h = srand(0.15, 2.6);
      st.len = srand(2.5, 6.0);
    };
    for (let i = 0; i < 40; i++) {
      const m = new THREE.Mesh(streakGeo, streakMat.clone());
      m.visible = false; m.frustumCulled = false;
      m.matrixAutoUpdate = false;
      scene.add(m);
      const st = { mesh: m };
      this._respawnStreak(st, srand(-8, 70));
      this.streaks.push(st);
    }
    this._fwd = new THREE.Vector3(0, 0, -1);
    this._lastPos = null;
    this._sM = new THREE.Matrix4();
    this._sX = new THREE.Vector3(); this._sY = new THREE.Vector3(); this._sZ = new THREE.Vector3();
    this._sP = new THREE.Vector3(); this._sC = new THREE.Vector3();

    this.hitMarks = [];
  }

  spark(pos, dir, count = 10, power = 1) {
    let n = 0;
    for (const p of this.pool) {
      if (p.life > 0) continue;
      p.mesh.visible = true;
      p.mesh.position.copy(pos);
      p.mesh.scale.setScalar(0.6 + Math.random() * 0.9);
      p.vel.set(dir.x, dir.y, dir.z).multiplyScalar(2.2 + Math.random() * 3.5).multiplyScalar(power);
      p.vel.x += (Math.random() - 0.5) * 3.0;
      p.vel.y += Math.random() * 2.6 + 0.6;
      p.vel.z += (Math.random() - 0.5) * 3.0;
      p.spin.set((Math.random() - 0.5) * 22, (Math.random() - 0.5) * 22, (Math.random() - 0.5) * 22);
      p.max = p.life = 0.32 + Math.random() * 0.34;
      if (++n >= count) break;
    }
  }

  dust(pos, count = 5, color = 0x9a8f78) {
    let n = 0;
    for (const d of this.dustPool) {
      if (d.life > 0) continue;
      d.sp.visible = true;
      d.sp.position.copy(pos);
      d.groundY = pos.y;
      d.sp.position.y += 0.25;
      d.vel.set((Math.random() - 0.5) * 2.2, 0.8 + Math.random() * 1.6, (Math.random() - 0.5) * 2.2);
      d.scale = 0.8 + Math.random() * 1.4;
      d.max = d.life = 0.7 + Math.random() * 0.7;
      d.sp.material.color.setHex(color);
      if (++n >= count) break;
    }
  }

  update(dt, playerPos, speedFrac) {
    for (const p of this.pool) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.mesh.visible = false; continue; }
      p.vel.y -= 13 * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.rotation.x += p.spin.x * dt;
      p.mesh.rotation.y += p.spin.y * dt;
      const k = p.life / p.max;
      p.mesh.scale.setScalar(Math.max(0.05, k) * 0.9);
    }
    for (const d of this.dustPool) {
      if (d.life <= 0) continue;
      d.life -= dt;
      if (d.life <= 0) { d.sp.visible = false; continue; }
      d.vel.y -= 1.1 * dt;
      d.sp.position.addScaledVector(d.vel, dt);
      const k = d.life / d.max;
      const sc = d.scale * (1.6 - k) * 1.5;
      d.sp.scale.set(sc, sc, 1);
      // A camera-facing puff that grows to ~5 m while its centre sits 0.25 m
      // up is mostly BELOW the tarmac, and the road's depth cut it along a hard
      // horizontal line -- a lit rectangle behind the bike in the chase view
      // (seen once the road glare stopped hiding it). Keep the puff's lower
      // edge on the ground: its soft radial falloff then does the fading.
      const floor = d.groundY + sc * 0.42;
      if (d.sp.position.y < floor) d.sp.position.y = floor;
      d.sp.material.opacity = 0.42 * k;
    }
    // streaks: a sleeve of ribbons around the camera path, only when fast.
    // Direction of travel from the rider's own motion over the frame, smoothed,
    // so the ribbons follow the road through a bend instead of world -Z.
    if (this._lastPos && dt > 0) {
      const dx = playerPos.x - this._lastPos.x, dz = playerPos.z - this._lastPos.z;
      const d = Math.hypot(dx, dz);
      if (d > 1e-3) {
        this._fwd.x += (dx / d - this._fwd.x) * Math.min(1, dt * 8);
        this._fwd.z += (dz / d - this._fwd.z) * Math.min(1, dt * 8);
        this._fwd.y = 0; this._fwd.normalize();
      }
    }
    this._lastPos = (this._lastPos || new THREE.Vector3()).copy(playerPos);
    // Fade in over 0.35-0.55 of top speed rather than switching on at 0.35.
    const speedK = THREE.MathUtils.smoothstep(speedFrac, 0.35, 0.55);
    const fwd = this._fwd;
    // right-hand side vector in xz
    const rx = -fwd.z, rz = fwd.x;
    // An approximate chase-camera position, only used to turn each ribbon to
    // face the viewer about its own long axis; being a metre off costs nothing.
    const cam = this._sC.set(playerPos.x - fwd.x * 6, playerPos.y + 2.4, playerPos.z - fwd.z * 6);
    const rel = (26 + speedFrac * 60) * dt;   // flow past the rider, m per frame
    for (const st of this.streaks) {
      if (speedK <= 0) { st.mesh.visible = false; continue; }
      st.ahead -= rel;
      if (st.ahead < -10) this._respawnStreak(st, 60 + Math.random() * 15);
      // fade in from 75 m to 45 m ahead, out from 2 m ahead to 8 m behind
      const a = st.ahead;
      const fade = THREE.MathUtils.smoothstep(a, -10, 2) * (1 - THREE.MathUtils.smoothstep(a, 45, 75));
      const alpha = (0.05 + 0.13 * speedFrac) * speedK * fade;
      if (alpha < 0.004) { st.mesh.visible = false; continue; }
      st.mesh.visible = true;
      st.mesh.material.opacity = alpha;
      const P = this._sP.set(
        playerPos.x + fwd.x * a + rx * st.lat,
        playerPos.y + st.h,
        playerPos.z + fwd.z * a + rz * st.lat);
      // basis: Z along travel, Y (the quad's normal) toward the camera with the
      // travel component removed, X completes it
      const Z = this._sZ.copy(fwd);
      const Y = this._sY.copy(cam).sub(P);
      Y.addScaledVector(Z, -Y.dot(Z));
      if (Y.lengthSq() < 1e-6) Y.set(0, 1, 0);
      Y.normalize();
      const X = this._sX.crossVectors(Y, Z).normalize();
      this._sM.makeBasis(X.multiplyScalar(1), Y, Z.multiplyScalar(st.len));
      this._sM.setPosition(P);
      st.mesh.matrix.copy(this._sM);
      st.mesh.matrixWorldNeedsUpdate = true;
    }
  }
}

function makePuffTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.45, 'rgba(255,255,255,0.42)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}