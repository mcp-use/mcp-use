import type { StructuredToolInterface } from '@langchain/core/tools'
import { SystemMessage } from '@langchain/core/messages'

export function generateToolDescriptions(
  tools: StructuredToolInterface[],
  disallowedTools?: string[],
): string[] {
  const disallowedSet = new Set(disallowedTools ?? [])
  const descriptions: string[] = []

  for (const tool of tools) {
    if (disallowedSet.has(tool.name))
      continue
    const escaped = tool.description
      .replace(/\{/g, '{{')
      .replace(/\}/g, '}}')
    descriptions.push(`- ${tool.name}: ${escaped}`)
  }

  return descriptions
}

export function buildSystemPromptContent(
  template: string,
  toolDescriptionLines: string[],
  additionalInstructions?: string,
): string {
  const block = toolDescriptionLines.join('\n')

  let content: string
  if (template.includes('{tool_descriptions}')) {
    content = template.replace('{tool_descriptions}', block)
  }
  else {
    console.warn('`{tool_descriptions}` placeholder not found; appending at end.')
    content = `${template}\n\nAvailable tools:\n${block}`
  }

  if (additionalInstructions) {
    content += `\n\n${additionalInstructions}`
  }

  return content
}

export function createSystemMessage(
  tools: StructuredToolInterface[],
  systemPromptTemplate: string,
  serverManagerTemplate: string,
  useServerManager: boolean,
  disallowedTools?: string[],
  userProvidedPrompt?: string,
  additionalInstructions?: string,
): SystemMessage {
  if (userProvidedPrompt) {
    return new SystemMessage({ content: userProvidedPrompt })
  }

  const template = useServerManager
    ? serverManagerTemplate
    : systemPromptTemplate

  const toolLines = generateToolDescriptions(tools, disallowedTools)
  const finalContent = buildSystemPromptContent(
    template,
    toolLines,
    additionalInstructions,
  )

  return new SystemMessage({ content: finalContent })
}
