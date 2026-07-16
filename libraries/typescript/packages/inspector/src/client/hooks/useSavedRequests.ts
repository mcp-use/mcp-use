import type { SavedRequest } from "@/client/components/tools/SavedRequestsList";
import { useCallback, useEffect, useState } from "react";

const SAVED_REQUESTS_KEY = "mcp-inspector-saved-requests";

export function useSavedRequests() {
  const [savedRequests, setSavedRequests] = useState<SavedRequest[]>([]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(SAVED_REQUESTS_KEY);
      if (saved) {
        setSavedRequests(JSON.parse(saved));
      }
    } catch (error) {
      console.error("[useSavedRequests] Failed to load saved requests:", error);
    }
  }, []);

  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === SAVED_REQUESTS_KEY && e.newValue) {
        try {
          setSavedRequests(JSON.parse(e.newValue));
        } catch (error) {
          console.error(
            "[useSavedRequests] Failed to parse saved requests:",
            error
          );
        }
      }
    };

    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, []);

  const saveSavedRequests = useCallback((requests: SavedRequest[]) => {
    try {
      localStorage.setItem(SAVED_REQUESTS_KEY, JSON.stringify(requests));
      setSavedRequests(requests);
    } catch (error) {
      console.error("[useSavedRequests] Failed to save requests:", error);
    }
  }, []);

  return { savedRequests, saveSavedRequests };
}
