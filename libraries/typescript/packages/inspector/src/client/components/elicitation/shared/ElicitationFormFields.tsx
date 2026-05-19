import { useMemo } from "react";
import type { PendingElicitationRequest } from "@/client/types/elicitation";
import { Input } from "@/client/components/ui/input";
import { Label } from "@/client/components/ui/label";
import { Textarea } from "@/client/components/ui/textarea";
import { Checkbox } from "@/client/components/ui/checkbox";
import { getMultiSelectChoices, getSingleSelectChoices } from "./schemaHelpers";

interface ElicitationFormFieldsProps {
  request: PendingElicitationRequest;
  formData: Record<string, any>;
  onFieldChange: (fieldName: string, value: any) => void;
  /** Prefix used for DOM `id` attributes (e.g. `"field"` → `"field-{name}"`). */
  idPrefix: string;
  /** Prefix used for `data-testid` attributes (e.g. `"elicitation-field"`). */
  testIdPrefix: string;
  /** Class for the per-field vertical spacing. */
  fieldContainerClassName?: string;
  /** Row count for textarea fields. */
  textareaRows?: number;
  /** Whether to render the outer label above a boolean field (in addition to the checkbox-adjacent label). */
  showOuterLabelForBoolean?: boolean;
  /** Fallback rendered when the schema is missing or malformed. */
  emptyFallback?: React.ReactNode;
}

export function ElicitationFormFields({
  request,
  formData,
  onFieldChange,
  idPrefix,
  testIdPrefix,
  fieldContainerClassName = "space-y-2",
  textareaRows = 4,
  showOuterLabelForBoolean = true,
  emptyFallback,
}: ElicitationFormFieldsProps) {
  const rendered = useMemo(() => {
    if (!("requestedSchema" in request.request)) return null;

    const schema = request.request.requestedSchema;
    if (!schema || schema.type !== "object" || !schema.properties) {
      return (
        emptyFallback ?? (
          <p className="text-sm text-muted-foreground">
            No form schema available
          </p>
        )
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

          const inputId = `${idPrefix}-${fieldName}`;
          const testId = `${testIdPrefix}-${fieldName}`;
          const showTopLabel =
            fieldType !== "boolean" || showOuterLabelForBoolean;

          return (
            <div key={fieldName} className={fieldContainerClassName}>
              {showTopLabel && (
                <Label htmlFor={inputId}>
                  {fieldLabel}
                  {isRequired && <span className="text-red-500 ml-1">*</span>}
                </Label>
              )}
              {fieldDescription && (
                <p className="text-xs text-muted-foreground">
                  {fieldDescription}
                </p>
              )}

              {fieldType === "boolean" ? (
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id={inputId}
                    data-testid={testId}
                    checked={formData[fieldName] || false}
                    onCheckedChange={(checked) =>
                      onFieldChange(fieldName, checked)
                    }
                  />
                  <Label
                    htmlFor={inputId}
                    className="text-sm font-normal cursor-pointer"
                  >
                    {fieldLabel}
                    {!showOuterLabelForBoolean && isRequired && (
                      <span className="text-red-500 ml-1">*</span>
                    )}
                  </Label>
                </div>
              ) : fieldType === "number" || fieldType === "integer" ? (
                <Input
                  id={inputId}
                  data-testid={testId}
                  type="number"
                  value={formData[fieldName] ?? ""}
                  onChange={(e) => {
                    const parsed =
                      fieldType === "integer"
                        ? parseInt(e.target.value, 10)
                        : parseFloat(e.target.value);
                    onFieldChange(fieldName, isNaN(parsed) ? "" : parsed);
                  }}
                  placeholder={field.default?.toString() || ""}
                />
              ) : isSingleSelectChoiceField ? (
                <select
                  id={inputId}
                  data-testid={testId}
                  value={formData[fieldName] || ""}
                  onChange={(e) => onFieldChange(fieldName, e.target.value)}
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
                  id={inputId}
                  data-testid={testId}
                  value={formData[fieldName] || ""}
                  onChange={(e) => onFieldChange(fieldName, e.target.value)}
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
                <div className="space-y-2" data-testid={testId}>
                  {field.items.enum.map((option: string) => {
                    const checkboxId = `${inputId}-${option}`;
                    const checked = selectedMultiValues.includes(option);
                    return (
                      <div key={option} className="flex items-center space-x-2">
                        <Checkbox
                          id={checkboxId}
                          checked={checked}
                          onCheckedChange={(nextChecked) => {
                            const updated = nextChecked
                              ? [...selectedMultiValues, option]
                              : selectedMultiValues.filter(
                                  (value) => value !== option
                                );
                            onFieldChange(fieldName, updated);
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
                <div className="space-y-2" data-testid={testId}>
                  {multiSelectChoices.map((choice) => {
                    const checkboxId = `${inputId}-${choice.const}`;
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
                            const updated = nextChecked
                              ? [...selectedMultiValues, choice.const]
                              : selectedMultiValues.filter(
                                  (value) => value !== choice.const
                                );
                            onFieldChange(fieldName, updated);
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
                  id={inputId}
                  data-testid={testId}
                  value={formData[fieldName] || ""}
                  onChange={(e) => onFieldChange(fieldName, e.target.value)}
                  placeholder={field.default || ""}
                  rows={textareaRows}
                />
              ) : (
                <Input
                  id={inputId}
                  data-testid={testId}
                  type="text"
                  value={formData[fieldName] || ""}
                  onChange={(e) => onFieldChange(fieldName, e.target.value)}
                  placeholder={field.default || ""}
                />
              )}
            </div>
          );
        })}
      </div>
    );
  }, [
    request,
    formData,
    onFieldChange,
    idPrefix,
    testIdPrefix,
    fieldContainerClassName,
    textareaRows,
    showOuterLabelForBoolean,
    emptyFallback,
  ]);

  return <>{rendered}</>;
}
