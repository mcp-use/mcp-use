import { useState, useCallback, useEffect } from "react";

export interface PropPreset {
  id: string;
  name: string;
  props: Record<string, string>;
}

interface ResourcePropsStorage {
  presets: PropPreset[];
  activePresetId: string | null;
}

const getStorageKey = (resourceUri: string) =>
  `mcp-inspector-resource-props-${resourceUri}`;

export function useResourceProps(resourceUri: string) {
  const [presets, setPresets] = useState<PropPreset[]>([]);
  const [activePresetId, setActivePresetId] = useState<string | null>(null);

  // Load presets from localStorage on mount or when resourceUri changes
  useEffect(() => {
    const loadPresets = () => {
      try {
        const key = getStorageKey(resourceUri);
        const stored = localStorage.getItem(key);
        if (stored) {
          const data: ResourcePropsStorage = JSON.parse(stored);
          setPresets(data.presets || []);
          setActivePresetId(data.activePresetId || null);
        } else {
          setPresets([]);
          setActivePresetId(null);
        }
      } catch (error) {
        console.error("[useResourceProps] Failed to load presets:", error);
        setPresets([]);
        setActivePresetId(null);
      }
    };

    loadPresets();
  }, [resourceUri]);

  // Save to localStorage
  const saveToStorage = useCallback(
    (presetsToSave: PropPreset[], activeId: string | null) => {
      try {
        const key = getStorageKey(resourceUri);
        const data: ResourcePropsStorage = {
          presets: presetsToSave,
          activePresetId: activeId,
        };
        localStorage.setItem(key, JSON.stringify(data));
      } catch (error) {
        console.error("[useResourceProps] Failed to save presets:", error);
      }
    },
    [resourceUri]
  );

  // Add or update a preset
  const savePreset = useCallback(
    (preset: PropPreset) => {
      setPresets((prev) => {
        const existingIndex = prev.findIndex((p) => p.id === preset.id);
        let updated: PropPreset[];
        if (existingIndex >= 0) {
          // Update existing
          updated = [...prev];
          updated[existingIndex] = preset;
        } else {
          // Add new
          updated = [...prev, preset];
        }
        saveToStorage(updated, activePresetId);
        return updated;
      });
    },
    [activePresetId, saveToStorage]
  );

  // Delete a preset
  const deletePreset = useCallback(
    (presetId: string) => {
      setPresets((prev) => {
        const updated = prev.filter((p) => p.id !== presetId);
        const newActiveId = activePresetId === presetId ? null : activePresetId;
        saveToStorage(updated, newActiveId);
        if (activePresetId === presetId) {
          setActivePresetId(null);
        }
        return updated;
      });
    },
    [activePresetId, saveToStorage]
  );

  // Set active preset
  const setActivePreset = useCallback(
    (presetId: string | null) => {
      setActivePresetId(presetId);
      saveToStorage(presets, presetId);
    },
    [presets, saveToStorage]
  );

  // Get current active props
  const getActiveProps = useCallback((): Record<string, string> | null => {
    if (!activePresetId) return null;
    const preset = presets.find((p) => p.id === activePresetId);
    return preset?.props || null;
  }, [activePresetId, presets]);

  return {
    presets,
    activePresetId,
    savePreset,
    deletePreset,
    setActivePreset,
    getActiveProps,
  };
}
