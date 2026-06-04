"use client";

import { useEffect, useRef, type RefObject } from "react";

interface ShaderOrbProps {
  /** Shared analyser from useStageAudio; may be null until the graph is ready. */
  analyserRef: RefObject<AnalyserNode | null>;
  isPlaying: boolean;
  className?: string;
}

const VERT = `
attribute vec2 aPos;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

const FRAG = `
precision highp float;

uniform vec2 uRes;
uniform float uTime;
uniform float uBass;
uniform float uMid;
uniform float uTreble;
uniform float uLevel;

// ── Ashima simplex noise (3D) ──────────────────────────────────────
vec4 permute(vec4 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod(i, 289.0);
  vec4 p = permute(permute(permute(
            i.z + vec4(0.0, i1.z, i2.z, 1.0))
          + i.y + vec4(0.0, i1.y, i2.y, 1.0))
          + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 1.0 / 7.0;
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
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

float fbm(vec3 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    s += a * snoise(p);
    p *= 2.02;
    a *= 0.5;
  }
  return s;
}

const vec3 CORAL = vec3(1.0, 0.416, 0.302); // #FF6A4D
const vec3 LIGHT = vec3(1.0, 0.86, 0.78);
const vec3 DEEP  = vec3(0.34, 0.06, 0.05);

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / min(uRes.x, uRes.y);
  float d = length(uv);

  float R = 0.30 + uBass * 0.028;
  float aa = 2.0 / min(uRes.x, uRes.y);
  float edge = smoothstep(R, R - aa * 2.0, d);

  vec3 col = vec3(0.0);
  float a = 0.0;

  if (edge > 0.0) {
    float nz = sqrt(max(R * R - d * d, 0.0));
    vec3 n = normalize(vec3(uv, nz) / R);

    float t = uTime * 0.16;
    vec3 q = n * 2.1 + vec3(0.0, 0.0, t);
    float f = fbm(q + n * uBass * 0.7);
    float f2 = fbm(q * 2.6 + vec3(t * 1.4));
    float surf = f * 0.7 + f2 * 0.3 * (0.5 + uTreble);

    vec3 L = normalize(vec3(-0.45, 0.6, 0.68));
    float diff = clamp(dot(n, L), 0.0, 1.0);
    vec3 refl = reflect(-L, n);
    float spec = pow(max(refl.z, 0.0), 22.0);
    float rim = pow(1.0 - clamp(n.z, 0.0, 1.0), 2.3);

    vec3 base = mix(DEEP, CORAL, diff * 0.85 + 0.15);
    base = mix(base, LIGHT, smoothstep(0.5, 0.95, diff) * 0.45);
    base += CORAL * surf * (0.22 + uLevel * 0.5);
    base += LIGHT * spec * (0.6 + uTreble * 0.9);
    base += CORAL * rim * (0.45 + uLevel * 0.7);

    float core = smoothstep(0.55, 0.0, d / R);
    base += LIGHT * core * (0.12 + uBass * 0.35);

    col = base;
    a = edge;
  }

  // Soft coral glow halo around the sphere.
  float hd = max(d - R, 0.0);
  float halo = exp(-hd * 11.0) * (0.28 + uLevel * 1.0 + uBass * 0.45);
  float haloA = halo * (1.0 - edge);
  vec3 haloColor = mix(CORAL, LIGHT, 0.22);

  vec3 finalCol = (col * a + haloColor * haloA) / max(a + haloA, 0.0001);
  float finalA = clamp(a + haloA, 0.0, 1.0);

  gl_FragColor = vec4(finalCol * finalA, finalA); // premultiplied
}
`;

function compile(
  gl: WebGLRenderingContext,
  type: number,
  src: string
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) {
    return null;
  }
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

const CSS_FALLBACK =
  "radial-gradient(circle at 50% 44%, #ffd9cf 0%, #ff7a5c 32%, rgba(255,106,77,0) 60%)";

export function ShaderOrb({ analyserRef, isPlaying, className }: ShaderOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playingRef = useRef(isPlaying);

  useEffect(() => {
    playingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const gl = (canvas.getContext("webgl", {
      alpha: true,
      premultipliedAlpha: true,
      antialias: true,
    }) ||
      canvas.getContext("experimental-webgl", {
        alpha: true,
        premultipliedAlpha: true,
        antialias: true,
      })) as WebGLRenderingContext | null;

    if (!gl) {
      // No WebGL — fall back to a static CSS coral orb so the stage still reads.
      canvas.style.background = CSS_FALLBACK;
      return;
    }

    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    const program = gl.createProgram();
    if (!vs || !fs || !program) {
      canvas.style.background = CSS_FALLBACK;
      return;
    }
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      canvas.style.background = CSS_FALLBACK;
      return;
    }
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW
    );
    const aPos = gl.getAttribLocation(program, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(program, "uRes");
    const uTime = gl.getUniformLocation(program, "uTime");
    const uBass = gl.getUniformLocation(program, "uBass");
    const uMid = gl.getUniformLocation(program, "uMid");
    const uTreble = gl.getUniformLocation(program, "uTreble");
    const uLevel = gl.getUniformLocation(program, "uLevel");

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(1, Math.floor(rect.width * dpr));
      const h = Math.max(1, Math.floor(rect.height * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    const motion = reduced ? 0.25 : 1;

    let freq: Uint8Array<ArrayBuffer> | null = null;
    let bass = 0;
    let mid = 0;
    let treble = 0;
    let level = 0;

    const smooth = (cur: number, target: number) =>
      cur + (target - cur) * (target > cur ? 0.35 : 0.12);

    const start = performance.now();
    let raf = 0;

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);

      const analyser = analyserRef.current;
      if (analyser && (!freq || freq.length !== analyser.frequencyBinCount)) {
        freq = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
      }

      let live = false;
      let tBass = 0;
      let tMid = 0;
      let tTreble = 0;
      let tLevel = 0;

      if (analyser && freq) {
        analyser.getByteFrequencyData(freq);
        const n = freq.length;
        const bEnd = Math.max(1, Math.floor(n * 0.08));
        const mEnd = Math.max(bEnd + 1, Math.floor(n * 0.35));
        let sb = 0;
        let sm = 0;
        let st = 0;
        let sa = 0;
        for (let i = 0; i < n; i++) {
          const v = freq[i] / 255;
          sa += v;
          if (v > 0) {
            live = true;
          }
          if (i < bEnd) {
            sb += v;
          } else if (i < mEnd) {
            sm += v;
          } else {
            st += v;
          }
        }
        tBass = sb / bEnd;
        tMid = sm / (mEnd - bEnd);
        tTreble = st / Math.max(1, n - mEnd);
        tLevel = sa / n;
      }

      // Generative idle motion when there is no live signal.
      if (!live) {
        const s = (now / 1000) * motion;
        tBass = 0.22 + 0.16 * (Math.sin(s * 1.3) * 0.5 + 0.5);
        tMid = 0.18 + 0.12 * (Math.sin(s * 0.7 + 1.0) * 0.5 + 0.5);
        tTreble = 0.1 + 0.08 * (Math.sin(s * 2.1) * 0.5 + 0.5);
        tLevel = 0.18 + 0.1 * (Math.sin(s * 0.9) * 0.5 + 0.5);
      }

      const intensity = playingRef.current ? 1 : 0.55;
      bass = smooth(bass, tBass * intensity);
      mid = smooth(mid, tMid * intensity);
      treble = smooth(treble, tTreble * intensity);
      level = smooth(level, tLevel * intensity);

      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, ((now - start) / 1000) * motion);
      gl.uniform1f(uBass, bass);
      gl.uniform1f(uMid, mid);
      gl.uniform1f(uTreble, treble);
      gl.uniform1f(uLevel, level);

      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteBuffer(buffer);
    };
    // analyserRef is a stable ref; isPlaying is read via playingRef each frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <canvas ref={canvasRef} className={className} aria-hidden />;
}
