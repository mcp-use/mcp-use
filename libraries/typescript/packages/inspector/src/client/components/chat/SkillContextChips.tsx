import type { Skill } from "@mcp-use/client/react";
import { LibraryBig, Plus, X } from "lucide-react";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";

interface SkillContextChipsProps {
  skills: Skill[];
  enabledUris: Set<string>;
  onChange: (enabledUris: Set<string>) => void;
}

function nameOf(skill: Skill): string {
  return typeof skill.frontmatter.name === "string"
    ? skill.frontmatter.name
    : skill.uri;
}

function Chip({ skill, onRemove }: { skill: Skill; onRemove: () => void }) {
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      className="h-7 max-w-56 rounded-full px-2 text-[11px]"
      title={`${nameOf(skill)} — ${skill.uri}`}
    >
      <LibraryBig className="size-3.5 shrink-0" />
      <span className="truncate">{nameOf(skill)}</span>
      <span
        role="button"
        tabIndex={0}
        title="Remove skill from future context"
        className="ml-1 rounded-full p-0.5 hover:bg-black/10 dark:hover:bg-white/10"
        onClick={(event) => {
          event.stopPropagation();
          onRemove();
        }}
      >
        <X className="size-3" />
      </span>
    </Button>
  );
}

export function SkillContextChips({
  skills,
  enabledUris,
  onChange,
}: SkillContextChipsProps) {
  if (skills.length === 0) return null;
  const enabled = skills.filter((skill) => enabledUris.has(skill.uri));
  const toggle = (uri: string) => {
    const next = new Set(enabledUris);
    if (next.has(uri)) next.delete(uri);
    else next.add(uri);
    onChange(next);
  };

  if (skills.length <= 2 && enabled.length > 0) {
    return (
      <div className="absolute top-4 left-4 right-4 z-20 flex gap-2 overflow-x-auto">
        {enabled.map((skill) => (
          <Chip
            key={skill.uri}
            skill={skill}
            onRemove={() => toggle(skill.uri)}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="absolute top-4 left-4 right-4 z-20 flex gap-2">
      <Popover>
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-7 rounded-full px-2 text-[11px]"
            >
              {enabled.length === 0 ? (
                <Plus className="size-3.5" />
              ) : (
                <LibraryBig className="size-3.5" />
              )}
              {enabled.length === 0
                ? "Add skills"
                : `Skills · ${enabled.length}/${skills.length}`}
            </Button>
          }
          nativeButton
        />
        <PopoverContent align="start" side="top" className="w-80 gap-2">
          <div>
            <p className="font-medium">Skills in context</p>
            <p className="text-xs text-muted-foreground">
              Only metadata is added initially. Files are read on demand.
            </p>
          </div>
          <div className="max-h-64 overflow-auto space-y-1">
            {skills.map((skill) => (
              <label
                key={skill.uri}
                className="flex cursor-pointer items-start gap-2 rounded-md p-2 hover:bg-muted"
              >
                <Checkbox
                  checked={enabledUris.has(skill.uri)}
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
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
