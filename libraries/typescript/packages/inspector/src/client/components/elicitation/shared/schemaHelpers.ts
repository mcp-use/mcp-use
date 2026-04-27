export interface EnumChoice {
  const: string;
  title?: string;
}

export function isEnumChoice(value: unknown): value is EnumChoice {
  if (!value || typeof value !== "object") return false;
  const maybeChoice = value as { const?: unknown; title?: unknown };
  return (
    typeof maybeChoice.const === "string" &&
    (maybeChoice.title === undefined || typeof maybeChoice.title === "string")
  );
}

export function getSingleSelectChoices(
  field: Record<string, any>
): EnumChoice[] {
  const oneOf = Array.isArray(field.oneOf)
    ? field.oneOf.filter(isEnumChoice)
    : [];
  const anyOf = Array.isArray(field.anyOf)
    ? field.anyOf.filter(isEnumChoice)
    : [];
  return oneOf.length > 0 ? oneOf : anyOf;
}

export function getMultiSelectChoices(
  field: Record<string, any>
): EnumChoice[] {
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
