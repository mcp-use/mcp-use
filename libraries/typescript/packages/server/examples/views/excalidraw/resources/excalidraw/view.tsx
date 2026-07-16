import {
  Excalidraw,
  exportToSvg,
  convertToExcalidrawElements,
  restore,
  CaptureUpdateAction,
  FONT_FAMILY,
  serializeAsJSON,
  MainMenu,
} from "@excalidraw/excalidraw";
import * as morphdomNs from "morphdom";

const morphdom = ((morphdomNs as unknown as { default?: typeof morphdomNs })
  .default ?? morphdomNs) as unknown as (
  fromNode: Element,
  toNode: Node | string,
  options?: { childrenOnly?: boolean }
) => Element;
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ModelContext,
  ToolError,
  useCallTool,
  useDisplayMode,
  useHostContext,
  useOpenExternal,
  useToolContext,
  type ViewConfig,
} from "mcp-use/react";
import { initPencilAudio, playStroke } from "./pencil-audio.js";
import {
  captureInitialElements,
  onEditorChange,
  setStorageKey,
  loadPersistedElements,
  getLatestEditedElements,
  setCheckpointId,
  setSaveCheckpoint,
} from "./edit-context.js";
import "./view.css";

/**
 * Fixed aspect-ratio SVG preview collapses under ext-apps auto-resize
 * (`height: max-content`); report size manually instead. Only inline and
 * fullscreen are supported — PiP is not a useful mode for the canvas editor.
 */
export const viewConfig = {
  autoResize: false,
  displayModes: ["inline", "fullscreen"],
} satisfies ViewConfig;

// ============================================================
// Debug logging (routes through SDK → host log file)
// ============================================================

function fsLog(msg: string) {
  // Dev-only breadcrumb; hosts may surface console output.
  if (import.meta.env.DEV) console.debug(`[Excalidraw] ${msg}`);
}

// ============================================================
// Shared helpers
// ============================================================

function parsePartialElements(str: string | undefined): any[] {
  if (!str?.trim().startsWith("[")) return [];
  try {
    return JSON.parse(str);
  } catch {
    /* partial */
  }
  const last = str.lastIndexOf("}");
  if (last < 0) return [];
  try {
    return JSON.parse(str.substring(0, last + 1) + "]");
  } catch {
    /* incomplete */
  }
  return [];
}

function excludeIncompleteLastItem<T>(arr: T[]): T[] {
  if (!arr || arr.length === 0) return [];
  if (arr.length <= 1) return [];
  return arr.slice(0, -1);
}

interface ViewportRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Convert raw shorthand elements → Excalidraw format (labels → bound text, font fix).
 *  Preserves pseudo-elements like cameraUpdate (not valid Excalidraw types). */
function convertRawElements(els: any[]): any[] {
  const pseudoTypes = new Set(["cameraUpdate", "delete", "restoreCheckpoint"]);
  const pseudos = els.filter((el: any) => pseudoTypes.has(el.type));
  const real = els.filter((el: any) => !pseudoTypes.has(el.type));
  const withDefaults = real.map((el: any) =>
    el.label
      ? {
          ...el,
          label: { textAlign: "center", verticalAlign: "middle", ...el.label },
        }
      : el
  );
  const converted = convertToExcalidrawElements(withDefaults, {
    regenerateIds: false,
  }).map((el: any) =>
    el.type === "text"
      ? { ...el, fontFamily: (FONT_FAMILY as any).Excalifont ?? 1 }
      : el
  );
  return [...converted, ...pseudos];
}

/** Fix SVG viewBox to 4:3 by expanding the smaller dimension and centering. */
function fixViewBox4x3(svg: SVGSVGElement): void {
  const vb = svg.getAttribute("viewBox")?.split(" ").map(Number);
  if (!vb || vb.length !== 4) return;
  const vx = vb[0]!;
  const vy = vb[1]!;
  const vw = vb[2]!;
  const vh = vb[3]!;
  const r = vw / vh;
  if (Math.abs(r - 4 / 3) < 0.01) return;
  if (r > 4 / 3) {
    const h2 = Math.round((vw * 3) / 4);
    svg.setAttribute(
      "viewBox",
      `${vx} ${vy - Math.round((h2 - vh) / 2)} ${vw} ${h2}`
    );
  } else {
    const w2 = Math.round((vh * 4) / 3);
    svg.setAttribute(
      "viewBox",
      `${vx - Math.round((w2 - vw) / 2)} ${vy} ${w2} ${vh}`
    );
  }
}

function extractViewportAndElements(elements: any[]): {
  viewport: ViewportRect | null;
  drawElements: any[];
  restoreId: string | null;
  deleteIds: Set<string>;
} {
  let viewport: ViewportRect | null = null;
  let restoreId: string | null = null;
  const deleteIds = new Set<string>();
  const drawElements: any[] = [];

  for (const el of elements) {
    if (el.type === "cameraUpdate") {
      viewport = { x: el.x, y: el.y, width: el.width, height: el.height };
    } else if (el.type === "restoreCheckpoint") {
      restoreId = el.id;
    } else if (el.type === "delete") {
      for (const id of String(el.ids ?? el.id).split(","))
        deleteIds.add(id.trim());
    } else {
      drawElements.push(el);
    }
  }

  // Hide deleted elements via near-zero opacity instead of removing — preserves SVG
  // group count/order so morphdom matches by position correctly (no cascade re-animations).
  // Using 1 (not 0) because Excalidraw treats opacity:0 as "unset" → defaults to 100.
  const processedDraw =
    deleteIds.size > 0
      ? drawElements.map((el: any) =>
          deleteIds.has(el.id) || deleteIds.has(el.containerId)
            ? { ...el, opacity: 1 }
            : el
        )
      : drawElements;

  return { viewport, drawElements: processedDraw, restoreId, deleteIds };
}

const ExpandIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 14 14"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M8.5 1.5H12.5V5.5" />
    <path d="M5.5 12.5H1.5V8.5" />
    <path d="M12.5 1.5L8 6" />
    <path d="M1.5 12.5L6 8" />
  </svg>
);

const ExternalLinkIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.25"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 8.667V12.667C12 13.035 11.702 13.333 11.333 13.333H3.333C2.965 13.333 2.667 13.035 2.667 12.667V4.667C2.667 4.298 2.965 4 3.333 4H7.333" />
    <path d="M10 2.667H13.333V6" />
    <path d="M6.667 9.333L13.333 2.667" />
  </svg>
);

async function shareToExcalidraw(
  data: { elements: any[]; appState: any; files: any },
  exportTool: (args: {
    json: string;
  }) => Promise<{ content?: any[] | undefined }>,
  openExternal: (args: { url: string }) => Promise<void>
) {
  try {
    if (!data.elements?.length) return;

    const json = serializeAsJSON(
      data.elements,
      data.appState,
      data.files,
      "database"
    );
    const result = await exportTool({ json });

    const url = (result.content?.[0] as { text?: string } | undefined)?.text;
    if (url) await openExternal({ url });
  } catch (err) {
    if (err instanceof ToolError) {
      fsLog(`export failed: ${JSON.stringify(err.result.content)}`);
      return;
    }
    fsLog(`shareToExcalidraw error: ${err}`);
  }
}

function ShareButton({
  onConfirm,
  compact,
}: {
  onConfirm: () => Promise<void>;
  compact?: boolean;
}) {
  const [state, setState] = useState<"idle" | "confirm" | "uploading">("idle");

  const handleConfirm = async () => {
    setState("uploading");
    try {
      await onConfirm();
    } finally {
      setState("idle");
    }
  };

  return (
    <>
      <button
        className=" app-button"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 5,
          width: "auto",
          padding: "0 10px",
          marginRight: compact ? 0 : -8,
        }}
        title="Export to Excalidraw"
        disabled={state === "uploading"}
        onClick={() => setState("confirm")}
      >
        <ExternalLinkIcon />
        {!compact && (
          <span style={{ fontSize: "0.75rem", fontWeight: 400 }}>
            {state === "uploading" ? "Exporting…" : "Open in Excalidraw"}
          </span>
        )}
      </button>

      {state === "confirm" && (
        <div
          className="excalidraw export-modal-overlay"
          onClick={() => setState("idle")}
        >
          <div
            className="Island export-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="export-modal-title">Export to Excalidraw</h3>
            <p className="export-modal-text">
              This will upload your diagram to excalidraw.com and open it in a
              new tab.
            </p>
            <div className="export-modal-actions">
              <button className="standalone" onClick={() => setState("idle")}>
                Cancel
              </button>
              <button
                className="standalone export-modal-confirm"
                onClick={handleConfirm}
              >
                Open in Excalidraw
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ============================================================
// Diagram component (Excalidraw SVG)
// ============================================================

const LERP_SPEED = 0.03; // 0–1, higher = faster snap
const EXPORT_PADDING = 20;

/**
 * Compute the min x/y of all draw elements in scene coordinates.
 * This matches the offset Excalidraw's exportToSvg applies internally:
 *   SVG_x = scene_x - sceneMinX + exportPadding
 */
function computeSceneBounds(elements: any[]): { minX: number; minY: number } {
  let minX = Infinity;
  let minY = Infinity;
  for (const el of elements) {
    if (el.x != null) {
      minX = Math.min(minX, el.x);
      minY = Math.min(minY, el.y);
      // Arrow points are offsets from el.x/y
      if (el.points && Array.isArray(el.points)) {
        for (const pt of el.points) {
          minX = Math.min(minX, el.x + pt[0]);
          minY = Math.min(minY, el.y + pt[1]);
        }
      }
    }
  }
  return { minX: isFinite(minX) ? minX : 0, minY: isFinite(minY) ? minY : 0 };
}

/**
 * Convert a scene-space viewport rect to an SVG-space viewBox.
 */
function sceneToSvgViewBox(
  vp: ViewportRect,
  sceneMinX: number,
  sceneMinY: number
): { x: number; y: number; w: number; h: number } {
  return {
    x: vp.x - sceneMinX + EXPORT_PADDING,
    y: vp.y - sceneMinY + EXPORT_PADDING,
    w: vp.width,
    h: vp.height,
  };
}

function DiagramView({
  toolInput,
  isFinal,
  displayMode,
  onElements,
  editedElements,
  onViewport,
  loadCheckpoint,
}: {
  toolInput: any;
  isFinal: boolean;
  displayMode: string;
  onElements?: ((els: any[]) => void) | undefined;
  editedElements?: any[] | undefined;
  onViewport?: ((vp: ViewportRect) => void) | undefined;
  loadCheckpoint?:
    | ((id: string) => Promise<{ elements: any[] } | null>)
    | undefined;
}) {
  const svgRef = useRef<HTMLDivElement | null>(null);
  const latestRef = useRef<any[]>([]);
  const restoredRef = useRef<{ id: string; elements: any[] } | null>(null);
  const [, setCount] = useState(0);

  // Init pencil audio on first mount
  useEffect(() => {
    initPencilAudio();
  }, []);

  // Set container height: 4:3 in inline, full viewport in fullscreen
  useEffect(() => {
    if (!svgRef.current) return;
    if (displayMode === "fullscreen") {
      svgRef.current.style.height = "100%";
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const w = entry.contentRect.width;
      if (w > 0 && svgRef.current) {
        svgRef.current.style.height = `${Math.round((w * 3) / 4)}px`;
      }
    });
    observer.observe(svgRef.current);
    return () => observer.disconnect();
  }, [displayMode]);

  // Font preloading — ensure Virgil is loaded before first export
  const fontsReady = useRef<Promise<void> | null>(null);
  const ensureFontsLoaded = useCallback(() => {
    if (!fontsReady.current) {
      fontsReady.current = document.fonts
        .load("20px Excalifont")
        .then(() => {});
    }
    return fontsReady.current;
  }, []);

  // Animated viewport in SCENE coordinates (stable across re-exports)
  const animatedVP = useRef<ViewportRect | null>(null);
  const targetVP = useRef<ViewportRect | null>(null);
  const sceneBoundsRef = useRef<{ minX: number; minY: number }>({
    minX: 0,
    minY: 0,
  });
  const animFrameRef = useRef<number>(0);

  // User-controlled zoom during streaming (scale + pan offset in viewBox units)
  const zoomRef = useRef({ scale: 1, panX: 0, panY: 0 });
  const baseViewBoxRef = useRef<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);

  /** Apply user zoom on top of the stored base viewBox. */
  const applyZoom = useCallback(() => {
    if (!svgRef.current || !baseViewBoxRef.current) return;
    const svg = svgRef.current.querySelector("svg");
    if (!svg) return;
    const { x, y, w, h } = baseViewBoxRef.current;
    const { scale, panX, panY } = zoomRef.current;
    const zw = w / scale;
    const zh = h / scale;
    svg.setAttribute(
      "viewBox",
      `${x + (w - zw) / 2 + panX} ${y + (h - zh) / 2 + panY} ${zw} ${zh}`
    );
  }, []);

  /** Apply current animated scene-space viewport to the SVG, then user zoom. */
  const applyViewBox = useCallback(() => {
    if (!animatedVP.current || !svgRef.current) return;
    const svg = svgRef.current.querySelector("svg");
    if (!svg) return;
    const { minX, minY } = sceneBoundsRef.current;
    const { x, y, width: w, height: h } = animatedVP.current;
    const ratio = w / h;
    const vp4x3: ViewportRect =
      Math.abs(ratio - 4 / 3) < 0.01
        ? animatedVP.current
        : ratio > 4 / 3
          ? { x, y, width: w, height: Math.round((w * 3) / 4) }
          : { x, y, width: Math.round((h * 4) / 3), height: h };
    const vb = sceneToSvgViewBox(vp4x3, minX, minY);
    baseViewBoxRef.current = { x: vb.x, y: vb.y, w: vb.w, h: vb.h };
    applyZoom();
  }, [applyZoom]);

  /** Lerp scene-space viewport toward target each frame. */
  const animateViewBox = useCallback(() => {
    if (!animatedVP.current || !targetVP.current) return;
    const a = animatedVP.current;
    const t = targetVP.current;
    a.x += (t.x - a.x) * LERP_SPEED;
    a.y += (t.y - a.y) * LERP_SPEED;
    a.width += (t.width - a.width) * LERP_SPEED;
    a.height += (t.height - a.height) * LERP_SPEED;
    applyViewBox();
    const delta =
      Math.abs(t.x - a.x) +
      Math.abs(t.y - a.y) +
      Math.abs(t.width - a.width) +
      Math.abs(t.height - a.height);
    if (delta > 0.5) {
      animFrameRef.current = requestAnimationFrame(animateViewBox);
    }
  }, [applyViewBox]);

  // Cleanup animation on unmount
  useEffect(() => {
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, []);

  const renderSvgPreview = useCallback(
    async (els: any[], viewport: ViewportRect | null, baseElements?: any[]) => {
      if ((els.length === 0 && !baseElements?.length) || !svgRef.current)
        return;
      try {
        // Wait for Virgil font to load before computing text metrics
        await ensureFontsLoaded();

        // Convert new elements (raw → Excalidraw format)
        const convertedNew = convertRawElements(els);
        const baseReal =
          baseElements?.filter((el: any) => el.type !== "cameraUpdate") ?? [];
        const excalidrawEls = [...baseReal, ...convertedNew];

        // Update scene bounds from all elements
        sceneBoundsRef.current = computeSceneBounds(excalidrawEls);

        const svg = await exportToSvg({
          elements: excalidrawEls as any,
          appState: {
            viewBackgroundColor: "transparent",
            exportBackground: false,
          } as any,
          files: null,
          exportPadding: EXPORT_PADDING,
          skipInliningFonts: true,
        });
        if (!svgRef.current) return;

        let wrapper = svgRef.current.querySelector(
          ".svg-wrapper"
        ) as HTMLDivElement | null;
        if (!wrapper) {
          wrapper = document.createElement("div");
          wrapper.className = "svg-wrapper";
          svgRef.current.appendChild(wrapper);
        }

        // Fill the container (height set by ResizeObserver to maintain 4:3)
        svg.style.width = "100%";
        svg.style.height = "100%";
        svg.removeAttribute("width");
        svg.removeAttribute("height");

        const existing = wrapper.querySelector("svg");
        if (existing) {
          morphdom(existing, svg, { childrenOnly: false });
        } else {
          wrapper.appendChild(svg);
        }

        // Always fix SVG viewBox to 4:3, then store as base for user zoom
        const renderedSvg = wrapper.querySelector("svg");
        if (renderedSvg) {
          fixViewBox4x3(renderedSvg as SVGSVGElement);
          const vbAttr = (renderedSvg as SVGSVGElement)
            .getAttribute("viewBox")
            ?.split(" ")
            .map(Number);
          if (vbAttr && vbAttr.length === 4) {
            baseViewBoxRef.current = {
              x: vbAttr[0]!,
              y: vbAttr[1]!,
              w: vbAttr[2]!,
              h: vbAttr[3]!,
            };
          }
        }

        // Animate viewport in scene space, convert to SVG space at apply time
        if (viewport) {
          targetVP.current = { ...viewport };
          onViewport?.(viewport);
          if (!animatedVP.current) {
            // First viewport — snap immediately
            animatedVP.current = { ...viewport };
          }
          // Re-apply immediately after morphdom to prevent flicker
          applyViewBox();
          // Start/restart animation toward new target
          if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
          animFrameRef.current = requestAnimationFrame(animateViewBox);
        } else {
          // No explicit viewport — use default
          const defaultVP: ViewportRect = {
            x: 0,
            y: 0,
            width: 1024,
            height: 768,
          };
          onViewport?.(defaultVP);
          targetVP.current = defaultVP;
          if (!animatedVP.current) {
            animatedVP.current = { ...defaultVP };
          }
          applyViewBox();
          if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
          animFrameRef.current = requestAnimationFrame(animateViewBox);
          targetVP.current = null;
          if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
          // Apply user zoom on top of the fixed viewBox
          applyZoom();
        }
      } catch {
        // export can fail on partial/malformed elements
      }
    },
    [applyViewBox, animateViewBox, applyZoom]
  );

  useEffect(() => {
    if (!toolInput) return;
    const raw = toolInput.elements;
    if (!raw) return;

    // Parse elements from string or array
    const str = typeof raw === "string" ? raw : JSON.stringify(raw);

    if (isFinal) {
      // Final input — parse complete JSON, render ALL elements
      const parsed = parsePartialElements(str);
      let { viewport, drawElements, restoreId, deleteIds } =
        extractViewportAndElements(parsed);

      // Load checkpoint base if restoring (async — from server)
      let base: any[] | undefined;
      const doFinal = async () => {
        if (restoreId && loadCheckpoint) {
          const saved = await loadCheckpoint(restoreId);
          if (saved) {
            base = saved.elements;
            // Extract camera from base as fallback
            if (!viewport) {
              const cam = base.find((el: any) => el.type === "cameraUpdate");
              if (cam)
                viewport = {
                  x: cam.x,
                  y: cam.y,
                  width: cam.width,
                  height: cam.height,
                };
            }
            // Convert base with convertRawElements (handles both raw and already-converted)
            base = convertRawElements(base);
          }
          if (base && deleteIds.size > 0) {
            base = base.filter(
              (el: any) =>
                !deleteIds.has(el.id) && !deleteIds.has(el.containerId)
            );
          }
        }

        latestRef.current = drawElements;
        // Convert new elements for fullscreen editor
        const convertedNew = convertRawElements(drawElements);

        // Merge base (converted) + new converted
        const allConverted = base ? [...base, ...convertedNew] : convertedNew;
        captureInitialElements(allConverted);
        // Only set elements if user hasn't edited yet (editedElements means user edits exist)
        if (!editedElements) onElements?.(allConverted);
        if (!editedElements) renderSvgPreview(drawElements, viewport, base);
      };
      doFinal();
      return;
    }

    // Partial input — drop last (potentially incomplete) element
    const parsed = parsePartialElements(str);

    // Extract restoreCheckpoint and delete before dropping last (they're small, won't be incomplete)
    let streamRestoreId: string | null = null;
    const streamDeleteIds = new Set<string>();
    for (const el of parsed) {
      if (el.type === "restoreCheckpoint") streamRestoreId = el.id;
      else if (el.type === "delete") {
        for (const id of String(el.ids ?? el.id).split(","))
          streamDeleteIds.add(id.trim());
      }
    }

    const safe = excludeIncompleteLastItem(parsed);
    let { viewport, drawElements } = extractViewportAndElements(safe);

    const doStream = async () => {
      // Load checkpoint base (once per restoreId) — from server via callServerTool
      let base: any[] | undefined;
      if (streamRestoreId) {
        if (
          !restoredRef.current ||
          restoredRef.current.id !== streamRestoreId
        ) {
          if (loadCheckpoint) {
            const saved = await loadCheckpoint(streamRestoreId);
            if (saved) {
              const converted = convertRawElements(saved.elements);
              restoredRef.current = {
                id: streamRestoreId,
                elements: converted,
              };
            }
          }
        }
        base = restoredRef.current?.elements;
        // Extract camera from base as fallback
        if (!viewport && base) {
          const cam = base.find((el: any) => el.type === "cameraUpdate");
          if (cam)
            viewport = {
              x: cam.x,
              y: cam.y,
              width: cam.width,
              height: cam.height,
            };
        }
        if (base && streamDeleteIds.size > 0) {
          base = base.filter(
            (el: any) =>
              !streamDeleteIds.has(el.id) &&
              !streamDeleteIds.has(el.containerId)
          );
        }
      }

      if (
        drawElements.length > 0 &&
        drawElements.length !== latestRef.current.length
      ) {
        // Play pencil sound for each new element
        const prevCount = latestRef.current.length;
        for (let i = prevCount; i < drawElements.length; i++) {
          playStroke(drawElements[i].type ?? "rectangle");
        }
        latestRef.current = drawElements;
        setCount(drawElements.length);
        const jittered = drawElements.map((el: any) => ({
          ...el,
          seed: Math.floor(Math.random() * 1e9),
        }));
        renderSvgPreview(jittered, viewport, base);
      } else if (base && base.length > 0 && latestRef.current.length === 0) {
        // First render: show restored base before new elements stream in
        renderSvgPreview([], viewport, base);
      }
    };
    doStream();
  }, [toolInput, isFinal, renderSvgPreview]);

  // Render already-converted elements directly (skip convertToExcalidrawElements)
  useEffect(() => {
    if (!editedElements || editedElements.length === 0 || !svgRef.current)
      return;
    (async () => {
      try {
        await ensureFontsLoaded();
        const svg = await exportToSvg({
          elements: editedElements as any,
          appState: {
            viewBackgroundColor: "transparent",
            exportBackground: false,
          } as any,
          files: null,
          exportPadding: EXPORT_PADDING,
          skipInliningFonts: true,
        });
        if (!svgRef.current) return;
        let wrapper = svgRef.current.querySelector(
          ".svg-wrapper"
        ) as HTMLDivElement | null;
        if (!wrapper) {
          wrapper = document.createElement("div");
          wrapper.className = "svg-wrapper";
          svgRef.current.appendChild(wrapper);
        }
        svg.style.width = "100%";
        svg.style.height = "100%";
        svg.removeAttribute("width");
        svg.removeAttribute("height");
        const existing = wrapper.querySelector("svg");
        if (existing) {
          morphdom(existing, svg, { childrenOnly: false });
        } else {
          wrapper.appendChild(svg);
        }
        const final = wrapper.querySelector("svg");
        if (final) {
          fixViewBox4x3(final as SVGSVGElement);
          const vbAttr = (final as SVGSVGElement)
            .getAttribute("viewBox")
            ?.split(" ")
            .map(Number);
          if (vbAttr && vbAttr.length === 4) {
            baseViewBoxRef.current = {
              x: vbAttr[0]!,
              y: vbAttr[1]!,
              w: vbAttr[2]!,
              h: vbAttr[3]!,
            };
            applyZoom();
          }
        }
      } catch {}
    })();
  }, [editedElements, applyZoom]);

  // Zoom: pinch-to-zoom / Ctrl+scroll, pan when zoomed, double-click to reset
  useEffect(() => {
    const container = svgRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      const isZoomGesture = e.ctrlKey || e.metaKey;
      const isZoomedIn = Math.abs(zoomRef.current.scale - 1) > 0.01;

      if (!isZoomGesture && !isZoomedIn) return;
      e.preventDefault();

      const zoom = zoomRef.current;
      if (isZoomGesture) {
        const factor = e.deltaY > 0 ? 0.97 : 1.03;
        const newScale = Math.max(0.25, Math.min(8, zoom.scale * factor));
        if (baseViewBoxRef.current) {
          const rect = container.getBoundingClientRect();
          const mx = (e.clientX - rect.left) / rect.width;
          const my = (e.clientY - rect.top) / rect.height;
          const { w, h } = baseViewBoxRef.current;
          zoom.panX += w * (1 / newScale - 1 / zoom.scale) * (0.5 - mx);
          zoom.panY += h * (1 / newScale - 1 / zoom.scale) * (0.5 - my);
        }
        zoom.scale = newScale;
      } else if (baseViewBoxRef.current) {
        const { w, h } = baseViewBoxRef.current;
        zoom.panX += (e.deltaX / container.clientWidth) * (w / zoom.scale);
        zoom.panY += (e.deltaY / container.clientHeight) * (h / zoom.scale);
      }
      applyZoom();
    };

    const handleDblClick = () => {
      zoomRef.current = { scale: 1, panX: 0, panY: 0 };
      applyZoom();
    };

    container.addEventListener("wheel", handleWheel, { passive: false });
    container.addEventListener("dblclick", handleDblClick);
    return () => {
      container.removeEventListener("wheel", handleWheel);
      container.removeEventListener("dblclick", handleDblClick);
    };
  }, [applyZoom]);

  return (
    <div
      ref={svgRef}
      className="excalidraw-container"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    />
  );
}

// ============================================================
// Main app — Excalidraw only
// ============================================================

const excalidrawLogo = (
  <svg focusable="false" role="img" viewBox="0 0 40 40" fill="none">
    <g fill="currentColor">
      <path
        d="M39.9 32.889a.326.326 0 0 0-.279-.056c-2.094-3.083-4.774-6-7.343-8.833l-.419-.472a.212.212 0 0 0-.056-.139.586.586 0 0 0-.167-.111l-.084-.083-.056-.056c-.084-.167-.28-.278-.475-.167-.782.39-1.507.973-2.206 1.528-.92.722-1.842 1.445-2.708 2.25a8.405 8.405 0 0 0-.977 1.028c-.14.194-.028.361.14.444-.615.611-1.23 1.223-1.843 1.861a.315.315 0 0 0-.084.223c0 .083.056.166.111.194l1.09.833v.028c1.535 1.528 4.244 3.611 7.12 5.861.418.334.865.667 1.284 1 .195.223.39.473.558.695.084.11.28.139.391.055.056.056.14.111.196.167a.398.398 0 0 0 .167.056.255.255 0 0 0 .224-.111.394.394 0 0 0 .055-.167c.029 0 .028.028.056.028a.318.318 0 0 0 .224-.084l5.082-5.528a.309.309 0 0 0 0-.444Zm-14.63-1.917a.485.485 0 0 0 .111.14c.586.5 1.2 1 1.843 1.555l-2.569-1.945-.251-.166c-.056-.028-.112-.084-.168-.111l-.195-.167.056-.056.055-.055.112-.111c.866-.861 2.346-2.306 3.1-3.028-.81.805-2.43 3.167-2.095 3.944Zm8.767 6.89-2.122-1.612a44.713 44.713 0 0 0-2.625-2.5c1.145.861 2.122 1.611 2.262 1.75 1.117.972 1.06.806 1.815 1.445l.921.666a1.06 1.06 0 0 1-.251.25Zm.558.416-.056-.028c.084-.055.168-.111.252-.194l-.196.222ZM1.089 5.75c.055.361.14.722.195 1.056.335 1.833.67 3.5 1.284 4.75l.252.944c.084.361.223.806.363.917 1.424 1.25 3.602 3.11 5.947 4.889a.295.295 0 0 0 .363 0s0 .027.028.027a.254.254 0 0 0 .196.084.318.318 0 0 0 .223-.084c2.988-3.305 5.221-6.027 6.813-8.305.112-.111.14-.278.14-.417.111-.111.195-.25.307-.333.111-.111.111-.306 0-.39l-.028-.027c0-.055-.028-.139-.084-.167-.698-.666-1.2-1.138-1.731-1.638-.922-.862-1.871-1.75-3.881-3.75l-.028-.028c-.028-.028-.056-.056-.112-.056-.558-.194-1.703-.389-3.127-.639C6.087 2.223 3.21 1.723.614.944c0 0-.168 0-.196.028l-.083.084c-.028.027-.056.055-.224.11h.056-.056c.028.167.028.278.084.473 0 .055.112.5.112.555l.782 3.556Zm15.496 3.278-.335-.334c.084.112.196.195.335.334Zm-3.546 4.666-.056.056c0-.028.028-.056.056-.056Zm-2.038-10c.168.167.866.834 1.033.973-.726-.334-2.54-1.167-3.379-1.445.838.167 1.983.334 2.346.472ZM1.424 2.306c.419.722.754 3.222 1.089 5.666-.196-.778-.335-1.555-.503-2.278-.251-1.277-.503-2.416-.838-3.416.056 0 .14 0 .252.028Zm-.168-.584c-.112 0-.223-.028-.307-.028 0-.027 0-.055-.028-.055.14 0 .223.028.335.083Zm-1.089.222c0-.027 0-.027 0 0ZM39.453 1.333c.028-.11-.558-.61-.363-.639.42-.027.42-.666 0-.666-.558.028-1.144.166-1.675.25-.977.194-1.982.389-2.96.61-2.205.473-4.383.973-6.561 1.557-.67.194-1.424.333-2.066.666-.224.111-.196.333-.084.472-.056.028-.084.028-.14.056-.195.028-.363.056-.558.083-.168.028-.252.167-.224.334 0 .027.028.083.028.11-1.173 1.556-2.485 3.195-3.909 4.945-1.396 1.611-2.876 3.306-4.356 5.056-4.719 5.5-10.052 11.75-15.943 17.25a.268.268 0 0 0 0 .389c.028.027.056.055.084.055-.084.084-.168.14-.252.222-.056.056-.084.111-.084.167a.605.605 0 0 0-.111.139c-.112.111-.112.305.028.389.111.11.307.11.39-.028.029-.028.029-.056.056-.056a.44.44 0 0 1 .615 0c.335.362.67.723.977 1.028l-.698-.583c-.112-.111-.307-.083-.39.028-.113.11-.085.305.027.389l7.427 6.194c.056.056.112.056.196.056s.14-.028.195-.084l.168-.166c.028.027.083.027.111.027.084 0 .14-.027.196-.083 10.052-10.055 18.15-17.639 27.42-24.417.083-.055.111-.166.111-.25.112 0 .196-.083.251-.194 1.704-5.194 2.039-9.806 2.15-12.083v-.028c0-.028.028-.056.028-.083.028-.056.028-.084.028-.084a1.626 1.626 0 0 0-.111-1.028ZM21.472 9.5c.446-.5.893-1.028 1.34-1.5-2.876 3.778-7.65 9.583-14.408 16.5 4.607-5.083 9.242-10.333 13.068-15ZM5.193 35.778h.084-.084Zm3.462 3.194c-.027-.028-.027-.028 0-.028v.028Zm4.16-3.583c.224-.25.448-.472.699-.722 0 0 0 .027.028.027-.252.223-.475.445-.726.695Zm1.146-1.111c.14-.14.279-.334.446-.5l.028-.028c1.648-1.694 3.351-3.389 5.082-5.111l.028-.028c.419-.333.921-.694 1.368-1.028a379.003 379.003 0 0 0-6.952 6.695ZM24.794 6.472c-.921 1.195-1.954 2.778-2.82 4.028-2.736 3.944-11.532 13.583-11.727 13.75a1976.983 1976.983 0 0 1-8.042 7.639l-.167.167c-.14-.167-.14-.417.028-.556C14.49 19.861 22.03 10.167 25.074 5.917c-.084.194-.14.36-.28.555Zm4.83 5.695c-1.116-.64-1.646-1.64-1.34-2.611l.084-.334c.028-.083.084-.194.14-.277.307-.5.754-.917 1.257-1.167.027 0 .055 0 .083-.028-.028-.056-.028-.139-.028-.222.028-.167.14-.278.335-.278.335 0 1.369.306 1.76.639.111.083.223.194.335.305.14.167.363.445.474.667.056.028.112.306.196.445.056.222.111.472.084.694-.028.028 0 .194-.028.194a2.668 2.668 0 0 1-.363 1.028c-.028.028-.028.056-.056.084l-.028.027c-.14.223-.335.417-.53.556-.643.444-1.369.583-2.095.389 0 0-.195-.084-.28-.111Zm8.154-.834a39.098 39.098 0 0 1-.893 3.167c0 .028-.028.083 0 .111-.056 0-.084.028-.14.056-2.206 1.61-4.356 3.305-6.506 5.028 1.843-1.64 3.686-3.306 5.613-4.945.558-.5.949-1.139 1.06-1.861l.28-1.667v-.055c.14-.334.67-.195.586.166Z"
        fill="currentColor"
      />
    </g>
  </svg>
);

const githubIcon = (
  <svg
    focusable="false"
    role="img"
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path
      d="M7.5 15.833c-3.583 1.167-3.583-2.083-5-2.5m10 4.167v-2.917c0-.833.083-1.166-.417-1.666 2.334-.25 4.584-1.167 4.584-5a3.833 3.833 0 0 0-1.084-2.667 3.5 3.5 0 0 0-.083-2.667s-.917-.25-2.917 1.084a10.25 10.25 0 0 0-5.166 0C5.417 2.333 4.5 2.583 4.5 2.583a3.5 3.5 0 0 0-.083 2.667 3.833 3.833 0 0 0-1.084 2.667c0 3.833 2.25 4.75 4.584 5-.5.5-.5 1-.417 1.666V17.5"
      strokeWidth="1.25"
    ></path>
  </svg>
);

const twitterIcon = (
  <svg
    focusable="false"
    role="img"
    viewBox="0 0 24 24"
    fill="none"
    strokeWidth="2"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <g strokeWidth="1.25">
      <path stroke="none" d="M0 0h24v24H0z" fill="none"></path>
      <path d="M4 4l11.733 16h4.267l-11.733 -16z"></path>
      <path d="M4 20l6.768 -6.768m2.46 -2.46l6.772 -6.772"></path>
    </g>
  </svg>
);

const discordIcon = (
  <svg
    focusable="false"
    role="img"
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <g strokeWidth="1.25">
      <path d="M7.5 10.833a.833.833 0 1 0 0-1.666.833.833 0 0 0 0 1.666ZM12.5 10.833a.833.833 0 1 0 0-1.666.833.833 0 0 0 0 1.666ZM6.25 6.25c2.917-.833 4.583-.833 7.5 0M5.833 13.75c2.917.833 5.417.833 8.334 0"></path>
      <path d="M12.917 14.167c0 .833 1.25 2.5 1.666 2.5 1.25 0 2.361-1.39 2.917-2.5.556-1.39.417-4.861-1.25-9.584-1.214-.846-2.5-1.116-3.75-1.25l-.833 2.084M7.083 14.167c0 .833-1.13 2.5-1.526 2.5-1.191 0-2.249-1.39-2.778-2.5-.529-1.39-.397-4.861 1.19-9.584 1.157-.846 2.318-1.116 3.531-1.25l.833 2.084"></path>
    </g>
  </svg>
);

export default function ExcalidrawView() {
  const toolCtx = useToolContext<"create_view">();
  const { displayMode, requestDisplayMode } = useDisplayMode();
  const { maxHeight, safeArea } = useHostContext();
  const openExternal = useOpenExternal();
  const { callTool: exportToExcalidrawTool } = useCallTool(
    "export_to_excalidraw"
  );
  const { callTool: saveCheckpoint } = useCallTool("save_checkpoint");
  const { callTool: readCheckpoint } = useCallTool("read_checkpoint");

  const toolInput = toolCtx.toolInput !== undefined ? toolCtx.toolInput : null;
  const isCancelled = toolCtx.status === "cancelled";
  // `status === "pending"` covers two cases per `useToolContext`'s contract:
  // nothing has arrived yet (`toolInput === undefined`), or complete input
  // was delivered and the result is still pending (`toolInput` is the full,
  // non-partial args). So `toolInput !== undefined` here already means
  // "streaming is done, input is complete" — not "streaming ended early".
  // This is the same complete-vs-partial signal the public story-writer
  // example relies on to stop showing its streaming caret, so no different
  // "isFinal" condition is warranted here.
  //
  // On `"cancelled"` / `"error"` the host will send no further tool-input
  // notifications, so `toolInput` (partial or not) is final by definition —
  // treat it as final too so the diagram renders whatever was captured
  // instead of waiting forever for updates that will never arrive (see the
  // cancelled / error banners below for the corresponding user-visible state).
  const inputIsFinal =
    toolCtx.status === "ready" ||
    isCancelled ||
    toolCtx.status === "error" ||
    (toolCtx.status === "pending" && toolCtx.toolInput !== undefined);
  const checkpointId =
    toolCtx.status === "ready" ? toolCtx.toolOutput.checkpointId : undefined;
  const cancelledReason =
    isCancelled &&
    typeof toolCtx.reason === "string" &&
    toolCtx.reason.length > 0
      ? toolCtx.reason
      : undefined;
  const errorBanner =
    toolCtx.status === "error"
      ? toolCtx.error instanceof ToolError
        ? {
            title: "Drawing failed",
            message: toolCtx.error.message,
          }
        : {
            title: "Invalid tool result",
            message: toolCtx.error.message,
          }
      : undefined;

  const [elements, setElements] = useState<any[]>([]);
  const [userEdits, setUserEdits] = useState<any[] | null>(null);
  const [isNarrow, setIsNarrow] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 640px)").matches
  );
  const [editorReady, setEditorReady] = useState(false);
  const [excalidrawApi, setExcalidrawApi] = useState<any>(null);
  const [editorSettled, setEditorSettled] = useState(false);
  const svgViewportRef = useRef<ViewportRect | null>(null);
  const elementsRef = useRef<any[]>([]);
  const prevDisplayMode = useRef(displayMode);

  const containerHeight = maxHeight ?? null;
  const safeAreaInsets = safeArea;

  const toggleFullscreen = useCallback(async () => {
    const newMode = displayMode === "fullscreen" ? "inline" : "fullscreen";
    fsLog(`toggle: ${displayMode}→${newMode}`);
    if (newMode === "inline") {
      const edited = getLatestEditedElements();
      if (edited) {
        setElements(edited);
        setUserEdits(edited);
      }
    }
    try {
      await requestDisplayMode({ mode: newMode });
    } catch (err) {
      fsLog(`requestDisplayMode FAILED: ${err}`);
    }
  }, [displayMode, requestDisplayMode]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && displayMode === "fullscreen")
        void toggleFullscreen();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [displayMode, toggleFullscreen]);

  useEffect(() => {
    Promise.all([
      document.fonts.load("20px Excalifont"),
      document.fonts.load("400 16px Assistant"),
      document.fonts.load("500 16px Assistant"),
      document.fonts.load("700 16px Assistant"),
    ]).catch(() => {});
  }, []);

  useEffect(() => {
    if (displayMode === "fullscreen" && containerHeight) {
      const h = `${containerHeight}px`;
      document.documentElement.style.height = h;
      document.body.style.height = h;
    } else {
      document.documentElement.style.height = "";
      document.body.style.height = "";
    }
  }, [displayMode, containerHeight]);

  useEffect(() => {
    if (displayMode !== "fullscreen") {
      setEditorReady(false);
      setExcalidrawApi(null);
      setEditorSettled(false);
      return;
    }
    void (async () => {
      await document.fonts.ready;
      setTimeout(() => setEditorReady(true), 200);
    })();
  }, [displayMode]);

  // Sync edits when host exits fullscreen on its own
  useEffect(() => {
    if (prevDisplayMode.current === "fullscreen" && displayMode === "inline") {
      const edited = getLatestEditedElements();
      if (edited) {
        setElements(edited);
        setUserEdits(edited);
      }
    }
    prevDisplayMode.current = displayMode;
  }, [displayMode]);

  const mountEditor =
    displayMode === "fullscreen" &&
    inputIsFinal &&
    elements.length > 0 &&
    editorReady;
  useEffect(() => {
    if (!mountEditor || !excalidrawApi) return;
    if (editorSettled) return;
    const api = excalidrawApi;

    const settle = async () => {
      try {
        await document.fonts.load("20px Excalifont");
      } catch {
        // ignore
      }
      await document.fonts.ready;

      const sceneElements = api.getSceneElements();
      if (sceneElements?.length) {
        const { elements: fixed } = restore(
          { elements: sceneElements },
          null,
          null,
          { refreshDimensions: true }
        );
        api.updateScene({
          elements: fixed,
          captureUpdate: CaptureUpdateAction.NEVER,
        });
      }
      requestAnimationFrame(() => setEditorSettled(true));
    };

    const timer = setTimeout(() => void settle(), 200);
    return () => clearTimeout(timer);
  }, [mountEditor, excalidrawApi, editorSettled]);

  useEffect(() => {
    elementsRef.current = elements;
  }, [elements]);

  // Wire checkpoint helpers when tool result arrives
  useEffect(() => {
    setSaveCheckpoint((args) => saveCheckpoint(args));
  }, [saveCheckpoint]);

  useEffect(() => {
    if (!checkpointId) return;
    setCheckpointId(checkpointId);
    setStorageKey(checkpointId);
    const persisted = loadPersistedElements();
    if (persisted && persisted.length > 0) {
      elementsRef.current = persisted;
      setElements(persisted);
      setUserEdits(persisted);
    }
  }, [checkpointId]);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const handler = (e: MediaQueryListEvent) => setIsNarrow(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (displayMode === "fullscreen" && isNarrow && safeAreaInsets) {
      root.style.setProperty("--sat", `${safeAreaInsets.top}px`);
      root.style.setProperty("--sar", `${safeAreaInsets.right}px`);
      root.style.setProperty("--sab", `${safeAreaInsets.bottom}px`);
      root.style.setProperty("--sal", `${safeAreaInsets.left}px`);
    } else {
      root.style.removeProperty("--sat");
      root.style.removeProperty("--sar");
      root.style.removeProperty("--sab");
      root.style.removeProperty("--sal");
    }
  }, [displayMode, isNarrow, safeAreaInsets]);

  const modelContextText = isCancelled
    ? `Excalidraw diagram drawing was cancelled${cancelledReason ? `: ${cancelledReason}` : "."} Showing whatever elements were drawn before cancellation.`
    : errorBanner !== undefined
      ? `Excalidraw diagram failed: ${errorBanner.message}`
      : toolCtx.status === "ready"
        ? `Excalidraw diagram ready (checkpoint: ${toolCtx.toolOutput.checkpointId}). Display mode: ${displayMode}.`
        : toolCtx.status === "streaming"
          ? "Excalidraw diagram is streaming into the view."
          : "Excalidraw diagram view is waiting for elements.";

  return (
    <main
      className={`main${displayMode === "fullscreen" ? " fullscreen" : ""}`}
      style={
        displayMode === "fullscreen" && containerHeight
          ? { height: containerHeight }
          : undefined
      }
    >
      <ModelContext content={modelContextText} />
      {isCancelled && displayMode === "inline" && (
        <div className="cancelled-banner" role="status">
          <p className="cancelled-banner-title">Drawing cancelled</p>
          {cancelledReason ? (
            <p className="cancelled-banner-reason">{cancelledReason}</p>
          ) : null}
        </div>
      )}
      {errorBanner !== undefined && displayMode === "inline" && (
        <div className="cancelled-banner" role="alert">
          <p className="cancelled-banner-title">{errorBanner.title}</p>
          <p className="cancelled-banner-reason">{errorBanner.message}</p>
        </div>
      )}
      {displayMode === "inline" && (
        <div className="toolbar">
          <ShareButton
            onConfirm={async () => {
              await shareToExcalidraw(
                { elements, appState: {}, files: {} },
                exportToExcalidrawTool,
                openExternal
              );
            }}
          />

          <button
            className="app-button"
            onClick={() => void toggleFullscreen()}
            title="Enter fullscreen"
            type="button"
          >
            <span>Edit</span>
            <ExpandIcon />
          </button>
        </div>
      )}
      {mountEditor && (
        <div
          style={{
            width: "100%",
            height: "100%",
            visibility: editorSettled ? "visible" : "hidden",
            position: editorSettled ? undefined : "absolute",
            inset: editorSettled ? undefined : 0,
          }}
        >
          <Excalidraw
            excalidrawAPI={(api: unknown) => {
              setExcalidrawApi(api);
              fsLog(`excalidrawAPI set`);
            }}
            initialData={{ elements: elements as any, scrollToContent: true }}
            theme="light"
            onChange={(els: readonly Record<string, unknown>[]) =>
              onEditorChange(els as any)
            }
            renderTopRightUI={
              isNarrow
                ? undefined
                : () => (
                    <ShareButton
                      onConfirm={async () => {
                        if (excalidrawApi) {
                          await shareToExcalidraw(
                            {
                              elements: excalidrawApi.getSceneElements(),
                              appState: excalidrawApi.getAppState(),
                              files: excalidrawApi.getFiles(),
                            },
                            exportToExcalidrawTool,
                            openExternal
                          );
                        }
                      }}
                    />
                  )
            }
          >
            <MainMenu>
              <MainMenu.Item
                onSelect={() => {
                  void openExternal({
                    url: "https://plus.excalidraw.com?utm_source=mcp_app_menu",
                  });
                }}
                style={{ minWidth: 200 }}
              >
                {excalidrawLogo} Excalidraw
              </MainMenu.Item>
              <MainMenu.Item
                onSelect={() => {
                  void openExternal({
                    url: "https://github.com/excalidraw/excalidraw",
                  });
                }}
                style={{ minWidth: 200 }}
              >
                {githubIcon} GitHub
              </MainMenu.Item>
              <MainMenu.Item
                onSelect={() => {
                  void openExternal({ url: "https://x.com/excalidraw" });
                }}
                style={{ minWidth: 200 }}
              >
                {twitterIcon} Follow us
              </MainMenu.Item>
              <MainMenu.Item
                onSelect={() => {
                  void openExternal({ url: "https://discord.gg/UexuTaE" });
                }}
                style={{ minWidth: 200 }}
              >
                {discordIcon} Discord chat
              </MainMenu.Item>
            </MainMenu>
          </Excalidraw>
          {isNarrow && (
            <div className="mobile-share-slot">
              <ShareButton
                compact
                onConfirm={async () => {
                  if (excalidrawApi) {
                    await shareToExcalidraw(
                      {
                        elements: excalidrawApi.getSceneElements(),
                        appState: excalidrawApi.getAppState(),
                        files: excalidrawApi.getFiles(),
                      },
                      exportToExcalidrawTool,
                      openExternal
                    );
                  }
                }}
              />
            </div>
          )}
        </div>
      )}
      {!editorSettled && (
        <div>
          <DiagramView
            toolInput={toolInput}
            isFinal={inputIsFinal}
            displayMode={displayMode}
            onElements={(els) => {
              elementsRef.current = els;
              setElements(els);
            }}
            {...(userEdits ? { editedElements: userEdits } : {})}
            onViewport={(vp) => {
              svgViewportRef.current = vp;
            }}
            loadCheckpoint={async (id) => {
              try {
                const result = await readCheckpoint({ id });
                const text = (
                  result.content?.[0] as { text?: string } | undefined
                )?.text;
                if (!text) return null;
                return JSON.parse(text) as { elements: any[] };
              } catch {
                return null;
              }
            }}
          />
        </div>
      )}
    </main>
  );
}
