// libraries/typescript/packages/inspector/src/client/components/chat/InlineElicitationCard.tsx
import { useState, useMemo, useEffect } from "react";
import type { ElicitResult } from "@modelcontextprotocol/sdk/types.js";
import type { PendingElicitationRequest } from "@/client/types/elicitation";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { Label } from "@/client/components/ui/label";
import { Textarea } from "@/client/components/ui/textarea";
import { Checkbox } from "@/client/components/ui/checkbox";
import { Badge } from "@/client/components/ui/badge";
import { ExternalLink } from "lucide-react";
import { toast } from "sonner";

interface InlineElicitationCardProps {
  request: PendingElicitationRequest;
  onApprove: (requestId: string, result: ElicitResult) => void;
  onReject: (requestId: string, error?: string) => void;
}

interface EnumChoice {
  const: string;
  title?: string;
}

function isEnumChoice(value: unknown): value is EnumChoice {
  if (!value || typeof value !== "object") return false;
  const v = value as { const?: unknown; title?: unknown };
  return (
    typeof v.const === "string" &&
    (v.title === undefined || typeof v.title === "string")
  );
}

function getSingleSelectChoices(field: Record<string, any>): EnumChoice[] {
  const oneOf = Array.isArray(field.oneOf) ? field.oneOf.filter(isEnumChoice) : [];
  const anyOf = Array.isArray(field.anyOf) ? field.anyOf.filter(isEnumChoice) : [];
  return oneOf.length > 0 ? oneOf : anyOf;
}

function getMultiSelectChoices(field: Record<string, any>): EnumChoice[] {
  const items = field.items && typeof field.items === "object" ? field.items : {};
  const anyOf = Array.isArray(items.anyOf) ? items.anyOf.filter(isEnumChoice) : [];
  const oneOf = Array.isArray(items.oneOf) ? items.oneOf.filter(isEnumChoice) : [];
  return anyOf.length > 0 ? anyOf : oneOf;
}

export function InlineElicitationCard({
  request,
  onApprove,
  onReject,
}: InlineElicitationCardProps) {
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [urlCompleted, setUrlCompleted] = useState(false);
  const [responded, setResponded] = useState(false);
  const [responseLabel, setResponseLabel] = useState<string>("");

  const mode = request.request.mode || "form";
  const isFormMode = mode === "form";
  const isUrlMode = mode === "url";

  // Initialize form fields from schema defaults
  useEffect(() => {
    if (!isFormMode || !("requestedSchema" in request.request)) return;
    const schema = request.request.requestedSchema;
    const initial: Record<string, any> = {};
    if (schema?.type === "object" && schema.properties) {
      for (const [fieldName, fieldSchema] of Object.entries(schema.properties)) {
        const field = fieldSchema as any;
        if (field.default !== undefined) {
          initial[fieldName] = field.default;
        } else if (field.type === "array") {
          initial[fieldName] = [];
        } else if (field.type === "boolean") {
          initial[fieldName] = false;
        } else if (field.type === "number" || field.type === "integer") {
          initial[fieldName] = 0;
        } else {
          initial[fieldName] = "";
        }
      }
    }
    setFormData(initial);
  }, [request.id, isFormMode]);

  const handleFieldChange = (fieldName: string, value: any) => {
    setFormData((prev) => ({ ...prev, [fieldName]: value }));
  };

  const handleAccept = () => {
    if (responded) return;
    if (isFormMode) {
      if ("requestedSchema" in request.request) {
        const schema = request.request.requestedSchema;
        if (schema?.required) {
          const missing = (schema.required as string[]).filter(
            (f) => formData[f] === undefined || formData[f] === "" || formData[f] === null
          );
          if (missing.length > 0) {
            toast.error("Missing required fields", {
              description: `Please fill in: ${missing.join(", ")}`,
            });
            return;
          }
        }
      }
      setResponded(true);
      setResponseLabel("accepted");
      onApprove(request.id, { action: "accept", content: formData });
    } else if (isUrlMode) {
      setResponded(true);
      setResponseLabel("accepted");
      onApprove(request.id, { action: "accept" });
    }
  };

  const handleDecline = () => {
    if (responded) return;
    setResponded(true);
    setResponseLabel("declined");
    onApprove(request.id, { action: "decline" });
  };

  const handleCancel = () => {
    if (responded) return;
    setResponded(true);
    setResponseLabel("cancelled");
    onReject(request.id, "User cancelled elicitation request");
  };

  const renderFormFields = useMemo(() => {
    if (!isFormMode || !("requestedSchema" in request.request)) return null;
    const schema = request.request.requestedSchema;
    if (!schema || schema.type !== "object" || !schema.properties) {
      return (
        <p className="text-sm text-muted-foreground">No form schema provided.</p>
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
            <div key={fieldName} className="space-y-1.5">
              {fieldType !== "boolean" && (
                <Label htmlFor={`inline-field-${request.id}-${fieldName}`}>
                  {fieldLabel}
                  {isRequired && <span className="text-red-500 ml-1">*</span>}
                </Label>
              )}
              {fieldDescription && (
                <p className="text-xs text-muted-foreground">{fieldDescription}</p>
              )}
              {fieldType === "boolean" ? (
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id={`inline-field-${request.id}-${fieldName}`}
                    data-testid={`inline-elicitation-field-${fieldName}`}
                    checked={formData[fieldName] || false}
                    onCheckedChange={(checked) => handleFieldChange(fieldName, checked)}
                  />
                  <Label
                    htmlFor={`inline-field-${request.id}-${fieldName}`}
                    className="text-sm font-normal cursor-pointer"
                  >
                    {fieldLabel}
                    {isRequired && <span className="text-red-500 ml-1">*</span>}
                  </Label>
                </div>
              ) : fieldType === "number" || fieldType === "integer" ? (
                <Input
                  id={`inline-field-${request.id}-${fieldName}`}
                  data-testid={`inline-elicitation-field-${fieldName}`}
                  type="number"
                  value={formData[fieldName] ?? ""}
                  onChange={(e) => {
                    const parsed =
                      fieldType === "integer"
                        ? parseInt(e.target.value, 10)
                        : parseFloat(e.target.value);
                    handleFieldChange(fieldName, isNaN(parsed) ? "" : parsed);
                  }}
                  placeholder={field.default?.toString() || ""}
                />
              ) : isSingleSelectChoiceField ? (
                <select
                  id={`inline-field-${request.id}-${fieldName}`}
                  data-testid={`inline-elicitation-field-${fieldName}`}
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
                  id={`inline-field-${request.id}-${fieldName}`}
                  data-testid={`inline-elicitation-field-${fieldName}`}
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
                  data-testid={`inline-elicitation-field-${fieldName}`}
                >
                  {field.items.enum.map((option: string) => {
                    const checkboxId = `inline-field-${request.id}-${fieldName}-${option}`;
                    const checked = selectedMultiValues.includes(option);
                    return (
                      <div key={option} className="flex items-center space-x-2">
                        <Checkbox
                          id={checkboxId}
                          checked={checked}
                          onCheckedChange={(nextChecked) => {
                            const updated = nextChecked
                              ? [...selectedMultiValues, option]
                              : selectedMultiValues.filter((v) => v !== option);
                            handleFieldChange(fieldName, updated);
                          }}
                        />
                        <Label htmlFor={checkboxId} className="text-sm font-normal cursor-pointer">
                          {option}
                        </Label>
                      </div>
                    );
                  })}
                </div>
              ) : isTitledMultiSelectField ? (
                <div
                  className="space-y-2"
                  data-testid={`inline-elicitation-field-${fieldName}`}
                >
                  {multiSelectChoices.map((choice) => {
                    const checkboxId = `inline-field-${request.id}-${fieldName}-${choice.const}`;
                    const checked = selectedMultiValues.includes(choice.const);
                    return (
                      <div key={choice.const} className="flex items-center space-x-2">
                        <Checkbox
                          id={checkboxId}
                          checked={checked}
                          onCheckedChange={(nextChecked) => {
                            const updated = nextChecked
                              ? [...selectedMultiValues, choice.const]
                              : selectedMultiValues.filter((v) => v !== choice.const);
                            handleFieldChange(fieldName, updated);
                          }}
                        />
                        <Label htmlFor={checkboxId} className="text-sm font-normal cursor-pointer">
                          {choice.title || choice.const}
                        </Label>
                      </div>
                    );
                  })}
                </div>
              ) : fieldType === "string" &&
                (field.format === "textarea" || field.maxLength > 100) ? (
                <Textarea
                  id={`inline-field-${request.id}-${fieldName}`}
                  data-testid={`inline-elicitation-field-${fieldName}`}
                  value={formData[fieldName] || ""}
                  onChange={(e) => handleFieldChange(fieldName, e.target.value)}
                  placeholder={field.default || ""}
                  rows={3}
                />
              ) : (
                <Input
                  id={`inline-field-${request.id}-${fieldName}`}
                  data-testid={`inline-elicitation-field-${fieldName}`}
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

  const urlModeUrl =
    isUrlMode && "url" in request.request
      ? (request.request as { url: string }).url
      : null;

  // Collapsed summary after responding
  if (responded) {
    return (
      <div className="rounded-lg border border-dashed bg-muted/30 p-3 text-sm text-muted-foreground max-w-2xl">
        Elicitation {responseLabel} — the tool will continue executing.
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card shadow-sm p-4 space-y-4 max-w-2xl">
      {/* Header */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-medium text-sm text-card-foreground">
          Elicitation Request
        </span>
        <Badge
          variant="outline"
          className={
            isUrlMode
              ? "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30"
              : "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/30"
          }
        >
          {mode}
        </Badge>
        <span className="text-xs text-muted-foreground">{request.serverName}</span>
      </div>

      {/* Server message */}
      <p className="text-sm text-card-foreground">{request.request.message}</p>

      {/* URL mode */}
      {isUrlMode && "url" in request.request && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 p-2 bg-muted rounded border">
            <code className="flex-1 text-xs font-mono break-all">
              {urlModeUrl}
            </code>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                window.open(urlModeUrl ?? "", "_blank");
                setUrlCompleted(true);
              }}
            >
              <ExternalLink className="h-3 w-3 mr-1" />
              Open
            </Button>
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox
              id={`inline-url-done-${request.id}`}
              checked={urlCompleted}
              onCheckedChange={(c) => setUrlCompleted(!!c)}
            />
            <Label
              htmlFor={`inline-url-done-${request.id}`}
              className="text-sm font-normal cursor-pointer"
            >
              I have completed the required action
            </Label>
          </div>
        </div>
      )}

      {/* Form mode */}
      {isFormMode && renderFormFields}

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <Button
          size="sm"
          onClick={handleAccept}
          disabled={isUrlMode && !urlCompleted}
          data-testid="inline-elicitation-accept"
        >
          Accept
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={handleDecline}
          data-testid="inline-elicitation-decline"
        >
          Decline
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={handleCancel}
          data-testid="inline-elicitation-cancel"
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
