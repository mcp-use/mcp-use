import { useCallback, useEffect, useState } from "react";
import type { PendingElicitationRequest } from "@/client/types/elicitation";

/**
 * Shared state + lifecycle for elicitation form/url requests.
 *
 * Handles:
 *  - Initializing `formData` from the request's JSON schema defaults.
 *  - Resetting `urlCompleted` when the request changes.
 *  - Validating required fields on submit.
 *
 * Used by both the full-panel (`ElicitationRequestDisplay`) and the
 * inline chat card (`InlineElicitationCard`) variants.
 */
export function useElicitationForm(request: PendingElicitationRequest | null) {
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [urlCompleted, setUrlCompleted] = useState(false);

  const mode = request?.request.mode || "form";
  const isFormMode = mode === "form";
  const isUrlMode = mode === "url";

  useEffect(() => {
    if (request && isFormMode && "requestedSchema" in request.request) {
      const schema = request.request.requestedSchema;
      const initial: Record<string, any> = {};
      if (schema?.type === "object" && schema.properties) {
        for (const [fieldName, fieldSchema] of Object.entries(
          schema.properties
        )) {
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
    }
    setUrlCompleted(false);
  }, [request?.id, isFormMode]);

  const setFieldValue = useCallback((fieldName: string, value: any) => {
    setFormData((prev) => ({ ...prev, [fieldName]: value }));
  }, []);

  const getMissingRequiredFields = useCallback((): string[] => {
    if (!request || !isFormMode || !("requestedSchema" in request.request)) {
      return [];
    }
    const schema = request.request.requestedSchema;
    const required = (schema?.required as string[] | undefined) ?? [];
    return required.filter(
      (f) =>
        formData[f] === undefined || formData[f] === "" || formData[f] === null
    );
  }, [request, formData, isFormMode]);

  return {
    formData,
    setFieldValue,
    getMissingRequiredFields,
    urlCompleted,
    setUrlCompleted,
    mode,
    isFormMode,
    isUrlMode,
  };
}
