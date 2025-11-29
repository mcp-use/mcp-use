import { z, ZodSchema, type ZodTypeAny } from 'zod';
import { type JSONSchema, type JSONValue, type JSONObject } from './Type.js';

export class JSONSchemaToZod
{
	/**
	 * Converts a JSON schema to a Zod schema.
	 *
	 * @param {JSONSchema} schema - The JSON schema.
	 * @returns {ZodSchema} - The Zod schema.
	 */
	public static convert(schema: JSONSchema): ZodSchema
	{
		return this.parseSchema(schema);
	}

	/**
	 * Checks if data matches a condition schema.
	 *
	 * @param {JSONValue} data - The data to check.
	 * @param {JSONSchema} condition - The condition schema.
	 * @returns {boolean} - Whether the data matches the condition.
	 */
	private static matchesCondition(data: JSONValue, condition: JSONSchema): boolean
	{
		// If no properties to check, condition is met
		if (!condition.properties)
		{
			return true;
		}

		// If data is not an object or is null, it can't match a schema with properties
		if (typeof data !== 'object' || data === null || Array.isArray(data))
		{
			return false;
		}

		// Now we know data is a JSONObject
		const objectData = data as JSONObject;

		// Check all property conditions
		for (const [key, propCondition] of Object.entries(condition.properties))
		{
			// If property doesn't exist in data
			if (!(key in objectData))
			{
				// If there's a const condition and property is missing, it doesn't match
				if ('const' in propCondition)
				{
					return false;
				}

				// For other conditions, skip this property
				continue;
			}

			const value = objectData[key];

			// Check for const condition
			if ('const' in propCondition && value !== propCondition['const'])
			{
				return false;
			}

			// Check for minimum condition
			if ('minimum' in propCondition && typeof value === 'number' && value < propCondition['minimum'])
			{
				return false;
			}

			// Check for maximum condition
			if ('maximum' in propCondition && typeof value === 'number' && value > propCondition['maximum'])
			{
				return false;
			}
		}

		return true;
	}

	/**
	 * Validates data against a conditional schema and adds issues to context if validation fails.
	 *
	 * @param {JSONValue} data - The data to validate.
	 * @param {JSONSchema} schema - The conditional schema.
	 * @param {z.RefinementCtx} ctx - The Zod refinement context.
	 */
	private static validateConditionalSchema(data: JSONValue, schema: JSONSchema, ctx: z.RefinementCtx): void
	{
		this.validateRequiredProperties(data, schema, ctx);
		this.validatePropertyPatterns(data, schema, ctx);
		this.validateNestedConditions(data, schema, ctx);
	}

	/**
	 * Validates that all required properties are present in the data.
	 *
	 * @param {JSONValue} data - The data to validate.
	 * @param {JSONSchema} schema - The schema containing required properties.
	 * @param {z.RefinementCtx} ctx - The Zod refinement context.
	 */
	private static validateRequiredProperties(data: JSONValue, schema: JSONSchema, ctx: z.RefinementCtx): void
	{
		if (!schema.required)
		{
			return;
		}

		// If data is not an object or is null, all required properties are missing
		if (typeof data !== 'object' || data === null)
		{
			for (const requiredProp of schema.required)
			{
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: `Required property '${requiredProp}' is missing`,
					path: [requiredProp]
				});
			}
			return;
		}

		// Now we know data is an object (either a plain object or an array)
		for (const requiredProp of schema.required)
		{
			if (!(requiredProp in data))
			{
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: `Required property '${requiredProp}' is missing`,
					path: [requiredProp]
				});
			}
		}
	}

	/**
	 * Validates property patterns for string properties.
	 *
	 * @param {JSONValue} data - The data to validate.
	 * @param {JSONSchema} schema - The schema containing property patterns.
	 * @param {z.RefinementCtx} ctx - The Zod refinement context.
	 */
	private static validatePropertyPatterns(data: JSONValue, schema: JSONSchema, ctx: z.RefinementCtx): void
	{
		if (!schema.properties)
		{
			return;
		}

		// If data is not an object or is null, we can't validate property patterns
		if (typeof data !== 'object' || data === null)
		{
			return;
		}

		// If data is an array, we can't validate property patterns
		if (Array.isArray(data))
		{
			return;
		}

		// Now we know data is a JSONObject
		const objectData = data as JSONObject;

		// Process each property in the schema
		for (const [key, propSchema] of Object.entries(schema.properties))
		{
			// Skip if property doesn't exist in data
			if (!(key in objectData))
			{
				continue;
			}

			const value = objectData[key];

			// Check pattern validation for strings
			if (propSchema['pattern'] && typeof value === 'string')
			{
				const regex = new RegExp(propSchema['pattern']);
				if (!regex.test(value))
				{
					ctx.addIssue({
						code: z.ZodIssueCode.custom,
						message: `String '${value}' does not match pattern '${propSchema['pattern']}'`,
						path: [key]
					});
				}
			}
		}
	}

	/**
	 * Validates nested if-then-else conditions.
	 *
	 * @param {JSONValue} data - The data to validate.
	 * @param {JSONSchema} schema - The schema containing if-then-else conditions.
	 * @param {z.RefinementCtx} ctx - The Zod refinement context.
	 */
	private static validateNestedConditions(data: JSONValue, schema: JSONSchema, ctx: z.RefinementCtx): void
	{
		if (!schema['if'] || !schema['then'])
		{
			return;
		}

		const matchesIf = this.matchesCondition(data, schema['if']);
		if (matchesIf)
		{
			this.validateConditionalSchema(data, schema['then'], ctx);
		}
		else if (schema['else'])
		{
			this.validateConditionalSchema(data, schema['else'], ctx);
		}
	}

	/**
	 * Parses a JSON schema and returns the corresponding Zod schema.
	 * This is the main entry point for schema conversion.
	 *
	 * @param {JSONSchema} schema - The JSON schema.
	 * @returns {ZodTypeAny} - The ZodTypeAny schema.
	 */
	private static parseSchema(schema: JSONSchema): ZodTypeAny
	{
		// Handle array of types (e.g., ['string', 'null'] for nullable types)
		if (Array.isArray(schema.type))
		{
			return this.handleTypeArray(schema);
		}

		// Handle combinators (oneOf, anyOf, allOf)
		if (schema.oneOf || schema.anyOf || schema.allOf)
		{
			return this.parseCombinator(schema);
		}

		// Handle if-then-else conditional validation
		if (schema['if'] && schema['then'])
		{
			return this.parseObject(schema);
		}

		// Handle object schema without explicit type but with properties
		if (schema.properties && (!schema.type || schema.type === 'object'))
		{
			return this.parseObject(schema);
		}

		// Handle all other types
		return this.handleSingleType(schema);
	}

	/**
	 * Handles schemas with an array of types.
	 *
	 * @param {JSONSchema} schema - The JSON schema with type array.
	 * @returns {ZodTypeAny} - The ZodTypeAny schema.
	 */
	private static handleTypeArray(schema: JSONSchema): ZodTypeAny
	{
		if (!Array.isArray(schema.type))
		{
			throw new Error('Expected schema.type to be an array');
		}

		// Check if the type array includes 'null' to create a nullable type
		if (schema.type.includes('null'))
		{
			return this.handleNullableType(schema);
		}

		// If no 'null' in the type array, handle as a union of types
		return this.createUnionFromTypes(schema.type, schema);
	}

	/**
	 * Handles nullable types by creating a nullable schema.
	 *
	 * @param {JSONSchema} schema - The JSON schema with nullable type.
	 * @returns {ZodTypeAny} - The nullable Zod schema.
	 */
	private static handleNullableType(schema: JSONSchema): ZodTypeAny
	{
		if (!Array.isArray(schema.type))
		{
			throw new Error('Expected schema.type to be an array');
		}

		// Create a copy of the schema without the 'null' type
		const nonNullSchema = { ...schema };
		nonNullSchema.type = schema.type.filter(t => t !== 'null');

		// If there's only one type left, handle it as a single type and make it nullable
		if (nonNullSchema.type.length === 1)
		{
			const singleTypeSchema = this.handleSingleType({ ...schema, type: nonNullSchema.type[0] });
			return singleTypeSchema.nullable();
		}

		// If multiple non-null types, create a union and make it nullable
		const unionSchema = this.parseSchema(nonNullSchema);
		return unionSchema.nullable();
	}

	/**
	 * Creates a union type from an array of types.
	 *
	 * @param {string[]} types - Array of type strings.
	 * @param {JSONSchema} baseSchema - The base schema to apply to each type.
	 * @returns {ZodTypeAny} - The union Zod schema.
	 */
	private static createUnionFromTypes(types: string[], baseSchema: JSONSchema): ZodTypeAny
	{
		const schemas = types.map(type =>
		{
			const singleTypeSchema = { ...baseSchema, type };
			return this.parseSchema(singleTypeSchema);
		});

		return z.union(schemas as [ZodTypeAny, ZodTypeAny, ...ZodTypeAny[]]);
	}

	/**
	 * Handles schemas with a single type.
	 *
	 * @param {JSONSchema} schema - The JSON schema with single type.
	 * @returns {ZodTypeAny} - The ZodTypeAny schema.
	 */
	private static handleSingleType(schema: JSONSchema): ZodTypeAny
	{
		// Handle schemas without a type property
		if (schema.type === undefined)
		{
			// Check for combinators first
			if (schema.oneOf || schema.anyOf || schema.allOf)
			{
				return this.parseCombinator(schema);
			}

			// Check for object properties
			if (schema.properties)
			{
				return this.parseObject(schema);
			}

			// Default to any() for schemas with no type and no other indicators
			return z.any();
		}

		// Handle specific types
		switch (schema.type)
		{
			case 'string': return this.parseString(schema);
			case 'number':
			case 'integer': return this.parseNumberSchema(schema);
			case 'boolean': return z.boolean();
			case 'array': return this.parseArray(schema);
			case 'object': return this.parseObject(schema);
			default: throw new Error('Unsupported schema type');
		}
	}

	/**
	 * Parses a number schema.
	 *
	 * @param {JSONSchema} schema - The JSON schema for a number.
	 * @returns {ZodTypeAny} - The ZodTypeAny schema.
	 */
	private static parseNumberSchema(schema: JSONSchema): ZodTypeAny
	{
		let numberSchema = z.number();

		// Apply all number validations
		let result: z.ZodTypeAny = numberSchema;
		result = this.applyNumberBounds(numberSchema, schema);
		result = this.applyNumberMultipleOf(numberSchema, schema);
		result = this.applyNumberEnum(numberSchema, schema);
		result = this.applyIntegerConstraint(numberSchema, schema);

		return result;
	}

	/**
	 * Applies bounds validation to a number schema.
	 *
	 * @param {z.ZodNumber} numberSchema - The base number schema.
	 * @param {JSONSchema} schema - The JSON schema with bounds.
	 * @returns {z.ZodNumber} - The updated schema with bounds validation.
	 */
	private static applyNumberBounds(numberSchema: z.ZodNumber, schema: JSONSchema): z.ZodTypeAny
	{
		let result = numberSchema;

		if (schema['minimum'] !== undefined)
		{
			result = schema['exclusiveMinimum'] ?
				result.gt(schema['minimum']) :
				result.gte(schema['minimum']);
		}

		if (schema['maximum'] !== undefined)
		{
			result = schema['exclusiveMaximum'] ?
				result.lt(schema['maximum']) :
				result.lte(schema['maximum']);
		}

		return result;
	}

	/**
	 * Applies multipleOf validation to a number schema.
	 *
	 * @param {z.ZodNumber} numberSchema - The base number schema.
	 * @param {JSONSchema} schema - The JSON schema with multipleOf.
	 * @returns {z.ZodNumber} - The updated schema with multipleOf validation.
	 */
	private static applyNumberMultipleOf(numberSchema: z.ZodNumber, schema: JSONSchema): z.ZodTypeAny
	{
		if (schema['multipleOf'] === undefined)
		{
			return numberSchema;
		}

		return numberSchema.refine(
			val => val % schema['multipleOf']! === 0,
			{ message: `Number must be a multiple of ${schema['multipleOf']}` }
		);
	}

	/**
	 * Applies enum validation to a number schema.
	 *
	 * @param {z.ZodNumber} numberSchema - The base number schema.
	 * @param {JSONSchema} schema - The JSON schema with enum.
	 * @returns {z.ZodNumber} - The updated schema with enum validation.
	 */
	private static applyNumberEnum(numberSchema: z.ZodNumber, schema: JSONSchema): z.ZodTypeAny
	{
		if (!schema.enum)
		{
			return numberSchema;
		}

		// Filter out non-number values from enum
		const numberEnums = schema.enum.filter(val => typeof val === 'number') as number[];
		if (numberEnums.length === 0)
		{
			return numberSchema;
		}

		// Use refinement to validate against enum values
		return numberSchema.refine(
			val => numberEnums.includes(val),
			{ message: `Number must be one of: ${numberEnums.join(', ')}` }
		);
	}

	/**
	 * Applies integer constraint to a number schema if needed.
	 *
	 * @param {z.ZodNumber} numberSchema - The base number schema.
	 * @param {JSONSchema} schema - The JSON schema.
	 * @returns {z.ZodNumber} - The updated schema with integer validation if needed.
	 */
	private static applyIntegerConstraint(numberSchema: z.ZodNumber, schema: JSONSchema): z.ZodTypeAny
	{
		if (schema.type !== 'integer')
		{
			return numberSchema;
		}

		return numberSchema.refine(
			val => Number.isInteger(val),
			{ message: 'Number must be an integer' }
		);
	}

	/**
	 * Parses a string schema.
	 *
	 * @param {JSONSchema} schema - The JSON schema for a string.
	 * @returns {ZodTypeAny} - The ZodTypeAny schema.
	 */
	private static parseString(schema: JSONSchema): ZodTypeAny
	{
		let stringSchema = z.string();
		let result: z.ZodTypeAny = stringSchema;

		// Apply all string validations
		if (schema.format)
		{
			// Handle format-specific string validation
			return this.applyStringFormat(stringSchema, schema);
		}
		else
		{
			// Only apply other validations if format is not specified
			// or apply them to the formatted string
			result = this.applyStringPattern(stringSchema, schema) as z.ZodTypeAny;
			result = this.applyStringLength(stringSchema, schema) as z.ZodTypeAny;
			result = this.applyStringEnum(stringSchema, schema);
		}

		return result;
	}

	/**
	 * Applies format validation to a string schema.
	 *
	 * @param {z.ZodString} stringSchema - The base string schema.
	 * @param {JSONSchema} schema - The JSON schema with format.
	 * @returns {ZodTypeAny} - The updated schema with format validation.
	 */
	private static applyStringFormat(stringSchema: z.ZodString, schema: JSONSchema): ZodTypeAny
	{
		if (!schema.format)
		{
			return stringSchema;
		}

		switch (schema.format)
		{
			case 'email':
				return stringSchema.email();
			case 'date-time':
				return stringSchema.datetime();
			case 'uri':
				return stringSchema.url();
			case 'uuid':
				return stringSchema.uuid();
			case 'date':
				return stringSchema.date();
			default:
				return stringSchema;
		}
	}

	/**
	 * Applies pattern validation to a string schema.
	 *
	 * @param {z.ZodString} stringSchema - The base string schema.
	 * @param {JSONSchema} schema - The JSON schema with pattern.
	 * @returns {z.ZodString} - The updated schema with pattern validation.
	 */
	private static applyStringPattern(stringSchema: z.ZodString, schema: JSONSchema): z.ZodTypeAny
	{
		if (!schema['pattern'])
		{
			return stringSchema;
		}

		const regex = new RegExp(schema['pattern']);
		return stringSchema.regex(regex, { message: `String must match pattern: ${schema['pattern']}` });
	}

	/**
	 * Applies length constraints to a string schema.
	 *
	 * @param {z.ZodString} stringSchema - The base string schema.
	 * @param {JSONSchema} schema - The JSON schema with length constraints.
	 * @returns {z.ZodString} - The updated schema with length validation.
	 */
	private static applyStringLength(stringSchema: z.ZodString, schema: JSONSchema): z.ZodTypeAny
	{
		let result = stringSchema;

		if (schema['minLength'] !== undefined)
		{
			stringSchema = stringSchema.min(schema['minLength']);
		}

		if (schema['maxLength'] !== undefined)
		{
			stringSchema = stringSchema.max(schema['maxLength']);
		}

		return result;
	}

	/**
	 * Applies enum validation to a string schema.
	 *
	 * @param {z.ZodString} stringSchema - The base string schema.
	 * @param {JSONSchema} schema - The JSON schema with enum.
	 * @returns {ZodTypeAny} - The updated schema with enum validation.
	 */
	private static applyStringEnum(stringSchema: z.ZodString, schema: JSONSchema): ZodTypeAny
	{
		if (!schema.enum)
		{
			return stringSchema;
		}

		// Use refinement to validate against enum values
		return stringSchema.refine((val) => schema.enum?.includes(val), {
			message: `Value must be one of: ${schema.enum?.join(', ')}`
		});
	}

	/**
	 * Parses a JSON schema of type array and returns the corresponding Zod schema.
	 *
	 * @param {JSONSchema} schema - The JSON schema.
	 * @returns {ZodTypeAny} - The ZodTypeAny schema.
	 */
	private static parseArray(schema: JSONSchema): ZodTypeAny
	{
		// Handle tuple validation (items is an array)
		if (Array.isArray(schema.items))
		{
			const tupleSchemas = schema.items.map(item => this.parseSchema(item));
			return z.union(tupleSchemas as [ZodTypeAny, ZodTypeAny, ...ZodTypeAny[]]);
		}

		// Create regular array schema
		const itemSchema = schema.items ? this.parseSchema(schema.items) : z.any();
		let arraySchema = z.array(itemSchema);

		// Apply array constraints
		let result: z.ZodTypeAny = arraySchema;
		result = this.applyArrayConstraints(arraySchema, schema);

		return result;
	}

	/**
	 * Applies constraints to an array schema.
	 *
	 * @param {z.ZodArray<any>} arraySchema - The base array schema.
	 * @param {JSONSchema} schema - The JSON schema with array constraints.
	 * @returns {z.ZodTypeAny} - The updated array schema with constraints.
	 */
	private static applyArrayConstraints(arraySchema: z.ZodArray<any>, schema: JSONSchema): z.ZodTypeAny
	{
		// Handle minItems
		if (schema['minItems'] !== undefined)
		{
			arraySchema = arraySchema.min(schema['minItems']);
		}

		// Handle maxItems
		if (schema['maxItems'] !== undefined)
		{
			arraySchema = arraySchema.max(schema['maxItems']);
		}

		// Handle uniqueItems
		if (schema['uniqueItems'])
		{
			return arraySchema.refine(
				(items) => new Set(items).size === items.length,
				{ message: 'Array items must be unique' }
			);
		}

		return arraySchema;
	}

	/**
	 * Parses an object schema.
	 *
	 * @param {JSONSchema} schema - The JSON schema for an object.
	 * @returns {ZodTypeAny} - The ZodTypeAny schema.
	 */
	private static parseObject(schema: JSONSchema): ZodTypeAny
	{
		// Handle conditional validation (if-then-else) first
		if (schema['if'] && schema['then'])
		{
			return this.parseConditional(schema);
		}

		// Create shape object for Zod
		const shape: Record<string, ZodTypeAny> = {};

		// Process properties
		this.processObjectProperties(schema, shape);

		// Create the object schema and handle additionalProperties
		return this.processAdditionalProperties(schema, z.object(shape));
	}

	/**
	 * Processes object properties and builds the shape object.
	 *
	 * @param {JSONSchema} schema - The JSON schema for an object.
	 * @param {Record<string, ZodTypeAny>} shape - The shape object to populate.
	 */
	private static processObjectProperties(schema: JSONSchema, shape: Record<string, ZodTypeAny>): void
	{
		const required = new Set(schema.required || []);

		if (!schema.properties)
		{
			return;
		}

		for (const [key, propSchema] of Object.entries(schema.properties))
		{
			const zodSchema = this.parseSchema(propSchema);
			shape[key] = required.has(key) ? zodSchema : zodSchema.optional();
		}
	}

	/**
	 * Processes additionalProperties configuration.
	 *
	 * @param {JSONSchema} schema - The JSON schema for an object.
	 * @param {z.ZodObject<any, any>} objectSchema - The Zod object schema.
	 * @returns {z.ZodObject<any, any>} - The updated Zod object schema.
	 */
	private static processAdditionalProperties(schema: JSONSchema, objectSchema: z.ZodObject<any, any>): z.ZodObject<any, any>
	{
		if (schema.additionalProperties === true)
		{
			return objectSchema.passthrough();
		}
		else if (schema.additionalProperties && typeof schema.additionalProperties === 'object')
		{
			// Handle schema for additional properties
			const additionalPropSchema = this.parseSchema(schema.additionalProperties);
			return objectSchema.catchall(additionalPropSchema);
		}
		else
		{
			return objectSchema.strict();
		}
	}

	/**
	 * Parses a conditional schema with if-then-else.
	 *
	 * @param {JSONSchema} schema - The JSON schema with conditional validation.
	 * @returns {ZodTypeAny} - The conditional Zod schema.
	 */
	private static parseConditional(schema: JSONSchema): ZodTypeAny
	{
		// Create base object schema
		const zodObject = this.createBaseObjectSchema(schema);

		// Extract conditional parts
		const ifCondition = schema['if'];
		const thenSchema = schema['then'];
		const elseSchema = schema['else'];

		// Apply conditional validation using superRefine
		return zodObject.superRefine((data, ctx) =>
		{
			// Apply default values to data for condition checking
			const dataWithDefaults = this.applyDefaultValues(data, schema);

			// Apply appropriate validation based on condition
			if (this.matchesCondition(dataWithDefaults, ifCondition))
			{
				this.validateConditionalSchema(dataWithDefaults, thenSchema, ctx);
			}
			else if (elseSchema)
			{
				this.validateConditionalSchema(dataWithDefaults, elseSchema, ctx);
			}
		});
	}

	/**
	 * Creates a base object schema from the given JSON schema.
	 *
	 * @param {JSONSchema} schema - The JSON schema.
	 * @returns {z.ZodObject<any, any>} - The base Zod object schema.
	 */
	private static createBaseObjectSchema(schema: JSONSchema): z.ZodObject<any, any>
	{
		const shape: Record<string, ZodTypeAny> = {};
		const required = new Set(schema.required || []);

		for (const [key, value] of Object.entries(schema.properties || {}))
		{
			const zodSchema = this.parseSchema(value);
			shape[key] = required.has(key) ? zodSchema : zodSchema.optional();
		}

		const zodObject = z.object(shape);
		return this.processAdditionalProperties(schema, zodObject);
	}

	/**
	 * Applies default values from schema properties to data object.
	 *
	 * @param {JSONValue} data - The original data object.
	 * @param {JSONSchema} schema - The schema with default values.
	 * @returns {JSONValue} - The data object with defaults applied.
	 */
	private static applyDefaultValues(data: JSONValue, schema: JSONSchema): JSONValue
	{
		// If data is not an object or is null, we can't apply defaults
		if (typeof data !== 'object' || data === null)
		{
			return data;
		}

		// If data is an array, we can't apply defaults from schema properties
		if (Array.isArray(data))
		{
			return data;
		}

		// Now we know data is a JSONObject
		const objectData = data as JSONObject;
		const dataWithDefaults = { ...objectData };

		if (!schema.properties)
		{
			return dataWithDefaults;
		}

		for (const [key, propSchema] of Object.entries(schema.properties))
		{
			if (!(key in dataWithDefaults) && 'default' in propSchema)
			{
				dataWithDefaults[key] = propSchema['default'];
			}
		}

		return dataWithDefaults;
	}

	/**
	 * Parses a schema with combinators (oneOf, anyOf, allOf).
	 * Delegates to the appropriate combinator parser based on which combinator is present.
	 *
	 * @param {JSONSchema} schema - The JSON schema with combinators.
	 * @returns {ZodTypeAny} - The ZodTypeAny schema.
	 */
	private static parseCombinator(schema: JSONSchema): ZodTypeAny
	{
		if (schema.oneOf)
		{
			return this.parseOneOf(schema.oneOf);
		}

		if (schema.anyOf)
		{
			return this.parseAnyOf(schema.anyOf);
		}

		if (schema.allOf)
		{
			return this.parseAllOf(schema.allOf);
		}

		// Should not reach here if schema has combinators
		throw new Error('Unsupported schema type');
	}

	/**
	 * Parses a oneOf combinator schema.
	 *
	 * @param {JSONSchema[]} schemas - Array of JSON schemas in the oneOf.
	 * @returns {ZodTypeAny} - The ZodTypeAny schema.
	 */
	private static parseOneOf(schemas: JSONSchema[]): ZodTypeAny
	{
		return this.createUnionFromSchemas(schemas);
	}

	/**
	 * Parses an anyOf combinator schema.
	 *
	 * @param {JSONSchema[]} schemas - Array of JSON schemas in the anyOf.
	 * @returns {ZodTypeAny} - The ZodTypeAny schema.
	 */
	private static parseAnyOf(schemas: JSONSchema[]): ZodTypeAny
	{
		return this.createUnionFromSchemas(schemas);
	}

	/**
	 * Creates a union from an array of schemas, handling special cases.
	 *
	 * @param {JSONSchema[]} schemas - Array of JSON schemas to create a union from.
	 * @returns {ZodTypeAny} - The union Zod schema.
	 */
	private static createUnionFromSchemas(schemas: JSONSchema[]): ZodTypeAny
	{
		// Handle empty array case
		if (schemas.length === 0)
		{
			return z.any();
		}

		// Handle single schema case
		if (schemas.length === 1)
		{
			return this.parseSchema(schemas[0]);
		}

		// Process each subschema individually
		const zodSchemas: ZodTypeAny[] = [];

		for (const subSchema of schemas)
		{
			// Handle null type specially
			if (subSchema.type === 'null')
			{
				zodSchemas.push(z.null());
			}
			else
			{
				zodSchemas.push(this.parseSchema(subSchema));
			}
		}

		// Return appropriate schema based on number of valid schemas
		if (zodSchemas.length >= 2)
		{
			return z.union(zodSchemas as [ZodTypeAny, ZodTypeAny, ...ZodTypeAny[]]);
		}
		else if (zodSchemas.length === 1)
		{
			return zodSchemas[0];
		}

		// Fallback if no valid schemas were created
		return z.any();
	}

	/**
	 * Parses an allOf combinator schema by merging all schemas.
	 *
	 * @param {JSONSchema[]} schemas - Array of JSON schemas in the allOf.
	 * @returns {ZodTypeAny} - The ZodTypeAny schema.
	 */
	private static parseAllOf(schemas: JSONSchema[]): ZodTypeAny
	{
		// Handle empty array case
		if (schemas.length === 0)
		{
			return z.any();
		}

		// Handle single schema case
		if (schemas.length === 1)
		{
			return this.parseSchema(schemas[0]);
		}

		// Merge all schemas together
		const mergedSchema = schemas.reduce(
			(acc, currentSchema) => this.mergeSchemas(acc, currentSchema)
		);

		return this.parseSchema(mergedSchema);
	}

	/**
	 * Merges two JSON schemas together.
	 *
	 * @param {JSONSchema} baseSchema - The base JSON schema.
	 * @param {JSONSchema} addSchema - The JSON schema to add.
	 * @returns {JSONSchema} - The merged JSON schema
	 */
	private static mergeSchemas(baseSchema: JSONSchema, addSchema: JSONSchema): JSONSchema
	{
		const merged: JSONSchema = { ...baseSchema, ...addSchema };
		if (baseSchema.properties && addSchema.properties)
		{
			const mergedProperties = { ...baseSchema.properties, ...addSchema.properties };
			merged.properties = mergedProperties;
		}
		if (baseSchema.required && addSchema.required)
		{
			const mergedRequired = [...new Set([...baseSchema.required, ...addSchema.required])];
			merged.required = mergedRequired;
		}
		return merged;
	}
}
