import type {
  AskUserAnswer,
  AskUserQuestion,
} from "@/client/components/ui/ask-user-questions";
import type {
  ElicitRequestFormParams,
  ElicitRequestURLParams,
} from "@mcp-use/client/react";
import { getMultiSelectChoices, getSingleSelectChoices } from "./schemaHelpers";

type ElicitParams = ElicitRequestFormParams | ElicitRequestURLParams;

export function elicitationToAskUserQuestions(
  request: ElicitParams
): AskUserQuestion[] {
  if (request.mode === "url" && "url" in request) {
    return [
      {
        id: "__url_confirm__",
        title: "Confirm completion",
        layout: "stacked",
        options: [
          {
            id: "confirmed",
            title: "I've completed the required action",
            description: request.url,
          },
        ],
        skippable: false,
        nextLabel: "Confirm",
      },
    ];
  }

  const schema =
    "requestedSchema" in request ? request.requestedSchema : undefined;
  if (!schema || schema.type !== "object" || !schema.properties) {
    return [
      {
        id: "__freeform__",
        title: "Your response",
        freeText: true,
        freeTextPlaceholder: "Type your response…",
        skippable: false,
      },
    ];
  }

  const properties = schema.properties as Record<
    string,
    Record<string, unknown>
  >;
  const required = (schema.required as string[] | undefined) ?? [];

  return Object.entries(properties).map(([fieldName, fieldSchema]) => {
    const field = fieldSchema;
    const isRequired = required.includes(fieldName);
    const fieldLabel = (field.title as string | undefined) || fieldName;
    const fieldDescription = field.description as string | undefined;
    const fieldType = (field.type as string | undefined) || "string";

    const singleSelectChoices = getSingleSelectChoices(field);
    const multiSelectChoices = getMultiSelectChoices(field);
    const isEnumField = Array.isArray(field.enum);
    const isUntitledMultiSelectField =
      fieldType === "array" &&
      Array.isArray((field.items as { enum?: string[] } | undefined)?.enum);
    const isTitledMultiSelectField =
      fieldType === "array" && multiSelectChoices.length > 0;

    const base: AskUserQuestion = {
      id: fieldName,
      title: fieldLabel,
      skippable: !isRequired,
      layout:
        fieldDescription && fieldDescription.length > 60 ? "stacked" : "inline",
    };

    if (fieldType === "boolean") {
      return {
        ...base,
        options: [
          { id: "true", title: "Yes" },
          { id: "false", title: "No" },
        ],
      };
    }

    if (isTitledMultiSelectField || isUntitledMultiSelectField) {
      const choices = isTitledMultiSelectField
        ? multiSelectChoices
        : ((field.items as { enum: string[] }).enum.map((value) => ({
            const: value,
            title: value,
          })) ?? []);
      return {
        ...base,
        multiSelect: true,
        options: choices.map((choice) => ({
          id: choice.const,
          title: choice.title || choice.const,
        })),
      };
    }

    if (singleSelectChoices.length > 0) {
      return {
        ...base,
        layout: "stacked",
        options: singleSelectChoices.map((choice) => ({
          id: choice.const,
          title: choice.title || choice.const,
        })),
      };
    }

    if (isEnumField) {
      const enumValues = field.enum as string[];
      const enumNames = field.enumNames as string[] | undefined;
      return {
        ...base,
        options: enumValues.map((option, index) => ({
          id: option,
          title: enumNames?.[index] || option,
        })),
      };
    }

    if (fieldType === "number" || fieldType === "integer") {
      return {
        ...base,
        freeText: true,
        freeTextMultiline: false,
        freeTextPlaceholder:
          field.default !== undefined
            ? String(field.default)
            : "Enter a number…",
        freeTextValidate: (value: string) => {
          const trimmed = value.trim();
          if (!trimmed) return isRequired ? "Required" : null;
          const parsed =
            fieldType === "integer"
              ? parseInt(trimmed, 10)
              : parseFloat(trimmed);
          if (Number.isNaN(parsed)) return "Enter a valid number";
          return null;
        },
      };
    }

    if (
      fieldType === "string" &&
      (field.format === "textarea" ||
        ((field.maxLength as number | undefined) ?? 0) > 100)
    ) {
      return {
        ...base,
        freeText: true,
        freeTextPlaceholder:
          (field.default as string | undefined) || "Type your answer…",
      };
    }

    return {
      ...base,
      freeText: true,
      freeTextMultiline: false,
      freeTextPlaceholder:
        field.default !== undefined
          ? String(field.default)
          : "Type your answer…",
      freeTextValidate: (value: string) => {
        const trimmed = value.trim();
        if (!trimmed && isRequired) return "Required";
        return null;
      },
    };
  });
}

export function answersToFormData(
  questions: AskUserQuestion[],
  answers: Record<string, AskUserAnswer>,
  request: ElicitParams
): Record<string, unknown> {
  if (request.mode === "url") {
    return {};
  }

  const schema =
    "requestedSchema" in request ? request.requestedSchema : undefined;
  const properties =
    schema?.type === "object" && schema.properties
      ? (schema.properties as Record<string, Record<string, unknown>>)
      : {};

  const result: Record<string, unknown> = {};

  for (const question of questions) {
    const questionId = question.id ?? "";
    if (questionId === "__freeform__") {
      const text = answers[questionId]?.otherText?.trim();
      if (text) result.response = text;
      continue;
    }

    const answer = answers[questionId];
    if (!answer || answer.skipped) continue;

    const field = properties[questionId];
    const fieldType = (field?.type as string | undefined) || "string";

    if (question.freeText) {
      const text = answer.otherText?.trim() ?? "";
      if (!text) continue;
      result[questionId] =
        fieldType === "number" || fieldType === "integer"
          ? fieldType === "integer"
            ? parseInt(text, 10)
            : parseFloat(text)
          : text;
      continue;
    }

    if (question.multiSelect) {
      result[questionId] = answer.selectedIds;
      continue;
    }

    if (fieldType === "boolean") {
      result[questionId] = answer.selectedIds[0] === "true";
      continue;
    }

    if (answer.selectedIds[0] !== undefined) {
      result[questionId] = answer.selectedIds[0];
    }
  }

  return result;
}

export function getMissingRequiredFromAnswers(
  questions: AskUserQuestion[],
  answers: Record<string, AskUserAnswer>,
  request: ElicitParams
): string[] {
  if (request.mode === "url") return [];

  const schema =
    "requestedSchema" in request ? request.requestedSchema : undefined;
  const required =
    schema?.type === "object"
      ? ((schema.required as string[] | undefined) ?? [])
      : [];

  return required.filter((fieldName) => {
    const answer = answers[fieldName];
    if (!answer || answer.skipped) return true;
    const question = questions.find((q) => q.id === fieldName);
    if (!question) return true;
    if (question.freeText) {
      return !answer.otherText?.trim();
    }
    if (question.multiSelect) {
      return answer.selectedIds.length === 0;
    }
    return answer.selectedIds.length === 0;
  });
}

export function schemaToDefaultAnswers(
  questions: AskUserQuestion[],
  request: ElicitParams
): Record<string, AskUserAnswer> {
  if (request.mode === "url") return {};

  const schema =
    "requestedSchema" in request ? request.requestedSchema : undefined;
  const properties =
    schema?.type === "object" && schema.properties
      ? (schema.properties as Record<string, Record<string, unknown>>)
      : {};

  const defaults: Record<string, AskUserAnswer> = {};

  for (const question of questions) {
    const questionId = question.id;
    if (!questionId || questionId.startsWith("__")) continue;

    const field = properties[questionId];
    if (!field || field.default === undefined) continue;

    if (question.freeText) {
      defaults[questionId] = {
        questionId,
        selectedIds: [],
        otherText: String(field.default),
        skipped: false,
      };
      continue;
    }

    if (question.multiSelect && Array.isArray(field.default)) {
      defaults[questionId] = {
        questionId,
        selectedIds: field.default.map(String),
        skipped: false,
      };
      continue;
    }

    if (field.type === "boolean") {
      defaults[questionId] = {
        questionId,
        selectedIds: [String(field.default)],
        skipped: false,
      };
      continue;
    }

    defaults[questionId] = {
      questionId,
      selectedIds: [String(field.default)],
      skipped: false,
    };
  }

  return defaults;
}
