import { useCallback, useEffect, useRef, useState } from "react";
import {
  ModelContext,
  useDisplayMode,
  useToolContext,
  type ViewConfig,
} from "mcp-use/react";

import "./view.css";

const RUNTIME_CHANNEL = "mcp-use-generated-world";
const THREE_MODULE_URL = "https://esm.sh/three@0.180.0?bundle";

/** Host display modes supported by the generated-world view. */
export const viewConfig = {
  displayModes: ["inline", "fullscreen"],
} satisfies ViewConfig;

type RuntimeState =
  | { status: "idle" }
  | { status: "loading" }
  | {
      status: "streaming";
      objects: number;
      triangles: number;
      lights: number;
    }
  | {
      status: "ready";
      objects: number;
      triangles: number;
      lights: number;
    }
  | { status: "error"; message: string };

interface RuntimeMessage {
  channel: typeof RUNTIME_CHANNEL;
  nonce: string;
  type: "runtime-ready" | "progress" | "ready" | "error";
  message?: string;
  stats?: {
    objects?: number;
    triangles?: number;
    lights?: number;
  };
}

function isRuntimeMessage(value: unknown): value is RuntimeMessage {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<RuntimeMessage>;
  return (
    candidate.channel === RUNTIME_CHANNEL &&
    typeof candidate.nonce === "string" &&
    (candidate.type === "runtime-ready" ||
      candidate.type === "progress" ||
      candidate.type === "ready" ||
      candidate.type === "error")
  );
}

interface WorldBuildRequest {
  title: string;
  source: string;
  seed: number;
  final: boolean;
}

function serializeForScript(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

function getProvisionalSeed(title: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < title.length; index += 1) {
    hash ^= title.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function buildWorldDocument({ nonce }: { nonce: string }): string {
  const runtimeChannel = serializeForScript(RUNTIME_CHANNEL);
  const runtimeNonce = serializeForScript(nonce);
  const moduleUrl = serializeForScript(THREE_MODULE_URL);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; script-src 'unsafe-inline' blob: https://esm.sh; connect-src https://esm.sh; style-src 'unsafe-inline'; img-src data: blob:; media-src 'none'; font-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
    />
    <title>Generated 3D world</title>
    <style>
      :root { color-scheme: dark; }
      * { box-sizing: border-box; }
      html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: #080a0f; }
      body { font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      #stage, canvas { display: block; width: 100%; height: 100%; }
      canvas { outline: none; touch-action: none; cursor: default; }
      canvas.controls-enabled { cursor: grab; }
      canvas.controls-enabled:active { cursor: grabbing; }
      #status {
        position: fixed;
        inset: 0;
        z-index: 4;
        display: grid;
        place-items: center;
        padding: 28px;
        background:
          radial-gradient(circle at 50% 42%, rgba(111, 80, 189, 0.22), transparent 34%),
          linear-gradient(145deg, #111624, #07080c 68%);
        color: #f4f0ff;
        text-align: center;
        transition: opacity 260ms ease;
      }
      #status.hidden { opacity: 0; pointer-events: none; }
      #status.error { background: linear-gradient(145deg, #2c1015, #090709 72%); }
      .status-card { max-width: 520px; }
      .status-orb {
        width: 44px;
        height: 44px;
        margin: 0 auto 16px;
        border-radius: 50%;
        background: conic-gradient(from 20deg, #ffca75, #b48cff, #5fd8ff, #ffca75);
        box-shadow: 0 0 42px rgba(180, 140, 255, 0.48);
        animation: spin 1.6s linear infinite;
      }
      #status.error .status-orb { background: #ff6b79; animation: none; }
      .status-title { margin: 0; font-size: clamp(20px, 4vw, 32px); font-weight: 650; }
      .status-copy { margin: 10px 0 0; color: rgba(244, 240, 255, 0.7); font-size: 14px; line-height: 1.5; }
      #hud {
        position: fixed;
        left: 12px;
        bottom: 12px;
        z-index: 3;
        max-width: calc(100% - 24px);
        padding: 7px 10px;
        border: 1px solid rgba(255,255,255,0.13);
        border-radius: 8px;
        background: rgba(7, 9, 14, 0.58);
        backdrop-filter: blur(9px);
        color: rgba(255,255,255,0.76);
        font-size: 11px;
        letter-spacing: 0.02em;
        pointer-events: none;
        opacity: 0;
        transition: opacity 240ms ease;
      }
      #hud.visible { opacity: 1; }
      #build-state {
        position: fixed;
        top: 12px;
        left: 12px;
        z-index: 3;
        display: flex;
        align-items: center;
        gap: 8px;
        max-width: calc(100% - 24px);
        padding: 7px 10px;
        border: 1px solid rgba(255,255,255,0.13);
        border-radius: 999px;
        background: rgba(7, 9, 14, 0.68);
        backdrop-filter: blur(9px);
        color: rgba(255,255,255,0.8);
        font-size: 11px;
        pointer-events: none;
        opacity: 0;
        transition: opacity 180ms ease;
      }
      #build-state.visible { opacity: 1; }
      #build-state::before {
        width: 7px;
        height: 7px;
        flex: 0 0 auto;
        border-radius: 50%;
        background: #b890ff;
        box-shadow: 0 0 12px rgba(184, 144, 255, 0.8);
        content: "";
        animation: pulse 1.2s ease-in-out infinite alternate;
      }
      @keyframes spin { to { transform: rotate(360deg); } }
      @keyframes pulse { to { opacity: 0.35; transform: scale(0.7); } }
      @media (max-width: 540px) { #hud { font-size: 10px; } }
      @media (prefers-reduced-motion: reduce) {
        .status-orb, #build-state::before { animation: none; }
      }
    </style>
  </head>
  <body>
    <div id="stage"></div>
    <div id="status" class="hidden">
      <div class="status-card">
        <div class="status-orb"></div>
        <h1 class="status-title">World failed to render</h1>
        <p class="status-copy"></p>
      </div>
    </div>
    <div id="build-state">Waiting for world source</div>
    <div id="hud">WASD move · Q/E rise/fall · drag to look · Shift boost</div>

    <script type="module">
      {
      const CHANNEL = ${runtimeChannel};
      const NONCE = ${runtimeNonce};
      const MAX_OBJECTS = 1500;
      const MAX_ADDITIONS = 2400;
      const MAX_TRIANGLES = 1000000;
      const MAX_VERTICES = 3000000;
      const MAX_LIGHTS = 32;
      const MAX_FRAME_CALLBACKS = 64;

      const stage = document.getElementById("stage");
      const status = document.getElementById("status");
      const statusTitle = status.querySelector(".status-title");
      const statusCopy = status.querySelector(".status-copy");
      const buildState = document.getElementById("build-state");
      const hud = document.getElementById("hud");

      const send = (type, payload = {}) => {
        window.parent.postMessage({ channel: CHANNEL, nonce: NONCE, type, ...payload }, "*");
      };

      const showError = (error, sendToHost = true) => {
        const message = error instanceof Error ? error.message : String(error);
        status.classList.remove("hidden");
        status.classList.add("error");
        statusTitle.textContent = "World failed to render";
        statusCopy.textContent = message;
        if (sendToHost) send("error", { message });
      };

      try {
        const THREE = await import(${moduleUrl});
        const renderer = new THREE.WebGLRenderer({
          antialias: true,
          alpha: false,
          powerPreference: "high-performance",
        });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.25;
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        renderer.domElement.tabIndex = 0;
        renderer.domElement.setAttribute("aria-label", "Generated 3D flying-camera view");
        stage.appendChild(renderer.domElement);

        let activeScene = new THREE.Scene();
        activeScene.background = new THREE.Color(0x111521);

        const camera = new THREE.PerspectiveCamera(65, 4 / 3, 0.05, 1200);
        camera.rotation.order = "YXZ";

        const toVector = (value, fallback) => {
          if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite)) {
            return new THREE.Vector3(...fallback);
          }
          return new THREE.Vector3(value[0], value[1], value[2]);
        };

        const constructionSpawn = new THREE.Vector3(14, 16, 20);
        const constructionLookAt = new THREE.Vector3(0, 2, 0);
        let spawn = constructionSpawn.clone();
        let lookAt = constructionLookAt.clone();
        let moveSpeed = 5;
        let yaw = 0;
        let pitch = 0;
        const applyPose = () => {
          camera.position.copy(spawn);
          const direction = lookAt.clone().sub(spawn).normalize();
          yaw = Math.atan2(-direction.x, -direction.z);
          pitch = Math.asin(THREE.MathUtils.clamp(direction.y, -1, 1));
          camera.rotation.set(pitch, yaw, 0, "YXZ");
        };
        applyPose();

        const disposeScene = (scene) => {
          scene.traverse((object) => {
            object.geometry?.dispose?.();
            const materials = Array.isArray(object.material)
              ? object.material
              : object.material
                ? [object.material]
                : [];
            for (const material of materials) {
              for (const value of Object.values(material)) {
                if (value?.isTexture) value.dispose();
              }
              material.dispose?.();
            }
          });
          if (scene.background?.isTexture) scene.background.dispose();
          if (scene.environment?.isTexture && scene.environment !== scene.background) {
            scene.environment.dispose();
          }
        };

        const inspectScene = (scene) => {
          let objects = 0;
          let triangles = 0;
          let vertices = 0;
          let lights = 0;
          scene.traverse((object) => {
            if (object !== scene) objects += 1;
            if (object.isLight) lights += 1;
            const geometry = object.geometry;
            if (geometry) {
              const position = geometry.getAttribute?.("position");
              const geometryVertices = position?.count ?? 0;
              const geometryTriangles = geometry.index
                ? geometry.index.count / 3
                : geometryVertices / 3;
              const instances = object.isInstancedMesh ? object.count : 1;
              vertices += geometryVertices * instances;
              triangles += geometryTriangles * instances;
            }
          });
          const stats = {
            objects: Math.round(objects),
            triangles: Math.round(triangles),
            vertices: Math.round(vertices),
            lights: Math.round(lights),
          };
          if (stats.objects > MAX_OBJECTS) {
            throw new Error("World has " + stats.objects + " objects; the limit is " + MAX_OBJECTS + ".");
          }
          if (stats.triangles > MAX_TRIANGLES) {
            throw new Error("World has " + stats.triangles.toLocaleString() + " triangles; the limit is " + MAX_TRIANGLES.toLocaleString() + ".");
          }
          if (stats.vertices > MAX_VERTICES) {
            throw new Error("World has " + stats.vertices.toLocaleString() + " vertices; the limit is " + MAX_VERTICES.toLocaleString() + ".");
          }
          if (stats.lights > MAX_LIGHTS) {
            throw new Error("World has " + stats.lights + " lights; the limit is " + MAX_LIGHTS + ".");
          }
          return stats;
        };

        const addRuntimeLighting = (scene) => {
          const sky = new THREE.HemisphereLight(0xdde9ff, 0x3a2d24, 1.1);
          sky.name = "Runtime sky fill";
          scene.add(sky);

          const sun = new THREE.DirectionalLight(0xfff1d6, 1.4);
          sun.name = "Runtime sun fill";
          sun.position.set(10, 16, 12);
          scene.add(sun);
        };

        const resize = () => {
          const width = Math.max(1, stage.clientWidth);
          const height = Math.max(1, stage.clientHeight);
          renderer.setSize(width, height, false);
          camera.aspect = width / height;
          camera.updateProjectionMatrix();
        };
        resize();
        new ResizeObserver(resize).observe(stage);

        const keys = new Set();
        let controlsEnabled = false;
        const controlKeys = new Set([
          "KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE",
          "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
          "ShiftLeft", "ShiftRight",
        ]);
        window.addEventListener("keydown", (event) => {
          if (!controlsEnabled) return;
          if (controlKeys.has(event.code)) event.preventDefault();
          keys.add(event.code);
        });
        window.addEventListener("keyup", (event) => keys.delete(event.code));
        window.addEventListener("blur", () => keys.clear());

        let dragging = false;
        let previousX = 0;
        let previousY = 0;
        const canvas = renderer.domElement;
        canvas.addEventListener("pointerdown", (event) => {
          if (!controlsEnabled) return;
          dragging = true;
          previousX = event.clientX;
          previousY = event.clientY;
          canvas.setPointerCapture(event.pointerId);
          canvas.focus();
        });
        canvas.addEventListener("pointermove", (event) => {
          if (!dragging) return;
          const dx = event.clientX - previousX;
          const dy = event.clientY - previousY;
          previousX = event.clientX;
          previousY = event.clientY;
          yaw -= dx * 0.003;
          pitch = THREE.MathUtils.clamp(pitch - dy * 0.003, -1.52, 1.52);
        });
        const stopDragging = (event) => {
          dragging = false;
          if (canvas.hasPointerCapture(event.pointerId)) {
            canvas.releasePointerCapture(event.pointerId);
          }
        };
        canvas.addEventListener("pointerup", stopDragging);
        canvas.addEventListener("pointercancel", stopDragging);

        const clock = new THREE.Clock();
        const forward = new THREE.Vector3();
        const right = new THREE.Vector3();
        const movement = new THREE.Vector3();
        let frameCallbacks = [];
        let activeBuildFinal = false;
        let animationCallbacksHealthy = true;

        const animate = () => {
          const delta = Math.min(clock.getDelta(), 0.05);
          const elapsed = clock.elapsedTime;

          camera.rotation.set(pitch, yaw, 0, "YXZ");
          movement.set(0, 0, 0);
          forward.set(0, 0, -1).applyQuaternion(camera.quaternion);
          right.set(1, 0, 0).applyQuaternion(camera.quaternion);

          if (keys.has("KeyW") || keys.has("ArrowUp")) movement.add(forward);
          if (keys.has("KeyS") || keys.has("ArrowDown")) movement.sub(forward);
          if (keys.has("KeyD") || keys.has("ArrowRight")) movement.add(right);
          if (keys.has("KeyA") || keys.has("ArrowLeft")) movement.sub(right);
          if (keys.has("KeyE")) movement.y += 1;
          if (keys.has("KeyQ")) movement.y -= 1;

          if (movement.lengthSq() > 0) {
            const boost = keys.has("ShiftLeft") || keys.has("ShiftRight") ? 3 : 1;
            camera.position.addScaledVector(movement.normalize(), moveSpeed * boost * delta);
          }

          if (animationCallbacksHealthy) {
            try {
              for (const callback of frameCallbacks) callback(delta, elapsed);
            } catch (error) {
              animationCallbacksHealthy = false;
              if (activeBuildFinal) {
                showError(error);
              } else {
                buildState.textContent = document.title + " · writing animation";
              }
            }
          }

          activeScene.fog = null;
          renderer.render(activeScene, camera);
          window.requestAnimationFrame(animate);
        };

        status.classList.add("hidden");
        buildState.classList.add("visible");
        animate();
        send("runtime-ready");

        let latestBuildId = 0;
        let queuedBuild = null;
        let buildLoopRunning = false;

        const runBuild = async (request) => {
          const candidateScene = new THREE.Scene();
          candidateScene.background = new THREE.Color(0x111521);
          const candidateCallbacks = [];
          let additions = 0;
          const originalAdd = THREE.Object3D.prototype.add;
          let timeoutId;

          try {
            const moduleSource =
              "export default async function buildWorld({ THREE, scene, random, onFrame }) {\\n" +
              request.source +
              "\\n}";
            const worldModuleUrl = URL.createObjectURL(
              new Blob([moduleSource], { type: "text/javascript" })
            );
            let builder;
            try {
              const worldModule = await import(worldModuleUrl);
              builder = worldModule.default;
            } finally {
              URL.revokeObjectURL(worldModuleUrl);
            }

            let randomState = request.seed || 0x6d2b79f5;
            const random = () => {
              randomState = (randomState + 0x6d2b79f5) >>> 0;
              let value = randomState;
              value = Math.imul(value ^ (value >>> 15), value | 1);
              value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
              return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
            };
            const onFrame = (callback) => {
              if (typeof callback !== "function") {
                throw new TypeError("onFrame expects a function.");
              }
              if (candidateCallbacks.length >= MAX_FRAME_CALLBACKS) {
                throw new Error("World exceeded the " + MAX_FRAME_CALLBACKS + " animation callback budget.");
              }
              candidateCallbacks.push(callback);
            };

            THREE.Object3D.prototype.add = function (...objects) {
              additions += objects.length;
              if (additions > MAX_ADDITIONS) {
                throw new Error("World exceeded the " + MAX_ADDITIONS + " object-addition budget.");
              }
              return originalAdd.apply(this, objects);
            };

            const timeout = new Promise((_, reject) => {
              timeoutId = window.setTimeout(
                () => reject(new Error("World construction exceeded 8 seconds.")),
                8000
              );
            });
            const result = await Promise.race([
              builder(Object.freeze({
                THREE,
                scene: candidateScene,
                random,
                onFrame,
              })),
              timeout,
            ]);
            window.clearTimeout(timeoutId);
            THREE.Object3D.prototype.add = originalAdd;

            if (request.id !== latestBuildId) {
              disposeScene(candidateScene);
              return;
            }
            if (candidateScene.children.length === 0) {
              throw new Error("The generated world did not add anything to the scene.");
            }

            const stats = inspectScene(candidateScene);
            candidateScene.fog = null;
            addRuntimeLighting(candidateScene);
            const previousScene = activeScene;
            activeScene = candidateScene;
            frameCallbacks = candidateCallbacks;
            activeBuildFinal = request.final;
            animationCallbacksHealthy = true;
            spawn = request.final
              ? toVector(result?.spawn, [0, 2.4, 9])
              : constructionSpawn.clone();
            lookAt = request.final
              ? toVector(result?.lookAt, [0, 1.5, 0])
              : constructionLookAt.clone();
            moveSpeed = THREE.MathUtils.clamp(
              Number.isFinite(result?.moveSpeed) ? result.moveSpeed : 5,
              1,
              20
            );
            applyPose();
            renderer.render(activeScene, camera);
            disposeScene(previousScene);

            controlsEnabled = request.final;
            status.classList.remove("error");
            status.classList.add("hidden");
            canvas.classList.toggle("controls-enabled", controlsEnabled);
            hud.classList.toggle("visible", controlsEnabled);
            buildState.classList.toggle("visible", !request.final);
            buildState.textContent = request.title + " · " + stats.objects.toLocaleString() + " objects forming";
            renderer.domElement.setAttribute(
              "aria-label",
              request.title + " 3D flying-camera view"
            );
            document.title = request.title;
            send(request.final ? "ready" : "progress", {
              stats: {
                objects: stats.objects,
                triangles: stats.triangles,
                lights: stats.lights,
              },
            });
          } catch (error) {
            window.clearTimeout(timeoutId);
            THREE.Object3D.prototype.add = originalAdd;
            disposeScene(candidateScene);
            if (request.id !== latestBuildId) return;
            controlsEnabled = false;
            canvas.classList.remove("controls-enabled");
            hud.classList.remove("visible");
            if (request.final) {
              showError(error);
            } else {
              buildState.textContent = request.title + " · writing geometry";
            }
          }
        };

        const drainBuildQueue = async () => {
          if (buildLoopRunning) return;
          buildLoopRunning = true;
          while (queuedBuild !== null) {
            const request = queuedBuild;
            queuedBuild = null;
            await runBuild(request);
          }
          buildLoopRunning = false;
        };

        window.addEventListener("message", (event) => {
          if (event.source !== window.parent) return;
          const message = event.data;
          if (message?.channel !== CHANNEL || message?.nonce !== NONCE) return;
          if (message.type === "reset") {
            if (controlsEnabled) applyPose();
            return;
          }
          if (
            message.type !== "build" ||
            typeof message.source !== "string" ||
            typeof message.title !== "string" ||
            typeof message.seed !== "number" ||
            typeof message.final !== "boolean"
          ) {
            return;
          }
          latestBuildId += 1;
          queuedBuild = { ...message, id: latestBuildId };
          controlsEnabled = false;
          keys.clear();
          canvas.classList.remove("controls-enabled");
          hud.classList.remove("visible");
          buildState.textContent = message.title + " · writing geometry";
          buildState.classList.add("visible");
          void drainBuildQueue();
        });
      } catch (error) {
        showError(error);
      }
      }
    </script>
  </body>
</html>`;
}

function ExpandIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M9.5 2H14v4.5M14 2 9 7M6.5 14H2V9.5M2 14l5-5" />
    </svg>
  );
}

function ResetIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3.2 5.6A5.5 5.5 0 1 1 2.5 9M3.2 5.6V2.7M3.2 5.6h2.9" />
    </svg>
  );
}

/** Renders the sandboxed world runtime and its host-level controls. */
export default function GeneratedWorldView() {
  const tool = useToolContext<"render_world">();
  const { displayMode, requestDisplayMode } = useDisplayMode();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const activeNonceRef = useRef<string | null>(null);
  const runtimeReadyRef = useRef(false);
  const latestBuildRef = useRef<WorldBuildRequest | null>(null);
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [runtime, setRuntime] = useState<RuntimeState>({ status: "idle" });

  const world = tool.status === "ready" ? tool.toolOutput : undefined;

  useEffect(() => {
    const nonce = crypto.randomUUID();
    activeNonceRef.current = nonce;
    setRuntime({ status: "loading" });
    const document = buildWorldDocument({ nonce });
    const url = URL.createObjectURL(
      new Blob([document], { type: "text/html;charset=utf-8" })
    );
    setFrameUrl(url);

    return () => {
      URL.revokeObjectURL(url);
      runtimeReadyRef.current = false;
      activeNonceRef.current = null;
    };
  }, []);

  const pendingTitle = tool.toolInput?.title;
  const pendingSource = tool.toolInput?.source;
  const pendingSourceLength = pendingSource?.length ?? 0;

  useEffect(() => {
    const request: WorldBuildRequest | null =
      tool.status === "ready"
        ? {
            title: tool.toolOutput.title,
            source: tool.toolOutput.source,
            seed: tool.toolOutput.seed,
            final: true,
          }
        : tool.status === "pending" &&
            typeof pendingSource === "string" &&
            pendingSource.length > 0
          ? {
              title: pendingTitle ?? "Generated world",
              source: pendingSource,
              seed:
                typeof tool.toolInput?.seed === "number"
                  ? tool.toolInput.seed
                  : getProvisionalSeed(pendingTitle ?? "Generated world"),
              final: false,
            }
          : null;

    latestBuildRef.current = request;
    const target = iframeRef.current?.contentWindow;
    const nonce = activeNonceRef.current;
    if (
      request === null ||
      !runtimeReadyRef.current ||
      target === undefined ||
      target === null ||
      nonce === null
    ) {
      return;
    }
    target.postMessage(
      { channel: RUNTIME_CHANNEL, nonce, type: "build", ...request },
      "*"
    );
  }, [
    pendingSource,
    pendingTitle,
    tool.status,
    tool.toolInput?.seed,
    world?.seed,
    world?.source,
    world?.title,
  ]);

  useEffect(() => {
    const receiveRuntimeMessage = (event: MessageEvent<unknown>) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      if (!isRuntimeMessage(event.data)) return;
      if (event.data.nonce !== activeNonceRef.current) return;

      if (event.data.type === "runtime-ready") {
        runtimeReadyRef.current = true;
        const request = latestBuildRef.current;
        const nonce = activeNonceRef.current;
        if (request !== null && nonce !== null) {
          iframeRef.current?.contentWindow?.postMessage(
            { channel: RUNTIME_CHANNEL, nonce, type: "build", ...request },
            "*"
          );
        }
        return;
      }

      if (event.data.type === "error") {
        setRuntime({
          status: "error",
          message:
            event.data.message ?? "The generated world failed to render.",
        });
        return;
      }

      setRuntime({
        status: event.data.type === "progress" ? "streaming" : "ready",
        objects: Math.max(0, Math.round(event.data.stats?.objects ?? 0)),
        triangles: Math.max(0, Math.round(event.data.stats?.triangles ?? 0)),
        lights: Math.max(0, Math.round(event.data.stats?.lights ?? 0)),
      });
    };

    window.addEventListener("message", receiveRuntimeMessage);
    return () => window.removeEventListener("message", receiveRuntimeMessage);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    try {
      await requestDisplayMode({
        mode: displayMode === "fullscreen" ? "inline" : "fullscreen",
      });
    } catch {
      // The host may decline fullscreen. displayMode remains the source of truth.
    }
  }, [displayMode, requestDisplayMode]);

  const resetCamera = useCallback(() => {
    const target = iframeRef.current?.contentWindow;
    const nonce = activeNonceRef.current;
    if (target === undefined || target === null || nonce === null) return;
    target.postMessage({ channel: RUNTIME_CHANNEL, nonce, type: "reset" }, "*");
  }, []);

  const shellClass = `world-shell${displayMode === "fullscreen" ? " fullscreen" : ""}`;
  const modelContext =
    tool.status === "ready"
      ? runtime.status === "error"
        ? `Generated 3D world "${tool.toolOutput.title}" failed in the viewer: ${runtime.message} Revise the source and call render_world again.`
        : runtime.status === "ready"
          ? `Generated 3D world "${tool.toolOutput.title}" is displayed (id: ${tool.toolOutput.worldId}). The user can fly with WASD, move vertically with Q/E, drag to look, and hold Shift to boost.`
          : `Generated 3D world "${tool.toolOutput.title}" is being constructed in the viewer.`
      : tool.status === "error"
        ? `Generated 3D world failed: ${tool.error.message}`
        : "A generated 3D world is being written.";

  return (
    <main className={shellClass}>
      <ModelContext content={modelContext} />

      {frameUrl !== null && (
        <iframe
          ref={iframeRef}
          className="world-frame"
          src={frameUrl}
          sandbox="allow-scripts"
          title={world?.title ?? pendingTitle ?? "Generated 3D world"}
        />
      )}

      {tool.status === "pending" && (
        <section className="generation-status" aria-busy="true">
          <span className="generation-pulse" aria-hidden="true" />
          <div>
            <strong>{pendingTitle ?? "Imagining a new world…"}</strong>
            <span>
              {pendingSourceLength > 0
                ? `${pendingSourceLength.toLocaleString()} characters written`
                : "Waiting for the world source…"}
            </span>
          </div>
        </section>
      )}

      {tool.status === "error" && (
        <section className="outer-status error" role="alert">
          <p className="eyebrow">World rejected</p>
          <h1>Couldn’t build this environment</h1>
          <p>{tool.error.message}</p>
        </section>
      )}

      {runtime.status === "error" && tool.status === "ready" && (
        <div className="runtime-error" role="alert">
          <strong>Runtime error</strong>
          <span>{runtime.message}</span>
        </div>
      )}

      {tool.status === "ready" && (
        <div className="world-toolbar">
          {runtime.status === "ready" && (
            <span className="world-stats">
              {runtime.objects.toLocaleString()} objects ·{" "}
              {runtime.triangles.toLocaleString()} triangles
            </span>
          )}
          <button type="button" onClick={resetCamera} title="Reset camera">
            <ResetIcon />
            <span>Reset</span>
          </button>
          <button
            type="button"
            onClick={() => void toggleFullscreen()}
            title={
              displayMode === "fullscreen"
                ? "Exit fullscreen"
                : "Enter fullscreen"
            }
          >
            <ExpandIcon />
            <span>{displayMode === "fullscreen" ? "Exit" : "Explore"}</span>
          </button>
        </div>
      )}
    </main>
  );
}
