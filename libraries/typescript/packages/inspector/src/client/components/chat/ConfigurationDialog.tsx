import { Check, ChevronsUpDown, Eye, EyeOff, Key, Loader2, Server } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/client/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/client/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { Input } from "@/client/components/ui/input";
import { Label } from "@/client/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/client/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";

import { cn } from "@/client/lib/utils";

interface ModelOption {
  id: string;
  displayName?: string;
}

interface CachedModels {
  models: ModelOption[];
  timestamp: number;
}

const MODELS_CACHE_KEY = "mcp-inspector-models-cache";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

// Helper functions for models cache
function getModelsCache(): Record<string, CachedModels> {
  try {
    const cached = localStorage.getItem(MODELS_CACHE_KEY);
    if (cached) {
      return JSON.parse(cached);
    }
  } catch (error) {
    console.error("Failed to load models cache:", error);
  }
  return {};
}

function setModelsCache(provider: string, models: ModelOption[]) {
  try {
    const cache = getModelsCache();
    cache[provider] = {
      models,
      timestamp: Date.now(),
    };
    localStorage.setItem(MODELS_CACHE_KEY, JSON.stringify(cache));
  } catch (error) {
    console.error("Failed to save models cache:", error);
  }
}

function getCachedModels(provider: string): ModelOption[] | null {
  try {
    const cache = getModelsCache();
    const cached = cache[provider];

    if (cached) {
      const age = Date.now() - cached.timestamp;
      if (age < CACHE_TTL_MS) {
        return cached.models;
      } else {
        // Cache expired, remove it
        delete cache[provider];
        localStorage.setItem(MODELS_CACHE_KEY, JSON.stringify(cache));
      }
    }
  } catch (error) {
    console.error("Failed to get cached models:", error);
  }
  return null;
}

interface ConfigurationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tempProvider: "openai" | "anthropic" | "google" | "custom";
  tempModel: string;
  tempApiKey: string;
  /** Base URL for custom OpenAI-compatible providers */
  tempBaseUrl?: string;
  onProviderChange: (
    provider: "openai" | "anthropic" | "google" | "custom"
  ) => void;
  onModelChange: (model: string) => void;
  onApiKeyChange: (apiKey: string) => void;
  onBaseUrlChange?: (url: string) => void;
  onSave: () => void;
  onClear?: () => void;
  showClearButton?: boolean;
  buttonLabel?: string;
  /**
   * When present, the dialog renders a "Manufact free tier" banner above the
   * provider/api-key form, with a Login button that increases the tier.
   * Used in hosted inspector mode (inspector.manufact.com) where the default
   * LLM is provided server-side. Below the banner the user can still paste
   * their own API key to switch to client-side mode + pick another model.
   */
  freeTierInfo?: {
    onLoginClick: () => void;
  };
}

async function fetchOpenAIModels(apiKey: string): Promise<ModelOption[]> {
  const response = await fetch("https://api.openai.com/v1/models", {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch OpenAI models: ${response.statusText}`);
  }

  const data = await response.json();
  return data.data.map((model: { id: string }) => ({
    id: model.id,
  }));
}

async function fetchAnthropicModels(apiKey: string): Promise<ModelOption[]> {
  const response = await fetch("https://api.anthropic.com/v1/models", {
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Anthropic models: ${response.statusText}`);
  }

  const data = await response.json();
  return data.data.map((model: { id: string; display_name?: string }) => ({
    id: model.id,
    displayName: model.display_name,
  }));
}

async function fetchGoogleModels(apiKey: string): Promise<ModelOption[]> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch Google models: ${response.statusText}`);
  }

  const data = await response.json();
  return (data.models || []).map(
    (model: { name: string; displayName?: string }) => ({
      id: model.name,
      displayName: model.displayName,
    })
  );
}

/**
 * Fetch models from any OpenAI-compatible /v1/models endpoint.
 * API key is optional — local servers (LM Studio, Ollama) don't require one.
 * Handles both OpenAI shape ({data:[]}) and Ollama shape ({models:[]}).
 */
async function fetchCustomModels(
  baseUrl: string,
  apiKey?: string
): Promise<ModelOption[]> {
  const base = baseUrl.replace(/\/$/, "");
  const headers: Record<string, string> = {};
  if (apiKey?.trim()) headers["Authorization"] = `Bearer ${apiKey}`;
  const response = await fetch(`${base}/v1/models`, { headers });
  if (!response.ok) {
    throw new Error(
      `Failed to fetch models from ${base}/v1/models: ${response.statusText}`
    );
  }
  const data = await response.json();
  // Safer parsing: handles null/malformed entries and both response shapes
  const list: unknown[] = data?.data || data?.models || [];
  return list
    .map((m: any) => m?.id || m?.name)
    .filter(Boolean)
    .map((id: string) => ({ id }));
}

export function ConfigurationDialog({
  open,
  onOpenChange,
  tempProvider,
  tempModel,
  tempApiKey,
  tempBaseUrl = "http://localhost:1234",
  onProviderChange,
  onModelChange,
  onApiKeyChange,
  onBaseUrlChange,
  onSave,
  onClear,
  showClearButton = false,
  buttonLabel: _buttonLabel = "Configure API Key",
  freeTierInfo,
}: ConfigurationDialogProps) {
  const [models, setModels] = useState<ModelOption[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);
  const [comboboxOpen, setComboboxOpen] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Fetch models when API key is set (or for custom providers where key is optional)
  useEffect(() => {
    // Custom provider: API key is optional — only skip if dialog is closed
    const needsApiKey = tempProvider !== "custom";
    if (!open || (needsApiKey && !tempApiKey.trim()) || !tempProvider) {
      setModels([]);
      setModelError(null);
      return;
    }

    const loadModels = async () => {
      // Check cache first
      const cachedModels = getCachedModels(tempProvider);
      if (cachedModels) {
        setModels(cachedModels);
        setModelError(null);
        return;
      }

      // Cache miss or expired, fetch from API
      setIsLoadingModels(true);
      setModelError(null);

      try {
        let fetchedModels: ModelOption[] = [];
        if (tempProvider === "custom") {
          fetchedModels = await fetchCustomModels(tempBaseUrl, tempApiKey);
        } else if (tempProvider === "openai") {
          fetchedModels = await fetchOpenAIModels(tempApiKey);
        } else if (tempProvider === "anthropic") {
          fetchedModels = await fetchAnthropicModels(tempApiKey);
        } else if (tempProvider === "google") {
          fetchedModels = await fetchGoogleModels(tempApiKey);
        }

        // Cache the fetched models
        setModelsCache(tempProvider, fetchedModels);
        setModels(fetchedModels);
      } catch (error) {
        setModelError(
          error instanceof Error
            ? error.message
            : "Failed to fetch models. Please check your API key."
        );
        setModels([]);
      } finally {
        setIsLoadingModels(false);
      }
    };

    // Debounce the API call
    const timeoutId = setTimeout(loadModels, 500);
    return () => clearTimeout(timeoutId);
  }, [tempApiKey, tempProvider, tempBaseUrl, open]);

  // Reset model when provider changes
  useEffect(() => {
    if (open) {
      onModelChange("");
    }
  }, [tempProvider, open, onModelChange]);



  const getProviderIcon = (provider: string) => {
    return `https://inspector-cdn.mcp-use.com/providers/${provider}.png`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="chat-config-dialog">
        <DialogHeader>
          <DialogTitle>
            {freeTierInfo ? "Model & usage" : "LLM Provider Configuration"}
          </DialogTitle>
          <DialogDescription>
            {freeTierInfo
              ? "You're using Manufact's free tier. Sign in to increase your limits, or bring your own key to pick any model."
              : "Configure your LLM provider and API key to start chatting with the MCP server"}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {freeTierInfo && (
            <div className="rounded-md border bg-muted/40 p-3 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm">
                  <div className="font-medium">Manufact free tier</div>
                  <div className="text-xs text-muted-foreground">
                    Sign in for increased generous limits.
                  </div>
                </div>
                <Button size="sm" onClick={freeTierInfo.onLoginClick}>
                  Sign in
                </Button>
              </div>
            </div>
          )}
          {freeTierInfo && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <div className="h-px flex-1 bg-border" />
              <span>or use your own API key</span>
              <div className="h-px flex-1 bg-border" />
            </div>
          )}
          <div className="space-y-2">
            <Label>Provider</Label>
            <Select
              value={tempProvider}
              onValueChange={(v: any) => onProviderChange(v)}
            >
              <SelectTrigger className="flex items-center gap-2">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="openai">
                  <div className="flex items-center gap-2">
                    <img
                      src={getProviderIcon("openai")}
                      alt="OpenAI"
                      className="w-4 h-4"
                    />
                    <span>OpenAI</span>
                  </div>
                </SelectItem>
                <SelectItem value="anthropic">
                  <div className="flex items-center gap-2">
                    <img
                      src={getProviderIcon("anthropic")}
                      alt="Anthropic"
                      className="w-4 h-4"
                    />
                    <span>Anthropic</span>
                  </div>
                </SelectItem>
                <SelectItem value="google">
                  <div className="flex items-center gap-2">
                    <img
                      src={getProviderIcon("google")}
                      alt="Google"
                      className="w-4 h-4"
                    />
                    <span>Google</span>
                  </div>
                </SelectItem>
                <SelectItem value="custom">
                  <div className="flex items-center gap-2">
                    <Server className="w-4 h-4" />
                    <span>Custom (OpenAI-compatible)</span>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>API Key</Label>
            <div className="relative">
              <Input
                type={showPassword ? "text" : "password"}
                value={tempApiKey}
                onChange={(e) => onApiKeyChange(e.target.value)}
                placeholder={
                  tempProvider === "custom"
                    ? "Enter API key (optional for local servers)"
                    : "Enter your API key"
                }
                className="pr-10"
                data-testid="chat-config-api-key-input"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <Eye className="h-4 w-4 text-muted-foreground" />
                )}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Your API key is stored locally and never sent to our servers
            </p>
          </div>

          {/* Base URL — shown only for custom provider */}
          {tempProvider === "custom" && (
            <div className="space-y-2">
              <Label>Base URL</Label>
              <Input
                value={tempBaseUrl}
                onChange={(e) => onBaseUrlChange?.(e.target.value)}
                placeholder="http://localhost:1234"
                data-testid="chat-config-base-url-input"
              />
              <p className="text-xs text-muted-foreground">
                LM Studio: http://localhost:1234 · Ollama: http://localhost:11434
              </p>
            </div>
          )}

          {(tempApiKey.trim() || tempProvider === "custom") && (
            <div className="space-y-2">
              <Label>Model</Label>
              {isLoadingModels ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Loading models...</span>
                </div>
              ) : modelError ? (
                <div className="text-sm text-destructive">{modelError}</div>
              ) : models.length > 0 ? (
                <Popover
                  open={comboboxOpen}
                  modal={true}
                  onOpenChange={setComboboxOpen}
                >
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={comboboxOpen}
                      className="w-full justify-between rounded-md"
                      data-testid="chat-config-model-select"
                    >
                      {tempModel
                        ? models.find((model) => model.id === tempModel)
                            ?.displayName ||
                          models.find((model) => model.id === tempModel)?.id ||
                          "Select a model..."
                        : "Select a model..."}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-full p-0" align="start">
                    <Command>
                      <CommandInput
                        placeholder="Search models..."
                        className="h-9"
                      />
                      <CommandList>
                        <CommandEmpty>No model found.</CommandEmpty>
                        <CommandGroup>
                          {models.map((model) => (
                            <CommandItem
                              key={model.id}
                              value={model.id}
                              onSelect={(currentValue) => {
                                onModelChange(
                                  currentValue === tempModel ? "" : currentValue
                                );
                                setComboboxOpen(false);
                              }}
                            >
                              {model.displayName || model.id}
                              <Check
                                className={cn(
                                  "ml-auto h-4 w-4",
                                  tempModel === model.id
                                    ? "opacity-100"
                                    : "opacity-0"
                                )}
                              />
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              ) : (
                <Input
                  value={tempModel}
                  onChange={(e) => onModelChange(e.target.value)}
                  placeholder="Enter model name manually"
                  data-testid="chat-config-model-input"
                />
              )}
            </div>
          )}

          <div className="flex justify-between">
            {showClearButton && onClear && (
              <Button variant="outline" onClick={onClear}>
                Clear Config
              </Button>
            )}
            <Button
              onClick={onSave}
              disabled={
                (tempProvider !== "custom" && !tempApiKey.trim()) ||
                !tempModel.trim()
              }
              className={showClearButton ? "ml-auto" : ""}
              data-testid="chat-config-save-button"
            >
              <Key className="h-4 w-4 mr-2" />
              Save Configuration
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
