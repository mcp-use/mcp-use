import { useState, useMemo, useEffect } from "react";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { Label } from "@/client/components/ui/label";
import { Textarea } from "@/client/components/ui/textarea";
import { Checkbox } from "@/client/components/ui/checkbox";
import type { ElicitResult } from "@modelcontextprotocol/sdk/types.js";
import type { PendingElicitationRequest } from "@/client/types/elicitation";
import { JSONDisplay } from "@/client/components/shared/JSONDisplay";
import { toast } from "sonner";
import {
  Check,
  Copy,
  Download,
  Maximize2,
  X,
  ExternalLink,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import { Badge } from "@/client/components/ui/badge";

interface ElicitationRequestDisplayProps {
  request: PendingElicitationRequest | null;
  onApprove: (requestId: string, result: ElicitResult) => void;
  onReject: (requestId: string, error?: string) => void;
  onClose: () => void;
  previewMode: boolean;
  onTogglePreview: () => void;
  isCopied: boolean;
  onCopy: () => void;
  onDownload: () => void;
  onFullscreen: () => void;
}

interface EnumChoice {
  const: string;
  title?: string;
}

function isEnumChoice(value: unknown): value is EnumChoice {
  if (!value || typeof value !== "object") return false;
  const maybeChoice = value as { const?: unknown; title?: unknown };
  return (
    typeof maybeChoice.const === "string" &&
    (maybeChoice.title === undefined || typeof maybeChoice.title === "string")
  );
}

function getSingleSelectChoices(field: Record<string, any>): EnumChoice[] {
  const oneOf = Array.isArray(field.oneOf)
    ? field.oneOf.filter(isEnumChoice)
    : [];
  const anyOf = Array.isArray(field.anyOf)
    ? field.anyOf.filter(isEnumChoice)
    : [];

  return oneOf.length > 0 ? oneOf : anyOf;
}

function getMultiSelectChoices(field: Record<string, any>): EnumChoice[] {
  const items =
    field.items && typeof field.items === "object" ? field.items : {};
  const anyOf = Array.isArray(items.anyOf)
    ? items.anyOf.filter(isEnumChoice)
    : [];
  const oneOf = Array.isArray(items.oneOf)
    ? items.oneOf.filter(isEnumChoice)
    : [];

  return anyOf.length > 0 ? anyOf : oneOf;
}

export function ElicitationRequestDisplay({
  request,
  onApprove,
  onReject,
  onClose,
  previewMode: _previewMode,
  onTogglePreview: _onTogglePreview,
  isCopied,
  onCopy,
  onDownload,
  onFullscreen,
}: ElicitationRequestDisplayProps) {
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [urlCompleted, setUrlCompleted] = useState(false);

  const mode = request?.request.mode || "form";
  const isFormMode = mode === "form";
  const isUrlMode = mode === "url";

  // Reset form data when request changes
  useEffect(() => {
    if (request && isFormMode && "requestedSchema" in request.request) {
      const schema = request.request.requestedSchema;
      const initialData: Record<string, any> = {};

      if (schema?.type === "object" && schema.properties) {
        for (const [fieldName, fieldSchema] of Object.entries(
          schema.properties
        )) {
          const field = fieldSchema as any;
          // Set default values if available
          if (field.default !== undefined) {
            initialData[fieldName] = field.default;
          } else if (field.type === "array") {
            initialData[fieldName] = [];
          } else if (field.type === "boolean") {
            initialData[fieldName] = false;
          } else if (field.type === "number" || field.type === "integer") {
            initialData[fieldName] = 0;
          } else {
            initialData[fieldName] = "";
          }
        }
      }
      setFormData(initialData);
    }
    setUrlCompleted(false);
  }, [request?.id, isFormMode]);

  const handleFieldChange = (fieldName: string, value: any) => {
    setFormData((prev) => ({ ...prev, [fieldName]: value }));
  };

  const handleAccept = () => {
    if (!request) return;

    if (isFormMode) {
      // Validate required fields if schema is available
      if ("requestedSchema" in request.request) {
        const schema = request.request.requestedSchema;
        if (schema?.required) {
          const missingFields = schema.required.filter(
            (field: string) =>
              formData[field] === undefined ||
              formData[field] === "" ||
              formData[field] === null
          );
          if (missingFields.length > 0) {
            toast.error("Missing required fields", {
              description: `Please fill in: ${missingFields.join(", ")}`,
            });
            return;
          }
        }
      }

      onApprove(request.id, {
        action: "accept",
        data: formData,
      });
    } else if (isUrlMode) {
      onApprove(request.id, {
        action: "accept",
      });
    }
    onClose();

    // Show success toast with navigation back to tools tab
    import("react").then((React) => {
      const toastId = toast(
        React.createElement(
          "div",
          { className: "space-y-3" },
          React.createElement(
            "div",
            null,
            React.createElement("strong", null, "Elicitation Response Sent"),
            React.createElement(
              "p",
              { className: "text-sm text-muted-foreground mt-1" },
              "The tool will continue executing."
            )
          ),
          React.createElement(
            "div",
            { className: "flex gap-2" },
            React.createElement(
              "button",
              {
                "data-testid": "elicitation-view-tool-result",
                className:
                  "px-3 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90",
                onClick: () => {
                  // Dispatch event to navigate to tools tab
                  const event = new globalThis.CustomEvent(
                    "navigate-to-tool-result",
                    {
                      detail: { toolName: null },
                    }
                  );
                  window.dispatchEvent(event);
                  // Dismiss the toast immediately
                  toast.dismiss(toastId);
                },
              },
              "View Tool Result"
            )
          )
        ),
        {
          duration: 5000, // Auto-dismiss after 5 seconds
        }
      );
    });
  };

  const handleDecline = () => {
    if (!request) return;
    onApprove(request.id, { action: "decline" });
    onClose();
  };

  const handleCancel = () => {
    if (!request) return;
    onReject(request.id, "User cancelled elicitation request");
    onClose();
  };

  const handleOpenUrl = () => {
    if (request && isUrlMode && "url" in request.request) {
      window.open(request.request.url, "_blank");
      setUrlCompleted(true);
    }
  };

  const renderFormFields = useMemo(() => {
    if (!request || !isFormMode || !("requestedSchema" in request.request))
      return null;

    const schema = request.request.requestedSchema;
    if (!schema || schema.type !== "object" || !schema.properties) {
      return (
        <div className="text-sm text-gray-500 dark:text-gray-400">
          No form schema available
        </div>
      );
    }

    const properties = schema.properties as Record<string, any>;
    const required = (schema.required as string[]) || [];

    return (
      <div className="space-y-4">
        {Object.entries(properties).map(([fieldName, fieldSchema]) => {
          const field = fieldSchema as any;
          const isRequired = required.includes(fieldName);
          const fieldType = field.type || "string";
          const fieldLabel = field.title || fieldName;
          const fieldDescription = field.description;
          const singleSelectChoices = getSingleSelectChoices(field);
          const isSingleSelectChoiceField = singleSelectChoices.length > 0;
          const isEnumField = Array.isArray(field.enum);
          const isUntitledMultiSelectField =
            fieldType === "array" && Array.isArray(field.items?.enum);
          const multiSelectChoices = getMultiSelectChoices(field);
          const isTitledMultiSelectField =
            fieldType === "array" && multiSelectChoices.length > 0;
          const selectedMultiValues = Array.isArray(formData[fieldName])
            ? (formData[fieldName] as string[])
            : [];

          return (
            <div key={fieldName} className="space-y-2">
              <Label htmlFor={`field-${fieldName}`}>
                {fieldLabel}
                {isRequired && <span className="text-red-500 ml-1">*</span>}
              </Label>
              {fieldDescription && (
                <p className="text-xs text-muted-foreground">
                  {fieldDescription}
                </p>
              )}

              {fieldType === "boolean" ? (
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id={`field-${fieldName}`}
                    data-testid={`elicitation-field-${fieldName}`}
                    checked={formData[fieldName] || false}
                    onCheckedChange={(checked) =>
                      handleFieldChange(fieldName, checked)
                    }
                  />
                  <Label
                    htmlFor={`field-${fieldName}`}
                    className="text-sm font-normal cursor-pointer"
                  >
                    {field.title || fieldName}
                  </Label>
                </div>
              ) : fieldType === "number" || fieldType === "integer" ? (
                <Input
                  id={`field-${fieldName}`}
                  data-testid={`elicitation-field-${fieldName}`}
                  type="number"
                  value={formData[fieldName] || ""}
                  onChange={(e) =>
                    handleFieldChange(
                      fieldName,
                      fieldType === "integer"
                        ? parseInt(e.target.value, 10)
                        : parseFloat(e.target.value)
                    )
                  }
                  placeholder={field.default?.toString() || ""}
                />
              ) : isSingleSelectChoiceField ? (
                <select
                  id={`field-${fieldName}`}
                  data-testid={`elicitation-field-${fieldName}`}
                  value={formData[fieldName] || ""}
                  onChange={(e) => handleFieldChange(fieldName, e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <option value="">Select...</option>
                  {singleSelectChoices.map((choice) => (
                    <option key={choice.const} value={choice.const}>
                      {choice.title || choice.const}
                    </option>
                  ))}
                </select>
              ) : isEnumField ? (
                <select
                  id={`field-${fieldName}`}
                  data-testid={`elicitation-field-${fieldName}`}
                  value={formData[fieldName] || ""}
                  onChange={(e) => handleFieldChange(fieldName, e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <option value="">Select...</option>
                  {field.enum.map((option: string, index: number) => (
                    <option key={option} value={option}>
                      {field.enumNames?.[index] || option}
                    </option>
                  ))}
                </select>
              ) : isUntitledMultiSelectField ? (
                <div
                  className="space-y-2"
                  data-testid={`elicitation-field-${fieldName}`}
                >
                  {field.items.enum.map((option: string) => {
                    const checkboxId = `field-${fieldName}-${option}`;
                    const checked = selectedMultiValues.includes(option);

                    return (
                      <div key={option} className="flex items-center space-x-2">
                        <Checkbox
                          id={checkboxId}
                          checked={checked}
                          onCheckedChange={(nextChecked) => {
                            const updatedValues = nextChecked
                              ? [...selectedMultiValues, option]
                              : selectedMultiValues.filter(
                                  (value) => value !== option
                                );
                            handleFieldChange(fieldName, updatedValues);
                          }}
                        />
                        <Label
                          htmlFor={checkboxId}
                          className="text-sm font-normal cursor-pointer"
                        >
                          {option}
                        </Label>
                      </div>
                    );
                  })}
                </div>
              ) : isTitledMultiSelectField ? (
                <div
                  className="space-y-2"
                  data-testid={`elicitation-field-${fieldName}`}
                >
                  {multiSelectChoices.map((choice) => {
                    const checkboxId = `field-${fieldName}-${choice.const}`;
                    const checked = selectedMultiValues.includes(choice.const);

                    return (
                      <div
                        key={choice.const}
                        className="flex items-center space-x-2"
                      >
                        <Checkbox
                          id={checkboxId}
                          checked={checked}
                          onCheckedChange={(nextChecked) => {
                            const updatedValues = nextChecked
                              ? [...selectedMultiValues, choice.const]
                              : selectedMultiValues.filter(
                                  (value) => value !== choice.const
                                );
                            handleFieldChange(fieldName, updatedValues);
                          }}
                        />
                        <Label
                          htmlFor={checkboxId}
                          className="text-sm font-normal cursor-pointer"
                        >
                          {choice.title || choice.const}
                        </Label>
                      </div>
                    );
                  })}
                </div>
              ) : fieldType === "string" &&
                (field.format === "textarea" || field.maxLength > 100) ? (
                <Textarea
                  id={`field-${fieldName}`}
                  data-testid={`elicitation-field-${fieldName}`}
                  value={formData[fieldName] || ""}
                  onChange={(e) => handleFieldChange(fieldName, e.target.value)}
                  placeholder={field.default || ""}
                  rows={4}
                />
              ) : (
                <Input
                  id={`field-${fieldName}`}
                  data-testid={`elicitation-field-${fieldName}`}
                  type="text"
                  value={formData[fieldName] || ""}
                  onChange={(e) => handleFieldChange(fieldName, e.target.value)}
                  placeholder={field.default || ""}
                />
              )}
            </div>
          );
        })}
      </div>
    );
  }, [request, formData, isFormMode]);

  if (!request) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4 text-center">
        <p className="text-gray-500 dark:text-gray-400">
          Select an elicitation request to view details
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b dark:border-zinc-700">
        <div className="flex items-center gap-2">
          <h3 className="font-medium text-gray-900 dark:text-gray-100">
            {request.serverName}
          </h3>
          <Badge
            variant="outline"
            className={
              isUrlMode
                ? "bg-blue-500/20 text-blue-600 dark:text-blue-400 border-blue-500/50"
                : "bg-green-500/20 text-green-600 dark:text-green-400 border-green-500/50"
            }
          >
            {mode}
          </Badge>
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {new Date(request.timestamp).toLocaleString()}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={onCopy}
                className="h-8 w-8 p-0"
              >
                {isCopied ? (
                  <Check className="h-4 w-4 text-green-600" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Copy request</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={onDownload}
                className="h-8 w-8 p-0"
              >
                <Download className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Download request</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={onFullscreen}
                className="h-8 w-8 p-0"
              >
                <Maximize2 className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Fullscreen</TooltipContent>
          </Tooltip>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="h-8 w-8 p-0"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Message Section */}
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            Message
          </h4>
          <p className="text-sm text-gray-700 dark:text-gray-300">
            {request.request.message}
          </p>
        </div>

        {/* URL Mode Display */}
        {isUrlMode && "url" in request.request && (
          <div className="space-y-2">
            <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              External Action Required
            </h4>
            <div className="bg-muted rounded-lg p-4 space-y-3">
              <p className="text-sm text-muted-foreground">
                This request requires you to complete an action at an external
                URL:
              </p>
              <div className="flex items-center gap-2 p-2 bg-background rounded border">
                <code className="flex-1 text-xs font-mono break-all">
                  {request.request.url}
                </code>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleOpenUrl}
                  className="flex items-center gap-2"
                >
                  <ExternalLink className="h-4 w-4" />
                  Open URL
                </Button>
              </div>
              <div className="flex items-center space-x-2 pt-2">
                <Checkbox
                  id="url-completed"
                  checked={urlCompleted}
                  onCheckedChange={(checked) => setUrlCompleted(!!checked)}
                />
                <Label
                  htmlFor="url-completed"
                  className="text-sm font-normal cursor-pointer"
                >
                  I have completed the required action
                </Label>
              </div>
            </div>
          </div>
        )}

        {/* Form Mode Display */}
        {isFormMode && (
          <div className="space-y-2">
            <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              Form Data
            </h4>
            {renderFormFields}
          </div>
        )}

        {/* Schema Display (for debugging/reference) */}
        {isFormMode &&
          "requestedSchema" in request.request &&
          request.request.requestedSchema && (
            <details className="space-y-2">
              <summary className="text-sm font-semibold text-gray-900 dark:text-gray-100 cursor-pointer">
                Schema (for reference)
              </summary>
              <div className="bg-muted rounded-lg p-3 max-h-64 overflow-auto">
                <JSONDisplay data={request.request.requestedSchema} />
              </div>
            </details>
          )}
      </div>

      {/* Actions Footer */}
      <div className="flex gap-2 p-4 border-t dark:border-zinc-700">
        <Button
          onClick={handleAccept}
          className="flex-1"
          data-testid="elicitation-accept-button"
        >
          Accept
        </Button>
        <Button
          onClick={handleDecline}
          variant="outline"
          className="flex-1"
          data-testid="elicitation-decline-button"
        >
          Decline
        </Button>
        <Button
          onClick={handleCancel}
          variant="outline"
          className="flex-1"
          data-testid="elicitation-cancel-button"
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
