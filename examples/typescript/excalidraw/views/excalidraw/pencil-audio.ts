import { PENCIL_STROKE_SOFT } from "./sounds.js";

/**
 * Pencil stroke audio engine.
 * Plays randomized variations of a pencil-on-paper sample when elements
 * appear during streaming. Each stroke varies in pitch, gain, duration,
 * and sample offset so no two elements sound identical.
 */

let audioCtx: AudioContext | null = null;
let softBuffer: AudioBuffer | null = null;
let initialized = false;
let initPromise: Promise<void> | null = null;

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }
  return audioCtx;
}

async function decodeBase64Audio(base64: string): Promise<AudioBuffer> {
  const ctx = getAudioContext();
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return ctx.decodeAudioData(bytes.buffer);
}

/** Initialize audio buffers. Call once, safe to call multiple times. */
export async function initPencilAudio(): Promise<void> {
  if (initialized) return;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    try {
      softBuffer = await decodeBase64Audio(PENCIL_STROKE_SOFT);
      initialized = true;
    } catch (e) {
      console.warn("[PencilAudio] Failed to init:", e);
    }
  })();
  return initPromise;
}

/** Play a pencil stroke sound for a given element type. */
export function playStroke(elementType: string): void {
  if (!initialized || !audioCtx) return;

  // Use soft stroke for all element types
  const isLine = elementType === "arrow" || elementType === "line";
  const buffer = softBuffer;
  if (!buffer) return;

  // Resume context if suspended (autoplay policy)
  if (audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }

  const ctx = audioCtx;

  // Create source with random offset into the sample
  const source = ctx.createBufferSource();
  source.buffer = buffer;

  // Random playback rate for pitch variation (0.85–1.2)
  source.playbackRate.value = 0.85 + Math.random() * 0.35;

  // Gain node for volume envelope — normalize across samples
  const gain = ctx.createGain();
  const isText = elementType === "text";
  // Per-type gain normalization: shapes are most prominent, text medium, arrows lighter
  const typeGain = isLine ? 1.0 : isText ? 2.0 : 2.5;
  const baseVolume = (0.8 + Math.random() * 0.4) * typeGain; // normalized
  gain.gain.setValueAtTime(0, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(baseVolume, ctx.currentTime + 0.03); // quick attack
  // Duration varies by element type
  const duration = isLine
    ? 0.3 + Math.random() * 0.3
    : 0.2 + Math.random() * 0.4;
  gain.gain.linearRampToValueAtTime(0, ctx.currentTime + duration); // fade out

  // Connect: source → gain → destination
  source.connect(gain);
  gain.connect(ctx.destination);

  // Start at random offset within the sample
  const maxOffset = Math.max(0, buffer.duration - duration - 0.1);
  const offset = Math.random() * maxOffset;
  source.start(0, offset, duration + 0.1);

  // Cleanup
  source.onended = () => {
    source.disconnect();
    gain.disconnect();
  };
}
