import { Mesh, Program, RenderTarget, Geometry, Color, Vec2, Vec4, type OGLRenderingContext } from "ogl";
import type { Renderer } from "ogl";
import { vec4 } from "gl-matrix";

const _vec4 = vec4.create();

const baseVertex = /* glsl */ `
    precision highp float;
    attribute vec2 position;
    attribute vec2 uv;
    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform vec2 texelSize;
    void main () {
        vUv = uv;
        vL = vUv - vec2(texelSize.x, 0.0);
        vR = vUv + vec2(texelSize.x, 0.0);
        vT = vUv + vec2(0.0, texelSize.y);
        vB = vUv - vec2(0.0, texelSize.y);
        gl_Position = vec4(position, 0, 1);
    }
`;

const clearShader = /* glsl */ `
    precision mediump float;
    precision mediump sampler2D;
    varying highp vec2 vUv;
    uniform sampler2D uTexture;
    uniform float value;
    void main () {
        gl_FragColor = value * texture2D(uTexture, vUv);
    }
`;

const splatShader = /* glsl */ `
    precision highp float;
    precision highp sampler2D;
    varying vec2 vUv;
    uniform sampler2D uTarget;
    uniform float aspectRatio;
    uniform vec3 color;
    uniform vec2 point;
    uniform float radius;
    uniform float time;

    uniform vec4 cumulativeAudio;
    uniform vec4 audioAverage;

    const float width = .15;
    void main () {
        // vec2 p = vUv - point;
        vec2 p = vUv - vec2(.5);
        p *= radius;
        vec2 uvDot = ((vUv - 0.5) * 2.);

        float dist = sqrt(dot(p, p));

        float pTime = time * .25 + cumulativeAudio.a * .15;
        float pDist = mod(dist * 2. - pTime, 1.);
        float pulse = smoothstep(0., width, pDist) - smoothstep(width, width * 2., pDist);

        // float d = sqrt(1.-clamp(dot(uvDot, uvDot), 0., 1.));
        // d = pow(d, 3.);
        // vec3 normals = vec3(uvDot, d);
        // vec3 splat = pulse * (1. - normals) * (audioAverage.x * 30.) * clamp(dist * 1., 0., 1.) + color * .1;

        vec3 splat = pulse * (audioAverage.x * 30.) * clamp(dist * 1., 0., 1.) * color;
        vec3 base = texture2D(uTarget, vUv).xyz;
        gl_FragColor = vec4(base + splat, 1.0);
    }
`;

const advectionManualFilteringShader = /* glsl */ `
    precision highp float;
    precision highp sampler2D;
    varying vec2 vUv;
    uniform sampler2D uVelocity;
    uniform sampler2D uSource;
    uniform vec2 texelSize;
    uniform vec2 dyeTexelSize;
    uniform float dt;
    uniform float dissipation;
    vec4 bilerp (sampler2D sam, vec2 uv, vec2 tsize) {
        vec2 st = uv / tsize - 0.5;
        vec2 iuv = floor(st);
        vec2 fuv = fract(st);
        vec4 a = texture2D(sam, (iuv + vec2(0.5, 0.5)) * tsize);
        vec4 b = texture2D(sam, (iuv + vec2(1.5, 0.5)) * tsize);
        vec4 c = texture2D(sam, (iuv + vec2(0.5, 1.5)) * tsize);
        vec4 d = texture2D(sam, (iuv + vec2(1.5, 1.5)) * tsize);
        return mix(mix(a, b, fuv.x), mix(c, d, fuv.x), fuv.y);
    }
    void main () {
        vec2 coord = vUv - dt * bilerp(uVelocity, vUv, texelSize).xy * texelSize;
        gl_FragColor = dissipation * bilerp(uSource, coord, dyeTexelSize);
        gl_FragColor.a = 1.0;
    }
`;

const advectionShader = /* glsl */ `
    precision highp float;
    precision highp sampler2D;
    varying vec2 vUv;
    uniform sampler2D uVelocity;
    uniform sampler2D uSource;
    uniform vec2 texelSize;
    uniform float dt;
    uniform float dissipation;
    void main () {
        vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;
        gl_FragColor = dissipation * texture2D(uSource, coord);
        gl_FragColor.a = 1.0;
    }
`;

const divergenceShader = /* glsl */ `
    precision mediump float;
    precision mediump sampler2D;
    varying highp vec2 vUv;
    varying highp vec2 vL;
    varying highp vec2 vR;
    varying highp vec2 vT;
    varying highp vec2 vB;
    uniform sampler2D uVelocity;
    void main () {
        float L = texture2D(uVelocity, vL).x;
        float R = texture2D(uVelocity, vR).x;
        float T = texture2D(uVelocity, vT).y;
        float B = texture2D(uVelocity, vB).y;
        vec2 C = texture2D(uVelocity, vUv).xy;
        if (vL.x < 0.0) { L = -C.x; }
        if (vR.x > 1.0) { R = -C.x; }
        if (vT.y > 1.0) { T = -C.y; }
        if (vB.y < 0.0) { B = -C.y; }
        float div = 0.5 * (R - L + T - B);
        gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
    }
`;

const curlShader = /* glsl */ `
    precision mediump float;
    precision mediump sampler2D;
    varying highp vec2 vUv;
    varying highp vec2 vL;
    varying highp vec2 vR;
    varying highp vec2 vT;
    varying highp vec2 vB;
    uniform sampler2D uVelocity;
    void main () {
        float L = texture2D(uVelocity, vL).y;
        float R = texture2D(uVelocity, vR).y;
        float T = texture2D(uVelocity, vT).x;
        float B = texture2D(uVelocity, vB).x;
        float vorticity = R - L - T + B;
        gl_FragColor = vec4(0.5 * vorticity, 0.0, 0.0, 1.0);
    }
`;

const vorticityShader = /* glsl */ `
    precision highp float;
    precision highp sampler2D;
    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform sampler2D uVelocity;
    uniform sampler2D uCurl;
    uniform float curl;
    uniform float dt;
    void main () {
        float L = texture2D(uCurl, vL).x;
        float R = texture2D(uCurl, vR).x;
        float T = texture2D(uCurl, vT).x;
        float B = texture2D(uCurl, vB).x;
        float C = texture2D(uCurl, vUv).x;
        vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
        force /= length(force) + 0.0001;
        force *= curl * C;
        force.y *= -1.0;
        vec2 vel = texture2D(uVelocity, vUv).xy;
        gl_FragColor = vec4(vel + force * dt, 0.0, 1.0);
    }
`;

const pressureShader = /* glsl */ `
    precision mediump float;
    precision mediump sampler2D;
    varying highp vec2 vUv;
    varying highp vec2 vL;
    varying highp vec2 vR;
    varying highp vec2 vT;
    varying highp vec2 vB;
    uniform sampler2D uPressure;
    uniform sampler2D uDivergence;
    void main () {
        float L = texture2D(uPressure, vL).x;
        float R = texture2D(uPressure, vR).x;
        float T = texture2D(uPressure, vT).x;
        float B = texture2D(uPressure, vB).x;
        float C = texture2D(uPressure, vUv).x;
        float divergence = texture2D(uDivergence, vUv).x;
        float pressure = (L + R + B + T - divergence) * 0.25;
        gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);
    }
`;

const gradientSubtractShader = /* glsl */ `
    precision mediump float;
    precision mediump sampler2D;
    varying highp vec2 vUv;
    varying highp vec2 vL;
    varying highp vec2 vR;
    varying highp vec2 vT;
    varying highp vec2 vB;
    uniform sampler2D uPressure;
    uniform sampler2D uVelocity;
    void main () {
        float L = texture2D(uPressure, vL).x;
        float R = texture2D(uPressure, vR).x;
        float T = texture2D(uPressure, vT).x;
        float B = texture2D(uPressure, vB).x;
        vec2 velocity = texture2D(uVelocity, vUv).xy;
        velocity.xy -= vec2(R - L, T - B);
        gl_FragColor = vec4(velocity, 0.0, 1.0);
    }
`;

const blurShader = /* glsl */ `
    precision mediump float;
    precision mediump sampler2D;
    varying highp vec2 vUv;
    uniform sampler2D uTexture;
    uniform float value;
    uniform vec2 simRes;
    uniform vec2 direction;
    vec4 blur9(sampler2D image, vec2 uv, vec2 resolution, vec2 direction) {
        vec4 color = vec4(0.0);
        vec2 off1 = vec2(1.3846153846) * direction;
        vec2 off2 = vec2(3.2307692308) * direction;
        color += texture2D(image, uv) * 0.2270270270;
        color += texture2D(image, uv + (off1 / resolution)) * 0.3162162162;
        color += texture2D(image, uv - (off1 / resolution)) * 0.3162162162;
        color += texture2D(image, uv + (off2 / resolution)) * 0.0702702703;
        color += texture2D(image, uv - (off2 / resolution)) * 0.0702702703;
        return color;
    }
    void main () {
        gl_FragColor = blur9(uTexture, vUv, simRes, direction);
    }
`;

// Type definitions
type OGLMesh = InstanceType<typeof Mesh>;
type OGLRenderTarget = InstanceType<typeof RenderTarget>;
type OGLRenderer = InstanceType<typeof Renderer>;

interface DoubleFBO {
  read: OGLRenderTarget;
  write: OGLRenderTarget;
  swap: () => void;
}

/**
 * Best-effort GPU cleanup. OGL's `RenderTarget` does not declare `dispose()` in
 * the version we build against, so this is a runtime probe rather than a call:
 * it frees the target where the method exists and no-ops where it doesn't.
 */
type MaybeDisposable = { dispose?: () => void };

function disposeTarget(target: unknown): void {
  (target as MaybeDisposable | null | undefined)?.dispose?.();
}

interface FluidSimOptions {
  scale?: number;
  simRes?: number;
  dyeRes?: number;
  curlStrength?: number;
  name?: string;
}

interface FluidSimConfig {
  OverallSoundScale: number;
  InputScale: number;
  DensityDissipation: number;
  VelocityDissipation: number;
  PressureDissipation: number;
  Radius: number;
  Blur: number;
  Iterations: number;
}

interface SplatData {
  x: number;
  y: number;
  dx: number;
  dy: number;
}

interface AudioData {
  low?: number;
  mid?: number;
  high?: number;
  all?: number;
}

interface TextureFormat {
  internalFormat: number;
  format: number;
}

interface RenderTargetOptions {
  width: number;
  height: number;
  wrapS?: number;
  wrapT?: number;
  minFilter?: number;
  magFilter?: number;
  type: number | undefined;
  format: number | undefined;
  internalFormat: number | undefined;
  depth: boolean;
}

/**
 * FluidSim - GPU-based fluid simulation for the Orb effect
 * Uses OGL for WebGL rendering with ping-pong FBOs
 */
class FluidSim {
  private gl: OGLRenderingContext;
  private renderer: OGLRenderer;
  public name: string;

  private simRes: number;
  private dyeRes: number;
  private curlStrength: number;

  private time: number = 0;

  // Audio data (vec4: low, mid, high, all)
  private audioAverage: vec4 = vec4.create();
  private lastAudioAverage: vec4 = vec4.create();
  private audioAverageDelta: vec4 = vec4.create();
  private cumulativeAudio: vec4 = vec4.create();
  private lastCumulativeAudio: vec4 = vec4.create();
  private cumulativeAudioDelta: vec4 = vec4.create();

  private splats: SplatData[] = [];
  private blurDirections: Vec2[] = [new Vec2(0.5, 0), new Vec2(0, 0.5)];

  public config: FluidSimConfig = {
    OverallSoundScale: 2,
    InputScale: 12,
    DensityDissipation: 0.98,
    VelocityDissipation: 0.98,
    PressureDissipation: 0.97,
    Radius: 1.5,
    Blur: 1.2,
    Iterations: 3,
  };

  private densityDissipation: number;
  private velocityDissipation: number;
  private pressureDissipation: number;
  private radius: number;
  private iterations: number;

  // FBOs
  private density!: DoubleFBO;
  private velocity!: DoubleFBO;
  private pressure!: DoubleFBO;
  private divergence!: OGLRenderTarget;
  private curl!: OGLRenderTarget;

  // Programs (Meshes with shaders)
  private texelSize!: { value: Vec2 };
  private clearProgram!: OGLMesh;
  private splatProgram!: OGLMesh;
  private advectionProgram!: OGLMesh;
  private divergenceProgram!: OGLMesh;
  private curlProgram!: OGLMesh;
  private vorticityProgram!: OGLMesh;
  private pressureProgram!: OGLMesh;
  private gradientSubtractProgram!: OGLMesh;
  private blurProgram!: OGLMesh;

  constructor(gl: OGLRenderingContext, renderer: OGLRenderer, options: FluidSimOptions = {}) {
    const { simRes = 128, dyeRes = 512, curlStrength = 0, name = "FluidSim" } = options;

    this.gl = gl;
    this.renderer = renderer;
    this.name = name;

    this.simRes = simRes;
    this.dyeRes = dyeRes;
    this.curlStrength = curlStrength;

    this.densityDissipation = this.config.DensityDissipation;
    this.velocityDissipation = this.config.VelocityDissipation;
    this.pressureDissipation = this.config.PressureDissipation;
    this.radius = this.config.Radius;
    this.iterations = this.config.Iterations;

    this.init();
  }

  private init(): void {
    const gl = this.gl;
    // Cast to WebGL2RenderingContext for WebGL2-specific constants
    const gl2 = gl as unknown as WebGL2RenderingContext;

    // Helper functions for larger device support
    const getSupportedFormat = (
      glCtx: OGLRenderingContext,
      internalFormat: number,
      format: number,
      type: number,
    ): TextureFormat | null => {
      if (!supportRenderTextureFormat(glCtx, internalFormat, format, type)) {
        switch (internalFormat) {
          case gl2.R16F:
            return getSupportedFormat(glCtx, gl2.RG16F, gl2.RG, type);
          case gl2.RG16F:
            return getSupportedFormat(glCtx, gl2.RGBA16F, gl2.RGBA, type);
          default:
            return null;
        }
      }
      return { internalFormat, format };
    };

    const supportRenderTextureFormat = (
      glCtx: OGLRenderingContext,
      internalFormat: number,
      format: number,
      type: number,
    ): boolean => {
      const texture = glCtx.createTexture();
      glCtx.bindTexture(glCtx.TEXTURE_2D, texture);
      glCtx.texParameteri(glCtx.TEXTURE_2D, glCtx.TEXTURE_MIN_FILTER, glCtx.NEAREST);
      glCtx.texParameteri(glCtx.TEXTURE_2D, glCtx.TEXTURE_MAG_FILTER, glCtx.NEAREST);
      glCtx.texParameteri(glCtx.TEXTURE_2D, glCtx.TEXTURE_WRAP_S, glCtx.CLAMP_TO_EDGE);
      glCtx.texParameteri(glCtx.TEXTURE_2D, glCtx.TEXTURE_WRAP_T, glCtx.CLAMP_TO_EDGE);
      glCtx.texImage2D(glCtx.TEXTURE_2D, 0, internalFormat, 4, 4, 0, format, type, null);

      const fbo = glCtx.createFramebuffer();
      glCtx.bindFramebuffer(glCtx.FRAMEBUFFER, fbo);
      glCtx.framebufferTexture2D(glCtx.FRAMEBUFFER, glCtx.COLOR_ATTACHMENT0, glCtx.TEXTURE_2D, texture, 0);

      const status = glCtx.checkFramebufferStatus(glCtx.FRAMEBUFFER);
      return status === glCtx.FRAMEBUFFER_COMPLETE;
    };

    // Check if WebGL2
    const isWebgl2 = gl instanceof WebGL2RenderingContext;

    // Get supported formats and types for FBOs
    const supportLinearFiltering = isWebgl2
      ? gl.getExtension("OES_texture_float_linear")
      : gl.getExtension("OES_texture_half_float_linear");

    const halfFloatExt = isWebgl2 ? null : gl.getExtension("OES_texture_half_float");
    const halfFloat = isWebgl2
      ? gl2.HALF_FLOAT
      : halfFloatExt
        ? (halfFloatExt as { HALF_FLOAT_OES: number }).HALF_FLOAT_OES
        : undefined;

    const filtering = supportLinearFiltering ? gl.LINEAR : gl.NEAREST;
    let rgba: TextureFormat | null;
    let rg: TextureFormat | null;
    let r: TextureFormat | null;

    if (isWebgl2) {
      rgba = getSupportedFormat(gl, gl2.RGBA16F, gl2.RGBA, halfFloat!);
      rg = getSupportedFormat(gl, gl2.RG16F, gl2.RG, halfFloat!);
      r = getSupportedFormat(gl, gl2.R16F, gl2.RED, halfFloat!);
    } else {
      rgba = getSupportedFormat(gl, gl.RGBA, gl.RGBA, halfFloat!);
      rg = rgba;
      r = rgba;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // Create fluid simulation FBOs
    this.density = this.createDoubleFBO({
      width: this.dyeRes,
      height: this.dyeRes,
      type: halfFloat,
      format: rgba?.format,
      internalFormat: rgba?.internalFormat,
      minFilter: filtering,
      depth: false,
    });

    this.velocity = this.createDoubleFBO({
      width: this.simRes,
      height: this.simRes,
      type: halfFloat,
      format: rg?.format,
      internalFormat: rg?.internalFormat,
      minFilter: filtering,
      depth: false,
    });

    this.pressure = this.createDoubleFBO({
      width: this.simRes,
      height: this.simRes,
      type: halfFloat,
      format: r?.format,
      internalFormat: r?.internalFormat,
      minFilter: gl.NEAREST,
      depth: false,
    });

    this.divergence = new RenderTarget(gl, {
      width: this.simRes,
      height: this.simRes,
      type: halfFloat,
      format: r?.format,
      internalFormat: r?.internalFormat,
      minFilter: gl.NEAREST,
      depth: false,
    });

    this.curl = new RenderTarget(gl, {
      width: this.simRes,
      height: this.simRes,
      type: halfFloat,
      format: r?.format,
      internalFormat: r?.internalFormat,
      minFilter: gl.NEAREST,
      depth: false,
    });

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // Geometry to be used for the simulation programs
    const triangle = new Geometry(gl, {
      position: { size: 2, data: new Float32Array([-1, -1, 3, -1, -1, 3]) },
      uv: { size: 2, data: new Float32Array([0, 0, 2, 0, 0, 2]) },
    });

    this.texelSize = { value: new Vec2(1 / this.simRes) };

    // Create fluid simulation programs
    this.clearProgram = new Mesh(gl, {
      geometry: triangle,
      program: new Program(gl, {
        vertex: baseVertex,
        fragment: clearShader,
        uniforms: {
          texelSize: this.texelSize,
          uTexture: { value: null },
          value: { value: this.pressureDissipation },
        },
        depthTest: false,
        depthWrite: false,
      }),
    });

    this.splatProgram = new Mesh(gl, {
      geometry: triangle,
      program: new Program(gl, {
        vertex: baseVertex,
        fragment: splatShader,
        uniforms: {
          texelSize: this.texelSize,
          uTarget: { value: null },
          aspectRatio: { value: 1 },
          color: { value: new Color() },
          point: { value: new Vec2() },
          time: { value: 0 },
          radius: { value: this.radius },
          cumulativeAudio: { value: new Vec4() },
          audioAverage: { value: new Vec2() },
        },
        depthTest: false,
        depthWrite: false,
      }),
    });

    this.advectionProgram = new Mesh(gl, {
      geometry: triangle,
      program: new Program(gl, {
        vertex: baseVertex,
        fragment: supportLinearFiltering ? advectionShader : advectionManualFilteringShader,
        uniforms: {
          texelSize: this.texelSize,
          dyeTexelSize: { value: new Vec2(1 / this.dyeRes) },
          uVelocity: { value: null },
          uSource: { value: null },
          dt: { value: 0.016 },
          dissipation: { value: 1 },
        },
        depthTest: false,
        depthWrite: false,
      }),
    });

    this.divergenceProgram = new Mesh(gl, {
      geometry: triangle,
      program: new Program(gl, {
        vertex: baseVertex,
        fragment: divergenceShader,
        uniforms: {
          texelSize: this.texelSize,
          uVelocity: { value: null },
        },
        depthTest: false,
        depthWrite: false,
      }),
    });

    this.curlProgram = new Mesh(gl, {
      geometry: triangle,
      program: new Program(gl, {
        vertex: baseVertex,
        fragment: curlShader,
        uniforms: {
          texelSize: this.texelSize,
          uVelocity: { value: null },
        },
        depthTest: false,
        depthWrite: false,
      }),
    });

    this.vorticityProgram = new Mesh(gl, {
      geometry: triangle,
      program: new Program(gl, {
        vertex: baseVertex,
        fragment: vorticityShader,
        uniforms: {
          texelSize: this.texelSize,
          uVelocity: { value: null },
          uCurl: { value: null },
          curl: { value: this.curlStrength },
          dt: { value: 0.016 },
        },
        depthTest: false,
        depthWrite: false,
      }),
    });

    this.pressureProgram = new Mesh(gl, {
      geometry: triangle,
      program: new Program(gl, {
        vertex: baseVertex,
        fragment: pressureShader,
        uniforms: {
          texelSize: this.texelSize,
          uPressure: { value: null },
          uDivergence: { value: null },
        },
        depthTest: false,
        depthWrite: false,
      }),
    });

    this.gradientSubtractProgram = new Mesh(gl, {
      geometry: triangle,
      program: new Program(gl, {
        vertex: baseVertex,
        fragment: gradientSubtractShader,
        uniforms: {
          texelSize: this.texelSize,
          uPressure: { value: null },
          uVelocity: { value: null },
        },
        depthTest: false,
        depthWrite: false,
      }),
    });

    this.blurProgram = new Mesh(gl, {
      geometry: triangle,
      program: new Program(gl, {
        vertex: baseVertex,
        fragment: blurShader,
        uniforms: {
          texelSize: this.texelSize,
          simRes: { value: new Vec2(this.simRes) },
          uTexture: { value: null },
          value: { value: 1 },
          direction: { value: new Vec2() },
        },
        depthTest: false,
        depthWrite: false,
      }),
    });
  }

  private createDoubleFBO(options: RenderTargetOptions): DoubleFBO {
    const gl = this.gl;
    const {
      width,
      height,
      wrapS,
      wrapT,
      minFilter = gl.LINEAR,
      magFilter = minFilter,
      type,
      format,
      internalFormat,
      depth,
    } = options;
    const rtOptions = { width, height, wrapS, wrapT, minFilter, magFilter, type, format, internalFormat, depth };

    const fbo: DoubleFBO = {
      read: new RenderTarget(gl, rtOptions),
      write: new RenderTarget(gl, rtOptions),
      swap: function () {
        const temp = this.read;
        this.read = this.write;
        this.write = temp;
      },
    };
    return fbo;
  }

  private splat(data: SplatData): void {
    const { x, y, dx, dy } = data;

    this.splatProgram.program.uniforms.uTarget.value = this.velocity.read.texture;
    this.splatProgram.program.uniforms.aspectRatio.value = this.renderer.width / this.renderer.height;
    (this.splatProgram.program.uniforms.point.value as Vec2).set(x, y);
    (this.splatProgram.program.uniforms.color.value as Color).set(dx, dy, 1);
    this.splatProgram.program.uniforms.radius.value = this.radius;
    this.splatProgram.program.uniforms.time.value = this.time;
    this.splatProgram.program.uniforms.cumulativeAudio.value = this.cumulativeAudio;
    this.splatProgram.program.uniforms.audioAverage.value = this.audioAverage;

    this.renderer.render({
      scene: this.splatProgram,
      target: this.velocity.write,
      sort: false,
      update: false,
    });
    this.velocity.swap();

    this.splatProgram.program.uniforms.uTarget.value = this.density.read.texture;

    this.renderer.render({
      scene: this.splatProgram,
      target: this.density.write,
      sort: false,
      update: false,
    });
    this.density.swap();
  }

  /**
   * Set audio data for reactive animation
   * @param audioData - { low, mid, high, all } normalized 0-1
   * @param inputAudioData - Input audio (microphone) { low, mid, high, all }
   * @param dt - Delta time in milliseconds
   */
  setAudioData(audioData: AudioData | null, inputAudioData: AudioData | null = null, dt: number = 16): void {
    if (audioData) {
      // lerp cumulative audio
      const scale = this.config.OverallSoundScale;
      vec4.copy(_vec4, [audioData.low || 0, audioData.mid || 0, audioData.high || 0, audioData.all || 0]);
      vec4.scale(_vec4, _vec4, scale);
      vec4.scale(_vec4, _vec4, (dt / 1000) * 60);
      vec4.add(_vec4, this.cumulativeAudio, _vec4);
      vec4.lerp(this.cumulativeAudio, this.cumulativeAudio, _vec4, 0.25);

      vec4.copy(_vec4, [audioData.low || 0, audioData.mid || 0, audioData.high || 0, audioData.all || 0]);
      vec4.scale(_vec4, _vec4, scale);
      vec4.lerp(this.audioAverage, this.audioAverage, _vec4, 0.35);
    }

    vec4.subtract(this.audioAverageDelta, this.audioAverage, this.lastAudioAverage);
    vec4.subtract(this.cumulativeAudioDelta, this.cumulativeAudio, this.lastCumulativeAudio);

    vec4.copy(this.lastAudioAverage, this.audioAverage);
    vec4.copy(this.lastCumulativeAudio, this.cumulativeAudio);
  }

  /**
   * Update the fluid simulation
   * @param dt - Delta time in milliseconds
   */
  update(dt: number = 16): void {
    this.time += dt / 1000;

    this.pressureDissipation = this.config.PressureDissipation;
    this.velocityDissipation = this.config.VelocityDissipation;
    this.densityDissipation = this.config.DensityDissipation;
    this.radius = this.config.Radius;
    this.iterations = this.config.Iterations;
    this.blurDirections[0].set(this.config.Blur, 0);
    this.blurDirections[1].set(0, this.config.Blur);

    const virtualCursorX = -Math.sin(this.cumulativeAudio[1] * 0.5) * 0.2 + 0.5;
    const virtualCursorY = Math.cos(this.cumulativeAudio[0] * 0.38) * 0.15 + 0.5;
    const deltaX = virtualCursorX - 0.5;
    const deltaY = virtualCursorY - 0.5;

    if (this.audioAverageDelta[3] > 0.0001) {
      this.splats.push({
        x: 0.5 + virtualCursorX * 0.1,
        y: 0.5 + virtualCursorY * 0.1,
        dx: deltaX * this.config.InputScale,
        dy: deltaY * this.config.InputScale,
      });
    }

    // Perform all of the fluid simulation renders
    const autoClear = this.renderer.autoClear;
    this.renderer.autoClear = false;

    // Render all of the inputs since last frame
    for (let i = this.splats.length - 1; i >= 0; i--) {
      this.splat(this.splats.splice(i, 1)[0]);
    }

    this.curlProgram.program.uniforms.uVelocity.value = this.velocity.read.texture;

    this.renderer.render({
      scene: this.curlProgram,
      target: this.curl,
      sort: false,
      update: false,
    });

    this.vorticityProgram.program.uniforms.uVelocity.value = this.velocity.read.texture;
    this.vorticityProgram.program.uniforms.uCurl.value = this.curl.texture;

    this.renderer.render({
      scene: this.vorticityProgram,
      target: this.velocity.write,
      sort: false,
      update: false,
    });
    this.velocity.swap();

    this.divergenceProgram.program.uniforms.uVelocity.value = this.velocity.read.texture;

    this.renderer.render({
      scene: this.divergenceProgram,
      target: this.divergence,
      sort: false,
      update: false,
    });

    this.clearProgram.program.uniforms.uTexture.value = this.pressure.read.texture;

    this.renderer.render({
      scene: this.clearProgram,
      target: this.pressure.write,
      sort: false,
      update: false,
    });
    this.pressure.swap();

    this.pressureProgram.program.uniforms.uDivergence.value = this.divergence.texture;

    for (let i = 0; i < this.iterations; i++) {
      this.pressureProgram.program.uniforms.uPressure.value = this.pressure.read.texture;

      this.renderer.render({
        scene: this.pressureProgram,
        target: this.pressure.write,
        sort: false,
        update: false,
      });
      this.pressure.swap();
    }

    this.gradientSubtractProgram.program.uniforms.uPressure.value = this.pressure.read.texture;
    this.gradientSubtractProgram.program.uniforms.uVelocity.value = this.velocity.read.texture;

    this.renderer.render({
      scene: this.gradientSubtractProgram,
      target: this.velocity.write,
      sort: false,
      update: false,
    });
    this.velocity.swap();

    this.advectionProgram.program.uniforms.dyeTexelSize.value.set(1 / this.simRes);
    this.advectionProgram.program.uniforms.uVelocity.value = this.velocity.read.texture;
    this.advectionProgram.program.uniforms.uSource.value = this.velocity.read.texture;
    this.advectionProgram.program.uniforms.dissipation.value = this.velocityDissipation;

    this.renderer.render({
      scene: this.advectionProgram,
      target: this.velocity.write,
      sort: false,
      update: false,
    });
    this.velocity.swap();

    this.advectionProgram.program.uniforms.dyeTexelSize.value.set(1 / this.dyeRes);
    this.advectionProgram.program.uniforms.uVelocity.value = this.velocity.read.texture;
    this.advectionProgram.program.uniforms.uSource.value = this.density.read.texture;
    this.advectionProgram.program.uniforms.dissipation.value = this.densityDissipation;

    this.renderer.render({
      scene: this.advectionProgram,
      target: this.density.write,
      sort: false,
      update: false,
    });
    this.density.swap();

    // Apply blur passes for each direction
    for (let i = 0; i < this.blurDirections.length; i++) {
      (this.blurProgram.program.uniforms.simRes.value as Vec2).set(this.simRes);
      this.blurProgram.program.uniforms.uTexture.value = this.density.read.texture;
      (this.blurProgram.program.uniforms.direction.value as Vec2).copy(this.blurDirections[i]);
      this.renderer.render({
        scene: this.blurProgram,
        target: this.density.write,
        sort: false,
        update: false,
      });
      this.density.swap();
    }

    this.renderer.autoClear = autoClear;
  }

  /**
   * Get the density texture for use in other shaders
   */
  getTexture(): OGLRenderTarget["texture"] {
    return this.density.read.texture;
  }

  /**
   * Handle resize - update any size-dependent uniforms
   */
  resize(): void {
    // If we needed to resize FBOs, we would do it here.
    // For now, just update any uniforms that depend on screen size if necessary.
    // The simulation resolution is usually fixed or independent of screen size.
  }

  /**
   * Dispose all resources
   */
  dispose(): void {
    // Dispose FBOs and resources
    if (this.density) {
      disposeTarget(this.density.read);
      disposeTarget(this.density.write);
    }
    if (this.velocity) {
      disposeTarget(this.velocity.read);
      disposeTarget(this.velocity.write);
    }
    if (this.pressure) {
      disposeTarget(this.pressure.read);
      disposeTarget(this.pressure.write);
    }
    disposeTarget(this.divergence);
    disposeTarget(this.curl);
  }
}

export default FluidSim;
