import { MCPChatConfiguredEvent, Telemetry } from "@/client/telemetry";
import { useCallback, useEffect, useState } from "react";
import type { ProviderName } from "@/llm/types";
import type { AuthConfig, LLMConfig } from "./types";
import {
  DEFAULT_MODELS,
  getDefaultBaseUrl,
  providerRequiresApiKey,
  providerSupportsBaseUrl,
} from "./types";
import { hashString } from "./utils";

interface UseConfigProps {
  mcpServerUrl: string;
}

export function useConfig({ mcpServerUrl }: UseConfigProps) {
  const [llmConfig, setLLMConfig] = useState<LLMConfig | null>(null);
  const [authConfig, setAuthConfig] = useState<AuthConfig | null>(null);
  const [configDialogOpen, setConfigDialogOpen] = useState(false);

  // LLM Config form state
  const [tempProvider, setTempProvider] = useState<ProviderName>("openai");
  const [tempApiKey, setTempApiKey] = useState("");
  const [tempModel, setTempModel] = useState(DEFAULT_MODELS.openai);
  const [tempBaseUrl, setTempBaseUrl] = useState(getDefaultBaseUrl("openai"));

  // Load API keys per provider from localStorage
  const getApiKeys = useCallback((): Record<string, string> => {
    const saved = localStorage.getItem("mcp-inspector-api-keys");
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (error) {
        console.error("Failed to load API keys:", error);
        return {};
      }
    }
    return {};
  }, []);

  // Save API keys per provider to localStorage
  const saveApiKeys = useCallback((apiKeys: Record<string, string>) => {
    localStorage.setItem("mcp-inspector-api-keys", JSON.stringify(apiKeys));
  }, []);

  const getBaseUrls = useCallback((): Record<string, string> => {
    const saved = localStorage.getItem("mcp-inspector-base-urls");
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (error) {
        console.error("Failed to load base URLs:", error);
        return {};
      }
    }
    return {};
  }, []);

  const saveBaseUrls = useCallback((baseUrls: Record<string, string>) => {
    localStorage.setItem("mcp-inspector-base-urls", JSON.stringify(baseUrls));
  }, []);

  // Auth Config form state
  const [tempAuthType, setTempAuthType] = useState<
    "none" | "basic" | "bearer" | "oauth"
  >("none");
  const [tempUsername, setTempUsername] = useState("");
  const [tempPassword, setTempPassword] = useState("");
  const [tempToken, setTempToken] = useState("");

  // Load saved LLM config from localStorage
  useEffect(() => {
    const loadConfig = () => {
      const saved = localStorage.getItem("mcp-inspector-llm-config");
      const apiKeys = getApiKeys();
      const baseUrls = getBaseUrls();
      if (saved) {
        try {
          const config = JSON.parse(saved);
          setLLMConfig(config);
          setTempProvider(config.provider);
          // Load API key for the provider from provider-specific storage
          setTempApiKey(apiKeys[config.provider] || config.apiKey || "");
          setTempModel(config.model);
          setTempBaseUrl(
            baseUrls[config.provider] ||
              config.baseUrl ||
              getDefaultBaseUrl(config.provider)
          );
        } catch (error) {
          console.error("Failed to load LLM config:", error);
        }
      }
    };

    // Load on mount
    loadConfig();

    // Listen for custom event when config is updated (from other components in same window)
    const handleConfigUpdate = () => {
      loadConfig();
    };

    // Listen for storage changes (from other browser windows/tabs)
    const handleStorageChange = (e: StorageEvent) => {
      if (
        e.key === "mcp-inspector-llm-config" ||
        e.key === "mcp-inspector-api-keys" ||
        e.key === "mcp-inspector-base-urls"
      ) {
        loadConfig();
      }
    };

    window.addEventListener("llm-config-updated", handleConfigUpdate);
    window.addEventListener("storage", handleStorageChange);
    return () => {
      window.removeEventListener("llm-config-updated", handleConfigUpdate);
      window.removeEventListener("storage", handleStorageChange);
    };
  }, [getApiKeys, getBaseUrls]);

  // Load auth config from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem("mcp-inspector-auth-config");
    if (saved) {
      try {
        const config = JSON.parse(saved);
        setAuthConfig(config);
        setTempAuthType(config.type);
        if (config.username) setTempUsername(config.username);
        if (config.password) setTempPassword(config.password);
        if (config.token) setTempToken(config.token);
      } catch (error) {
        console.error("Failed to load auth config:", error);
      }
    } else {
      // Check if OAuth tokens exist for this server
      try {
        const storageKeyPrefix = "mcp:auth";
        const serverUrlHash = hashString(mcpServerUrl);
        const storageKey = `${storageKeyPrefix}_${serverUrlHash}_tokens`;
        const tokensStr = localStorage.getItem(storageKey);
        if (tokensStr) {
          // OAuth tokens exist, default to OAuth mode
          const defaultAuthConfig: AuthConfig = { type: "oauth" };
          setAuthConfig(defaultAuthConfig);
          setTempAuthType("oauth");
        }
      } catch (error) {
        console.error("Failed to check for OAuth tokens:", error);
      }
    }
  }, [mcpServerUrl]);

  // Update model and load API key when provider changes
  useEffect(() => {
    setTempModel(DEFAULT_MODELS[tempProvider]);
    // Load API key for the selected provider
    const apiKeys = getApiKeys();
    const baseUrls = getBaseUrls();
    setTempApiKey(apiKeys[tempProvider] || "");
    setTempBaseUrl(baseUrls[tempProvider] || getDefaultBaseUrl(tempProvider));
  }, [tempProvider, getApiKeys, getBaseUrls]);

  const saveLLMConfig = useCallback(() => {
    if (providerRequiresApiKey(tempProvider) && !tempApiKey.trim()) {
      return;
    }

    // Save API key for the current provider
    const apiKeys = getApiKeys();
    apiKeys[tempProvider] = tempApiKey;
    saveApiKeys(apiKeys);

    if (providerSupportsBaseUrl(tempProvider)) {
      const baseUrls = getBaseUrls();
      baseUrls[tempProvider] = tempBaseUrl.trim();
      saveBaseUrls(baseUrls);
    }

    const newLlmConfig: LLMConfig = {
      provider: tempProvider,
      apiKey: tempApiKey.trim(),
      model: tempModel.trim(),
      ...(providerSupportsBaseUrl(tempProvider)
        ? { baseUrl: tempBaseUrl.trim() || getDefaultBaseUrl(tempProvider) }
        : {}),
    };

    const newAuthConfig: AuthConfig = {
      type: tempAuthType,
      ...(tempAuthType === "basic" && {
        username: tempUsername.trim(),
        password: tempPassword.trim(),
      }),
      ...(tempAuthType === "bearer" && {
        token: tempToken.trim(),
      }),
    };

    setLLMConfig(newLlmConfig);
    setAuthConfig(newAuthConfig);
    localStorage.setItem(
      "mcp-inspector-llm-config",
      JSON.stringify(newLlmConfig)
    );
    localStorage.setItem(
      "mcp-inspector-auth-config",
      JSON.stringify(newAuthConfig)
    );

    // Dispatch custom event to notify other components
    window.dispatchEvent(new CustomEvent("llm-config-updated"));

    // Track chat configuration (no API key)
    try {
      Telemetry.getInstance()
        .capture(
          new MCPChatConfiguredEvent({
            provider: tempProvider,
            model: tempModel,
          })
        )
        .catch(() => {});
    } catch {
      // ignore telemetry errors
    }

    setConfigDialogOpen(false);
  }, [
    tempProvider,
    tempApiKey,
    tempModel,
    tempBaseUrl,
    tempAuthType,
    tempUsername,
    tempPassword,
    tempToken,
    getApiKeys,
    getBaseUrls,
    saveApiKeys,
    saveBaseUrls,
  ]);

  const clearConfig = useCallback(() => {
    setLLMConfig(null);
    setAuthConfig(null);
    // Clear API key for current provider only
    const apiKeys = getApiKeys();
    delete apiKeys[tempProvider];
    saveApiKeys(apiKeys);
    const baseUrls = getBaseUrls();
    setTempApiKey("");
    setTempBaseUrl(baseUrls[tempProvider] || getDefaultBaseUrl(tempProvider));
    setTempUsername("");
    setTempPassword("");
    setTempToken("");
    setTempAuthType("none");
    localStorage.removeItem("mcp-inspector-llm-config");
    localStorage.removeItem("mcp-inspector-auth-config");
  }, [tempProvider, getApiKeys, saveApiKeys, getBaseUrls]);

  return {
    llmConfig,
    authConfig,
    configDialogOpen,
    setConfigDialogOpen,
    tempProvider,
    setTempProvider,
    tempApiKey,
    setTempApiKey,
    tempModel,
    setTempModel,
    tempBaseUrl,
    setTempBaseUrl,
    tempAuthType,
    saveLLMConfig,
    clearConfig,
  };
}
