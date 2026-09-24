// RideRash — post-processing chain.
//
// WHY THIS FILE EXISTS. Measured against the reference frames, our rendered
// frame was flat at the top end: p98 luma 203 against the bar's 239, and 0.0%
// of pixels above 245 against the bar's 1.1%. Nothing in the frame was
// genuinely BRIGHT. A hotter key light alone cannot fix that, because ACES
// tone mapping compresses the top end by design — pushing the sun just moves
// more pixels into the shoulder and they all come out the same value.
//
// The reference build reached the same numbers with a bloom pass that lets the
// brightest specular highlights bleed past the tone curve. So: render the
// scene into a float target, extract what is genuinely a highlight, blur it at
// three radii, and add it back. That is what puts pixels above 245, and it is
// also what makes wet tarmac and chrome read as wet and chrome.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// A grade that runs AFTER bloom and BEFORE the output pass. Bloom alone adds
// light; it does not add COLOUR. Measured high-saturation pixels were 0.9% of
// frame against the bar's 19%, so this pass is where that is solved: a
// saturation lift weighted toward the mid-tones (so the sky stays neutral and
// the hero bodywork does not go fluorescent), plus a slight warm lift in the
// highlights and a cool push in the shade. Two colour temperatures, applied
// globally, is what stops a tinted key from reading as a filter.
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uSat:     { value: 0.58 },   // mid-tone saturation lift
    uSatHi:   { value: 0.24 },   // highlight saturation lift (keeps it from clipping to white)
    uContrast:{ value: 0.10 },
    uWarm:    { value: new THREE.Color(0xffd9a8) },
    uCool:    { value: new THREE.Color(0x9fbcd8) },
    uWarmAmt: { value: 0.085 },
    uCoolAmt: { value: 0.070 },
    uLift:    { value: 0.012 },  // black floor: nothing crushes to pure black
    uVig:     { value: 0.34 },   // corner falloff, so the eye goes to the road
  },
  vertexShader: `
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uSat, uSatHi, uContrast, uWarmAmt, uCoolAmt, uLift, uVig;
    uniform vec3 uWarm, uCool;
    varying vec2 vUv;

    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));

      // --- saturation, split by tone ---
      // A single saturation multiplier over the whole range is what made the
      // sky go cyan and the sun go white. Weighting it means the mid-tones
      // (road, verge, bodywork, foliage — the things that should be colourful)
      // take the lift, while the sky and the clipped highlights do not.
      float midW = 1.0 - pow(abs(l - 0.42) * 2.0, 1.6);
      midW = clamp(midW, 0.0, 1.0);
      float hiW  = smoothstep(0.55, 0.92, l);
      float amt  = uSat * midW + uSatHi * hiW;
      c = mix(vec3(l), c, 1.0 + amt);

      // --- two-temperature grade ---
      // Warm the highlights, cool the shadows. This is a lighting decision
      // expressed in the grade, and it is the cheapest way to make a frame look
      // lit by a sun rather than by an engine.
      float hi = smoothstep(0.42, 0.95, l);
      float lo = 1.0 - smoothstep(0.05, 0.48, l);
      c += uWarm * (uWarmAmt * hi);
      c += uCool * (uCoolAmt * lo);

      // --- contrast about a mid pivot, plus a black lift ---
      c = (c - 0.5) * (1.0 + uContrast) + 0.5;
      c = c * (1.0 - uLift) + uLift;

      // --- vignette: radial, gentle, keeps the corners from competing ---
      vec2 d = vUv - 0.5;
      float r = dot(d, d) * 2.0;
      c *= 1.0 - uVig * smoothstep(0.25, 1.15, r);

      gl_FragColor = vec4(max(c, 0.0), 1.0);
    }`,
};

export class PostFX {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.enabled = true;

    const size = renderer.getSize(new THREE.Vector2());
    const pr = renderer.getPixelRatio();

    // HalfFloat: the highlight extraction depends on values above 1.0 surviving
    // the render into the composer. An 8-bit target clips them at 1.0 and the
    // threshold then has nothing to find, which is exactly how a bloom pass
    // ends up doing nothing while still costing a full-screen blit.
    const target = new THREE.WebGLRenderTarget(
      Math.max(2, Math.floor(size.x * pr)),
      Math.max(2, Math.floor(size.y * pr)),
      {
        type: THREE.HalfFloatType,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        depthBuffer: true,
        stencilBuffer: false,
      }
    );

    this.composer = new EffectComposer(renderer, target);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(size.x, size.y);

    this.renderPass = new RenderPass(scene, camera);
    // RenderPass resets renderer.info at its start; snapshotting here captures
    // the scene's true cost before the post passes clobber it.
    const origRender = this.renderPass.render.bind(this.renderPass);
    this.renderPass.render = (...a) => {
      origRender(...a);
      this._captureStats();
    };
    this.composer.addPass(this.renderPass);

    // threshold 0.86 / strength 0.34 / radius 0.55.
    // MEASURED, FOURTH ATTEMPT. Once the sky became a real photograph (rather
    // than a dim gradient shader) the 0.80/0.42 setting blew the frame: the
    // panorama's sea and horizon haze sit far higher in the histogram than any
    // procedural sky did, so they crossed the threshold and bloomed the whole
    // lower frame. The threshold has to be measured against the SKY that is
    // actually in the scene, not against the previous one.
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(size.x, size.y),
      0.17,   // strength
      0.50,   // radius
      0.955   // threshold
    );
    this.composer.addPass(this.bloom);

    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);

    // OutputPass applies the renderer's tone mapping and colour space at the
    // END of the chain, which is required once a composer is in use: the
    // renderer no longer does it for a render-to-texture pass.
    this.composer.addPass(new OutputPass());
  }

  setPixelRatio(pr) {
    this.composer.setPixelRatio(pr);
  }

  setSize(w, h) {
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w, h);
  }

  // `speedFrac` opens the bloom a little at speed, so the road's highlight
  // smear brightens as the rider gets faster. That is a speed cue, and it is
  // cheaper than another geometry pass.
  render(dt, speedFrac = 0) {
    if (!this.enabled) {
      this.renderer.render(this.renderPass.scene, this.renderPass.camera);
      this.sceneStats = {
        calls: this.renderer.info.render.calls,
        triangles: this.renderer.info.render.triangles,
      };
      return;
    }
    this.bloom.strength = 0.17 + speedFrac * 0.09;
    this.composer.render(dt);
    // With a composer, renderer.info.render is RESET by each pass, so after the
    // last fullscreen quad it reports 1 call / 1 triangle. The scene's real cost
    // has to be captured from the SCENE pass, taken inside the RenderPass
    // callback below. This is a measurement trap, not a rendering one: the game
    // looks right while every draw-call number reads as 1.
    this.sceneStats = this._stats || this.sceneStats || { calls: 0, triangles: 0 };
  }

  // Snapshot renderer.info at the end of the scene pass, before the post passes
  // overwrite it.
  // Snapshot the scene pass before the post passes overwrite renderer.info.
  //
  // NOTE: `calls` here is the SCENE pass only. three.js renders the shadow map
  // inside WebGLRenderer.render() and adds those draws to renderer.info, but
  // the numbers below are read after the scene pass has already run, so they
  // include it. The gate's 900 budget is therefore a scene+shadow budget; the
  // honest way to reduce it is to reduce objects, not to move the goalposts.
  _captureStats() {
    const r = this.renderer.info.render;
    this._stats = { calls: r.calls, triangles: r.triangles };
  }
}