import type { Resource } from "@modelcontextprotocol/sdk/types.js";
import {
  Database,
  File,
  FileCode,
  FileImage,
  FileText,
  Globe,
} from "lucide-react";
import { ListItem } from "@/client/components/shared";

interface ResourcesListProps {
  resources: Resource[];
  selectedResource: Resource | null;
  onResourceSelect: (resource: Resource) => void;
  focusedIndex: number;
}

function getResourceIcon(mimeType?: string, uri?: string) {
  if (!mimeType && !uri) return <File className="h-5 w-5" />;

  const type = (mimeType || uri || "").toLowerCase();

  if (type.includes("image")) {
    return <FileImage className="h-5 w-5" />;
  }
  if (
    type.includes("json") ||
    type.includes("javascript") ||
    type.includes("typescript")
  ) {
    return <FileCode className="h-5 w-5" />;
  }
  if (type.includes("html") || type.includes("xml")) {
    return <Globe className="h-5 w-5" />;
  }
  if (type.includes("database") || type.includes("sql")) {
    return <Database className="h-5 w-5" />;
  }

  return <FileText className="h-5 w-5" />;
}

export function ResourcesList({
  resources,
  selectedResource,
  onResourceSelect,
  focusedIndex,
}: ResourcesListProps) {
  if (resources.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4 text-center">
        <Database className="h-12 w-12 text-gray-400 dark:text-gray-600 mb-3" />
        <p className="text-gray-500 dark:text-gray-400">
          No resources available
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-y-auto flex-1 overscroll-contain">
      {resources.map((resource, index) => {
        const icon = getResourceIcon(resource.mimeType, resource.uri);
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
            icon={icon}
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
