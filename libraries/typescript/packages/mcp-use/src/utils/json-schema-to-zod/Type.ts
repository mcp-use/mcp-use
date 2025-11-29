/**
 * Represents any valid JSON value.
 */
export type JSONValue =
	| string
	| number
	| boolean
	| null
	| JSONObject
	| JSONValue[];

/**
 * Represents a JSON object.
 */
export type JSONObject = {
	[key: string]: JSONValue
};

export type JSONSchema = {
	type?: string | string[];
	properties?: Record<string, JSONSchema>;
	items?: JSONSchema | JSONSchema[];
	required?: string[];
	enum?: (string | number)[];
	format?: string;
	oneOf?: JSONSchema[];
	allOf?: JSONSchema[];
	anyOf?: JSONSchema[];
	additionalProperties?: boolean | JSONSchema;
	[key: string]: any; // For any other additional properties
};

