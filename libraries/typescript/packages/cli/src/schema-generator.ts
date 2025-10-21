import ts from 'typescript'
import { promises as fs } from 'node:fs'
import path from 'node:path'

interface PropSchema {
  name: string
  type: string
  required: boolean
  description?: string
  enum?: string[]
  validation?: string
}

interface ComponentSchema {
  props: PropSchema[]
  metadata?: {
    description?: string
    inputs?: PropSchema[]
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
  let metadata: { description?: string; inputs?: PropSchema[] } | undefined
  
  // Store variable declarations to resolve references
  const variableDeclarations = new Map<string, ts.Expression>()

  // Find the default export component and extract its props type
  ts.forEachChild(sourceFile, (node) => {
    // Collect variable declarations (for Zod schema references)
    if (ts.isVariableStatement(node)) {
      node.declarationList.declarations.forEach((declaration) => {
        if (
          ts.isVariableDeclaration(declaration) &&
          ts.isIdentifier(declaration.name) &&
          declaration.initializer
        ) {
          variableDeclarations.set(declaration.name.text, declaration.initializer)
        }
      })
    }
  })

  // Second pass to extract metadata and component info
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
                ts.isIdentifier(prop.name)
              ) {
                if (!metadata) metadata = {}
                
                // Extract description
                if (prop.name.text === 'description' && ts.isStringLiteral(prop.initializer)) {
                  metadata.description = prop.initializer.text
                }
                
                // Extract inputs - support array, object, and Zod schema formats
                if (prop.name.text === 'inputs') {
                  let initializer = prop.initializer
                  
                  // Resolve variable references
                  if (ts.isIdentifier(initializer)) {
                    const varName = initializer.text
                    const resolvedExpr = variableDeclarations.get(varName)
                    if (resolvedExpr) {
                      initializer = resolvedExpr
                    }
                  }
                  
                  if (ts.isArrayLiteralExpression(initializer)) {
                    // Array format: [{ name: 'x', type: 'string', ... }]
                    metadata.inputs = extractInputsFromArrayMetadata(initializer)
                  } else if (ts.isObjectLiteralExpression(initializer)) {
                    // Object format: { x: { type: 'string', ... } }
                    metadata.inputs = extractInputsFromObjectMetadata(initializer)
                  } else if (ts.isCallExpression(initializer)) {
                    // Zod schema format: z.object({ x: z.string(), ... })
                    metadata.inputs = extractInputsFromZodSchema(initializer)
                  }
                }
              }
            })
          }
        })
      }
    }
  })

  // If metadata has inputs defined, use those directly
  if (metadata?.inputs && metadata.inputs.length > 0) {
    return {
      props: metadata.inputs,
      metadata,
    }
  }

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

function extractInputsFromArrayMetadata(arrayLiteral: ts.ArrayLiteralExpression): PropSchema[] {
  const inputs: PropSchema[] = []
  
  arrayLiteral.elements.forEach((element) => {
    if (ts.isObjectLiteralExpression(element)) {
      const input: Partial<PropSchema> = {}
      
      element.properties.forEach((prop) => {
        if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) {
          const propName = prop.name.text
          
          if (propName === 'name' && ts.isStringLiteral(prop.initializer)) {
            input.name = prop.initializer.text
          } else if (propName === 'type' && ts.isStringLiteral(prop.initializer)) {
            input.type = prop.initializer.text
          } else if (propName === 'description' && ts.isStringLiteral(prop.initializer)) {
            input.description = prop.initializer.text
          } else if (propName === 'required') {
            if (prop.initializer.kind === ts.SyntaxKind.TrueKeyword) {
              input.required = true
            } else if (prop.initializer.kind === ts.SyntaxKind.FalseKeyword) {
              input.required = false
            }
          } else if (propName === 'enum' && ts.isArrayLiteralExpression(prop.initializer)) {
            input.enum = prop.initializer.elements
              .filter(ts.isStringLiteral)
              .map(e => e.text)
          }
        }
      })
      
      // Only add if required fields are present
      if (input.name && input.type !== undefined) {
        inputs.push({
          name: input.name,
          type: input.type,
          required: input.required ?? false,
          description: input.description,
          enum: input.enum,
        })
      }
    }
  })
  
  return inputs
}

function extractInputsFromObjectMetadata(objectLiteral: ts.ObjectLiteralExpression): PropSchema[] {
  const inputs: PropSchema[] = []
  
  objectLiteral.properties.forEach((property) => {
    if (ts.isPropertyAssignment(property) && ts.isIdentifier(property.name)) {
      const propName = property.name.text
      
      if (ts.isObjectLiteralExpression(property.initializer)) {
        const input: Partial<PropSchema> = {
          name: propName,
        }
        
        property.initializer.properties.forEach((prop) => {
          if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) {
            const configKey = prop.name.text
            
            if (configKey === 'type' && ts.isStringLiteral(prop.initializer)) {
              input.type = prop.initializer.text
            } else if (configKey === 'description' && ts.isStringLiteral(prop.initializer)) {
              input.description = prop.initializer.text
            } else if (configKey === 'required') {
              if (prop.initializer.kind === ts.SyntaxKind.TrueKeyword) {
                input.required = true
              } else if (prop.initializer.kind === ts.SyntaxKind.FalseKeyword) {
                input.required = false
              }
            } else if (configKey === 'enum' && ts.isArrayLiteralExpression(prop.initializer)) {
              input.enum = prop.initializer.elements
                .filter(ts.isStringLiteral)
                .map(e => e.text)
            }
          }
        })
        
        // Only add if required fields are present
        if (input.name && input.type !== undefined) {
          inputs.push({
            name: input.name,
            type: input.type,
            required: input.required ?? false,
            description: input.description,
            enum: input.enum,
          })
        }
      }
    }
  })
  
  return inputs
}

function extractZodValidations(expression: ts.Expression): { validations: string[]; description?: string; isOptional: boolean; enumValues?: string[] } {
  const validations: string[] = []
  let description: string | undefined
  let isOptional = false
  let enumValues: string[] | undefined
  
  // Helper to parse Zod chain calls
  const parseZodChain = (expr: ts.Expression): void => {
    if (ts.isCallExpression(expr)) {
      // Parse the method being called
      if (ts.isPropertyAccessExpression(expr.expression)) {
        const methodName = expr.expression.name.text
        
        // Check for .describe()
        if (methodName === 'describe' && expr.arguments.length > 0) {
          const arg = expr.arguments[0]
          if (ts.isStringLiteral(arg)) {
            description = arg.text
          }
        }
        
        // Check for .optional()
        if (methodName === 'optional') {
          isOptional = true
        }
        
        // Check for validation methods
        if (methodName === 'min' && expr.arguments.length > 0) {
          const arg = expr.arguments[0]
          if (ts.isNumericLiteral(arg)) {
            validations.push(`min: ${arg.text}`)
          }
        }
        
        if (methodName === 'max' && expr.arguments.length > 0) {
          const arg = expr.arguments[0]
          if (ts.isNumericLiteral(arg)) {
            validations.push(`max: ${arg.text}`)
          }
        }
        
        if (methodName === 'email') {
          validations.push('email format')
        }
        
        if (methodName === 'url') {
          validations.push('URL format')
        }
        
        if (methodName === 'uuid') {
          validations.push('UUID format')
        }
        
        if (methodName === 'regex' && expr.arguments.length > 0) {
          validations.push('regex pattern')
        }
        
        if (methodName === 'length' && expr.arguments.length > 0) {
          const arg = expr.arguments[0]
          if (ts.isNumericLiteral(arg)) {
            validations.push(`length: ${arg.text}`)
          }
        }
        
        if (methodName === 'int') {
          validations.push('integer')
        }
        
        if (methodName === 'positive') {
          validations.push('positive')
        }
        
        if (methodName === 'negative') {
          validations.push('negative')
        }
        
        if (methodName === 'nonnegative') {
          validations.push('non-negative')
        }
        
        // Recursively parse the left side of the chain
        parseZodChain(expr.expression.expression)
      }
    } else if (ts.isPropertyAccessExpression(expr)) {
      // Continue parsing property access
      parseZodChain(expr.expression)
    }
  }
  
  parseZodChain(expression)
  
  return { validations, description, isOptional, enumValues }
}

function extractInputsFromZodSchema(callExpression: ts.CallExpression): PropSchema[] {
  const inputs: PropSchema[] = []
  
  // Look for z.object({ ... }) pattern
  if (
    ts.isPropertyAccessExpression(callExpression.expression) &&
    callExpression.expression.name.text === 'object' &&
    callExpression.arguments.length > 0
  ) {
    const schemaArg = callExpression.arguments[0]
    
    if (ts.isObjectLiteralExpression(schemaArg)) {
      schemaArg.properties.forEach((property) => {
        if (ts.isPropertyAssignment(property) && ts.isIdentifier(property.name)) {
          const propName = property.name.text
          const zodType = parseZodType(property.initializer)
          
          if (zodType) {
            inputs.push({
              name: propName,
              type: zodType.type,
              required: zodType.required,
              description: zodType.description,
              enum: zodType.enum,
              validation: zodType.validation,
            })
          }
        }
      })
    }
  }
  
  return inputs
}

function parseZodType(expression: ts.Expression): { type: string; required: boolean; description?: string; enum?: string[]; validation?: string } | null {
  let type = 'string'
  let required = true
  let description: string | undefined
  let enumValues: string[] | undefined
  const validations: string[] = []
  
  // Helper to traverse the chain and find the base type
  const findBaseType = (expr: ts.Expression): void => {
    if (ts.isCallExpression(expr)) {
      // Check if this is a Zod type constructor
      if (ts.isPropertyAccessExpression(expr.expression)) {
        const typeName = expr.expression.name.text
        
        // Map Zod types to basic types
        if (typeName === 'string') {
          type = 'string'
        } else if (typeName === 'number') {
          type = 'number'
        } else if (typeName === 'boolean') {
          type = 'boolean'
        } else if (typeName === 'array') {
          type = 'array'
        } else if (typeName === 'object') {
          type = 'object'
        } else if (typeName === 'enum' && expr.arguments.length > 0) {
          type = 'string'
          const enumArg = expr.arguments[0]
          // z.enum(['a', 'b', 'c']) - array literal directly
          if (ts.isArrayLiteralExpression(enumArg)) {
            enumValues = enumArg.elements
              .filter(ts.isStringLiteral)
              .map(e => e.text)
          }
          // z.enum(['a', 'b'] as const) - array with as const
          else if (ts.isAsExpression(enumArg) && ts.isArrayLiteralExpression(enumArg.expression)) {
            enumValues = enumArg.expression.elements
              .filter(ts.isStringLiteral)
              .map(e => e.text)
          }
        } else if (typeName === 'optional') {
          required = false
        } else if (typeName === 'describe' && expr.arguments.length > 0) {
          const arg = expr.arguments[0]
          if (ts.isStringLiteral(arg)) {
            description = arg.text
          }
        } else if (typeName === 'min' && expr.arguments.length > 0) {
          const arg = expr.arguments[0]
          if (ts.isNumericLiteral(arg)) {
            validations.push(`min: ${arg.text}`)
          } else if (ts.isPrefixUnaryExpression(arg) && arg.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(arg.operand)) {
            validations.push(`min: -${arg.operand.text}`)
          }
        } else if (typeName === 'max' && expr.arguments.length > 0) {
          const arg = expr.arguments[0]
          if (ts.isNumericLiteral(arg)) {
            validations.push(`max: ${arg.text}`)
          } else if (ts.isPrefixUnaryExpression(arg) && arg.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(arg.operand)) {
            validations.push(`max: -${arg.operand.text}`)
          }
        } else if (typeName === 'email') {
          validations.push('email format')
        } else if (typeName === 'url') {
          validations.push('URL format')
        } else if (typeName === 'uuid') {
          validations.push('UUID format')
        } else if (typeName === 'int') {
          validations.push('integer')
        } else if (typeName === 'positive') {
          validations.push('positive')
        } else if (typeName === 'negative') {
          validations.push('negative')
        }
        
        // Recursively check the left side of the property access
        findBaseType(expr.expression.expression)
      }
    } else if (ts.isPropertyAccessExpression(expr)) {
      findBaseType(expr.expression)
    }
  }
  
  findBaseType(expression)
  
  const validation = validations.length > 0 ? validations.join(', ') : undefined
  
  return {
    type,
    required,
    description,
    enum: enumValues,
    validation,
  }
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

