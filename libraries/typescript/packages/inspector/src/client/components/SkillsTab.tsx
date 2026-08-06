import type { Skill, SkillGetResult } from "@mcp-use/client/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  File,
  FileCode2,
  Folder,
  FolderOpen,
  LibraryBig,
  ShieldAlert,
} from "lucide-react";
import { parseDocument } from "yaml";
import { MarkdownRenderer } from "./shared/MarkdownRenderer";
import { InspectorScrollArea, SearchTabHeader } from "./shared";
import { Button, buttonToolbarClass } from "./ui/button";
import { Badge } from "./ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "./ui/resizable";
import { copyToClipboard } from "@/client/utils/browser";

type ResourceContent = {
  uri: string;
  mimeType?: string;
  text?: string;
  blob?: string;
};

type LoadedResource = ResourceContent & {
  digest: string;
  digestValid: boolean;
  frontmatterValid?: boolean;
};

interface SkillsTabProps {
  skills: Skill[];
  getSkill: (uri: string) => Promise<SkillGetResult>;
  readResource: (uri: string) => Promise<{ contents: ResourceContent[] }>;
  refreshSkills?: () => Promise<void>;
}

function bytesOf(content: ResourceContent): Uint8Array {
  if (content.text !== undefined) return new TextEncoder().encode(content.text);
  const binary = atob(content.blob ?? "");
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function arrayBufferOf(content: ResourceContent): ArrayBuffer {
  const bytes = bytesOf(content);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function sha256(content: ResourceContent): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", arrayBufferOf(content));
  return `sha256:${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

function parseFrontmatter(source: string): Record<string, unknown> | null {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match?.[1]) return null;
  const document = parseDocument(match[1]);
  if (document.errors.length > 0) return null;
  const value = document.toJS();
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function equalJson(left: unknown, right: unknown): boolean {
  const normalize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, item]) => [key, normalize(item)])
      );
    }
    return value;
  };
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

function displayName(skill: Skill): string {
  return typeof skill.frontmatter.name === "string"
    ? skill.frontmatter.name
    : skill.uri;
}

function resourcePath(skill: Skill, uri: string): string {
  const root = skill.uri.slice(0, skill.uri.lastIndexOf("/") + 1);
  return uri.startsWith(root)
    ? decodeURIComponent(uri.slice(root.length))
    : uri;
}

type TreeNode = {
  name: string;
  path: string;
  resource?: NonNullable<Skill["resources"]>[number];
  children: Map<string, TreeNode>;
};

function resourceTree(skill: Skill): TreeNode[] {
  const roots = new Map<string, TreeNode>();
  for (const resource of skill.resources ?? []) {
    const segments = resourcePath(skill, resource.uri).split("/");
    let children = roots;
    let currentPath = "";
    segments.forEach((name, index) => {
      currentPath = currentPath ? `${currentPath}/${name}` : name;
      let node = children.get(name);
      if (!node) {
        node = { name, path: currentPath, children: new Map() };
        children.set(name, node);
      }
      if (index === segments.length - 1) node.resource = resource;
      children = node.children;
    });
  }
  const normalize = (nodes: Iterable<TreeNode>): TreeNode[] =>
    [...nodes]
      .sort((left, right) => {
        const leftDirectory = left.children.size > 0 && !left.resource;
        const rightDirectory = right.children.size > 0 && !right.resource;
        if (leftDirectory !== rightDirectory) return leftDirectory ? -1 : 1;
        return left.name.localeCompare(right.name);
      })
      .map((node) => ({
        ...node,
        children: new Map(
          normalize(node.children.values()).map((child) => [child.name, child])
        ),
      }));
  return normalize(roots.values());
}

export function SkillsTab({
  skills,
  getSkill,
  readResource,
  refreshSkills,
}: SkillsTabProps) {
  const [query, setQuery] = useState("");
  const [isSearchExpanded, setIsSearchExpanded] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [expandedDirectories, setExpandedDirectories] = useState<Set<string>>(
    new Set()
  );
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [selectedUri, setSelectedUri] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<LoadedResource | null>(null);
  const [formattedMode, setFormattedMode] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [validation, setValidation] = useState<{
    running: boolean;
    checked: number;
    errors: string[];
  } | null>(null);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return skills;
    return skills.filter((skill) =>
      [displayName(skill), skill.frontmatter.description, skill.uri]
        .join(" ")
        .toLowerCase()
        .includes(needle)
    );
  }, [query, skills]);

  useEffect(() => {
    if (isSearchExpanded) searchInputRef.current?.focus();
  }, [isSearchExpanded]);

  const handleSearchBlur = useCallback(() => {
    if (!query) setIsSearchExpanded(false);
  }, [query]);

  const handleRefresh = useCallback(async () => {
    if (!refreshSkills) return;
    setRefreshing(true);
    try {
      await refreshSkills();
    } finally {
      setRefreshing(false);
    }
  }, [refreshSkills]);

  const load = async (catalogSkill: Skill, uri = catalogSkill.uri) => {
    setLoading(true);
    setError(null);
    setFormattedMode(true);
    try {
      const current = (await getSkill(catalogSkill.uri)).skill;
      const manifest = current.resources ?? [];
      const expected = manifest.find((item) => item.uri === uri)?.digest;
      if (!expected)
        throw new Error(`Resource is missing from the skill manifest: ${uri}`);
      const result = await readResource(uri);
      const content = result.contents[0];
      if (!content || content.uri !== uri) {
        throw new Error("resources/read returned an unexpected resource");
      }
      const actual = await sha256(content);
      const isRoot = uri === current.uri;
      const parsed =
        isRoot && content.text ? parseFrontmatter(content.text) : null;
      setSelectedSkill(current);
      setSelectedUri(uri);
      setLoaded({
        ...content,
        digest: actual,
        digestValid: actual === expected,
        ...(isRoot && {
          frontmatterValid:
            parsed !== null && equalJson(parsed, current.frontmatter),
        }),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setLoaded(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!selectedSkill) return;
    const current = skills.find((skill) => skill.uri === selectedSkill.uri);
    if (!current) {
      setSelectedSkill(null);
      setSelectedUri(null);
      setLoaded(null);
      setError(null);
      return;
    }
    void load(current, selectedUri ?? current.uri);
    // A new skills catalog is the HMR boundary. Selection changes call load()
    // directly and must not create a second request loop here.
  }, [skills]);

  const download = () => {
    if (!loaded) return;
    const blob = new Blob([arrayBufferOf(loaded)], {
      type: loaded.mimeType ?? "application/octet-stream",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = selectedUri?.split("/").pop() || "skill-resource";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const validateAll = async () => {
    setValidation({ running: true, checked: 0, errors: [] });
    const errors: string[] = [];
    let checked = 0;
    for (const catalogSkill of skills) {
      try {
        const skill = (await getSkill(catalogSkill.uri)).skill;
        if (!skill.resources) {
          errors.push(
            `${displayName(skill)}: missing complete resource manifest`
          );
          continue;
        }
        for (const resource of skill.resources) {
          try {
            const response = await readResource(resource.uri);
            const content = response.contents[0];
            if (
              !content ||
              response.contents.length !== 1 ||
              content.uri !== resource.uri
            ) {
              throw new Error("unexpected resources/read response");
            }
            if ((await sha256(content)) !== resource.digest) {
              throw new Error("digest mismatch");
            }
            if (resource.uri === skill.uri) {
              const parsed = content.text
                ? parseFrontmatter(content.text)
                : null;
              if (!parsed || !equalJson(parsed, skill.frontmatter)) {
                throw new Error("frontmatter mismatch");
              }
            }
            checked += 1;
          } catch (cause) {
            errors.push(
              `${resource.uri}: ${cause instanceof Error ? cause.message : String(cause)}`
            );
          }
        }
      } catch (cause) {
        errors.push(
          `${catalogSkill.uri}: ${cause instanceof Error ? cause.message : String(cause)}`
        );
      }
    }
    setValidation({ running: false, checked, errors });
  };

  const renderNodes = (
    skill: Skill,
    nodes: TreeNode[],
    depth = 0
  ): ReactNode[] =>
    nodes.flatMap((node) => {
      const directory = node.children.size > 0 && !node.resource;
      const key = `${skill.uri}::${node.path}`;
      const open = expandedDirectories.has(key);
      const row = directory ? (
        <button
          key={key}
          type="button"
          className="w-full flex items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
          style={{ paddingLeft: `${8 + depth * 12}px` }}
          onClick={() =>
            setExpandedDirectories((previous) => {
              const next = new Set(previous);
              if (next.has(key)) next.delete(key);
              else next.add(key);
              return next;
            })
          }
        >
          {open ? (
            <ChevronDown className="size-3.5" />
          ) : (
            <ChevronRight className="size-3.5" />
          )}
          {open ? (
            <FolderOpen className="size-3.5 text-amber-500" />
          ) : (
            <Folder className="size-3.5 text-amber-500" />
          )}
          <span className="truncate">{node.name}</span>
        </button>
      ) : (
        <button
          key={node.resource?.uri ?? key}
          type="button"
          title={node.resource?.uri}
          className={`w-full flex items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted ${selectedUri === node.resource?.uri ? "bg-muted" : ""}`}
          style={{ paddingLeft: `${22 + depth * 12}px` }}
          onClick={() => node.resource && void load(skill, node.resource.uri)}
        >
          {node.name === "SKILL.md" ? (
            <FileCode2 className="size-3.5" />
          ) : (
            <File className="size-3.5" />
          )}
          <span className="truncate">{node.name}</span>
        </button>
      );
      return [
        row,
        ...(directory && open
          ? renderNodes(skill, [...node.children.values()], depth + 1)
          : []),
      ];
    });

  return (
    <ResizablePanelGroup orientation="horizontal" className="h-full">
      <ResizablePanel defaultSize="33%">
        <div className="flex h-full flex-col overflow-hidden border-r dark:border-zinc-700">
          <InspectorScrollArea>
            {(isScrolled) => (
              <>
                <SearchTabHeader
                  isScrolled={isScrolled}
                  title="Skills"
                  icon={LibraryBig}
                  count={filtered.length}
                  isSearchExpanded={isSearchExpanded}
                  searchQuery={query}
                  searchPlaceholder="Search skills..."
                  onSearchExpand={() => setIsSearchExpanded(true)}
                  onSearchChange={setQuery}
                  onSearchBlur={handleSearchBlur}
                  searchInputRef={
                    searchInputRef as React.RefObject<HTMLInputElement>
                  }
                  onRefresh={refreshSkills ? handleRefresh : undefined}
                  isRefreshing={refreshing}
                />
                <div className="p-2 flex-1">
                  {filtered.length === 0 ? (
                    <div className="text-sm text-muted-foreground p-6 text-center">
                      No skills available
                    </div>
                  ) : (
                    filtered.map((skill) => {
                      const open = expanded.has(skill.uri);
                      return (
                        <div key={skill.uri} className="mb-1">
                          <button
                            type="button"
                            className="w-full flex items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-muted"
                            onClick={() => {
                              setExpanded((previous) => {
                                const next = new Set(previous);
                                if (next.has(skill.uri)) next.delete(skill.uri);
                                else next.add(skill.uri);
                                return next;
                              });
                              void load(skill);
                            }}
                          >
                            {open ? (
                              <ChevronDown className="size-4" />
                            ) : (
                              <ChevronRight className="size-4" />
                            )}
                            {open ? (
                              <FolderOpen className="size-4 text-amber-500" />
                            ) : (
                              <Folder className="size-4 text-amber-500" />
                            )}
                            <span className="truncate font-medium text-sm">
                              {displayName(skill)}
                            </span>
                          </button>
                          {open && (
                            <div className="ml-7 border-l pl-2">
                              {renderNodes(skill, resourceTree(skill))}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </>
            )}
          </InspectorScrollArea>
        </div>
      </ResizablePanel>

      <ResizableHandle />

      <ResizablePanel defaultSize="67%">
        <ResizablePanelGroup orientation="vertical">
          <ResizablePanel defaultSize="38%" minSize="180px" collapsible>
            <div className="flex h-full flex-col bg-white dark:bg-zinc-900 @container/skill-detail">
              {!selectedSkill ? (
                <div className="flex h-full flex-col items-center justify-center p-4 text-center">
                  <p className="mb-2 text-gray-500 dark:text-gray-400">
                    Select a skill to get started
                  </p>
                  <p className="text-xs text-gray-400 dark:text-gray-500">
                    Choose a skill from the list to inspect its files
                  </p>
                </div>
              ) : (
                <>
                  <div className="shrink-0 p-3 pt-3 pb-2 sm:p-5 sm:pt-4 sm:pr-4 sm:pb-2">
                    <div className="flex flex-row items-center justify-between gap-2">
                      <h3 className="truncate text-base font-semibold sm:text-lg">
                        {displayName(selectedSkill)}
                      </h3>
                      <div className="flex shrink-0 gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className={buttonToolbarClass}
                          disabled={!loaded}
                          onClick={download}
                        >
                          Download
                        </Button>
                        <Button
                          size="sm"
                          className={buttonToolbarClass}
                          disabled={skills.length === 0 || validation?.running}
                          onClick={() => void validateAll()}
                        >
                          {validation?.running ? "Validating…" : "Validate all"}
                        </Button>
                      </div>
                    </div>
                    <div className="mt-1 flex min-w-0 items-center gap-1">
                      <span className="truncate font-mono text-xs text-muted-foreground">
                        {selectedUri}
                      </span>
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 shrink-0 p-0"
                              aria-label="Copy skill URI"
                              onClick={() =>
                                selectedUri && void copyToClipboard(selectedUri)
                              }
                            >
                              <Copy className="size-3.5" />
                            </Button>
                          }
                          nativeButton
                        />
                        <TooltipContent>Copy URI</TooltipContent>
                      </Tooltip>
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto px-3 pb-4 pr-3 sm:px-5">
                    {typeof selectedSkill.frontmatter.description ===
                      "string" && (
                      <p className="mb-4 text-sm leading-relaxed text-gray-600 dark:text-gray-400">
                        {selectedSkill.frontmatter.description}
                      </p>
                    )}
                    {validation && !validation.running && (
                      <p
                        className={`mb-3 text-xs ${validation.errors.length > 0 ? "text-destructive" : "text-emerald-600"}`}
                      >
                        {validation.errors.length > 0
                          ? `${validation.errors.length} validation issue${validation.errors.length === 1 ? "" : "s"}`
                          : `${validation.checked} files verified`}
                      </p>
                    )}
                    {validation && validation.errors.length > 0 && (
                      <details className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
                        <summary className="cursor-pointer font-medium text-destructive">
                          Validation details
                        </summary>
                        <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-destructive">
                          {validation.errors.map((item) => (
                            <li key={item} className="break-all">
                              {item}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                </>
              )}
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel defaultSize="62%">
            <div className="relative flex h-full flex-col bg-white dark:bg-black">
              <div className="flex shrink-0 items-center gap-2 border-b border-gray-200 bg-white/50 px-4 pt-2 pb-2 backdrop-blur-xs dark:border-zinc-600 dark:bg-black/50">
                <h3 className="hidden text-sm font-medium sm:block">Content</h3>
                {loaded && (
                  <div className="flex items-center gap-2 sm:ml-4">
                    <button
                      type="button"
                      onClick={() => setFormattedMode(true)}
                      className={`text-xs font-medium ${
                        formattedMode
                          ? "text-black dark:text-white"
                          : "text-zinc-500 dark:text-zinc-400"
                      }`}
                    >
                      Formatted
                    </button>
                    <span className="text-xs text-zinc-400">|</span>
                    <button
                      type="button"
                      onClick={() => setFormattedMode(false)}
                      className={`text-xs font-medium ${
                        !formattedMode
                          ? "text-black dark:text-white"
                          : "text-zinc-500 dark:text-zinc-400"
                      }`}
                    >
                      Raw
                    </button>
                  </div>
                )}
                {loaded && (
                  <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
                    <Badge
                      variant={loaded.digestValid ? "secondary" : "destructive"}
                    >
                      {loaded.digestValid ? (
                        <CheckCircle2 className="mr-1 size-3" />
                      ) : (
                        <ShieldAlert className="mr-1 size-3" />
                      )}
                      {loaded.digestValid
                        ? "Digest verified"
                        : "Digest mismatch"}
                    </Badge>
                    {loaded.frontmatterValid !== undefined && (
                      <Badge
                        variant={
                          loaded.frontmatterValid ? "secondary" : "destructive"
                        }
                      >
                        {loaded.frontmatterValid
                          ? "Frontmatter verified"
                          : "Frontmatter mismatch"}
                      </Badge>
                    )}
                    <Badge variant="outline">
                      {loaded.mimeType ?? "application/octet-stream"}
                    </Badge>
                  </div>
                )}
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto">
                {loading ? (
                  <div className="px-4 pt-4 text-sm text-muted-foreground">
                    Reading and verifying resource…
                  </div>
                ) : error ? (
                  <div className="m-4 rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
                    {error}
                  </div>
                ) : !loaded || !selectedSkill ? (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                    No content yet
                  </div>
                ) : !loaded.digestValid ? (
                  <div className="m-4 rounded-lg border border-destructive/40 p-6 text-sm text-destructive">
                    Preview blocked because the resource bytes do not match the
                    advertised digest.
                  </div>
                ) : !formattedMode ? (
                  <pre className="min-h-full p-4 font-mono text-xs whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                    {loaded.text ?? loaded.blob ?? ""}
                  </pre>
                ) : loaded.text !== undefined ? (
                  loaded.mimeType === "text/markdown" ? (
                    <article className="w-full p-4 sm:p-5">
                      <MarkdownRenderer
                        content={
                          selectedUri === selectedSkill.uri
                            ? loaded.text.replace(
                                /^---\r?\n[\s\S]*?\r?\n---\r?\n?/,
                                ""
                              )
                            : loaded.text
                        }
                      />
                    </article>
                  ) : (
                    <pre className="min-h-full p-4 font-mono text-xs whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                      {loaded.text}
                    </pre>
                  )
                ) : loaded.blob &&
                  loaded.mimeType?.startsWith("image/") &&
                  loaded.mimeType !== "image/svg+xml" ? (
                  <div className="flex min-h-full w-full items-start justify-center p-4">
                    <img
                      className="max-h-full max-w-full object-contain"
                      src={`data:${loaded.mimeType};base64,${loaded.blob}`}
                      alt="Skill resource preview"
                    />
                  </div>
                ) : loaded.blob && loaded.mimeType?.startsWith("audio/") ? (
                  <div className="w-full p-4">
                    <audio
                      controls
                      className="w-full"
                      src={`data:${loaded.mimeType};base64,${loaded.blob}`}
                    />
                  </div>
                ) : loaded.blob && loaded.mimeType?.startsWith("video/") ? (
                  <div className="flex min-h-full w-full items-start justify-center p-4">
                    <video
                      controls
                      className="max-h-full max-w-full"
                      src={`data:${loaded.mimeType};base64,${loaded.blob}`}
                    />
                  </div>
                ) : (
                  <div className="m-4 rounded-lg border p-6 text-sm text-muted-foreground">
                    Binary preview is disabled for this media type. Download the
                    verified file to inspect it.
                  </div>
                )}
              </div>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
