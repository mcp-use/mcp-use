import { useEffect, useRef } from "react";

const VERT = `#version 300 es
in vec4 a_position;
out vec2 v_objectUV;
void main(){
  gl_Position=a_position;
  v_objectUV=a_position.xy*0.5+0.5;
}`;

const FRAG = `#version 300 es
precision mediump float;
uniform float u_time;
uniform vec4 u_colors[4];
uniform float u_colorsCount;
uniform float u_distortion;
uniform float u_swirl;
uniform float u_grainMixer;
uniform float u_grainOverlay;
in vec2 v_objectUV;
out vec4 fragColor;
vec2 rotate(vec2 uv,float th){return mat2(cos(th),sin(th),-sin(th),cos(th))*uv;}
float hash21(vec2 p){
  p=fract(p*vec2(0.3183099,0.3678794))+0.1;
  p+=dot(p,p+19.19);
  return fract(p.x*p.y);
}
float valueNoise(vec2 st){
  vec2 i=floor(st);vec2 f=fract(st);
  float a=hash21(i),b=hash21(i+vec2(1.,0.)),c=hash21(i+vec2(0.,1.)),d=hash21(i+vec2(1.,1.));
  vec2 u=f*f*(3.-2.*f);
  return mix(mix(a,b,u.x),mix(c,d,u.x),u.y);
}
vec2 getPosition(int i,float t){
  float a=float(i)*.37,b=.6+fract(float(i)/3.)*.9,c=.8+fract(float(i+1)/4.);
  float x=sin(t*b+a),y=cos(t*c+a*1.5);
  return .5+.5*vec2(x,y);
}
void main(){
  vec2 uv=v_objectUV;uv+=.5;
  vec2 grainUV=uv*1000.;
  float grain=valueNoise(grainUV);
  float mixerGrain=.4*u_grainMixer*(grain-.5);
  float t=.5*(u_time+41.5);
  float radius=smoothstep(0.,1.,length(uv-.5));
  float center=1.-radius;
  for(float i=1.;i<=2.;i++){
    uv.x+=u_distortion*center/i*sin(t+i*.4*smoothstep(0.,1.,uv.y))*cos(.2*t+i*2.4*smoothstep(0.,1.,uv.y));
    uv.y+=u_distortion*center/i*cos(t+i*2.*smoothstep(0.,1.,uv.x));
  }
  vec2 uvR=uv-vec2(.5);
  float angle=3.*u_swirl*radius;
  uvR=rotate(uvR,-angle);uvR+=vec2(.5);
  vec3 color=vec3(0.);float opacity=0.,totalWeight=0.;
  for(int i=0;i<4;i++){
    if(i>=int(u_colorsCount))break;
    vec2 pos=getPosition(i,t)+mixerGrain;
    vec3 cf=u_colors[i].rgb*u_colors[i].a;
    float opacityF=u_colors[i].a;
    float dist=length(uvR-pos);
    dist=pow(dist,3.5);
    float w=1./(dist+1e-3);
    color+=cf*w;opacity+=opacityF*w;totalWeight+=w;
  }
  color/=max(1e-4,totalWeight);
  opacity/=max(1e-4,totalWeight);
  float grainO=valueNoise(rotate(grainUV,1.)+vec2(3.));
  grainO=mix(grainO,valueNoise(rotate(grainUV,2.)+vec2(-1.)),.5);
  grainO=pow(grainO,1.3);
  float grainOV=grainO*2.-1.;
  vec3 grainOC=vec3(step(0.,grainOV));
  float grainOS=u_grainOverlay*abs(grainOV);
  grainOS=pow(grainOS,.8);
  color=mix(color,grainOC,.35*grainOS);
  opacity+=.5*grainOS;
  fragColor=vec4(color,clamp(opacity,0.,1.));
}`;

function hexToRgba(hex: string): [number, number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
    1,
  ];
}

interface MeshGradientCanvasProps {
  className?: string;
  colors?: string[];
  distortion?: number;
  swirl?: number;
  grainMixer?: number;
  grainOverlay?: number;
  speed?: number;
}

/** Inline WebGL2 mesh gradient — port of mcp-use landing.ts getMeshGradientScript(). */
export function MeshGradientCanvas({
  className,
  colors = ["#e0eaff", "#f9ffbd", "#dedede", "#ffffff"],
  distortion = 0.8,
  swirl = 0.1,
  grainMixer = 0,
  grainOverlay = 0.2,
  speed = 1,
}: MeshGradientCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef({
    colors,
    distortion,
    swirl,
    grainMixer,
    grainOverlay,
    speed,
  });
  propsRef.current = {
    colors,
    distortion,
    swirl,
    grainMixer,
    grainOverlay,
    speed,
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const gl = canvas.getContext("webgl2");
    if (!gl) return;

    const compileShader = (type: number, src: string) => {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, src);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error(gl.getShaderInfoLog(shader));
        return null;
      }
      return shader;
    };

    const vs = compileShader(gl.VERTEX_SHADER, VERT);
    const fs = compileShader(gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return;

    const prog = gl.createProgram();
    if (!prog) return;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error(gl.getProgramInfoLog(prog));
      return;
    }
    gl.useProgram(prog);

    const posLoc = gl.getAttribLocation(prog, "a_position");
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW
    );
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    const uTime = gl.getUniformLocation(prog, "u_time");
    const uColors = [0, 1, 2, 3].map((i) =>
      gl.getUniformLocation(prog, `u_colors[${i}]`)
    );
    const uColorsCount = gl.getUniformLocation(prog, "u_colorsCount");
    const uDistortion = gl.getUniformLocation(prog, "u_distortion");
    const uSwirl = gl.getUniformLocation(prog, "u_swirl");
    const uGrainMixer = gl.getUniformLocation(prog, "u_grainMixer");
    const uGrainOverlay = gl.getUniformLocation(prog, "u_grainOverlay");

    let time = 0;
    let raf = 0;

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.floor(wrap.clientWidth * dpr);
      canvas.height = Math.floor(wrap.clientHeight * dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
    };

    const draw = () => {
      if (document.hidden) {
        raf = requestAnimationFrame(draw);
        return;
      }
      const {
        colors: currentColors,
        distortion: currentDistortion,
        swirl: currentSwirl,
        grainMixer: currentGrainMixer,
        grainOverlay: currentGrainOverlay,
        speed: currentSpeed,
      } = propsRef.current;
      const rgbaColors = currentColors.map(hexToRgba);
      time += 0.016 * currentSpeed;
      gl.uniform1f(uTime, time);
      for (let i = 0; i < 4; i++) {
        const loc = uColors[i];
        if (loc) gl.uniform4fv(loc, rgbaColors[i] ?? [1, 1, 1, 1]);
      }
      gl.uniform1f(uColorsCount, rgbaColors.length);
      gl.uniform1f(uDistortion, currentDistortion);
      gl.uniform1f(uSwirl, currentSwirl);
      gl.uniform1f(uGrainMixer, currentGrainMixer);
      gl.uniform1f(uGrainOverlay, currentGrainOverlay);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      raf = requestAnimationFrame(draw);
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    draw();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <div ref={wrapRef} className={className}>
      <canvas ref={canvasRef} className="h-full w-full" aria-hidden />
    </div>
  );
}
