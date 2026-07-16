import { CopyButton } from "./CopyButton";

function formatTokenLabel(count: number, direction: "in" | "out"): string {
  const noun = count === 1 ? "token" : "tokens";
  return `${count.toLocaleString()} ${noun} ${direction}`;
}

export function MessageMetaActions({
  variant,
  copyText,
  inputTokens,
  outputTokens,
}: {
  variant: "user" | "assistant";
  copyText?: string;
  inputTokens?: number;
  outputTokens?: number;
}) {
  const hasCopy = Boolean(copyText);
  const tokenLabel =
    variant === "user" && inputTokens != null
      ? formatTokenLabel(inputTokens, "in")
      : variant === "assistant" && outputTokens != null
        ? formatTokenLabel(outputTokens, "out")
        : null;

  if (!hasCopy && !tokenLabel) return null;

  const copy = hasCopy ? <CopyButton text={copyText!} /> : null;
  const tokens = tokenLabel ? (
    <span
      className="tabular-nums"
      title={variant === "user" ? "Input tokens" : "Output tokens"}
      data-testid={
        variant === "user" ? "message-input-tokens" : "message-output-tokens"
      }
    >
      {tokenLabel}
    </span>
  ) : null;

  if (variant === "user") {
    return (
      <>
        {tokens}
        {copy}
      </>
    );
  }

  return (
    <>
      {copy}
      {tokens}
    </>
  );
}
