import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { HorizontalTiltShiftShader } from 'three/addons/shaders/HorizontalTiltShiftShader.js';
import { VerticalTiltShiftShader } from 'three/addons/shaders/VerticalTiltShiftShader.js';

// 彩度・色味・周辺減光
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    tint: { value: new THREE.Vector3(1, 1, 1) },
    sat: { value: 1.05 },
    vignette: { value: 0.3 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform vec3 tint;
    uniform float sat;
    uniform float vignette;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = mix(vec3(l), c.rgb, sat) * tint;
      vec2 d = vUv - 0.5;
      float r = dot(d, d);
      c.rgb *= 1.0 - vignette * smoothstep(0.08, 0.55, r * 1.7);
      gl_FragColor = c;
    }`,
};

/** ジオラマ風の後処理（ブルーム＋ティルトシフト＋グレーディング） */
export class Post {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.enabled = true;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.25, 0.5, 0.92);
    this.composer.addPass(this.bloom);
    this.tiltH = new ShaderPass(HorizontalTiltShiftShader);
    this.tiltV = new ShaderPass(VerticalTiltShiftShader);
    this.tiltH.uniforms.r.value = this.tiltV.uniforms.r.value = 0.45;
    this.composer.addPass(this.tiltH);
    this.composer.addPass(this.tiltV);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
    this.tiltAmount = 1.7;
  }

  setSize(w, h, pr) {
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.tiltH.uniforms.h.value = this.tiltAmount / (w * pr);
    this.tiltV.uniforms.v.value = this.tiltAmount / (h * pr);
  }

  setPreset(p) {
    this.bloom.strength = p.bloom;
    this.grade.uniforms.tint.value.set(...p.tint);
    this.grade.uniforms.sat.value = p.sat;
    this.grade.uniforms.vignette.value = p.vignette;
  }

  setTilt(amount) {
    this.tiltAmount = amount;
    const s = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.tiltH.uniforms.h.value = amount / s.x;
    this.tiltV.uniforms.v.value = amount / s.y;
  }

  render(dt) {
    if (this.enabled) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }
}
