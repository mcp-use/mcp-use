/**
 * The page a browser sees at the MCP URL. Edit it freely, or delete it to
 * fall back to the built-in page. Styled with Tailwind classes.
 */
import { useState, type ReactNode } from "react";
import {
  useInstallTargets,
  useServerInfo,
  useToolList,
  type InstallTargets,
} from "mcp-use/landing";

// Optional: `export const metadata = { title: "...", description: "..." };`
// sets the page title and social preview tags.

type InstallTarget = InstallTargets[keyof InstallTargets];

// Layered radial gradients behind the header card.
const heroGradient = [
  "radial-gradient(at 12% 18%, #c7d7fe 0, transparent 55%)",
  "radial-gradient(at 88% 22%, #f4fca0 0, transparent 50%)",
  "radial-gradient(at 70% 100%, #d4d4d8 0, transparent 55%)",
  "radial-gradient(at 20% 95%, #e0eaff 0, transparent 50%)",
].join(", ");

export default function Landing() {
  const { name, title, version, description, url, iconUrl } = useServerInfo();
  const install = useInstallTargets();

  return (
    <div className="min-h-screen bg-[#fdfcfc] text-slate-800">
      <div className="mx-auto max-w-3xl border-x border-black/[0.08]">
        <header className="p-6" style={{ backgroundImage: heroGradient }}>
          <div className="border border-black/[0.06] bg-white/80 px-6 py-8 text-center backdrop-blur-md">
            {iconUrl && (
              <img
                src={iconUrl}
                alt=""
                width={64}
                height={64}
                className="mx-auto mb-3 size-16 rounded-2xl object-contain"
              />
            )}
            <h1 className="text-3xl font-bold text-[#172037]">
              {title ?? name}{" "}
              <span className="text-base font-medium text-slate-500">
                (v{version})
              </span>
            </h1>
            {description && (
              <p className="mx-auto mt-2 max-w-xl text-[#172037]/80">
                {description}
              </p>
            )}
            <div className="mx-auto mt-6 flex w-fit max-w-full items-center gap-2 rounded-full border border-black/[0.12] bg-white py-2 pr-2 pl-4">
              <code className="truncate font-mono text-sm text-slate-600">
                {url}
              </code>
              <CopyButton text={url} label="Copy URL" />
            </div>
            <a
              href={install.inspector.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-6 inline-block rounded-full bg-linear-to-b from-slate-800 to-slate-900 px-5 py-2.5 text-[15px] font-semibold text-white shadow-md hover:from-slate-700 hover:to-slate-800"
            >
              Open in Inspector
            </a>
          </div>
        </header>

        <Section
          title="Installation Guide"
          subtitle="Choose your preferred MCP client"
        >
          <InstallTabs targets={Object.values(install)} />
        </Section>

        <Tools />

        <footer className="border-t border-black/[0.08] py-10 text-center text-sm text-slate-500">
          Powered by{" "}
          <a
            href="https://github.com/mcp-use/mcp-use"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-slate-900 hover:underline"
          >
            mcp-use
          </a>
        </footer>
      </div>
    </div>
  );
}

function Section(props: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section className="border-t border-black/[0.08] bg-white px-6 py-8">
      <h2 className="text-xl font-semibold text-[#172037]">{props.title}</h2>
      {props.subtitle && (
        <p className="mt-1 text-sm text-[#172037]/80">{props.subtitle}</p>
      )}
      <div className="mt-6">{props.children}</div>
    </section>
  );
}

/** One tab per client; the panel's shape depends on what the target holds. */
function InstallTabs({ targets }: { targets: InstallTarget[] }) {
  const [active, setActive] = useState(targets[0].label);
  const target = targets.find((t) => t.label === active) ?? targets[0];

  return (
    <div>
      <div
        role="tablist"
        className="flex flex-wrap gap-0.5 rounded-lg bg-[#172037]/5 p-[3px]"
      >
        {targets.map(({ label }) => (
          <button
            key={label}
            type="button"
            role="tab"
            aria-selected={label === active}
            onClick={() => setActive(label)}
            className={`min-w-20 flex-1 rounded-md border px-3 py-2 text-[13px] font-medium ${
              label === active
                ? "border-black/10 bg-white text-[#172037] shadow-sm"
                : "border-transparent text-slate-500 hover:bg-white/60 hover:text-[#172037]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div role="tabpanel" className="mt-6 text-slate-600">
        {"command" in target && (
          <>
            <p>Run this command in your terminal:</p>
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-black/[0.08] bg-slate-50 py-1.5 pr-1.5 pl-3">
              <pre className="flex-1 overflow-x-auto font-mono text-sm">
                {target.command}
              </pre>
              <CopyButton text={target.command} label="Copy command" />
            </div>
          </>
        )}
        {"deeplink" in target && (
          <>
            <p>Add this server to {target.label} in one click:</p>
            <InstallLink href={target.deeplink}>
              Open in {target.label}
            </InstallLink>
            <p className="mt-3 text-sm">
              Or add it manually: Settings → MCP → Add server
            </p>
          </>
        )}
        {"steps" in target && (
          <ol className="list-decimal space-y-2 pl-5">
            {target.steps.map((step) => {
              const [heading, ...rest] = step.split(": ");
              return (
                <li key={step}>
                  <strong className="text-[#172037]">{heading}:</strong>{" "}
                  {rest.join(": ")}
                </li>
              );
            })}
          </ol>
        )}
        {"url" in target && (
          <>
            <p>Chat with this server and try its tools in the browser:</p>
            <InstallLink href={target.url} external>
              Open {target.label}
            </InstallLink>
          </>
        )}
      </div>
    </div>
  );
}

function InstallLink(props: {
  href: string;
  external?: boolean;
  children: ReactNode;
}) {
  return (
    <a
      href={props.href}
      {...(props.external && { target: "_blank", rel: "noopener noreferrer" })}
      className="mt-3 inline-block rounded-full bg-slate-900 px-3.5 py-1.5 text-[13px] font-medium text-white hover:bg-slate-800"
    >
      {props.children}
    </a>
  );
}

/** Registered tools. Reading the list is what ships it to the page. */
function Tools() {
  const tools = useToolList();
  if (tools.length === 0) return null;

  return (
    <Section title={`Tools (${tools.length})`}>
      <ul className="divide-y divide-slate-100">
        {tools.map((tool) => (
          <li key={tool.name} className="py-3 first:pt-0 last:pb-0">
            <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[13px]">
              {tool.title ?? tool.name}
            </code>
            {tool.description && (
              <p className="mt-2 text-sm text-slate-500">{tool.description}</p>
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // The clipboard needs a secure context (https or localhost).
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={label}
      className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
