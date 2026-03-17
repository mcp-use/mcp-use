import { Button } from "@/client/components/ui/button";
import { Label } from "@/client/components/ui/label";
import { Textarea } from "@/client/components/ui/textarea";
import { cn } from "@/client/lib/utils";
import { FileCode } from "lucide-react";
import { useState } from "react";

interface OpenApiConnectionFormProps {
  onConnect: (spec: string) => void;
  isLoading?: boolean;
}

/**
 * Form for connecting to an API via an OpenAPI spec.
 * Accepts a URL to an OpenAPI document or the raw JSON.
 */
export function OpenApiConnectionForm({
  onConnect,
  isLoading = false,
}: OpenApiConnectionFormProps) {
  const [spec, setSpec] = useState("");

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label className="text-white/90">OpenAPI Specification</Label>
        <Textarea
          data-testid="connection-form-openapi-input"
          placeholder={
            "https://api.example.com/openapi.json\n\nor paste the raw JSON:\n\n{\"openapi\": \"3.0.0\", ...}"
          }
          value={spec}
          onChange={(e) => setSpec(e.target.value)}
          className="min-h-[200px] max-h-[400px] font-mono text-xs bg-white/10 border-white/20 text-white placeholder:text-white/50"
        />
        <p className="text-xs text-white/60">
          Paste a URL to an OpenAPI spec or the raw JSON. Each operation becomes
          an MCP tool.
        </p>
      </div>

      <Button
        data-testid="connection-form-openapi-connect-button"
        onClick={() => spec.trim() && onConnect(spec)}
        disabled={!spec.trim() || isLoading}
        className="w-full font-semibold bg-white text-black hover:bg-white/90"
      >
        {isLoading ? (
          <>
            <svg
              className="w-4 h-4 mr-2 animate-spin"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            Starting MCP Server...
          </>
        ) : (
          <>
            <FileCode className="w-4 h-4 mr-2" />
            Connect from OpenAPI
          </>
        )}
      </Button>
    </div>
  );
}
