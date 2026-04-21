/**
 * Landing page generator for MCP server endpoints
 *
 * Generates SEO-friendly HTML with connection instructions for MCP servers
 * from Claude Code, Cursor, VS Code, ChatGPT, and Manufact Inspector (hosted).
 */

/**
 * Escapes HTML special characters to prevent XSS in user-provided content.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Sanitizes a server name for use in filenames and URLs.
 * Replaces non-alphanumeric characters with underscores and converts to lowercase.
 */
function sanitizeServerName(name: string): string {
  return name.replace(/[^a-zA-Z0-9-_]/g, "_").toLowerCase();
}

/**
 * Generates a Cursor deep link for installing an MCP server.
 * The config is base64-encoded JSON containing the server URL.
 */
function generateCursorDeepLink(url: string, name: string): string {
  const config = { url };
  const configJson = JSON.stringify(config);

  // Use Buffer in Node.js or btoa in browser-like environments
  const base64Config =
    typeof Buffer !== "undefined"
      ? Buffer.from(configJson).toString("base64")
      : btoa(configJson);

  const sanitizedName = sanitizeServerName(name);
  return `cursor://anysphere.cursor-deeplink/mcp/install?config=${base64Config}&name=${encodeURIComponent(sanitizedName)}`;
}

/**
 * Generates a VS Code deep link for installing an MCP server.
 * The config is URL-encoded JSON containing the server URL.
 */
function generateVSCodeDeepLink(url: string, name: string): string {
  const config = {
    url,
    name: sanitizeServerName(name),
    type: "http",
  };
  const configJson = JSON.stringify(config);
  const urlEncodedConfig = encodeURIComponent(configJson);
  return `vscode:mcp/install?${urlEncodedConfig}`;
}

/**
 * Generates a VS Code Insiders deep link for installing an MCP server.
 * The config is URL-encoded JSON containing the server URL.
 */
function generateVSCodeInsidersDeepLink(url: string, name: string): string {
  const config = {
    url,
    name: sanitizeServerName(name),
    type: "http",
  };
  const configJson = JSON.stringify(config);
  const urlEncodedConfig = encodeURIComponent(configJson);
  return `vscode-insiders:mcp/install?${urlEncodedConfig}`;
}

/**
 * Generates a Claude Code CLI command for adding an MCP server.
 */
function generateClaudeCommand(url: string, name: string): string {
  const sanitizedName = sanitizeServerName(name);
  return `claude mcp add --transport http "${sanitizedName}" ${url}`;
}

/** Hosted Manufact Inspector base (same as cloud deploy “Open in new tab”). */
const MANUFACT_INSPECTOR_ORIGIN = "https://inspector.manufact.com";

/**
 * Deep link to hosted Manufact Inspector with this MCP server URL pre-filled
 * and the Chat tab selected (`tab=chat`).
 */
function getManufactInspectorUrl(serverUrl: string): string {
  const params = new URLSearchParams({
    autoConnect: serverUrl,
    tab: "chat",
  });
  return `${MANUFACT_INSPECTOR_ORIGIN}/inspector?${params.toString()}`;
}

const LOGO_SVG_PATHS = {
  path1:
    "M105.933 0C164.437 0.000115889 211.865 47.607 211.865 106.333C211.865 131.828 210.494 158.401 221.068 181.6L228.976 198.947C243.585 230.997 269.266 256.7 301.304 271.336L316.156 278.121C340.143 289.079 367.695 287.335 394.067 287.335C452.572 287.335 500 334.942 500 393.668C500 452.394 452.572 500.001 394.067 500.001C335.563 500.001 288.135 452.394 288.135 393.668C288.135 368.974 289.241 343.275 278.992 320.807L270.587 302.38C255.949 270.289 230.214 244.565 198.118 229.939L180.164 221.758C157.282 211.331 131.078 212.666 105.933 212.666C47.4278 212.666 4.92992e-05 165.059 0 106.333C0 47.607 47.4278 0 105.933 0Z",
  circle: { cx: 100.426, cy: 399.575, r: 100.426 },
  path2:
    "M500 100.426C500 155.889 455.037 200.851 399.574 200.851C344.11 200.851 299.148 155.889 299.148 100.426C299.148 44.962 344.11 0 399.574 0C455.037 0 500 44.962 500 100.426Z",
};

const LINE_INTERSECTION_PATH =
  "M10.5 4C10.5 7.31371 7.81371 10 4.5 10H0.5V11H4.5C7.81371 11 10.5 13.6863 10.5 17V21H11.5V17C11.5 13.6863 14.1863 11 17.5 11H21.5V10H17.5C14.1863 10 11.5 7.31371 11.5 4V0H10.5V4Z";

/** Returns the inline WebGL mesh gradient script (no deps). */
function getMeshGradientScript(): string {
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
#define PI 3.14159265359
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

  return `(function(){
var c=document.getElementById('mesh-bg');
if(!c)return;
var wrap=c.parentElement;
if(!wrap)return;
var gl=c.getContext('webgl2');
if(!gl)return;
function compileShader(typ,src){
  var s=gl.createShader(typ);
  gl.shaderSource(s,src);
  gl.compileShader(s);
  if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){console.error(gl.getShaderInfoLog(s));return null;}
  return s;
}
var vs=compileShader(gl.VERTEX_SHADER,${JSON.stringify(VERT)});
var fs=compileShader(gl.FRAGMENT_SHADER,${JSON.stringify(FRAG)});
if(!vs||!fs)return;
var prog=gl.createProgram();
gl.attachShader(prog,vs);
gl.attachShader(prog,fs);
gl.linkProgram(prog);
if(!gl.getProgramParameter(prog,gl.LINK_STATUS)){console.error(gl.getProgramInfoLog(prog));return;}
gl.useProgram(prog);
var posLoc=gl.getAttribLocation(prog,'a_position');
var buf=gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER,buf);
gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
gl.enableVertexAttribArray(posLoc);
gl.vertexAttribPointer(posLoc,2,gl.FLOAT,false,0,0);
function hexToRgba(hex){
  var r=(parseInt(hex.slice(1,3),16))/255;
  var g=(parseInt(hex.slice(3,5),16))/255;
  var b=(parseInt(hex.slice(5,7),16))/255;
  return[r,g,b,1];
}
var colors=[hexToRgba('#e0eaff'),hexToRgba('#f9ffbd'),hexToRgba('#dedede'),hexToRgba('#ffffff')];
var uTime=gl.getUniformLocation(prog,'u_time');
var uColors=[gl.getUniformLocation(prog,'u_colors[0]'),gl.getUniformLocation(prog,'u_colors[1]'),gl.getUniformLocation(prog,'u_colors[2]'),gl.getUniformLocation(prog,'u_colors[3]')];
var uColorsCount=gl.getUniformLocation(prog,'u_colorsCount');
var uDistortion=gl.getUniformLocation(prog,'u_distortion');
var uSwirl=gl.getUniformLocation(prog,'u_swirl');
var uGrainMixer=gl.getUniformLocation(prog,'u_grainMixer');
var uGrainOverlay=gl.getUniformLocation(prog,'u_grainOverlay');
var time=0,speed=1,raf;
function resize(){
  var dpr=Math.min(2,window.devicePixelRatio||1);
  c.width=Math.floor(wrap.clientWidth*dpr);
  c.height=Math.floor(wrap.clientHeight*dpr);
  gl.viewport(0,0,c.width,c.height);
}
function draw(){
  if(document.hidden){raf=requestAnimationFrame(draw);return;}
  time+=0.016*speed;
  gl.uniform1f(uTime,time);
  for(var i=0;i<4;i++)gl.uniform4fv(uColors[i],colors[i]);
  gl.uniform1f(uColorsCount,4);
  gl.uniform1f(uDistortion,0.8);
  gl.uniform1f(uSwirl,0.1);
  gl.uniform1f(uGrainMixer,0);
  gl.uniform1f(uGrainOverlay,0.3);
  gl.drawArrays(gl.TRIANGLES,0,6);
  raf=requestAnimationFrame(draw);
}
resize();
new ResizeObserver(resize).observe(wrap);
draw();
})();`;
}

/** Tool entry for the landing page. */
export interface LandingPageTool {
  name: string;
  description?: string;
}

/** Prompt entry for the landing page. */
export interface LandingPagePrompt {
  name: string;
  description?: string;
}

/** Resource entry for the landing page. */
export interface LandingPageResource {
  uri: string;
  name?: string;
  description?: string;
}

/**
 * Generates an HTML landing page with connection instructions
 * for Claude Code, Cursor, VS Code, ChatGPT, and Manufact Inspector.
 *
 * @param name - Server name
 * @param version - Server version
 * @param url - Full server URL (including protocol, host, port, and path)
 * @param description - Optional server description
 * @param tools - Optional list of tools (names or {name, description})
 * @param prompts - Optional list of prompts
 * @param resources - Optional list of resources
 * @param iconUrl - Optional full URL to the server icon image
 * @returns HTML landing page with connection instructions
 */
export function generateLandingPage(
  name: string,
  version: string,
  url: string,
  description?: string,
  tools?: (LandingPageTool | string)[],
  prompts?: LandingPagePrompt[],
  resources?: LandingPageResource[],
  iconUrl?: string
): string {
  const cursorDeepLink = generateCursorDeepLink(url, name);
  const vscodeDeepLink = generateVSCodeDeepLink(url, name);
  const vscodeInsidersDeepLink = generateVSCodeInsidersDeepLink(url, name);
  const claudeCommand = generateClaudeCommand(url, name);
  const manufactInspectorUrl = getManufactInspectorUrl(url);

  const safeName = escapeHtml(name);
  const safeDescription = description ? escapeHtml(description) : "";
  const metaDescription =
    safeDescription ||
    `${safeName} MCP Server — Connect with Claude Code, Cursor, and VS Code. Model Context Protocol server.`;
  const pageTitle = `${safeName} MCP Server — Connect with Claude Code, Cursor & VS Code`;

  const jsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: name,
    softwareVersion: version,
    description: metaDescription,
    applicationCategory: "DeveloperApplication",
  });

  const normalizedTools: LandingPageTool[] =
    tools && tools.length > 0
      ? tools.map((t) =>
          typeof t === "string"
            ? { name: t }
            : { name: t.name, description: t.description }
        )
      : [];

  const toolsListHtml =
    normalizedTools.length > 0
      ? normalizedTools
          .map(
            (t) =>
              `<div class="spec-item"><code class="spec-name">${escapeHtml(t.name)}</code>${t.description ? `<p class="spec-desc">${escapeHtml(t.description)}</p>` : ""}</div>`
          )
          .join("\n")
      : "";

  const promptsListHtml =
    prompts && prompts.length > 0
      ? prompts
          .map(
            (p) =>
              `<div class="spec-item"><code class="spec-name">${escapeHtml(p.name)}</code>${p.description ? `<p class="spec-desc">${escapeHtml(p.description)}</p>` : ""}</div>`
          )
          .join("\n")
      : "";

  const resourcesListHtml =
    resources && resources.length > 0
      ? resources
          .map(
            (r) =>
              `<div class="spec-item"><code class="spec-uri">${escapeHtml(r.uri)}</code>${r.name ? `<strong>${escapeHtml(r.name)}</strong>` : ""}${r.description ? `<p class="spec-desc">${escapeHtml(r.description)}</p>` : ""}</div>`
          )
          .join("\n")
      : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${pageTitle}</title>
<meta name="description" content="${metaDescription}">
<meta property="og:title" content="${pageTitle}">
<meta property="og:description" content="${metaDescription}">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${pageTitle}">
<meta name="twitter:description" content="${metaDescription}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&display=swap" rel="stylesheet">
<script type="application/ld+json">${jsonLd}</script>
<style>
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-size: 16px;
  line-height: 1.6;
  color: #1e293b;
  background-color: #fdfcfc;
  min-height: 100vh;
}
.layout {
  max-width: 48rem;
  margin: 0 auto;
  padding: 2rem 1.5rem;
  position: relative;
}
.rail-left, .rail-right {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: rgba(0,0,0,0.08);
}
.rail-left { left: 1.5rem; }
.rail-right { right: 1.5rem; }
.rail-top, .rail-bottom {
  height: 1px;
  background: rgba(0,0,0,0.08);
  position: absolute;
  left: 1.5rem;
  right: 1.5rem;
}
.rail-top { top: 0; }
.rail-bottom { bottom: 0; }
.corner {
  position: absolute;
  width: 22px;
  height: 21px;
  color: rgba(0,0,0,0.08);
}
.corner-tl { left: 1.5rem; top: 0; transform: translate(-50%, -50%); }
.corner-tr { right: 1.5rem; top: 0; transform: translate(50%, -50%); left: auto; }
.corner-bl { left: 1.5rem; bottom: 0; transform: translate(-50%, 50%); top: auto; }
.corner-br { right: 1.5rem; bottom: 0; transform: translate(50%, 50%); left: auto; top: auto; }
.card {
  background: #fff;
  border-top: 1px solid rgba(0,0,0,0.08);
  border-bottom: 1px solid rgba(0,0,0,0.08);
  margin-bottom: 1.5rem;
  overflow: hidden;
}
.card-header {
  padding: 1.5rem 1.5rem 0.5rem;
}
.card-content { padding: 0 1.5rem 1.5rem; }
.hero-card .card-header {
  text-align: center;
  padding: 0 1.5rem 1.25rem;
}
.hero-card .card-header.has-icon {
  padding-top: 1.5rem;
}
.hero-icon {
  width: 64px;
  height: 64px;
  border-radius: 14px;
  object-fit: contain;
  margin-bottom: 0.75rem;
}
.hero-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  margin-bottom: 0.35rem;
}
.hero h1 {
  font-size: 1.75rem;
  font-weight: 700;
  color: #172037;
  margin: 0.75rem 0 0;
}
.hero-card .card-header.has-icon .hero h1 { margin-top: 0; }
.hero .version { font-size: 0.95rem; color: #64748b; font-weight: 500; }
.hero-description {
  color: rgba(23,32,55,0.8);
  font-size: 1rem;
  margin: 0.35rem 0 0;
  max-width: 36rem;
  margin-left: auto;
  margin-right: auto;
}
.logo-symbol {
  display: inline-block;
  cursor: default;
  flex-shrink: 0;
}
.logo-symbol svg {
  width: 32px;
  height: 32px;
  color: #172037;
}
.logo-fill { transition: opacity 0.2s ease; }
.logo-stroke path,
.logo-stroke circle {
  fill: none;
  stroke: currentColor;
  stroke-width: 6;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-dasharray: 2000;
  stroke-dashoffset: 2000;
  opacity: 0;
}
.logo-symbol:hover .logo-fill {
  animation: logo-fill-out 0.2s forwards, logo-fill-in 0.6s 0.9s forwards;
}
.logo-symbol:hover .logo-stroke path,
.logo-symbol:hover .logo-stroke circle {
  opacity: 1;
  animation: logo-draw 0.7s 0.2s ease-in-out forwards;
}
@keyframes logo-fill-out { to { opacity: 0; } }
@keyframes logo-fill-in { to { opacity: 1; } }
@keyframes logo-draw { to { stroke-dashoffset: 0; } }
.footer-content { text-align: center; padding: 2.5rem 1.5rem; border-top: 1px solid rgba(0,0,0,0.08); display: flex; justify-content: center; align-items: center; }
.footer-brand-link { justify-content: center; }
.footer-brand-link .logo-symbol svg { width: 22px; height: 22px; }
.hero-powered { display: inline-flex; align-items: center; justify-content: center; gap: 0.35rem; margin-top: 0.75rem; font-family: "Outfit", -apple-system, BlinkMacSystemFont, sans-serif; font-size: 0.875rem; font-weight: 500; color: rgba(23,32,55,0.6); }
.hero-powered a { color: #000; text-decoration: none; display: inline-flex; align-items: center; }
.hero-powered a:hover { text-decoration: underline; }
.footer-brand-link { display: inline-flex; align-items: center; gap: 0.5rem; font-family: "Outfit", -apple-system, BlinkMacSystemFont, sans-serif; font-size: 1.5rem; font-weight: 600; color: #172037; text-decoration: none; }
.footer-brand-link:hover { color: #0f172a; }
.hero-url-block { display: flex; justify-content: center; margin: 0.75rem 0; }
.hero-cta-row {
  display: flex;
  justify-content: center;
  margin: 0.35rem 0 0.5rem;
}
.hero-primary-btn {
  display: inline-block;
  padding: 0.625rem 1.25rem;
  background: linear-gradient(180deg, #1e293b 0%, #0f172a 100%);
  color: #fff;
  border-radius: 9999px;
  text-decoration: none;
  font-weight: 600;
  font-size: 0.9375rem;
  box-shadow: 0 1px 2px rgba(0,0,0,0.12), 0 2px 8px rgba(15,23,42,0.15);
  transition: background 0.15s;
  border: 1px solid rgba(0,0,0,0.12);
}
.hero-primary-btn:hover {
  background: linear-gradient(180deg, #334155 0%, #1e293b 100%);
  text-decoration: none;
  color: #fff;
}
.hero-url-block .url-block { max-width: 100%; }
.hero-url-block .url-box {
  font-size: 0.938rem;
  background: #fff;
  border: 1px solid rgba(0,0,0,0.12);
  border-radius: 9999px;
  padding: 0.75rem 3rem 0.75rem 1rem;
  margin: 1rem 0;
}
.hero-powered .gh-icon { width: 18px; height: 18px; margin-right: 0.25rem; vertical-align: -0.2em; }
.hero-powered .gh-shield { height: 18px; width: auto; margin-left: 0.4rem; vertical-align: -0.2em; }
.card-title { font-size: 1.25rem; font-weight: 600; color: #172037; margin: 0 0 0.25rem; }
.card-desc { font-size: 0.875rem; color: rgba(23,32,55,0.8); margin: 0 0 1rem; }
.url-block {
  position: relative;
  margin: 1rem 0;
}
.url-block .url-box {
  margin: 0;
  padding-right: 2.75rem;
}
.url-block .copy-btn { top: 50%; right: 0.5rem; transform: translateY(-50%); }
.url-box {
  font-family: ui-monospace, monospace;
  font-size: 0.813rem;
  background: #f8fafc;
  padding: 0.5rem 0.75rem;
  border-radius: 6px;
  color: #475569;
  margin: 1rem 0;
}
.spec-section { margin-top: 1.5rem; }
.spec-section h3 { font-size: 1rem; font-weight: 600; color: #172037; margin: 0 0 0.75rem; }
.spec-item { margin-bottom: 1rem; padding-bottom: 1rem; border-bottom: 1px solid #f1f5f9; }
.spec-item:last-child { margin-bottom: 0; padding-bottom: 0; border-bottom: none; }
.spec-name, .spec-uri { font-family: ui-monospace, monospace; font-size: 0.813rem; background: #f1f5f9; padding: 0.2rem 0.4rem; border-radius: 4px; }
.spec-uri { word-break: break-all; }
.spec-desc { margin: 0.5rem 0 0; font-size: 0.875rem; color: #64748b; line-height: 1.5; }
.tabs-row {
  display: flex;
  gap: 2px;
  background: rgba(23,32,55,0.05);
  padding: 3px;
  border-radius: 8px;
  margin-bottom: 1.5rem;
  flex-wrap: wrap;
}
.tab {
  flex: 1;
  min-width: 80px;
  padding: 0.5rem 0.75rem;
  font-size: 0.813rem;
  font-weight: 500;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #64748b;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.tab:hover { color: #172037; background: rgba(255,255,255,0.6); }
.tab.active { background: #fff; color: #172037; border: 1px solid rgba(0,0,0,0.1); box-shadow: 0 1px 2px rgba(0,0,0,0.04); }
.tab-panel { display: none; }
.tab-panel.active { display: block; }
.tab-panel h3 { font-size: 1.125rem; font-weight: 600; color: #172037; margin: 0 0 1rem; }
.install-btn {
  display: inline-block;
  padding: 0.375rem 0.875rem;
  background: #0f172a;
  color: #fff;
  border-radius: 9999px;
  text-decoration: none;
  font-weight: 500;
  font-size: 0.813rem;
  margin-bottom: 1rem;
  transition: background 0.15s;
}
.install-btn:hover { background: #1e293b; }
.code-block {
  position: relative;
  margin: 1rem 0;
}
.code-block pre {
  margin: 0;
  padding: 0.5rem 0.75rem;
  background: #f8fafc;
  color: #475569;
  border-radius: 8px;
  font-family: ui-monospace, monospace;
  font-size: 0.875rem;
  overflow-x: auto;
  border: 1px solid rgba(0,0,0,0.08);
}
.code-block .copy-btn { top: 50%; right: 0.375rem; transform: translateY(-50%); }
.copy-btn {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  width: 2rem;
  height: 2rem;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: #fff;
  color: #172037;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s;
}
.copy-btn:hover { background: #f1f5f9; }
.copy-btn.copied { background: #fff; color: #172037; }
.copy-btn svg { width: 14px; height: 14px; }
ol.steps { margin: 0; padding-left: 1.25rem; }
ol.steps li { margin: 0.5rem 0; color: #475569; }
a { color: #0522a5; text-decoration: none; }
a:hover { text-decoration: underline; }
.hero-gradient-wrap {
  position: relative;
  padding: 1.5rem;
  overflow: hidden;
}
.hero-gradient-wrap canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
}
.hero-inner {
  position: relative;
  z-index: 1;
  background: rgba(253,252,252,0.9);
  -webkit-backdrop-filter: blur(12px);
  backdrop-filter: blur(12px);
  padding: 1.25rem 1.5rem;
  border: 1px solid rgba(0,0,0,0.06);
}
.hero-inner .card-header { padding: 0; }
.hero-inner .card-header.has-icon { padding-top: 0.5rem; }
</style>
</head>
<body>
<div class="layout">
  <div class="rail-left"></div>
  <div class="rail-right"></div>
  <div class="rail-top"></div>
  <div class="rail-bottom"></div>
  <svg class="corner corner-tl" viewBox="0 0 22 21" fill="none"><path d="${LINE_INTERSECTION_PATH}" fill="currentColor"/></svg>
  <svg class="corner corner-tr" viewBox="0 0 22 21" fill="none"><path d="${LINE_INTERSECTION_PATH}" fill="currentColor"/></svg>
  <svg class="corner corner-bl" viewBox="0 0 22 21" fill="none"><path d="${LINE_INTERSECTION_PATH}" fill="currentColor"/></svg>
  <svg class="corner corner-br" viewBox="0 0 22 21" fill="none"><path d="${LINE_INTERSECTION_PATH}" fill="currentColor"/></svg>

  <div class="card hero-card">
    <div class="hero-gradient-wrap" id="hero-gradient-wrap">
      <canvas id="mesh-bg" aria-hidden="true"></canvas>
      <div class="hero-inner">
        <div class="card-header ${iconUrl ? "has-icon" : ""}">
          ${iconUrl ? `<img src="${escapeHtml(iconUrl)}" alt="" class="hero-icon" width="64" height="64" />` : ""}
          <div class="hero-row">
            <h1>${safeName} <span class="version">(v${escapeHtml(version)})</span></h1>
          </div>
          ${safeDescription ? `<p class="hero-description">${safeDescription}</p>` : ""}
          <div class="hero-url-block">
            <div class="url-block">
              <div class="url-box" data-copy="${escapeHtml(url)}">${escapeHtml(url)}</div>
              <button type="button" class="copy-btn" data-copy="${escapeHtml(url)}" aria-label="Copy URL"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg></button>
            </div>
          </div>
          <div class="hero-cta-row">
            <a href="${escapeHtml(manufactInspectorUrl)}" class="hero-primary-btn" target="_blank" rel="noopener noreferrer">Open in Inspector</a>
          </div>
          <div class="hero-powered">
            <span>Powered by</span>
            <a href="https://github.com/mcp-use/mcp-use" target="_blank" rel="noopener noreferrer">
              <svg class="gh-icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
              github.com/mcp-use/mcp-use
              <img src="https://img.shields.io/github/stars/mcp-use/mcp-use" alt="GitHub stars" class="gh-shield" width="90" height="18" loading="lazy" />
            </a>
          </div>
        </div>
      </div>
    </div>
  </div>

  <div class="card">
    <div class="card-header">
      <h2 class="card-title">Installation Guide</h2>
      <p class="card-desc">Choose your preferred MCP client</p>
    </div>
    <div class="card-content">
      <div class="tabs-row" role="tablist">
        <button type="button" class="tab active" role="tab" data-tab="claude-code" aria-selected="true">Claude Code</button>
        <button type="button" class="tab" role="tab" data-tab="cursor" aria-selected="false">Cursor</button>
        <button type="button" class="tab" role="tab" data-tab="vscode" aria-selected="false">VS Code</button>
        <button type="button" class="tab" role="tab" data-tab="vscode-insiders" aria-selected="false">VS Code Insiders</button>
        <button type="button" class="tab" role="tab" data-tab="chatgpt" aria-selected="false">ChatGPT</button>
      </div>

      <div id="panel-claude-code" class="tab-panel active">
        <h3>Install in Claude Code</h3>
        <p>Run this command in your terminal:</p>
        <div class="code-block">
          <pre data-copy="${escapeHtml(claudeCommand)}">${escapeHtml(claudeCommand)}</pre>
          <button type="button" class="copy-btn" aria-label="Copy"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg></button>
        </div>
      </div>

      <div id="panel-cursor" class="tab-panel">
        <h3>Install in Cursor</h3>
        <p>Click the button below to add this MCP server to Cursor:</p>
        <a href="${cursorDeepLink}" class="install-btn">Open in Cursor</a>
        <p>Or add manually: Settings → MCP → Add server</p>
      </div>

      <div id="panel-vscode" class="tab-panel">
        <h3>Install in VS Code</h3>
        <p>Click the button below to add this MCP server to VS Code:</p>
        <a href="${vscodeDeepLink}" class="install-btn">Open in VS Code</a>
        <p>Or add manually: Settings → MCP → Add server</p>
      </div>

      <div id="panel-vscode-insiders" class="tab-panel">
        <h3>Install in VS Code Insiders</h3>
        <p>Click the button below to add this MCP server to VS Code Insiders:</p>
        <a href="${vscodeInsidersDeepLink}" class="install-btn">Open in VS Code Insiders</a>
        <p>Or add manually: Settings → MCP → Add server</p>
      </div>

      <div id="panel-chatgpt" class="tab-panel">
        <h3>Connect with ChatGPT</h3>
        <ol class="steps">
          <li><strong>Enable Developer Mode:</strong> Settings → Connectors → Advanced → Developer mode</li>
          <li><strong>Import this MCP server:</strong> Go to Connectors tab and add: ${escapeHtml(url)}</li>
          <li><strong>Use in conversations:</strong> Choose the MCP server from the Plus menu</li>
        </ol>
      </div>
    </div>
  </div>

  ${
    toolsListHtml || promptsListHtml || resourcesListHtml
      ? `
  <div class="card">
    <div class="card-header">
      <h2 class="card-title">Primitives</h2>
      ${toolsListHtml ? `<div class="spec-section"><h3>Tools (${normalizedTools.length})</h3>${toolsListHtml}</div>` : ""}
      ${promptsListHtml ? `<div class="spec-section"><h3>Prompts (${prompts!.length})</h3>${promptsListHtml}</div>` : ""}
      ${resourcesListHtml ? `<div class="spec-section"><h3>Resources (${resources!.length})</h3>${resourcesListHtml}</div>` : ""}
    </div>
  </div>
  `
      : ""
  }

  <footer class="footer-content">
    <a href="https://manufact.com" target="_blank" rel="noopener noreferrer" class="footer-brand-link" aria-label="Manufact">
      <span class="logo-symbol">
        <svg viewBox="0 0 500 500" xmlns="http://www.w3.org/2000/svg">
          <g class="logo-fill" fill="currentColor" fill-rule="nonzero">
            <path d="${LOGO_SVG_PATHS.path1}"/>
            <circle cx="${LOGO_SVG_PATHS.circle.cx}" cy="${LOGO_SVG_PATHS.circle.cy}" r="${LOGO_SVG_PATHS.circle.r}"/>
            <path d="${LOGO_SVG_PATHS.path2}"/>
          </g>
          <g class="logo-stroke">
            <path d="${LOGO_SVG_PATHS.path1}"/>
            <circle cx="${LOGO_SVG_PATHS.circle.cx}" cy="${LOGO_SVG_PATHS.circle.cy}" r="${LOGO_SVG_PATHS.circle.r}"/>
            <path d="${LOGO_SVG_PATHS.path2}"/>
          </g>
        </svg>
      </span>
      <span>Manufact</span>
    </a>
  </footer>
</div>

<script>${getMeshGradientScript()}</script>
<script>
(function(){
  var tabs = document.querySelectorAll('.tab');
  var panels = document.querySelectorAll('.tab-panel');
  tabs.forEach(function(tab){
    tab.addEventListener('click', function(){
      var target = tab.getAttribute('data-tab');
      tabs.forEach(function(t){ t.classList.remove('active'); t.setAttribute('aria-selected','false'); });
      panels.forEach(function(p){
        var match = p.id === 'panel-' + target;
        p.classList.toggle('active', match);
        p.hidden = !match;
      });
      tab.classList.add('active');
      tab.setAttribute('aria-selected','true');
    });
  });
  var copySvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';
  var checkSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';
  document.querySelectorAll('.copy-btn').forEach(function(btn){
    btn.addEventListener('click', function(){
      var text = btn.getAttribute('data-copy');
      if (!text) {
        var pre = btn.parentElement.querySelector('pre');
        text = pre ? (pre.getAttribute('data-copy') || pre.textContent) : '';
      }
      if (text) navigator.clipboard.writeText(text).then(function(){
        btn.classList.add('copied');
        btn.innerHTML = checkSvg;
        setTimeout(function(){ btn.classList.remove('copied'); btn.innerHTML = copySvg; }, 2000);
      });
    });
  });
  panels.forEach(function(p){ if(!p.classList.contains('active')) p.hidden = true; });
})();
</script>
</body>
</html>`;
}
