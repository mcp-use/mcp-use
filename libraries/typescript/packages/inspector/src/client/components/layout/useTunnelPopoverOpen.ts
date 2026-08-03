import { useSyncExternalStore, useEffect, useState, useCallback } from "react";

function subscribeLg(cb: () => void) {
  const mq = window.matchMedia("(min-width: 1024px)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

function getLgSnapshot() {
  return window.matchMedia("(min-width: 1024px)").matches;
}

function getLgServerSnapshot() {
  return true;
}

/** True when the desktop header row is visible (lg breakpoint and up). */
export function useIsLgUp() {
  return useSyncExternalStore(subscribeLg, getLgSnapshot, getLgServerSnapshot);
}

/** Lifted tunnel popover open state — only the visible header row may open it. */
export function useTunnelPopoverOpen(tunnelUrl: string | null) {
  const [open, setOpen] = useState(false);
  const [autoCopyOnOpen, setAutoCopyOnOpen] = useState(false);
  const isLgUp = useIsLgUp();

  const openWithAutoCopy = useCallback(() => {
    setOpen(true);
    setAutoCopyOnOpen(true);
  }, []);

  useEffect(() => {
    if (tunnelUrl) return;
    setOpen(false);
    setAutoCopyOnOpen(false);
  }, [tunnelUrl]);

  useEffect(() => {
    if (!tunnelUrl) return;
    const p = new URLSearchParams(window.location.search);
    if (!p.has("openTunnelPopover")) return;
    setOpen(true);
    setAutoCopyOnOpen(true);
    p.delete("openTunnelPopover");
    const qs = p.toString();
    window.history.replaceState(
      {},
      "",
      `${window.location.pathname}${qs ? `?${qs}` : ""}`
    );
  }, [tunnelUrl]);

  const onOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    if (!next) {
      setAutoCopyOnOpen(false);
    }
  }, []);

  return { open, onOpenChange, isLgUp, autoCopyOnOpen, openWithAutoCopy };
}
