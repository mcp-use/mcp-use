import type { Skill } from "@mcp-use/client/react";
import { LibraryBig, Plus, X } from "lucide-react";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";

/** Optional host-controlled skill selection; omitted for automatic discovery. */
export interface ChatSkillSelection {
  enabledUris: ReadonlySet<string>;
  onChange: (enabledUris: Set<string>) => void;
  disabled?: boolean;
  maxSelected?: number;
}

function nameOf(skill: Skill): string {
  return typeof skill.frontmatter.name === "string"
    ? skill.frontmatter.name
    : skill.uri;
}

export function SkillContextChips({
  skills,
  enabledUris,
  onChange,
  disabled = false,
  maxSelected = 8,
}: ChatSkillSelection & { skills: Skill[] }) {
  if (skills.length === 0) return null;
  const enabled = skills.filter((skill) => enabledUris.has(skill.uri));
  const toggle = (uri: string) => {
    if (disabled || (!enabledUris.has(uri) && enabledUris.size >= maxSelected))
      return;
    const next = new Set(enabledUris);
    if (next.has(uri)) next.delete(uri);
    else next.add(uri);
    onChange(next);
  };

  return (
    <div className="absolute top-4 left-4 right-4 z-20 flex items-center gap-2 overflow-x-auto">
      <Popover>
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={disabled}
              className="h-7 shrink-0 gap-1.5 rounded-full px-2 text-[11px]"
              aria-label="Add skills"
            >
              <Plus className="size-3.5" />
              Add skills
            </Button>
          }
          nativeButton
        />
        <PopoverContent align="start" side="top" className="w-80 gap-2">
          <p className="font-medium">Skills for this chat</p>
          <div className="max-h-64 space-y-1 overflow-auto">
            {skills.map((skill) => {
              const checked = enabledUris.has(skill.uri);
              const unavailable =
                disabled || (!checked && enabledUris.size >= maxSelected);
              return (
                <label
                  key={skill.uri}
                  className={`flex items-start gap-2 rounded-md p-2 ${unavailable ? "cursor-default opacity-50" : "cursor-pointer hover:bg-muted"}`}
                >
                  <Checkbox
                    checked={checked}
                    disabled={unavailable}
                    onCheckedChange={() => toggle(skill.uri)}
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {nameOf(skill)}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {String(skill.frontmatter.description ?? skill.uri)}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>
      {enabled.map((skill) => (
        <span
          key={skill.uri}
          className="inline-flex h-7 max-w-56 shrink-0 items-center gap-1.5 rounded-full bg-secondary px-2 text-[11px] text-secondary-foreground"
          title={`${nameOf(skill)} — ${skill.uri}`}
        >
          <LibraryBig className="size-3.5 shrink-0" />
          <span className="truncate">{nameOf(skill)}</span>
          <button
            type="button"
            disabled={disabled}
            aria-label={`Remove ${nameOf(skill)} skill`}
            className="shrink-0 rounded-full p-0.5 hover:bg-black/10 focus-visible:outline-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 dark:hover:bg-white/10"
            onClick={() => toggle(skill.uri)}
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
    </div>
  );
}
