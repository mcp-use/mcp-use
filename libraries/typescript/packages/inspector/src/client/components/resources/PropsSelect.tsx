import { useState, useEffect } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import { Settings, Trash2 } from "lucide-react";
import { Button } from "@/client/components/ui/button";
import { PropsConfigDialog } from "./PropsConfigDialog";
import {
  useResourceProps,
  type PropPreset,
} from "@/client/hooks/useResourceProps";
import type { LLMConfig } from "../chat/types";
import type { Resource } from "@modelcontextprotocol/sdk/types.js";
import { toast } from "sonner";

interface PropsSelectProps {
  resource: Resource;
  resourceAnnotations?: Record<string, unknown>;
  llmConfig: LLMConfig | null;
  onPropsChange: (props: Record<string, string> | null) => void;
}

const NO_PROPS_VALUE = "__no_props__";
const CREATE_PRESET_VALUE = "__create_preset__";

export function PropsSelect({
  resource,
  resourceAnnotations,
  llmConfig,
  onPropsChange,
}: PropsSelectProps) {
  const {
    presets,
    activePresetId,
    savePreset,
    deletePreset,
    setActivePreset,
    getActiveProps,
  } = useResourceProps(resource.uri);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectValue, setSelectValue] = useState<string>(NO_PROPS_VALUE);
  const [editingPreset, setEditingPreset] = useState<PropPreset | null>(null);

  // Update select value when active preset changes
  useEffect(() => {
    if (activePresetId) {
      setSelectValue(activePresetId);
    } else {
      setSelectValue(NO_PROPS_VALUE);
    }
  }, [activePresetId]);

  // Notify parent of props changes
  useEffect(() => {
    const props = getActiveProps();
    onPropsChange(props);
  }, [activePresetId, getActiveProps, onPropsChange]);

  const handleValueChange = (value: string) => {
    if (value === CREATE_PRESET_VALUE) {
      // Open dialog to create new preset
      setEditingPreset(null);
      setDialogOpen(true);
      // Keep the current selection
      return;
    }

    if (value === NO_PROPS_VALUE) {
      setActivePreset(null);
      setSelectValue(NO_PROPS_VALUE);
    } else {
      setActivePreset(value);
      setSelectValue(value);
    }
  };

  const handleSavePreset = (preset: PropPreset) => {
    savePreset(preset);
    setActivePreset(preset.id);
    setSelectValue(preset.id);
  };

  const handleDeletePreset = (presetId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const preset = presets.find((p) => p.id === presetId);
    if (preset) {
      deletePreset(presetId);
      toast.success("Preset deleted", {
        description: `Preset "${preset.name}" has been deleted.`,
      });
    }
  };

  const handleEditPreset = (preset: PropPreset, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingPreset(preset);
    setDialogOpen(true);
  };

  return (
    <>
      <div className="flex items-center gap-1">
        <Select value={selectValue} onValueChange={handleValueChange}>
          <SelectTrigger
            size="sm"
            className="w-[160px] h-7 text-xs rounded-full bg-background"
          >
            <Settings className="h-3 w-3 mr-1" />
            <SelectValue placeholder="Set Props" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_PROPS_VALUE}>No Props</SelectItem>

            {presets.length > 0 && (
              <>
                {presets.map((preset) => (
                  <div
                    key={preset.id}
                    className="relative group flex items-center"
                  >
                    <SelectItem value={preset.id} className="flex-1 pr-14">
                      {preset.name}
                    </SelectItem>
                    <div className="absolute right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0"
                        onClick={(e) => handleEditPreset(preset, e)}
                      >
                        <Settings className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0"
                        onClick={(e) => handleDeletePreset(preset.id, e)}
                      >
                        <Trash2 className="h-3 w-3 text-destructive" />
                      </Button>
                    </div>
                  </div>
                ))}
              </>
            )}

            <SelectItem value={CREATE_PRESET_VALUE} className="text-primary">
              + Create Preset...
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <PropsConfigDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSave={handleSavePreset}
        existingPresets={presets}
        resource={resource}
        resourceAnnotations={resourceAnnotations}
        llmConfig={llmConfig}
        editingPreset={editingPreset}
      />
    </>
  );
}
