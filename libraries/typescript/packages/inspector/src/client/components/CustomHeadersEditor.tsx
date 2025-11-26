"use client";

import { Eye, EyeOff, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { Label } from "@/client/components/ui/label";
import { cn } from "@/client/lib/utils";

export interface CustomHeader {
  name: string;
  value: string;
  id: string;
}

export interface CustomHeadersEditorProps {
  headers: CustomHeader[];
  onChange: (headers: CustomHeader[]) => void;
  onSave?: () => void;
  className?: string;
  title?: string;
  description?: string;
  maxHeaders?: number;
}

export function CustomHeadersEditor({
  headers,
  onChange,
  onSave,
  className,
  title = "Custom Headers",
  description = "Headers with both name and value will be sent",
  maxHeaders = 50,
}: CustomHeadersEditorProps) {
  const [showValues, setShowValues] = useState<Record<string, boolean>>({});

  // Generate unique ID for new headers
  const generateId = () => Math.random().toString(36).slice(2, 11);

  // Add new header
  const addHeader = () => {
    if (headers.length >= maxHeaders) return;

    const newHeader: CustomHeader = {
      id: generateId(),
      name: "",
      value: "",
    };
    onChange([...headers, newHeader]);
  };

  // Remove header
  const removeHeader = (id: string) => {
    onChange(headers.filter((h) => h.id !== id));
  };

  // Update header
  const updateHeader = (id: string, field: "name" | "value", value: string) => {
    onChange(headers.map((h) => (h.id === id ? { ...h, [field]: value } : h)));
  };

  // Toggle value visibility
  const toggleValueVisibility = (id: string) => {
    setShowValues((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  return (
    <div className={cn("space-y-3", className)}>
      {/* Header */}
      <div className="space-y-2">
        <Label className="text-base font-medium">{title}</Label>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>

      {/* Headers Table */}
      <div className="space-y-2">
        {/* Table Header */}
        <div className="grid grid-cols-[1fr_1fr] gap-4 text-sm font-medium text-muted-foreground">
          <div>Name</div>
          <div>Value</div>
        </div>

        {/* Headers */}
        {headers.length === 0 ? (
          <div className="grid grid-cols-[1fr_1fr] gap-4 items-center">
            <Input
              placeholder="Authorization"
              value=""
              onChange={(e) => {
                // Create a new header when user starts typing
                if (e.target.value.trim()) {
                  const newHeader: CustomHeader = {
                    id: generateId(),
                    name: e.target.value,
                    value: "",
                  };
                  onChange([newHeader]);
                }
              }}
              className="text-sm"
              autoComplete="off"
            />
            <div className="flex items-center gap-2">
              <Input
                placeholder="Bearer token..."
                value=""
                onChange={() => {}}
                type="password"
                className="font-mono text-sm"
                autoComplete="off"
                disabled
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="h-8 w-8 p-0"
                disabled
              >
                <Eye className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="h-8 w-8 p-0"
                disabled
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ) : (
          headers.map((header) => (
            <div
              key={header.id}
              className="grid grid-cols-[1fr_1fr] gap-4 items-center"
            >
              <Input
                placeholder="Authorization"
                value={header.name}
                onChange={(e) =>
                  updateHeader(header.id, "name", e.target.value)
                }
                className="text-sm"
                autoComplete="off"
              />
              <div className="flex items-center gap-2">
                <Input
                  placeholder=""
                  value={header.value}
                  onChange={(e) =>
                    updateHeader(header.id, "value", e.target.value)
                  }
                  type={showValues[header.id] ? "text" : "password"}
                  className="font-mono text-sm"
                  autoComplete="off"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => toggleValueVisibility(header.id)}
                  className="h-8 w-8 p-0"
                >
                  {showValues[header.id] ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => removeHeader(header.id)}
                  className="h-8 w-8 p-0"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))
        )}

        {/* Add Button */}
        <div className="flex justify-start mt-4">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addHeader}
            disabled={headers.length >= maxHeaders}
            className="flex items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            Add
          </Button>
        </div>
      </div>

      {/* Save Button */}
      {onSave && (
        <div className="flex justify-end">
          <Button
            type="button"
            onClick={onSave}
            className="bg-black text-white hover:bg-gray-800"
          >
            Save
          </Button>
        </div>
      )}
    </div>
  );
}
