import { useCallback, useEffect, useState } from 'react'
import type { AuthConfig, LLMConfig } from './types'
import { DEFAULT_MODELS } from './types'
import { hashString } from './utils'

interface UseConfigProps {
  mcpServerUrl: string
}

export function useConfig({ mcpServerUrl }: UseConfigProps) {
  const [llmConfig, setLLMConfig] = useState<LLMConfig | null>(null)
  const [authConfig, setAuthConfig] = useState<AuthConfig | null>(null)
  const [configDialogOpen, setConfigDialogOpen] = useState(false)

  // LLM Config form state
  const [tempProvider, setTempProvider] = useState<
    'openai' | 'anthropic' | 'google'
  >('openai')
  const [tempApiKey, setTempApiKey] = useState('')
  const [tempModel, setTempModel] = useState(DEFAULT_MODELS.openai)

  // Auth Config form state
  const [tempAuthType, setTempAuthType] = useState<
    'none' | 'basic' | 'bearer' | 'oauth'
  >('none')
  const [tempUsername, setTempUsername] = useState('')
  const [tempPassword, setTempPassword] = useState('')
  const [tempToken, setTempToken] = useState('')

  // Load saved LLM config from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('mcp-inspector-llm-config')
    if (saved) {
      try {
        const config = JSON.parse(saved)
        setLLMConfig(config)
        setTempProvider(config.provider)
        setTempApiKey(config.apiKey)
        setTempModel(config.model)
      }
      catch (error) {
        console.error('Failed to load LLM config:', error)
      }
    }
  }, [])

  // Load auth config from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('mcp-inspector-auth-config')
    if (saved) {
      try {
        const config = JSON.parse(saved)
        setAuthConfig(config)
        setTempAuthType(config.type)
        if (config.username)
          setTempUsername(config.username)
        if (config.password)
          setTempPassword(config.password)
        if (config.token)
          setTempToken(config.token)
      }
      catch (error) {
        console.error('Failed to load auth config:', error)
      }
    }
    else {
      // Check if OAuth tokens exist for this server
      try {
        const storageKeyPrefix = 'mcp:auth'
        const serverUrlHash = hashString(mcpServerUrl)
        const storageKey = `${storageKeyPrefix}_${serverUrlHash}_tokens`
        const tokensStr = localStorage.getItem(storageKey)
        if (tokensStr) {
          // OAuth tokens exist, default to OAuth mode
          const defaultAuthConfig: AuthConfig = { type: 'oauth' }
          setAuthConfig(defaultAuthConfig)
          setTempAuthType('oauth')
        }
      }
      catch (error) {
        console.error('Failed to check for OAuth tokens:', error)
      }
    }
  }, [mcpServerUrl])

  // Update model when provider changes
  useEffect(() => {
    setTempModel(DEFAULT_MODELS[tempProvider])
  }, [tempProvider])

  const saveLLMConfig = useCallback(() => {
    if (!tempApiKey.trim()) {
      return
    }

    const newLlmConfig: LLMConfig = {
      provider: tempProvider,
      apiKey: tempApiKey,
      model: tempModel,
    }

    const newAuthConfig: AuthConfig = {
      type: tempAuthType,
      ...(tempAuthType === 'basic' && {
        username: tempUsername.trim(),
        password: tempPassword.trim(),
      }),
      ...(tempAuthType === 'bearer' && {
        token: tempToken.trim(),
      }),
    }

    setLLMConfig(newLlmConfig)
    setAuthConfig(newAuthConfig)
    localStorage.setItem(
      'mcp-inspector-llm-config',
      JSON.stringify(newLlmConfig),
    )
    localStorage.setItem(
      'mcp-inspector-auth-config',
      JSON.stringify(newAuthConfig),
    )
    setConfigDialogOpen(false)
  }, [
    tempProvider,
    tempApiKey,
    tempModel,
    tempAuthType,
    tempUsername,
    tempPassword,
    tempToken,
  ])

  const clearConfig = useCallback(() => {
    setLLMConfig(null)
    setAuthConfig(null)
    setTempApiKey('')
    setTempUsername('')
    setTempPassword('')
    setTempToken('')
    setTempAuthType('none')
    localStorage.removeItem('mcp-inspector-llm-config')
    localStorage.removeItem('mcp-inspector-auth-config')
  }, [])

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
    tempAuthType,
    saveLLMConfig,
    clearConfig,
  }
}

