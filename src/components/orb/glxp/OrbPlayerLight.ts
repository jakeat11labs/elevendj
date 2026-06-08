import { Renderer, Program, Mesh, Texture, Triangle, type OGLRenderingContext } from "ogl";
import { vec4 } from "gl-matrix";

import RAF from "./utils/RAF";
import FluidSim from "./entities/FluidSim";

const _vec4 = vec4.create();

// Vertex shader - fullscreen triangle
const vertex = /* glsl */ `#version 300 es
precision highp float;

in vec2 uv;
in vec3 position;

out vec2 vUv;

void main() {
    vUv = vec2(1.0 - uv.x, uv.y); // Flip UV.x for correct orientation
    gl_Position = vec4(position, 1.0);
}
`;

// Fragment shader - Orb effect (simplified, no fluid sim)
function getFragment({ cornerRadius = Infinity }: { cornerRadius?: number }) {
  return /* glsl */ `#version 300 es
precision highp float;

in vec2 vUv;

uniform float uTime;
uniform float uCircleSize;
uniform float uAlpha;
uniform vec4 uAudioAverage;
uniform vec4 uAudioAverageInput;
uniform vec4 uCumulativeAudio;

uniform float uExposure;
uniform float uContrast;
uniform float uSaturation;
uniform float uNoiseOpacity;
uniform int uNoiseBlendMode;
uniform float uAnimatedNoise;

uniform float uNoiseSpeed;
uniform float uNoiseAmplitude;
uniform float uNoiseScale;

uniform float uSphereScale;
uniform float uSpherePower;

uniform vec3 uFluidColor;
uniform int uFluidBlendMode;
uniform float uFluidColorOpacity;
uniform float uRingColorOpacity;

uniform float uFbmScale;
uniform float uFbmPower;
uniform float uFbmAmplitude;
uniform float uFbmSpeed;

uniform sampler2D uTexture;
uniform sampler2D uFluidSimTexture;

uniform float uFadeInDuration;

uniform float uCornerRadius;
uniform vec2 uResolution;
uniform float uDpr;
uniform vec2 uTextureResolution;

out vec4 outColor;

// ============================================
// COVER UV CALCULATION (like CSS background-size: cover)
// ============================================
vec2 getCoverUv(vec2 uv, vec2 containerRes, vec2 textureRes) {
    float containerAspect = containerRes.x / containerRes.y;
    float textureAspect = textureRes.x / textureRes.y;
    
    vec2 scale = vec2(1.0);
    
    if (containerAspect > textureAspect) {
        // Container is wider - fit width, crop height (shrink Y range)
        scale.y = textureAspect / containerAspect;
    } else {
        // Container is taller - fit height, crop width (shrink X range)
        scale.x = containerAspect / textureAspect;
    }
    
    // Scale from center (scale < 1 zooms in / crops)
    vec2 coverUv = (uv - 0.5) * scale + 0.5;
    return coverUv;
}

// ============================================
// ROUNDED RECTANGLE SDF
// ============================================
float sdRoundedBox(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - b + r;
    return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}

// ============================================
// NOISE FUNCTIONS
// ============================================
vec3 permute(vec3 x) { return mod(((x*34.0)+1.0)*x, 289.0); }
vec4 permute(vec4 x) { return mod(((x*34.0)+1.0)*x, 289.0); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
    const vec2 C = vec2(1.0/6.0, 1.0/3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

    vec3 i = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);

    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);

    vec3 x1 = x0 - i1 + 1.0 * C.xxx;
    vec3 x2 = x0 - i2 + 2.0 * C.xxx;
    vec3 x3 = x0 - 1.0 + 3.0 * C.xxx;

    i = mod(i, 289.0);
    vec4 p = permute(permute(permute(
        i.z + vec4(0.0, i1.z, i2.z, 1.0))
        + i.y + vec4(0.0, i1.y, i2.y, 1.0))
        + i.x + vec4(0.0, i1.x, i2.x, 1.0));

    float n_ = 1.0/7.0;
    vec3 ns = n_ * D.wyz - D.xzx;

    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);

    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);

    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);

    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));

    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);

    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
    p0 *= norm.x;
    p1 *= norm.y;
    p2 *= norm.z;
    p3 *= norm.w;

    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}

// ============================================
// COLOR CORRECTION FUNCTIONS
// ============================================
vec3 contrast(vec3 color, float value) {
    return clamp(0.5 + (1.0 + value) * (color - 0.5), vec3(0.0), vec3(1.0));
}

vec3 exposure(vec3 color, float value) {
    return (1.0 + value) * color;
}

vec3 czm_saturation(vec3 rgb, float adjustment) {
    const vec3 W = vec3(0.2125, 0.7154, 0.0721);
    vec3 intensity = vec3(dot(rgb, W));
    return mix(intensity, rgb, adjustment);
}

// ============================================
// BLEND MODE FUNCTIONS (simplified set)
// ============================================

vec3 blendMultiply_19_17(vec3 base, vec3 blend) {
	return base*blend;
}

vec3 blendMultiply_19_17(vec3 base, vec3 blend, float opacity) {
	return (blendMultiply_19_17(base, blend) * opacity + base * (1.0 - opacity));
}

float blendOverlay_9_12(float base, float blend) {
	return base<0.5?(2.0*base*blend):(1.0-2.0*(1.0-base)*(1.0-blend));
}

vec3 blendOverlay_9_12(vec3 base, vec3 blend) {
	return vec3(blendOverlay_9_12(base.r,blend.r),blendOverlay_9_12(base.g,blend.g),blendOverlay_9_12(base.b,blend.b));
}

vec3 blendOverlay_9_12(vec3 base, vec3 blend, float opacity) {
	return (blendOverlay_9_12(base, blend) * opacity + base * (1.0 - opacity));
}

vec3 blendHardLight_7_13(vec3 base, vec3 blend) {
	return blendOverlay_9_12(blend,base);
}

vec3 blendHardLight_7_13(vec3 base, vec3 blend, float opacity) {
	return (blendHardLight_7_13(base, blend) * opacity + base * (1.0 - opacity));
}

// ============================================
// UTILITY FUNCTIONS
// ============================================
float random(in vec2 st) {
    return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
}

vec2 hash(vec2 p) {
    p = vec2(dot(p, vec2(2127.1, 81.17)), dot(p, vec2(1269.5, 283.37)));
    return fract(sin(p) * 43758.5453);
}

float filmGrainNoise(in vec2 uv) {
    return length(hash(vec2(uv.x, uv.y)));
}

float noise(in vec2 _st) {
    vec2 i = floor(_st);
    vec2 f = fract(_st);

    float a = random(i);
    float b = random(i + vec2(1.0, 0.0));
    float c = random(i + vec2(0.0, 1.0));
    float d = random(i + vec2(1.0, 1.0));

    vec2 u = f * f * (3.0 - 2.0 * f);

    return mix(a, b, u.x) +
            (c - a) * u.y * (1.0 - u.x) +
            (d - b) * u.x * u.y;
}

#define NUM_OCTAVES 4
float fbm(in vec2 _st) {
    float v = 0.0;
    float a = 0.5;
    vec2 shift = vec2(100.0);
    mat2 rot = mat2(cos(0.5), sin(0.5), -sin(0.5), cos(0.5));
    for (int i = 0; i < NUM_OCTAVES; ++i) {
        v += a * noise(_st);
        _st = rot * _st * 2.0 + shift;
        a *= 0.5;
    }
    return v;
}

// ============================================
// MAIN
// ============================================
void main() {
    vec3 color = vec3(vUv, 0.);
    float circleSize = uCircleSize - pow(uAudioAverageInput.x * .75, 3.) * .2;  // Range  [0.0, 1.0]
    vec2 uv = vec2(1. - vUv.x, vUv.y);

    vec3 fluid = texture(uFluidSimTexture, vUv).rgb;

    ${
      cornerRadius === Infinity
        ? `
    // Sphere UV
    float sphereScale = uSphereScale; //+ (pow(uAudioAverage.y * .75, 2.) * .5); // 1.5;
    float spherePower = uSpherePower; // .15
    vec2 uvDot = ((uv - 0.5) * 2.);

    float d = sqrt(1.-clamp(dot(uvDot, uvDot), 0., 1.));
    d = pow(d, spherePower);
    vec3 normals = vec3(uvDot, d); // Keep for later
    `
        : `
    // Rounded Rectangle parameters
    vec2 rectSize = vec2(1., 1.) * circleSize;
    // Convert pixel-based corner radius (CSS pixels) to shader coordinate space
    // Multiply by uDpr since uResolution is in canvas pixels, not CSS pixels
    // The * 2.0 accounts for the * 0.5 scaling used throughout the SDF calculations
    float cornerRadius = (uCornerRadius * uDpr / min(uResolution.x, uResolution.y)) * 2.0;
    
    // Rounded Rectangle UV distortion (pillow/bulge effect)
    float sphereScale = uSphereScale;
    float spherePower = uSpherePower;
    vec2 uvDot = ((uv - 0.5) * 2.);

    // Calculate distance from rounded rectangle edge for depth
    float sdfDist = sdRoundedBox(uvDot * 0.5, rectSize * 0.5, cornerRadius * 0.5);
    // Convert SDF to a 0-1 depth value (1 at center, 0 at edges)
    float maxDist = max(min(rectSize.x, rectSize.y) * 0.5 - cornerRadius * 0.5, 0.001);
    float d = 1.0 - clamp(-sdfDist / maxDist, 0.0, 1.0);
    d = sqrt(max(1.0 - d * d, 0.0)); // Spherical falloff for smooth bulge
    d = pow(d, spherePower);
    
    // Calculate smooth normals using separable approach (avoids corner artifacts)
    // Instead of using SDF gradient, use smooth edge falloffs per axis
    vec2 innerSize = rectSize * 0.5 - vec2(cornerRadius * 0.5);
    vec2 absUv = abs(uvDot * 0.5);
    
    // Smooth falloff for each axis independently
    vec2 edgeDist = max(absUv - innerSize, vec2(0.0));
    float cornerDist = length(edgeDist);
    
    // Create smooth normals: blend between axis-aligned and radial at corners
    vec2 axisNormal = sign(uvDot) * smoothstep(vec2(0.0), innerSize, absUv);
    vec2 cornerNormal = edgeDist / max(cornerDist, 0.001) * sign(uvDot);
    
    // Blend: use axis-aligned in flat regions, radial in corners
    float cornerBlend = smoothstep(0.0, cornerRadius * 0.5, cornerDist);
    vec2 normalXY = mix(axisNormal, cornerNormal, cornerBlend) * (1.0 - d);
    vec3 normals = vec3(normalXY, d);
    `
    }

    vec2 uv_scale = 1./vec2(sphereScale);
    uvDot /= (vec2(d, d) + vec2(1.,1.)) * uv_scale;
    uvDot = (uvDot +1.) * 0.5;

    uv = uvDot;

    // FBM
    float fbmScale = uFbmScale;
    float fbmPower = uFbmPower;
    float fbmAmplitude = uFbmAmplitude;
    float fbmTime1 = uTime * uFbmSpeed;
    float fbmTime2 = uTime * (uFbmSpeed * .5) + uCumulativeAudio.x * .25;

    vec2 fbmUv = uv * fbmScale;
    vec2 q = vec2(0.);
    q.x = fbm( fbmUv + 0.00 * fbmTime1);
    q.y = fbm( fbmUv + vec2(1.0));
    vec2 r = vec2(0.);
    r.x = fbm( fbmUv + 1.0 * q + vec2(91.3, .55) + 0.15 * fbmTime2 );
    r.y = fbm( fbmUv + 1.0 * q - vec2(45.33, 1.2) + 0.126 * fbmTime2);

    float f = fbm(fbmUv+r);
    float ffbm = mix(0.8, 0.66, clamp((f*f)*fbmPower,0.0,1.0));
    ffbm = mix(ffbm, 0., clamp(length(q),0.0,1.0));
    ffbm = mix(ffbm, 1., clamp(length(r.x),0.0,1.0));

    // Simplex Noise
    float noiseTime1 = uTime * uNoiseSpeed * .5 + uCumulativeAudio.z * .1;
    float noiseX = snoise(vec3(vUv * uNoiseScale, noiseTime1));
    float noiseTime2 = uTime * uNoiseSpeed;
    float noiseY = snoise(vec3(vUv * uNoiseScale + vec2(54., 54.), noiseTime2));
    vec2 noiseDisp = vec2(noiseX, noiseY);
    noiseDisp *= 1. + uAudioAverage.z * .25;

    ${
      cornerRadius === Infinity
        ? `
    // Compute circle shape and alpha mask
    vec2 circleUv = (vUv)-.5;
    float dist = sqrt(dot(circleUv, circleUv));
    float s = 1.; // smoothstep(1. - (1.-circleSize), .99 - (1.-circleSize), dist * 2.);

    // Pulse
    float pTime = uTime * .2 + uCumulativeAudio.z * .4;
    float pDist = mod(dist * 2. - pTime, 1.);
    float pulse = smoothstep(0., .75, pDist) - smoothstep(.75, 1., pDist);
    pulse = pow(pulse, 2.);
    pulse *= uAudioAverage.y;
    `
        : `
    // Compute rounded rectangle shape and alpha mask
    vec2 shapeUv = (vUv - 0.5) * 2.0;
    float shapeDist = sdRoundedBox(shapeUv * 0.5, rectSize * 0.5, cornerRadius * 0.5);
    float s = 1.; // smoothstep(0.01, -0.01, shapeDist); // Sharp edge mask
    float shapeMask = smoothstep(0.0, -maxDist, shapeDist);
    shapeMask = shapeMask * shapeMask;

    // Pulse - using SDF distance instead of radial
    float pTime = uTime * .2 + uCumulativeAudio.z * .4;
    float pDist = mod(-shapeDist - pTime * 0.5, 0.5);
    float pulse = smoothstep(0., .375, pDist) - smoothstep(.375, .5, pDist);
    pulse = pow(pulse, 2.);
    pulse *= uAudioAverage.y;
    `
    }

    // Uv shift
    uv += -fluid.rg * 0.001;
    uv += normals.xy * (ffbm - .5) * fbmAmplitude;
    uv += noiseDisp * uNoiseAmplitude;

    // Gradient sampling with cover strategy
    vec2 coverUv = getCoverUv(uv, uResolution, uTextureResolution);
    vec3 gradient = texture(uTexture, coverUv).rgb;

    // Ring Constants
    vec3 color1 = vec3(1.);
    vec3 color2 = vec3(0.);
    float innerRadius = 0.25;
    float noiseScale = 0.65 + uAudioAverage.x * .4;

    // Ring
    vec2 ringUv = (vUv - .5) * 2. * (1./uCircleSize);
    ringUv *= .75;
    float ang = atan(ringUv.y, ringUv.x);
    float len = length(ringUv);
    float v2, v3, cl;
    float r0, n0;

    float ringTime = (-uTime * .5) - uCumulativeAudio.a * .2;
    ringUv.x += 1. + uAudioAverage.y * 1.5 - uAudioAverageInput.y * 2.5;

    n0 = snoise( vec3(ringUv * noiseScale, ringTime * 0.5) ) * 0.5 + 0.5;
    r0 = mix(mix(innerRadius, 1.0, 0.75), mix(innerRadius, 1.0, 0.2), n0);
    cl = cos(ang + ringTime * 2.0) * 0.5 + 0.5;

    // high light
    float a = -ringTime * 1.0;
    vec2 pos = vec2(cos(a), sin(a)) * r0;
    v2 = smoothstep(1.0, mix(innerRadius, 1.0, n0 * 0.5), len);
    v3 = pow(smoothstep(innerRadius, mix(innerRadius, 1.0, n0 * 0.75), len), 2.);
    cl = cl * v2 * v3;
    cl = clamp(pow(cl * min(uAudioAverage.a * 4. + uAudioAverageInput.x * 4., 1.), 3.), 0., 1.);

    // Compositing
    color = gradient + (vec3(cl) * uRingColorOpacity);
    color = blendHardLight_7_13(color, uFluidColor, length(fluid) * .01 * uFluidColorOpacity);

    // Color correction
    color = blendMultiply_19_17(color, vec3(filmGrainNoise(vUv + mod(uTime, 1.) * uAnimatedNoise)), uNoiseOpacity);
    color = czm_saturation(color, uSaturation);
    color = contrast(color, uContrast);
    color = exposure(color, uExposure);

    // alpha
    float fadeIn = uFadeInDuration > 0.0 ? min(uTime / uFadeInDuration, 1.) : 1.;
    outColor.a = s * uAlpha * fadeIn;

    // Clamp color to valid range before premultiplying
    // (exposure can push values > 1.0 which causes over-saturation during fade)
    color = clamp(color, 0.0, 1.0);
    
    // Set color
    outColor.rgb = color * outColor.a;


}
`;
}

// OGL types (minimal declarations for what we use)
type OGLRenderer = InstanceType<typeof Renderer>;
type OGLProgram = InstanceType<typeof Program>;
type OGLMesh = InstanceType<typeof Mesh>;
type OGLTexture = InstanceType<typeof Texture>;
type OGLTriangle = InstanceType<typeof Triangle>;

interface OrbPlayerLightOptions {
  width?: number | null;
  height?: number | null;
  dpr?: number;
  rafId?: string;
  animated?: boolean;
  cornerRadius?: number;
  saturation?: number;
  fadeInDuration?: number;
  preserveDrawingBuffer?: boolean;
}

interface OrbConfig {
  circleSize: number;
  alpha: number;
  timeScale: number;
  sphereScale: number;
  spherePower: number;
  noiseSpeed: number;
  noiseAmplitude: number;
  noiseScale: number;
  rotationSpeed: number;
  ringColorOpacity: number;
  fluidColor: [number, number, number];
  fluidColorOpacity: number;
  fbmScale: number;
  fbmPower: number;
  fbmAmplitude: number;
  fbmSpeed: number;
  exposure: number;
  contrast: number;
  grainOpacity: number;
  grainAnimated: boolean;
  overallSoundScale: number;
  clearColor: [number, number, number, number];
}

interface AudioData {
  low?: number;
  mid?: number;
  high?: number;
  all?: number;
}

/**
 * OrbPlayerLight - A simplified OGL-based orb renderer
 * Renders the orb shader on a fullscreen plane without fluid simulation
 */
class OrbPlayerLight {
  private container: HTMLElement;
  private options: Required<OrbPlayerLightOptions>;

  // Audio data (vec4: low, mid, high, all)
  private audioAverage: [number, number, number, number] = [0, 0, 0, 0];
  private audioAverageInput: [number, number, number, number] = [0, 0, 0, 0];
  private cumulativeAudio: [number, number, number, number] = [0, 0, 0, 0];

  // OGL objects
  private renderer: OGLRenderer | null = null;
  private gl: OGLRenderingContext | null = null;
  private geometry: OGLTriangle | null = null;
  private texture: OGLTexture | null = null;
  private fluidSimTexture: OGLTexture | null = null;
  private program: OGLProgram | null = null;
  private mesh: OGLMesh | null = null;
  private fluidSim: any = null;

  // Private methods and properties
  private loadingPromise: Promise<OGLTexture> | null = null;
  private loadingImage: HTMLImageElement | null = null;
  private time: number = 0;
  private isPlaying: boolean = false;
  private wasPlayingBeforeHidden: boolean = false;
  private rafId: string;
  private resizeObserver: ResizeObserver | null = null;
  private intersectionObserver: IntersectionObserver | null = null;
  private fluidSimAccumulator: number = 0;
  private readonly fluidSimInterval: number = 1 / 60; // 60fps cap

  // Public
  public userCanSpeak: boolean = false;
  public loaded: boolean = false;
  public isDisposed: boolean = false;

  // Configuration with defaults matching the original
  public config: OrbConfig = {
    circleSize: 1,
    alpha: 1,
    timeScale: 1.4,
    overallSoundScale: 1,

    clearColor: [1, 1, 1, 0],

    sphereScale: 0.9,
    spherePower: 1.1,

    noiseSpeed: 0.25,
    noiseAmplitude: 0.15,
    noiseScale: 0.65,
    rotationSpeed: 0.1,

    ringColorOpacity: 0.25,

    fluidColor: [1, 1, 1],
    fluidColorOpacity: 0.1,

    fbmScale: 3.25,
    fbmPower: 2.75,
    fbmAmplitude: 0.65,
    fbmSpeed: 4.5,

    exposure: 0.15,
    contrast: 0,

    grainOpacity: 0,
    grainAnimated: false,
  };

  constructor(container: HTMLElement, options: OrbPlayerLightOptions = {}) {
    this.container = container;
    this.options = {
      width: null,
      height: null,
      dpr: Math.min(window.devicePixelRatio, 2),
      rafId: `orb-player-${Date.now()}`,
      animated: true,
      cornerRadius: Infinity,
      ...options,
      saturation: options.saturation ?? 1,
      fadeInDuration: options.fadeInDuration ?? 0,
      preserveDrawingBuffer: options.preserveDrawingBuffer ?? false,
    };

    this.rafId = this.options.rafId;

    this.init();
  }

  private init(): void {
    const width = this.options.width ?? this.container.offsetWidth;
    const height = this.options.height ?? this.container.offsetHeight;

    // Create OGL Renderer
    this.renderer = new Renderer({
      dpr: this.options.dpr,
      width,
      height,
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      powerPreference: "high-performance",
      preserveDrawingBuffer: this.options.preserveDrawingBuffer,
    });

    this.gl = this.renderer.gl as OGLRenderingContext;
    this.container.appendChild(this.gl.canvas);

    // Fullscreen triangle geometry (more efficient than a quad)
    this.geometry = new Triangle(this.gl);

    // Create empty texture (will be replaced when loading)
    this.texture = new Texture(this.gl);
    this.fluidSimTexture = new Texture(this.gl); // Placeholder for fluid sim texture

    // Create program with all uniforms
    this.program = new Program(this.gl, {
      vertex,
      fragment: getFragment({ cornerRadius: this.options.cornerRadius }),
      uniforms: {
        uTime: { value: 0 },
        uCircleSize: { value: this.config.circleSize },
        uAlpha: { value: this.config.alpha },
        uAudioAverage: { value: this.audioAverage },
        uAudioAverageInput: { value: this.audioAverageInput },
        uCumulativeAudio: { value: this.cumulativeAudio },

        uSphereScale: { value: this.config.sphereScale },
        uSpherePower: { value: this.config.spherePower },

        uNoiseSpeed: { value: this.config.noiseSpeed },
        uNoiseAmplitude: { value: this.config.noiseAmplitude },
        uNoiseScale: { value: this.config.noiseScale },
        uRotationSpeed: { value: this.config.rotationSpeed },

        uRingColorOpacity: { value: this.config.ringColorOpacity },
        uFluidColor: { value: this.config.fluidColor },
        uFluidColorOpacity: { value: this.config.fluidColorOpacity },

        uFbmScale: { value: this.config.fbmScale },
        uFbmPower: { value: this.config.fbmPower },
        uFbmAmplitude: { value: this.config.fbmAmplitude },
        uFbmSpeed: { value: this.config.fbmSpeed },

        uExposure: { value: this.config.exposure },
        uContrast: { value: this.config.contrast },
        uSaturation: { value: this.options.saturation },

        uNoiseOpacity: { value: this.config.grainOpacity },
        uNoiseBlendMode: { value: 15 }, // multiply
        uAnimatedNoise: { value: this.config.grainAnimated ? 1 : 0 },

        uTexture: { value: this.texture },
        uFluidSimTexture: { value: this.fluidSimTexture },
        uResolution: { value: [width * this.options.dpr, height * this.options.dpr] },
        uTextureResolution: { value: [1, 1] }, // Will be updated when texture loads

        uFadeInDuration: { value: this.options.fadeInDuration },

        uCornerRadius: { value: this.options.cornerRadius },
        uDpr: { value: this.options.dpr },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });

    // Create mesh
    this.mesh = new Mesh(this.gl, {
      geometry: this.geometry,
      program: this.program,
    });

    // Initialize FluidSim
    this.fluidSim = new FluidSim(this.gl, this.renderer);

    // Setup ResizeObserver for container size changes is animated
    if (this.options.animated) {
      this.resizeObserver = new ResizeObserver(() => {
        this.resize();
        if (this.loaded) {
          this.update();
        }
      });
      this.resizeObserver.observe(this.container);

      // Setup IntersectionObserver to pause/play when offscreen
      this.intersectionObserver = new IntersectionObserver(
        entries => {
          const entry = entries[0];
          if (entry.isIntersecting) {
            // Element is visible - resume if it was playing before
            if (this.wasPlayingBeforeHidden) {
              this.play();
            }
          } else {
            // Element is not visible - pause if currently playing
            this.wasPlayingBeforeHidden = this.isPlaying;
            if (this.isPlaying) {
              this.stop();
            }
          }
        },
        { threshold: 0 },
      );
      this.intersectionObserver.observe(this.container);
    }
  }

  /**
   * Load a texture from URL
   */
  loadTexture(url: string): Promise<OGLTexture> {
    this.loadingPromise = new Promise((resolve, reject) => {
      const image = new Image();
      this.loadingImage = image;
      const gl = this.gl;
      if (!gl || !this.program) {
        reject(new Error("WebGL context not initialized"));
        return;
      }

      image.crossOrigin = "anonymous";

      image.onload = () => {
        this.loadingImage = null;
        if (this.isDisposed) {
          reject(new Error("Component disposed before texture loaded"));
          return;
        }
        this.texture = new Texture(gl, {
          image,
          generateMipmaps: true,
        });
        this.program!.uniforms.uTexture.value = this.texture;
        this.program!.uniforms.uTextureResolution.value = [image.naturalWidth, image.naturalHeight];
        resolve(this.texture);
        this.loaded = true;

        if (!this.options.animated && this.renderer) {
          this.playOnce();
        }
      };

      image.onerror = (err: Event | string) => {
        this.loadingImage = null;
        reject(err);
      };
      image.src = url;
    });
    return this.loadingPromise;
  }

  /**
   * Update audio data for reactive animation
   * @param audioData - { low, mid, high, all } normalized 0-1
   * @param inputAudioData - Input audio (microphone) { low, mid, high, all }
   * @param dt - Delta time in seconds (optional, defaults to 1/60)
   */
  setAudioData(audioData: AudioData | null, inputAudioData: AudioData | null = null, dt: number = 1 / 60): void {
    const scaleOutput = this.config.overallSoundScale;
    // lerp cumulative audio
    if (audioData) {
      vec4.copy(_vec4, [audioData.low || 0, audioData.mid || 0, audioData.high || 0, audioData.all || 0]);
    } else {
      vec4.copy(_vec4, [0, 0, 0, 0]);
    }

    vec4.scale(_vec4, _vec4, scaleOutput);
    vec4.scale(_vec4, _vec4, dt * 60 * this.config.timeScale);
    vec4.add(_vec4, this.cumulativeAudio, _vec4);
    vec4.lerp(this.cumulativeAudio, this.cumulativeAudio, _vec4, 0.25);

    if (audioData) {
      vec4.copy(_vec4, [audioData.low || 0, audioData.mid || 0, audioData.high || 0, audioData.all || 0]);
      this.userCanSpeak = (audioData.low || 0) < 10 / 255;
    } else {
      vec4.copy(_vec4, [0, 0, 0, 0]);
      this.userCanSpeak = false;
    }

    vec4.scale(_vec4, _vec4, scaleOutput);
    vec4.lerp(this.audioAverage, this.audioAverage, _vec4, 0.55);

    const scaleInput = 1 * (this.userCanSpeak ? 1 : 0);
    // lerp cumulative audio
    if (inputAudioData) {
      vec4.copy(_vec4, [
        inputAudioData.low || 0,
        inputAudioData.mid || 0,
        inputAudioData.high || 0,
        inputAudioData.all || 0,
      ]);
    } else {
      vec4.copy(_vec4, [0, 0, 0, 0]);
    }
    vec4.scale(_vec4, _vec4, scaleInput);
    vec4.lerp(this.audioAverageInput, this.audioAverageInput, _vec4, 0.45);

    // Update FluidSim audio data
    if (this.fluidSim && audioData) {
      this.fluidSim.setAudioData(audioData, inputAudioData, dt * 1000); // Convert to ms
    }
  }

  /**
   * Update a config value
   */
  setConfig<K extends keyof OrbConfig>(key: K, value: OrbConfig[K]): void {
    this.config[key] = value;
  }

  /**
   * Update the gradient saturation live. The render loop reads
   * `this.options.saturation` every frame, so this takes effect next frame
   * without rebuilding the player — letting colorway switches recolor the orb
   * while the audio-reactive loop keeps running uninterrupted.
   */
  setSaturation(value: number): void {
    this.options.saturation = value;
  }

  resize(): void {
    if (!this.renderer || !this.program) return;

    const width = this.options.width ?? this.container.offsetWidth;
    const height = this.options.height ?? this.container.offsetHeight;
    this.renderer.setSize(width, height);
    this.program.uniforms.uResolution.value = [width * this.options.dpr, height * this.options.dpr];
  }

  /**
   * Main render/update loop
   * @param dt - Delta time in seconds
   */
  update(dt: number = 1 / 60): void {
    if (!this.renderer || !this.program || !this.mesh) return;

    this.time += dt * this.config.timeScale;

    // Update uniforms
    const u = this.program.uniforms;
    u.uTime.value = this.time;
    u.uCircleSize.value = this.config.circleSize;
    u.uAlpha.value = this.config.alpha;
    u.uAudioAverage.value = this.audioAverage;
    u.uAudioAverageInput.value = this.audioAverageInput;
    u.uCumulativeAudio.value = this.cumulativeAudio;

    u.uSphereScale.value = this.config.sphereScale;
    u.uSpherePower.value = this.config.spherePower;
    u.uNoiseSpeed.value = this.config.noiseSpeed;
    u.uNoiseAmplitude.value = this.config.noiseAmplitude;
    u.uNoiseScale.value = this.config.noiseScale;
    u.uRotationSpeed.value = this.config.rotationSpeed;
    u.uRingColorOpacity.value = this.config.ringColorOpacity;
    u.uFbmScale.value = this.config.fbmScale;
    u.uFbmPower.value = this.config.fbmPower;
    u.uFbmAmplitude.value = this.config.fbmAmplitude;
    u.uFbmSpeed.value = this.config.fbmSpeed;
    u.uExposure.value = this.config.exposure;
    u.uContrast.value = this.config.contrast;
    u.uSaturation.value = this.options.saturation;
    u.uNoiseOpacity.value = this.config.grainOpacity;
    u.uAnimatedNoise.value = this.config.grainAnimated ? 1 : 0;

    // Update FluidSim and get texture (capped at 60fps)
    if (this.fluidSim) {
      this.fluidSimAccumulator += dt;
      if (this.fluidSimAccumulator >= this.fluidSimInterval) {
        this.fluidSim.update(this.fluidSimAccumulator * 1000); // Convert to ms
        this.fluidSimAccumulator = 0;
      }
      u.uFluidSimTexture.value = this.fluidSim.getTexture();
    }

    // Render
    this.renderer.render({ scene: this.mesh });
  }

  /**
   * Start the animation loop using RAF singleton
   */
  play(): void {
    if (this.isPlaying) return;
    this.isPlaying = true;

    RAF.subscribe(this.rafId, (dt: number) => {
      this.update(dt / 1000); // RAF provides dt in ms, convert to seconds
    });
  }

  playOnce(): void {
    this.update(1 / 60);
    this.stop();
  }

  /**
   * Stop the animation loop
   */
  stop(): void {
    this.isPlaying = false;
    RAF.unsubscribe(this.rafId);
  }

  /**
   * Dispose all resources
   */
  dispose(keepCanvas: boolean = false): void {
    // Cancel pending texture loading
    this.isDisposed = true;
    if (this.loadingImage) {
      this.loadingImage.onload = null;
      this.loadingImage.onerror = null;
      this.loadingImage.src = "";
      this.loadingImage = null;
    }
    this.loadingPromise = null;

    this.gl?.finish();
    this.stop();

    // Disconnect observers
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    if (this.intersectionObserver) {
      this.intersectionObserver.disconnect();
      this.intersectionObserver = null;
    }

    if (this.texture) {
      this.texture = null;
    }

    if (this.fluidSim) {
      this.fluidSim.dispose();
      this.fluidSim = null;
    }

    if (this.gl && this.gl.canvas && this.gl.canvas.parentNode && !keepCanvas) {
      this.gl.canvas.parentNode.removeChild(this.gl.canvas);
    }

    this.renderer = null;
    this.gl = null;
  }
}

export default OrbPlayerLight;
