/** MCP App starter view — edit this file to build your UI. */
import {
  Image,
  ModelContext,
  ThemeProvider,
  useCallTool,
  useDisplayMode,
  useHostContext,
  useOpenExternal,
  useSendFollowUp,
  useToolContext,
  useViewTheme,
  useViewTool,
} from "mcp-use/react";
import { useState } from "react";
import { z } from "zod";

import {
  CloseIcon,
  ExpandIcon,
  ExternalLinkIcon,
  MonitorIcon,
  MoonIcon,
  PipIcon,
  SmartphoneIcon,
  SunIcon,
} from "./icons.js";
import { HeroMeshOrb } from "./MeshGradient.js";
import { Tooltip } from "./Tooltip.js";
import "./view.css";

export default function McpApp() {
  // useToolContext — tool lifecycle (pending / error / result)
  const view = useToolContext<"show-app">();
  // useHostContext — locale, timezone, platform, capabilities
  const { hostCapabilities, platform, displayMode, locale, timeZone } =
    useHostContext();
  const theme = useViewTheme();
  // useDisplayMode — request pip / fullscreen / inline
  const { availableDisplayModes, requestDisplayMode } = useDisplayMode();
  // useOpenExternal — open URLs via the host
  const openExternal = useOpenExternal();
  // useSendFollowUp — send a prompt back to the host
  const sendFollowUp = useSendFollowUp();
  // useCallTool — invoke server tools from the view
  const sayHello = useCallTool("say-hello");

  const [count, setCount] = useState(0);
  const [highlighted, setHighlighted] = useState(false);

  // useViewTool — register a tool callable from the host
  useViewTool(
    {
      name: "set-counter",
      description: "Set the counter displayed in the MCP App card",
      inputSchema: z.object({
        value: z.number().int().min(0).describe("Counter value to display"),
      }),
    },
    async ({ value }) => {
      setCount(value);
      setHighlighted(true);
      window.setTimeout(() => setHighlighted(false), 1200);
      return { content: [{ type: "text", text: `Counter set to ${value}` }] };
    }
  );

  const isMobile = platform === "mobile";
  const isFullscreen = displayMode === "fullscreen";
  const isPip = displayMode === "pip";
  const pending = view.status === "pending";
  const canOpenExternal = hostCapabilities?.openLinks !== undefined;
  const canSendFollowUp = hostCapabilities?.message !== undefined;
  const callResult = sayHello.data?.structuredContent?.greeting;

  return (
    <ThemeProvider>
      <div
        data-card-shell
        className={
          isFullscreen
            ? "relative flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden rounded-none border-0 bg-white dark:bg-black"
            : `relative overflow-hidden rounded-3xl border border-zinc-200 bg-white dark:border-white/10 dark:bg-black${
                !pending && highlighted
                  ? " ring-2 ring-blue-500 ring-offset-2 dark:ring-offset-black"
                  : ""
              }`
        }
      >
        {!isMobile && <HeroMeshOrb />}
        {!isFullscreen && (
          <div className="absolute inset-x-4 top-4 z-20 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Tooltip label={`MCP Host sending: Theme: ${theme}`} multiline>
                <span
                  className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium tracking-wide text-neutral-500 dark:text-neutral-400"
                  aria-label={`Theme: ${theme}`}
                >
                  {theme === "dark" ? <MoonIcon /> : <SunIcon />}
                </span>
              </Tooltip>
              <Tooltip
                label={`MCP Host sending: Platform: ${isMobile ? "mobile" : "web"}`}
                multiline
              >
                <span
                  className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium tracking-wide text-neutral-500 dark:text-neutral-400"
                  aria-label={`Platform: ${isMobile ? "mobile" : "web"}`}
                >
                  {isMobile ? <SmartphoneIcon /> : <MonitorIcon />}
                </span>
              </Tooltip>
              <Tooltip label={`MCP Host sending: Locale: ${locale}`} multiline>
                <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium tracking-wide text-neutral-500 dark:text-neutral-400">
                  {locale}
                </span>
              </Tooltip>
              <Tooltip
                label={`MCP Host sending: Timezone: ${timeZone}`}
                multiline
              >
                <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium tracking-wide text-neutral-500 dark:text-neutral-400">
                  {timeZone.split("/").pop()?.replace(/_/g, " ") ?? timeZone}
                </span>
              </Tooltip>
            </div>
            <div className="flex items-center gap-2">
              {!isFullscreen && !isPip && (
                <>
                  {availableDisplayModes.includes("pip") && (
                    <Tooltip
                      label="MCP Apps display mode: picture-in-picture"
                      multiline
                    >
                      <button
                        type="button"
                        className="cursor-pointer rounded-full border border-neutral-300 p-2 text-neutral-900 transition-colors hover:bg-neutral-100 dark:border-neutral-600 dark:text-neutral-100 dark:hover:bg-neutral-800"
                        aria-label="Picture-in-picture"
                        onClick={() => void requestDisplayMode({ mode: "pip" })}
                      >
                        <PipIcon />
                      </button>
                    </Tooltip>
                  )}
                  {availableDisplayModes.includes("fullscreen") && (
                    <Tooltip
                      label="MCP Apps display mode: fullscreen"
                      multiline
                    >
                      <button
                        type="button"
                        className="cursor-pointer rounded-full border border-neutral-300 p-2 text-neutral-900 transition-colors hover:bg-neutral-100 dark:border-neutral-600 dark:text-neutral-100 dark:hover:bg-neutral-800"
                        aria-label="Fullscreen"
                        onClick={() =>
                          void requestDisplayMode({ mode: "fullscreen" })
                        }
                      >
                        <ExpandIcon />
                      </button>
                    </Tooltip>
                  )}
                </>
              )}
              {(isFullscreen || isPip) && (
                <Tooltip
                  label="MCP Apps display mode: return to inline"
                  multiline
                >
                  <button
                    type="button"
                    className="cursor-pointer rounded-full border border-neutral-300 p-2 text-neutral-900 transition-colors hover:bg-neutral-100 dark:border-neutral-600 dark:text-neutral-100 dark:hover:bg-neutral-800"
                    aria-label="Exit"
                    onClick={() => void requestDisplayMode({ mode: "inline" })}
                  >
                    <CloseIcon />
                  </button>
                </Tooltip>
              )}
            </div>
          </div>
        )}
        {!isMobile && (
          <button
            type="button"
            className="absolute bottom-6 left-1/2 z-20 flex -translate-x-1/2 cursor-pointer flex-col items-center gap-1 border-0 bg-transparent p-0 text-neutral-900 transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!canOpenExternal}
            title="mcp-use on GitHub"
            onClick={() =>
              void openExternal({ url: "https://github.com/mcp-use/mcp-use" })
            }
          >
            <span className="text-[10px] font-medium tracking-wide uppercase">
              Built with
            </span>
            <Image
              src="/logo-mcp-use.svg"
              alt="mcp-use"
              className="h-[1.4rem] w-auto max-w-[115px] object-contain"
            />
          </button>
        )}
        <div
          className={`relative z-10 flex flex-col items-center text-center ${
            isFullscreen
              ? "min-h-0 flex-1 justify-center overflow-y-auto px-6 py-8"
              : isMobile
                ? "px-6 py-10"
                : "min-h-[400px] px-8 py-8 pb-16 sm:min-h-[440px] sm:px-10 sm:py-10 sm:pb-16"
          }`}
        >
          {view.status === "error" ? (
            <>
              <h1 className="m-0 text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
                Failed to load MCP App
              </h1>
              <p className="mt-4 mb-0 text-sm text-neutral-600 dark:text-neutral-400">
                {view.error.message}
              </p>
            </>
          ) : (
            <>
              {/* ModelContext — push state the host model can read */}
              {!pending && (
                <ModelContext content={`MCP App counter: ${count}`} />
              )}
              <div
                className={`relative z-10 mb-0 flex flex-col items-center gap-3 ${isMobile ? "mt-10" : "mt-3"}`}
              >
                {pending ? (
                  <span
                    aria-hidden
                    className="inline-block h-7 w-[4.75rem] animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-800"
                  />
                ) : (
                  <button
                    type="button"
                    className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-neutral-300 bg-transparent px-3 py-1 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-800"
                    disabled={!canOpenExternal}
                    onClick={() =>
                      void openExternal({
                        url: "https://mcp-use.com/docs/typescript",
                      })
                    }
                  >
                    Docs
                    <ExternalLinkIcon />
                  </button>
                )}
                <h1
                  className={`hero-title relative z-10 mx-auto mb-0 max-w-md text-center font-medium leading-tight text-neutral-900 dark:text-neutral-100 ${
                    isMobile ? "text-2xl" : "text-4xl sm:text-5xl"
                  }`}
                >
                  {pending ? (
                    <span className="inline-block animate-pulse rounded-sm text-transparent select-none bg-zinc-200 dark:bg-zinc-800">
                      {view.toolInput?.appName?.trim() || "MCP App"}
                    </span>
                  ) : (
                    view.toolInput?.appName?.trim() || "MCP App"
                  )}
                </h1>
              </div>
              <p
                className={`relative z-10 mx-auto mt-4 mb-6 max-w-md text-center leading-relaxed text-neutral-600 dark:text-neutral-400 ${isMobile ? "text-sm" : "text-base"}`}
              >
                {pending ? (
                  <span className="inline-block animate-pulse rounded-sm text-transparent select-none bg-zinc-200 dark:bg-zinc-800">
                    Get started by editing{" "}
                    <code className="inline-flex align-middle rounded-md bg-zinc-100 px-1.5 py-0.5 font-mono text-[13px] leading-none text-transparent dark:bg-zinc-800">
                      views/my-view/view.tsx
                    </code>
                  </span>
                ) : (
                  <>
                    Get started by editing{" "}
                    <code className="inline-flex align-middle rounded-md bg-zinc-100 px-1.5 py-0.5 font-mono text-[13px] leading-none text-neutral-700 dark:bg-zinc-800 dark:text-neutral-200">
                      views/my-view/view.tsx
                    </code>
                  </>
                )}
              </p>
              <div
                className={`relative z-10 flex w-full flex-wrap items-center justify-center ${isMobile ? "gap-1.5" : "gap-2"}`}
              >
                <Tooltip
                  label="Widget state: updates UI and Model Context for the host"
                  multiline
                >
                  <button
                    type="button"
                    disabled={pending}
                    aria-hidden={pending}
                    tabIndex={pending ? -1 : 0}
                    className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-black font-normal text-white transition-colors hover:bg-black/90 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-white/90 ${
                      isMobile ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm"
                    } ${pending ? "animate-pulse opacity-70" : ""}`}
                    onClick={() => setCount((c) => c + 1)}
                  >
                    <span className={pending ? "text-transparent" : undefined}>
                      Update State
                    </span>
                    <span
                      className={`rounded-full border tabular-nums ${
                        isMobile
                          ? "px-1 py-0.5 text-[10px]"
                          : "px-1.5 py-0.5 text-xs"
                      } border-white/35 dark:border-black/25 ${pending ? "text-transparent" : ""}`}
                    >
                      {count}
                    </span>
                  </button>
                </Tooltip>
                <Tooltip
                  label="In-app tool calls: invoke MCP tools from the view"
                  multiline
                >
                  <button
                    type="button"
                    disabled={pending || sayHello.isPending}
                    aria-hidden={pending}
                    tabIndex={pending ? -1 : 0}
                    className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-neutral-300 bg-transparent font-normal text-neutral-900 transition-colors hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-600 dark:text-neutral-100 dark:hover:bg-neutral-800 ${
                      isMobile ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm"
                    } ${pending ? "animate-pulse opacity-70" : ""}`}
                    onClick={() => void sayHello.callTool({ name: "mcp-use" })}
                  >
                    <span className={pending ? "text-transparent" : undefined}>
                      {sayHello.isPending ? "Saying…" : "Say Hello"}
                    </span>
                  </button>
                </Tooltip>
                <Tooltip
                  label="Follow-up messages: send a prompt back to the MCP host"
                  multiline
                >
                  <button
                    type="button"
                    disabled={pending || !canSendFollowUp}
                    aria-hidden={pending}
                    tabIndex={pending ? -1 : 0}
                    className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-neutral-300 bg-transparent font-normal text-neutral-900 transition-colors hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-600 dark:text-neutral-100 dark:hover:bg-neutral-800 ${
                      isMobile ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm"
                    } ${pending ? "animate-pulse opacity-70" : ""}`}
                    onClick={() =>
                      void sendFollowUp({
                        prompt:
                          "Tell me more about MCP Apps and views in mcp-use",
                      }).catch(() => {})
                    }
                  >
                    <span className={pending ? "text-transparent" : undefined}>
                      Send Followup
                    </span>
                  </button>
                </Tooltip>
              </div>
              {!pending && callResult !== undefined && (
                <p className="mx-auto mt-4 mb-0 text-center text-sm text-neutral-600 dark:text-neutral-400">
                  Tool Response: {callResult}
                </p>
              )}
              {!pending && sayHello.error !== undefined && (
                <p className="mt-4 mb-0 text-sm text-red-500" role="alert">
                  {sayHello.error.message}
                </p>
              )}
            </>
          )}
        </div>
        {isMobile && !isFullscreen && (
          <div className="relative w-full">
            <HeroMeshOrb flow />
            <button
              type="button"
              className="absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 cursor-pointer flex-col items-center gap-1 border-0 bg-transparent p-0 text-neutral-900 transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!canOpenExternal}
              title="mcp-use on GitHub"
              onClick={() =>
                void openExternal({ url: "https://github.com/mcp-use/mcp-use" })
              }
            >
              <span className="text-[10px] font-medium tracking-wide uppercase">
                Built with
              </span>
              <Image
                src="/logo-mcp-use.svg"
                alt="mcp-use"
                className="h-[1.15rem] w-auto max-w-[98px] object-contain"
              />
            </button>
          </div>
        )}
      </div>
    </ThemeProvider>
  );
}
