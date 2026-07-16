import * as p from "@clack/prompts";

export function isInteractive(): boolean {
  return process.stdin.isTTY === true;
}

function handleCancel<T>(value: T | symbol): T {
  if (p.isCancel(value)) {
    p.cancel("Operation cancelled");
    process.exit(0);
  }
  return value;
}

type PromptTextOptions = {
  defaultValue?: string;
  validate?: (value: string) => string | undefined;
};

export async function promptText(
  message: string,
  options: PromptTextOptions = {}
): Promise<string> {
  const result = await p.text({
    message,
    defaultValue: options.defaultValue,
    placeholder: options.defaultValue,
    validate: options.validate
      ? (value) => options.validate!(value ?? "")
      : undefined,
  });
  return handleCancel(result);
}

export async function promptConfirm(
  message: string,
  initialValue = true
): Promise<boolean> {
  const result = await p.confirm({ message, initialValue });
  return handleCancel(result);
}

type SelectItem = {
  label: string;
  value: string;
};

export async function promptSelect(
  message: string,
  items: SelectItem[],
  defaultIndex = 0
): Promise<string> {
  if (items.length === 0) {
    throw new Error("No items to select");
  }

  const result = await p.select({
    message,
    options: items.map((item) => ({
      value: item.value,
      label: item.label,
    })),
    initialValue: items[defaultIndex]?.value,
  });

  return handleCancel(result);
}

export const spinner = p.spinner;
