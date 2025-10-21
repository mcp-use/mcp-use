import ts from 'typescript'
import { promises as fs } from 'node:fs'
import path from 'node:path'

interface PropSchema {
  name: string
  type: string
  required: boolean
  description?: string
  enum?: string[]
}

interface ComponentSchema {
  props: PropSchema[]
  metadata?: {
    description?: string
  }
}

/**
 * Extract prop types from a React component using TypeScript's compiler API
 */
export function extractPropsFromComponent(filePath: string): ComponentSchema | null {
  // Create a TypeScript program
  const program = ts.createProgram([filePath], {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    jsx: ts.JsxEmit.React,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    esModuleInterop: true,
    skipLibCheck: true,
  })

  const sourceFile = program.getSourceFile(filePath)
  if (!sourceFile) return null

  const checker = program.getTypeChecker()
  let propsTypeName: string | null = null
  let metadata: { description?: string } | undefined

  // Find the default export component and extract its props type
  ts.forEachChild(sourceFile, (node) => {
    // Look for: export default ComponentName
    if (ts.isExportAssignment(node) && !node.isExportEquals) {
      const symbol = checker.getSymbolAtLocation(node.expression)
      if (symbol) {
        const type = checker.getTypeOfSymbolAtLocation(symbol, node.expression)
        propsTypeName = extractPropsTypeFromComponent(type, checker)
      }
    }

    // Look for: const Component: React.FC<Props> = ...
    if (ts.isVariableStatement(node)) {
      node.declarationList.declarations.forEach((declaration) => {
        if (ts.isVariableDeclaration(declaration) && declaration.type) {
          const type = checker.getTypeFromTypeNode(declaration.type)
          const typeName = extractPropsTypeFromComponent(type, checker)
          if (typeName) {
            propsTypeName = typeName
          }
        }
      })
    }

    // Look for: export const widgetMetadata = { ... }
    if (ts.isVariableStatement(node)) {
      const hasExportKeyword = node.modifiers?.some(
        m => m.kind === ts.SyntaxKind.ExportKeyword
      )
      if (hasExportKeyword) {
        node.declarationList.declarations.forEach((declaration) => {
          if (
            ts.isVariableDeclaration(declaration) &&
            ts.isIdentifier(declaration.name) &&
            declaration.name.text === 'widgetMetadata' &&
            declaration.initializer &&
            ts.isObjectLiteralExpression(declaration.initializer)
          ) {
            // Extract metadata
            declaration.initializer.properties.forEach((prop) => {
              if (
                ts.isPropertyAssignment(prop) &&
                ts.isIdentifier(prop.name) &&
                prop.name.text === 'description' &&
                ts.isStringLiteral(prop.initializer)
              ) {
                if (!metadata) metadata = {}
                metadata.description = prop.initializer.text
              }
            })
          }
        })
      }
    }
  })

  if (!propsTypeName) {
    return null
  }

  // Find the props interface/type definition
  const propsSymbol = checker.resolveName(
    propsTypeName,
    sourceFile,
    ts.SymbolFlags.Type,
    false
  )

  if (!propsSymbol) {
    return null
  }

  const propsType = checker.getDeclaredTypeOfSymbol(propsSymbol)
  const props = extractPropsFromType(propsType, checker)

  return {
    props,
    metadata,
  }
}

function extractPropsTypeFromComponent(
  type: ts.Type,
  checker: ts.TypeChecker
): string | null {
  // Check for React.FC<Props> pattern
  const typeArguments = (type as any).typeArguments
  if (typeArguments && typeArguments.length > 0) {
    const propsType = typeArguments[0]
    const symbol = propsType.symbol || propsType.aliasSymbol
    if (symbol) {
      return symbol.name
    }
  }

  // Check for function component signature
  const callSignatures = type.getCallSignatures()
  if (callSignatures.length > 0) {
    const firstParam = callSignatures[0].parameters[0]
    if (firstParam) {
      const paramType = checker.getTypeOfSymbolAtLocation(
        firstParam,
        firstParam.valueDeclaration!
      )
      const symbol = paramType.symbol || paramType.aliasSymbol
      if (symbol) {
        return symbol.name
      }
    }
  }

  return null
}

function extractPropsFromType(type: ts.Type, checker: ts.TypeChecker): PropSchema[] {
  const props: PropSchema[] = []
  const properties = checker.getPropertiesOfType(type)

  for (const prop of properties) {
    const propType = checker.getTypeOfSymbolAtLocation(prop, prop.valueDeclaration!)
    const typeString = checker.typeToString(propType)
    
    // Check if property is optional
    const isOptional = (prop.flags & ts.SymbolFlags.Optional) !== 0
    
    // Extract JSDoc comments for description
    const description = ts.displayPartsToString(prop.getDocumentationComment(checker))

    // Check for enum/union types
    let enumValues: string[] | undefined
    if (propType.isUnion()) {
      const literalTypes = propType.types.filter((t) => t.isStringLiteral())
      if (literalTypes.length > 0) {
        enumValues = literalTypes.map((t) => (t as ts.StringLiteralType).value)
      }
    }

    props.push({
      name: prop.name,
      type: typeString,
      required: !isOptional,
      description: description || undefined,
      enum: enumValues,
    })
  }

  return props
}

/**
 * Convert kebab-case to camelCase
 */
function toCamelCase(str: string): string {
  return str.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
}

/**
 * Generate a TypeScript schema file from component schema
 */
export function generateSchemaFile(schema: ComponentSchema, componentName: string): string {
  const safeName = toCamelCase(componentName)
  
  const propsObject = schema.props.map((prop) => {
    const parts: string[] = []
    parts.push(`    ${prop.name}: {`)
    parts.push(`      type: '${prop.type}',`)
    parts.push(`      required: ${prop.required},`)
    if (prop.description) {
      parts.push(`      description: '${prop.description.replace(/'/g, "\\'")}',`)
    }
    if (prop.enum) {
      parts.push(`      enum: ${JSON.stringify(prop.enum)},`)
    }
    parts.push(`    }`)
    return parts.join('\n')
  }).join(',\n')

  const metadataStr = schema.metadata 
    ? `\n  metadata: ${JSON.stringify(schema.metadata, null, 2).replace(/\n/g, '\n  ')},`
    : ''

  return `// Auto-generated schema for ${componentName}
// This file is generated by the mcp-use CLI - do not edit manually

export const ${safeName}Schema = {${metadataStr}
  props: {
${propsObject}
  }
} as const

export type ${safeName}Props = {
${schema.props.map((prop) => {
  const optional = prop.required ? '' : '?'
  return `  ${prop.name}${optional}: ${prop.type}`
}).join('\n')}
}
`
}

/**
 * Map TypeScript type to InputDefinition type
 */
function mapToInputType(tsType: string): 'string' | 'number' | 'boolean' | 'object' | 'array' {
  if (tsType.includes('number')) return 'number'
  if (tsType.includes('boolean')) return 'boolean'
  if (tsType.includes('[]') || tsType.includes('Array<')) return 'array'
  if (tsType.includes('{') || tsType.includes('object')) return 'object'
  return 'string'
}

/**
 * Process a component file and generate its schema
 */
export async function generateSchemaForComponent(
  componentPath: string,
  outputDir: string
): Promise<void> {
  const schema = extractPropsFromComponent(componentPath)
  
  if (!schema) {
    console.warn(`Could not extract props from ${componentPath}`)
    return
  }

  const baseName = path.basename(componentPath, path.extname(componentPath))
  const safeName = toCamelCase(baseName)
  
  // Add helper to convert schema to InputDefinition
  const inputsHelper = `
/**
 * Helper function to convert schema props to MCP tool inputs
 */
export function ${safeName}Inputs() {
  return [
${schema.props.map((prop) => `    {
      name: '${prop.name}',
      type: '${mapToInputType(prop.type)}' as const,
      description: ${prop.description ? `'${prop.description.replace(/'/g, "\\'")}'` : `'${prop.name}'`},
      required: ${prop.required},
    }`).join(',\n')}
  ]
}
`
  
  const schemaContent = generateSchemaFile(schema, baseName) + inputsHelper
  
  const outputPath = path.join(outputDir, `${baseName}.schema.ts`)
  await fs.mkdir(outputDir, { recursive: true })
  await fs.writeFile(outputPath, schemaContent, 'utf8')
}

