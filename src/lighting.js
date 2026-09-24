// RideRash — lighting. The geometry is 1995; the light is not.
// Traps this file is written against:
//  - a light that emits without coupling to the surfaces around it (the world
//    is lit and the floor it stands on is not) — the ground is lit explicitly
//    by the same key, and everything receives.
//  - clearcoat over a saturated sky reading magenta in shade — the sky is
//    desaturated and the environment is a plain gradient, not a blue zenith.
import * as THREE from 'three';
import { CFG, PAL } from './config.js';

export function buildLighting(scene, renderer, camera, sky = null) {
  // The fog colour is sampled from the actual Atlas sky's horizon band when it
  // is available, so distant ridges dissolve into the real photograph instead
  // of into a colour I guessed. This is the whole reason the backdrop reads as
  // distance rather than as a wall with a line under it.
  const FOG = sky && sky.uniforms ? sky.uniforms.uFogColour.value.getHex() : 0xa8b4bc;
  scene.fog = new THREE.FogExp2(FOG, CFG.FOG_DENSITY);

  // --- sky ---
  // DynamicSky (sky.js) provides the sky as a real mesh, so this gradient dome is
  // ONLY a fallback for when the panoramas failed to load. It must not be added
  // otherwise: it would render inside the panorama and hide it, which is a silent
  // failure — the frame still has a "sky", just the wrong one.
  let fallbackSky = null;
  let skyMat = null;
  if (!sky || !sky.ok) {
    const skyGeo = new THREE.SphereGeometry(4000, 24, 16);
    skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        top:    { value: new THREE.Color(0x5d7896) },
        mid:    { value: new THREE.Color(0x93a6b4) },
        bottom: { value: new THREE.Color(FOG) },        // == fog colour, so the horizon is seamless
        sunDir: { value: new THREE.Vector3() },
        sunTint:{ value: new THREE.Color(0xffd9a8) },
      },
      vertexShader: `
        varying vec3 vW;
        void main(){ vW = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        uniform vec3 top, mid, bottom, sunTint; uniform vec3 sunDir;
        varying vec3 vW;
        void main(){
          float h = clamp(vW.y*0.5+0.5, 0.0, 1.0);
          vec3 c = mix(bottom, mid, smoothstep(0.35, 0.53, h));
          c = mix(c, top, smoothstep(0.53, 0.95, h));
          float sd = max(dot(normalize(vW), normalize(sunDir)), 0.0);
          c += sunTint * pow(sd, 6.0) * 0.55;         // a soft warm glow, not a disc
          c += sunTint * pow(sd, 1.6) * 0.10;
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    fallbackSky = new THREE.Mesh(skyGeo, skyMat);
    fallbackSky.frustumCulled = false;
    scene.add(fallbackSky);
  }

  // --- key: a low, warm sun. Two colour temperatures is claim 2. ---
  // THE SUN'S DIRECTION IS MEASURED, NOT AUTHORED. sky.sun came from scanning the
  // Atlas panorama for its brightest point, so the light now sits exactly where
  // the sun is drawn in the sky above. Previously CFG.SUN_ELEV/SUN_AZIM were
  // hand-matched to a background image, and any edit to either one silently put
  // the shadows at odds with the visible sun.
  // WORLD yaw, not the panorama's image yaw: see DynamicSky's `worldYaw`. The
  // image yaw put this light 180 deg from the sun drawn in the sky.
  const sunYaw = sky && sky.ok ? (sky.sun.worldYaw ?? sky.sun.yaw) : CFG.SUN_AZIM;
  const sunPitch = sky && sky.ok ? sky.sun.pitch : CFG.SUN_ELEV;
  const sunDist = 200;
  const sunDir = new THREE.Vector3(
    Math.sin(sunYaw) * Math.cos(sunPitch),
    Math.sin(sunPitch),
    -Math.cos(sunYaw) * Math.cos(sunPitch)
  );

  // NOTE: since the light was re-aimed at the sun DRAWN in the sky (worldYaw),
  // it sits behind the grid, so the chase cams no longer look into its lobe;
  // the history below is from when it pointed down the road.
  // 5.0, down from 8.4. The sun sits ~12 degrees up and DOWN THE ROAD, so the
  // camera looks straight into its specular lobe on the tarmac; at 8.4 that
  // lobe blew the whole near carriageway -- and the rider on it -- to white.
  // Measured live by pinning the intensity: 0 removes the glare entirely, 4.5
  // leaves a readable glint. The fill below is raised to keep the exposure.
  const sun = new THREE.DirectionalLight(0xffe6c0, 5.0);
  sun.position.copy(sunDir).multiplyScalar(sunDist);
  sun.userData.sunDir = sunDir.clone();
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const d = 90;
  sun.shadow.camera.left = -d; sun.shadow.camera.right = d;
  sun.shadow.camera.top = d; sun.shadow.camera.bottom = -d;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 520;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.035;
  scene.add(sun);
  scene.add(sun.target);
  if (skyMat) skyMat.uniforms.sunDir.value.copy(sun.position).normalize();

  // --- fill: sky bounce. No shadow. ---
  // 0xd4dbe2, was 0xbfd2e6. With the key sun now BEHIND the chase camera (it
  // follows the sun drawn in the sky -- see DynamicSky.worldYaw), the road is
  // front-lit at 12.6 deg and the fill does most of the work on it. MEASURED
  // (chase, road band mean): 0xbfd2e6 left the asphalt at 84/92/98 -- still
  // reading blue -- and 0xd4dbe2 lands it at 96/98/98, neutral grey. Still a
  // cool sky against the warm key, just not a blue floodlight.
  const sky2 = new THREE.HemisphereLight(0xd4dbe2, 0x39352c, 2.6);
  scene.add(sky2);

  // a cool rim from the seaward side, to separate the pack from the road
  const rim = new THREE.DirectionalLight(0xa9c4e0, 1.35);
  rim.position.set(-120, 60, -80);
  scene.add(rim);

  // a warm bounce up off the tarmac, low and soft. This is what stops the
  // undersides of the bikes going to black.
  const bounce = new THREE.DirectionalLight(0xffc98a, 0.75);
  bounce.position.set(20, -60, 40);
  scene.add(bounce);

  // ambient floor so nothing crushes to pure black
  scene.add(new THREE.AmbientLight(0x5c646e, 0.72));

  // --- environment for PBR reflections ---
  // The Atlas sky provides the environment when it is loaded (textures.js calls
  // skyFromTexture before lighting is built is NOT the case here — the order is
  // textures, then lighting — so scene.environment is already the real sky and
  // this procedural gradient is only the fallback for a failed texture load).
  const env = scene.environment || makeEnvMap(renderer);
  scene.environment = env;
  scene.environmentIntensity = 1.0;

  // THE THREE.JS 0.169 TRAP, and it is silent. When a material's own `envMap`
  // is null, three.js OVERRIDES its `envMapIntensity` with the scene's value, so
  // a per-material intensity is ignored and any clearcoat reflects at whatever
  // the scene says. Measured: a per-material intensity of 2.0 on the paint had
  // no effect at all until the material carried its own envMap.
  //
  // This is why the road's wetness and the paint's gloss are applied by
  // assigning the PMREM to the material directly, not by tuning its intensity.
  scene.userData.envMap = env;
  scene.userData.setMaterialEnv = (material, intensity) => {
    if (!material) return material;
    material.envMap = env;
    material.envMapIntensity = intensity;
    material.needsUpdate = true;
    return material;
  };

  // --- exposure & tone mapping: filmic, slightly cool in the shadows ---
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  // MEASURED after the specular blowout was fixed. Removing the blown highlight
  // took the frame from too bright to too dim: p98 luma 211-233 against the
  // reference set's 239, and pixels over 245 at 0.03-0.45% against 1.1%.
  // Exposure is the right lever rather than more bloom -- bloom lifts the top
  // end by smearing one bright object, which is exactly the artefact that was
  // just removed, whereas exposure lifts the whole curve.
  renderer.toneMappingExposure = 1.14;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  return { sun, sky2, rim, bounce, sky: fallbackSky, sunDir, sunPitch, sunYaw };
}

function makeEnvMap(renderer) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  // a small gradient scene, rendered to an env map
  const s = new THREE.Scene();
  const geo = new THREE.SphereGeometry(50, 16, 10);
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    vertexShader: `varying vec3 vW; void main(){ vW=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `
      varying vec3 vW;
      void main(){
        float h = clamp(vW.y*0.5+0.5,0.0,1.0);
        vec3 sky = mix(vec3(0.42,0.44,0.46), vec3(0.55,0.60,0.66), h);
        vec3 gnd = mix(vec3(0.10,0.10,0.11), vec3(0.24,0.23,0.21), smoothstep(0.0,0.3,h));
        vec3 c = mix(gnd, sky, smoothstep(0.42,0.58,h));
        gl_FragColor = vec4(c,1.0);
      }`,
  });
  const dome = new THREE.Mesh(geo, m);
  s.add(dome);
  const rt = pmrem.fromScene(s, 0, 0.1, 100);
  pmrem.dispose();
  geo.dispose(); m.dispose();
  return rt.texture;
}

// Keep the shadow camera on the player, or the near shadow detail is all spent
// on a 90 m box centered at the origin.
export function followSun(sun, target) {
  sun.target.position.copy(target);
  // Carry the sun's OWN direction, measured from the sky, rather than
  // recomputing it from CFG — otherwise the light drifts off the visible sun as
  // soon as the two disagree.
  const dir = sun.userData.sunDir || new THREE.Vector3(0, 0.2, -1);
  sun.position.copy(target).add(dir.clone().multiplyScalar(140));
  sun.target.updateMatrixWorld();
}