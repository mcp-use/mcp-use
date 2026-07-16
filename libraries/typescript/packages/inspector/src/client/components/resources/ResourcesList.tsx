import type { Resource } from "@modelcontextprotocol/client";
import { Database } from "lucide-react";
import { ListItem } from "@/client/components/shared";

interface ResourcesListProps {
  resources: Resource[];
  selectedResource: Resource | null;
  onResourceSelect: (resource: Resource) => void;
  focusedIndex: number;
}

export function ResourcesList({
  resources,
  selectedResource,
  onResourceSelect,
  focusedIndex,
}: ResourcesListProps) {
  if (resources.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-4 text-center">
        <Database className="h-12 w-12 text-gray-400 dark:text-gray-600 mb-3" />
        <p className="text-gray-500 dark:text-gray-400">
          No resources available
        </p>
      </div>
    );
  }

  return (
    <div>
      {resources.map((resource, index) => {
        const description = [
          resource.description,
          resource.mimeType && (
            <span key="mime" className="font-mono">
              {resource.mimeType}
            </span>
          ),
        ].filter(Boolean);

        return (
          <ListItem
            key={resource.uri}
            id={`resource-${resource.uri}`}
            data-testid={`resource-item-${resource.name}`}
            isSelected={selectedResource?.uri === resource.uri}
            isFocused={focusedIndex === index}
            title={resource.name}
            description={
              description.length > 0 ? (
                <span className="flex flex-col gap-1">
                  {resource.description && <span>{resource.description}</span>}
                  {resource.mimeType && (
                    <span className="text-xs text-gray-500 dark:text-gray-500 font-mono">
                      {resource.mimeType}
                    </span>
                  )}
                </span>
              ) : undefined
            }
            onClick={() => onResourceSelect(resource)}
          />
        );
      })}
    </div>
  );
}
