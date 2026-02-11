import { Button } from "@/client/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { Input } from "@/client/components/ui/input";
import { Label } from "@/client/components/ui/label";
import { usePropsLLM } from "@/client/hooks/usePropsLLM";
import type { PropPreset } from "@/client/hooks/useResourceProps";
import type { Resource } from "@modelcontextprotocol/sdk/types.js";
import { Loader2, Plus, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { LLMConfig } from "../chat/types";
import { SchemaFormField } from "../shared/SchemaFormField";

interface PropsConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (preset: PropPreset) => void;
  existingPresets: PropPreset[];
  resource: Resource;
  resourceAnnotations?: Record<string, unknown>;
  llmConfig: LLMConfig | null;
  editingPreset?: PropPreset | null;
}

interface PropPair {
  id: string;
  key: string;
  value: string;
}

export function PropsConfigDialog({
  open,
  onOpenChange,
  onSave,
  existingPresets,
  resource,
  resourceAnnotations,
  llmConfig,
  editingPreset,
}: PropsConfigDialogProps) {
  // Detect props schema from resource metadata
  const propsSchema = useMemo(() => {
    console.log("[PropsConfigDialog] Schema detection:", {
      resourceAnnotations,
      resource,
      resourceUri: resource.uri,
      resourceName: resource.name,
      hasResourceAnnotations: !!resourceAnnotations,
      resourceAnnotationsKeys: resourceAnnotations
        ? Object.keys(resourceAnnotations)
        : [],
      hasResourceDotAnnotations: !!resource.annotations,
      resourceDotAnnotationsKeys: resource.annotations
        ? Object.keys(resource.annotations)
        : [],
    });

    // Check for mcp-use widget props in _meta["mcp-use/widget"].props
    const mcpUseWidget = resourceAnnotations?.["mcp-use/widget"] as any;
    if (mcpUseWidget?.props) {
      console.log("[PropsConfigDialog] Found Zod schema in mcp-use/widget", {
        props: mcpUseWidget.props,
      });

      // Convert Zod schema format to JSON Schema-like format
      // Zod format: { def: { type: "object", shape: { propName: { def: {...}, type: "string" } } } }
      if (
        mcpUseWidget.props.def?.type === "object" &&
        mcpUseWidget.props.def.shape
      ) {
        const shape = mcpUseWidget.props.def.shape;
        const properties: Record<string, any> = {};
        const required: string[] = [];

        for (const [key, zodProp] of Object.entries(shape)) {
          const prop = zodProp as any;
          // Extract type from Zod definition
          const propType = prop.type || prop.def?.type || "string";

          properties[key] = {
            type: propType,
            description: prop.description || prop.def?.description,
          };

          // Check if required (Zod marks optional with _def.typeName === "ZodOptional")
          if (prop.def && !prop.def.typeName?.includes("Optional")) {
            required.push(key);
          }
        }

        return {
          type: "object",
          properties,
          required: required.length > 0 ? required : undefined,
        };
      }

      // Check if it's already in JSON Schema format (not Zod)
      if (
        mcpUseWidget.props.type === "object" &&
        mcpUseWidget.props.properties
      ) {
        console.log("[PropsConfigDialog] Found JSON Schema in mcp-use/widget", {
          props: mcpUseWidget.props,
        });
        // It's already JSON Schema, return as-is
        return mcpUseWidget.props;
      }
    }

    // Check standard JSON Schema locations
    const annotations = resourceAnnotations as Record<string, any>;
    if (annotations?.["mcp-use/propsSchema"]) {
      console.log("[PropsConfigDialog] Found schema in resourceAnnotations");
      return annotations["mcp-use/propsSchema"] as any;
    }
    const resourceAnnots = resource.annotations as Record<string, any>;
    if (resourceAnnots?.["mcp-use/propsSchema"]) {
      console.log("[PropsConfigDialog] Found schema in resource.annotations");
      return resourceAnnots["mcp-use/propsSchema"] as any;
    }

    console.log("[PropsConfigDialog] No schema found, using generic mode");
    return null;
  }, [resourceAnnotations, resource.annotations, resource.uri, resource.name]);

  const hasSchema = !!propsSchema;

  console.log("[PropsConfigDialog] Render mode:", {
    hasSchema,
    propsSchema: propsSchema ? Object.keys(propsSchema) : null,
    propsSchemaProperties: propsSchema?.properties
      ? Object.keys(propsSchema.properties)
      : null,
  });

  const [presetName, setPresetName] = useState("");
  // For schema mode: track values by field name
  const [schemaValues, setSchemaValues] = useState<Record<string, string>>({});
  // For generic mode: track key-value pairs
  const [propPairs, setPropPairs] = useState<PropPair[]>([
    { id: crypto.randomUUID(), key: "", value: "" },
  ]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);

  const { generateProps, isAvailable } = usePropsLLM({ llmConfig });

  // Initialize form when editing or opening dialog
  useEffect(() => {
    if (open) {
      if (editingPreset) {
        setPresetName(editingPreset.name);

        if (hasSchema) {
          // Schema mode: set values for each field
          setSchemaValues(editingPreset.props);
        } else {
          // Generic mode: convert props to key-value pairs
          const pairs = Object.entries(editingPreset.props).map(
            ([key, value]) => ({
              id: crypto.randomUUID(),
              key,
              value,
            })
          );
          setPropPairs(
            pairs.length > 0
              ? pairs
              : [{ id: crypto.randomUUID(), key: "", value: "" }]
          );
        }
      } else {
        // Initialize empty state based on mode
        setPresetName("");
        if (hasSchema) {
          setSchemaValues({});
        } else {
          setPropPairs([{ id: crypto.randomUUID(), key: "", value: "" }]);
        }
      }
      setGenerationError(null);
    }
  }, [open, editingPreset, hasSchema]);

  const handleAddPair = () => {
    setPropPairs([
      ...propPairs,
      { id: crypto.randomUUID(), key: "", value: "" },
    ]);
  };

  const handleRemovePair = (id: string) => {
    if (propPairs.length > 1) {
      setPropPairs(propPairs.filter((pair) => pair.id !== id));
    }
  };

  const handlePairChange = (
    id: string,
    field: "key" | "value",
    value: string
  ) => {
    setPropPairs(
      propPairs.map((pair) =>
        pair.id === id ? { ...pair, [field]: value } : pair
      )
    );
  };

  const handleGenerateWithLLM = async () => {
    if (!isAvailable) {
      toast.error("LLM not configured", {
        description: "Please configure LLM in the Chat tab first.",
      });
      return;
    }

    setIsGenerating(true);
    setGenerationError(null);

    try {
      const generatedProps = await generateProps({
        resource,
        resourceAnnotations,
        propsSchema: hasSchema ? propsSchema : undefined,
      });

      if (hasSchema) {
        // For schema mode: map generated props to schema fields
        const values: Record<string, string> = {};
        for (const prop of generatedProps) {
          if (propsSchema.properties?.[prop.key]) {
            values[prop.key] = prop.value;
          }
        }
        setSchemaValues(values);
      } else {
        // For generic mode: use existing propPairs logic
        setPropPairs(
          generatedProps.map((prop) => ({
            id: crypto.randomUUID(),
            key: prop.key,
            value: prop.value,
          }))
        );
      }

      toast.success("Props generated successfully", {
        description: `Generated ${generatedProps.length} prop(s) using ${llmConfig?.provider}`,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to generate props";
      setGenerationError(errorMessage);
      toast.error("LLM Generation Failed", {
        description: errorMessage,
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSave = () => {
    // Validation
    if (!presetName.trim()) {
      toast.error("Preset name required", {
        description: "Please enter a name for this preset.",
      });
      return;
    }

    // Check for duplicate names (excluding current preset if editing)
    const duplicateName = existingPresets.find(
      (p) =>
        p.name.toLowerCase() === presetName.toLowerCase() &&
        p.id !== editingPreset?.id
    );
    if (duplicateName) {
      toast.error("Duplicate preset name", {
        description: "A preset with this name already exists.",
      });
      return;
    }

    // Build props object based on mode
    let props: Record<string, string>;

    if (hasSchema) {
      // Schema mode: use schemaValues directly
      props = { ...schemaValues };
    } else {
      // Generic mode: build from propPairs (filter out empty keys)
      props = {};
      for (const pair of propPairs) {
        if (pair.key.trim()) {
          props[pair.key.trim()] = pair.value;
        }
      }
    }

    if (Object.keys(props).length === 0) {
      toast.error("No props defined", {
        description: "Please add at least one prop with a key.",
      });
      return;
    }

    const preset: PropPreset = {
      id: editingPreset?.id || crypto.randomUUID(),
      name: presetName.trim(),
      props,
    };

    onSave(preset);
    onOpenChange(false);
    toast.success(editingPreset ? "Preset updated" : "Preset created", {
      description: `Preset "${preset.name}" saved successfully.`,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-[600px] max-h-[80vh] flex flex-col"
        data-testid="props-config-dialog"
      >
        <DialogHeader>
          <DialogTitle>
            {editingPreset ? "Edit Preset" : "Create Props Preset"}
          </DialogTitle>
          <DialogDescription>
            Configure props for {resource.name || resource.uri}. You can
            manually add key-value pairs or generate them with AI.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-4">
          {/* Preset Name */}
          <div className="space-y-2">
            <Label htmlFor="preset-name">Preset Name</Label>
            <Input
              id="preset-name"
              data-testid="props-config-preset-name"
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              placeholder="e.g., Dark Theme, Production Config"
              disabled={isGenerating}
            />
          </div>

          {/* LLM Generation Section */}
          <div className="space-y-2 p-3 bg-muted rounded-lg">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Generate with AI</Label>
              {isAvailable && (
                <span className="text-xs text-muted-foreground">
                  Using {llmConfig?.provider} ({llmConfig?.model})
                </span>
              )}
            </div>
            {isAvailable ? (
              <Button
                onClick={handleGenerateWithLLM}
                disabled={isGenerating}
                size="sm"
                variant="outline"
                className="w-full"
                data-testid="props-config-generate-llm-button"
              >
                {isGenerating ? (
                  <span
                    data-testid="props-config-generating"
                    className="flex items-center gap-2"
                  >
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Generating...
                  </span>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4 mr-2" />
                    Generate Props with LLM
                  </>
                )}
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground">
                LLM not configured. Please configure LLM in the Chat tab to use
                this feature.
              </p>
            )}
            {generationError && (
              <p
                className="text-xs text-destructive"
                data-testid="props-config-error"
              >
                {generationError}
              </p>
            )}
          </div>

          {/* Props Form Section */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">Props</Label>

            {hasSchema ? (
              // Schema-based form
              <div className="space-y-4">
                {Object.entries(propsSchema.properties || {}).map(
                  ([key, propDef]: [string, any]) => (
                    <SchemaFormField
                      key={key}
                      name={key}
                      schema={propDef}
                      value={schemaValues[key] || ""}
                      onChange={(value) =>
                        setSchemaValues((prev) => ({ ...prev, [key]: value }))
                      }
                      required={propsSchema.required?.includes(key)}
                      disabled={isGenerating}
                      rootSchema={propsSchema}
                    />
                  )
                )}
              </div>
            ) : (
              // Generic key-value form
              <>
                <div className="flex items-center justify-between">
                  <Button
                    onClick={handleAddPair}
                    size="sm"
                    variant="ghost"
                    disabled={isGenerating}
                    data-testid="props-config-add-prop"
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Add Prop
                  </Button>
                </div>

                {propPairs.map((pair, index) => (
                  <div key={pair.id} className="flex items-center gap-2">
                    <div className="flex-1 grid grid-cols-2 gap-2">
                      <Input
                        placeholder="Key"
                        value={pair.key}
                        onChange={(e) =>
                          handlePairChange(pair.id, "key", e.target.value)
                        }
                        disabled={isGenerating}
                        data-testid={`props-config-key-${index}`}
                      />
                      <Input
                        placeholder="Value"
                        value={pair.value}
                        onChange={(e) =>
                          handlePairChange(pair.id, "value", e.target.value)
                        }
                        disabled={isGenerating}
                        data-testid={`props-config-value-${index}`}
                      />
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemovePair(pair.id)}
                      disabled={propPairs.length === 1 || isGenerating}
                      className="h-9 w-9 p-0"
                      data-testid={`props-config-remove-${index}`}
                    >
                      <Trash2 className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isGenerating}
            data-testid="props-config-cancel-button"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={isGenerating}
            data-testid="props-config-save-button"
          >
            {editingPreset ? "Update" : "Create"} Preset
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
