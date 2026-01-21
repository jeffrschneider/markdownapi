/**
 * Skill Generator
 *
 * Generates MAPI Skill format output from parsed documents.
 */

import {
  SkillOutput,
  CapabilityIndexEntry,
  ParsedMapiDocument,
  ParsedCapability,
  ParsedOpenApiDocument,
  ParsedOpenApiOperation,
  OpenApiSchema,
  ConvertOptions,
  IntentGenerator,
} from '../types.js';
import { extractIntentKeywords } from '../parsers/mapi.js';
import { extractOpenApiIntentKeywords, schemaToTypeScript } from '../parsers/openapi.js';

// ============================================================================
// MAPI → Skill
// ============================================================================

/**
 * Convert a parsed MAPI document to Skill format
 */
export async function generateSkillFromMapi(
  doc: ParsedMapiDocument,
  options: ConvertOptions = {}
): Promise<SkillOutput> {
  const apiName = options.apiName || doc.title;
  const capabilities: Record<string, string> = {};
  const common: Record<string, string> = {};
  const index: CapabilityIndexEntry[] = [];

  // Generate auth.md if auth is specified
  if (doc.meta.auth && doc.meta.auth !== 'none') {
    common['auth.md'] = generateAuthFile(doc.meta);
  }

  // Generate schemas from global types
  if (doc.globalTypes) {
    common['schemas/types.md'] = generateTypesFile(doc.globalTypes);
  }

  // Generate capability files
  for (const cap of doc.capabilities) {
    const fileName = `${cap.meta.id}.md`;
    capabilities[fileName] = generateCapabilityFile(cap);

    // Generate intent keywords
    let keywords: string[];
    if (options.intentGenerator && cap.intention) {
      keywords = await options.intentGenerator.generate(cap.meta.id, cap.intention);
    } else {
      keywords = extractIntentKeywords(cap.intention || cap.name, cap.meta.id);
    }

    // Determine dependencies
    const dependencies = determineMapiDependencies(cap, doc);

    index.push({
      id: cap.meta.id,
      intentKeywords: keywords,
      filePath: `capabilities/${fileName}`,
      dependencies,
    });
  }

  // Generate Skill.md
  const skillMd = generateSkillMd(apiName, doc.description, doc.meta, index, Object.keys(common));

  return {
    skillMd,
    common,
    capabilities,
  };
}

/**
 * Generate the Skill.md index file
 */
function generateSkillMd(
  apiName: string,
  description: string | undefined,
  meta: Record<string, unknown>,
  index: CapabilityIndexEntry[],
  commonFiles: string[]
): string {
  const lines: string[] = [];

  // Header
  lines.push(`# ${apiName}`);
  lines.push('');

  if (description) {
    lines.push(description);
    lines.push('');
  }

  // Metadata
  lines.push('~~~meta');
  if (meta.version) lines.push(`version: ${meta.version}`);
  if (meta.base_url) lines.push(`base_url: ${meta.base_url}`);
  if (meta.auth) lines.push(`auth: ${meta.auth}`);
  lines.push('~~~');
  lines.push('');

  // Common dependencies
  if (commonFiles.length > 0) {
    lines.push('## Common Dependencies');
    lines.push('');
    lines.push('| File | Description |');
    lines.push('|------|-------------|');
    for (const file of commonFiles) {
      const desc = file.includes('auth') ? 'Authentication setup' :
                   file.includes('schema') ? 'Shared type definitions' :
                   file.includes('pagination') ? 'Pagination conventions' : 'Common definitions';
      lines.push(`| common/${file} | ${desc} |`);
    }
    lines.push('');
  }

  // Capabilities index
  lines.push('## Capabilities');
  lines.push('');
  lines.push('| ID | Intent Keywords | File | Dependencies |');
  lines.push('|----|-----------------|------|--------------|');

  for (const entry of index) {
    const keywords = entry.intentKeywords.slice(0, 5).join(', ');
    const deps = entry.dependencies.join(', ') || '-';
    lines.push(`| ${entry.id} | ${keywords} | ${entry.filePath} | ${deps} |`);
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Generate auth.md file
 */
function generateAuthFile(meta: Record<string, unknown>): string {
  const lines: string[] = [];

  lines.push('# Authentication');
  lines.push('');

  const authType = meta.auth as string;

  switch (authType) {
    case 'bearer':
      lines.push('This API uses Bearer token authentication.');
      lines.push('');
      lines.push('## Usage');
      lines.push('');
      lines.push('Include the token in the Authorization header:');
      lines.push('```');
      lines.push('Authorization: Bearer {token}');
      lines.push('```');
      break;

    case 'api_key':
      lines.push('This API uses API key authentication.');
      lines.push('');
      lines.push('## Usage');
      lines.push('');
      const header = meta.auth_header || 'X-API-Key';
      lines.push(`Include the API key in the \`${header}\` header.`);
      break;

    case 'oauth2':
      lines.push('This API uses OAuth 2.0 authentication.');
      lines.push('');
      if (meta.auth_flow) {
        lines.push(`## Flow: ${meta.auth_flow}`);
        lines.push('');
      }
      if (meta.auth_scopes) {
        lines.push('## Default Scopes');
        lines.push('');
        const scopes = Array.isArray(meta.auth_scopes) ? meta.auth_scopes : [meta.auth_scopes];
        for (const scope of scopes) {
          lines.push(`- \`${scope}\``);
        }
      }
      break;

    default:
      lines.push(`Authentication type: ${authType}`);
  }

  if (meta.auth_docs_url) {
    lines.push('');
    lines.push(`## Documentation`);
    lines.push('');
    lines.push(`See [Authentication Docs](${meta.auth_docs_url}) for setup instructions.`);
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Generate types file from global types
 */
function generateTypesFile(globalTypes: string): string {
  const lines: string[] = [];

  lines.push('# Shared Types');
  lines.push('');
  lines.push('```typescript');
  lines.push(globalTypes);
  lines.push('```');
  lines.push('');

  return lines.join('\n');
}

/**
 * Generate a capability file
 */
function generateCapabilityFile(cap: ParsedCapability): string {
  const lines: string[] = [];

  // Header
  lines.push(`# Capability: ${cap.name}`);
  lines.push('');

  // Metadata
  lines.push('~~~meta');
  lines.push(`id: ${cap.meta.id}`);
  lines.push(`transport: ${cap.meta.transport}`);
  if (cap.meta.auth) lines.push(`auth: ${cap.meta.auth}`);
  if (cap.meta.idempotent !== undefined) lines.push(`idempotent: ${cap.meta.idempotent}`);
  if (cap.meta.deprecated) lines.push(`deprecated: ${cap.meta.deprecated}`);
  lines.push('~~~');
  lines.push('');

  // Intention
  if (cap.intention) {
    lines.push('## Intention');
    lines.push('');
    lines.push(cap.intention);
    lines.push('');
  }

  // Auth Intention
  if (cap.authIntention) {
    lines.push('## Auth Intention');
    lines.push('');
    lines.push(cap.authIntention);
    lines.push('');
  }

  // Input
  if (cap.input) {
    lines.push('## Input');
    lines.push('');
    lines.push('```typescript');
    lines.push(cap.input);
    lines.push('```');
    lines.push('');
  }

  // Output
  if (cap.output) {
    lines.push('## Output');
    lines.push('');
    lines.push('```typescript');
    lines.push(cap.output);
    lines.push('```');
    lines.push('');
  }

  // Logic Constraints
  if (cap.logicConstraints) {
    lines.push('## Logic Constraints');
    lines.push('');
    lines.push(cap.logicConstraints);
    lines.push('');
  }

  // Errors
  if (cap.errors) {
    lines.push('## Errors');
    lines.push('');
    lines.push(cap.errors);
    lines.push('');
  }

  // Example
  if (cap.example) {
    lines.push('## Example');
    lines.push('');
    lines.push(cap.example);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Determine dependencies for a MAPI capability
 */
function determineMapiDependencies(cap: ParsedCapability, doc: ParsedMapiDocument): string[] {
  const deps: string[] = [];

  // Always depend on auth if auth is required
  if (cap.meta.auth === 'required' || (cap.meta.auth === undefined && doc.meta.auth !== 'none')) {
    deps.push('auth');
  }

  // Check if capability references global types
  if (doc.globalTypes && cap.rawContent) {
    // Simple heuristic: look for type names in the capability
    const typeMatches = doc.globalTypes.match(/interface\s+(\w+)|type\s+(\w+)/g);
    if (typeMatches) {
      const typeNames = typeMatches.map(m => m.split(/\s+/)[1]);
      for (const typeName of typeNames) {
        if (cap.rawContent.includes(typeName)) {
          deps.push('schemas/types');
          break;
        }
      }
    }
  }

  return deps;
}

// ============================================================================
// OpenAPI → Skill
// ============================================================================

/**
 * Convert a parsed OpenAPI document to Skill format
 */
export async function generateSkillFromOpenApi(
  doc: ParsedOpenApiDocument,
  options: ConvertOptions = {}
): Promise<SkillOutput> {
  const apiName = options.apiName || doc.title;
  const capabilities: Record<string, string> = {};
  const common: Record<string, string> = {};
  const index: CapabilityIndexEntry[] = [];

  // Generate auth.md
  if (doc.auth) {
    common['auth.md'] = generateAuthFromOpenApi(doc);
  }

  // Generate schema files
  if (Object.keys(doc.schemas).length > 0) {
    common['schemas/types.md'] = generateSchemasFromOpenApi(doc.schemas);
  }

  // Generate capability files from operations
  for (const op of doc.operations) {
    const capabilityId = normalizeOperationId(op.operationId);
    const fileName = `${capabilityId}.md`;

    capabilities[fileName] = generateCapabilityFromOperation(op, doc);

    // Generate intent keywords
    let keywords: string[];
    if (options.intentGenerator) {
      const description = op.description || op.summary || op.operationId;
      keywords = await options.intentGenerator.generate(capabilityId, description);
    } else {
      keywords = extractOpenApiIntentKeywords(op);
    }

    // Determine dependencies
    const dependencies = determineOpenApiDependencies(op, doc);

    index.push({
      id: capabilityId,
      intentKeywords: keywords,
      filePath: `capabilities/${fileName}`,
      dependencies,
    });
  }

  // Generate Skill.md
  const meta = {
    version: doc.version,
    base_url: doc.baseUrl,
    auth: doc.auth?.type || 'none',
  };

  const skillMd = generateSkillMd(apiName, doc.description, meta, index, Object.keys(common));

  return {
    skillMd,
    common,
    capabilities,
  };
}

/**
 * Normalize an operationId to MAPI format
 * - If operationId already has dots, preserve it (just lowercase)
 * - If operationId uses underscores only, convert first underscore to dot for hierarchy
 * - Handle camelCase by inserting dots
 */
function normalizeOperationId(operationId: string): string {
  // If already has dots, just lowercase it
  if (operationId.includes('.')) {
    return operationId.toLowerCase();
  }

  // Convert camelCase to dot notation
  let normalized = operationId.replace(/([a-z])([A-Z])/g, '$1.$2').toLowerCase();

  // Convert first underscore to dot for resource.action pattern
  // e.g., "users_create" -> "users.create", "messages_count_tokens" -> "messages.count_tokens"
  normalized = normalized.replace(/_/, '.');

  return normalized;
}

/**
 * Generate auth.md from OpenAPI
 */
function generateAuthFromOpenApi(doc: ParsedOpenApiDocument): string {
  const lines: string[] = [];

  lines.push('# Authentication');
  lines.push('');

  if (!doc.auth) {
    lines.push('No authentication required.');
    return lines.join('\n');
  }

  switch (doc.auth.type) {
    case 'bearer':
      lines.push('This API uses Bearer token authentication.');
      lines.push('');
      lines.push('## Usage');
      lines.push('');
      lines.push('```');
      lines.push('Authorization: Bearer {token}');
      lines.push('```');
      break;

    case 'api_key':
      lines.push('This API uses API key authentication.');
      break;

    case 'oauth2':
      lines.push('This API uses OAuth 2.0 authentication.');
      if (doc.auth.flows) {
        lines.push('');
        lines.push('## Flows');
        lines.push('');
        for (const [flowName] of Object.entries(doc.auth.flows)) {
          lines.push(`- ${flowName}`);
        }
      }
      break;
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Generate schemas file from OpenAPI schemas
 */
function generateSchemasFromOpenApi(schemas: Record<string, unknown>): string {
  const lines: string[] = [];

  lines.push('# Shared Types');
  lines.push('');
  lines.push('```typescript');

  for (const [name, schema] of Object.entries(schemas)) {
    const ts = schemaToTypeScript(schema as any, name, schemas as any);
    if (ts.startsWith('interface')) {
      lines.push(ts);
      lines.push('');
    } else {
      lines.push(`type ${name} = ${ts};`);
      lines.push('');
    }
  }

  lines.push('```');
  return lines.join('\n');
}

/**
 * Generate a capability file from an OpenAPI operation
 */
function generateCapabilityFromOperation(
  op: ParsedOpenApiOperation,
  doc: ParsedOpenApiDocument
): string {
  const lines: string[] = [];
  const capName = op.summary || op.operationId;

  // Header
  lines.push(`# Capability: ${capName}`);
  lines.push('');

  // Metadata
  lines.push('~~~meta');
  lines.push(`id: ${normalizeOperationId(op.operationId)}`);
  lines.push(`transport: HTTP ${op.method} ${op.path}`);
  if (op.security && op.security.length > 0) {
    lines.push('auth: required');
  }
  lines.push('~~~');
  lines.push('');

  // Intention
  lines.push('## Intention');
  lines.push('');
  lines.push(op.description || op.summary || `Performs ${op.operationId} operation.`);
  lines.push('');

  // Input as markdown table
  if (op.parameters?.length || op.requestBody) {
    lines.push('## Input');
    lines.push('');
    lines.push('| Field | Type | Required | Description |');
    lines.push('|-------|------|----------|-------------|');

    // Path and query parameters
    if (op.parameters) {
      for (const param of op.parameters) {
        const required = param.required ? 'yes' : 'no';
        const typeInfo = getTypeDescription(param.schema, doc.schemas);
        const desc = param.description || `Parameter from ${param.in}`;
        lines.push(`| ${param.name} | ${typeInfo.type} | ${required} | ${typeInfo.description || desc} |`);
      }
    }

    // Request body fields
    if (op.requestBody?.content?.['application/json']?.schema) {
      const bodySchema = op.requestBody.content['application/json'].schema;
      const bodyLines = generateInputTableRows(bodySchema, doc.schemas, op.requestBody.required || false);
      lines.push(...bodyLines);
    }

    lines.push('');
  }

  // Output as markdown table
  const successResponse = op.responses?.['200'] || op.responses?.['201'] || op.responses?.['204'];
  if (successResponse?.content?.['application/json']?.schema) {
    lines.push('## Output');
    lines.push('');
    lines.push('| Field | Type | Description |');
    lines.push('|-------|------|-------------|');

    const outputSchema = successResponse.content['application/json'].schema;
    const outputLines = generateOutputTableRows(outputSchema, doc.schemas);
    lines.push(...outputLines);
    lines.push('');
  }

  // Generate Example section
  const example = generateExample(op, doc);
  if (example) {
    lines.push('## Example');
    lines.push('');
    lines.push(example);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Get type description with enum values if available
 */
function getTypeDescription(schema: OpenApiSchema | undefined, schemas: Record<string, unknown>): { type: string; description?: string } {
  if (!schema) return { type: 'string' };

  if (schema.$ref) {
    const refName = schema.$ref.split('/').pop() || 'object';
    const resolvedSchema = (schemas as Record<string, OpenApiSchema>)[refName];
    if (resolvedSchema?.enum) {
      return {
        type: 'string',
        description: `One of: ${resolvedSchema.enum.map(e => `\`${e}\``).join(', ')}`
      };
    }
    return { type: refName };
  }

  if (schema.enum && Array.isArray(schema.enum)) {
    return {
      type: 'string',
      description: `One of: ${schema.enum.map(e => `\`${e}\``).join(', ')}`
    };
  }

  if (schema.type === 'array' && schema.items) {
    const itemType = getTypeDescription(schema.items, schemas);
    return { type: `array of ${itemType.type}`, description: itemType.description };
  }

  if (schema.type === 'object' || schema.properties) {
    return { type: 'object' };
  }

  return { type: schema.type || 'string' };
}

/**
 * Generate input table rows from a schema
 */
function generateInputTableRows(
  schema: OpenApiSchema,
  schemas: Record<string, unknown>,
  parentRequired: boolean
): string[] {
  const lines: string[] = [];

  // Resolve $ref if present
  let resolvedSchema = schema;
  if (schema.$ref) {
    const refName = schema.$ref.split('/').pop() || '';
    resolvedSchema = (schemas as Record<string, OpenApiSchema>)[refName] || schema;
  }

  if (resolvedSchema.properties) {
    const required = new Set(resolvedSchema.required || []);

    for (const [propName, propSchema] of Object.entries(resolvedSchema.properties)) {
      const isRequired = required.has(propName) ? 'yes' : 'no';
      const typeInfo = getTypeDescription(propSchema as OpenApiSchema, schemas);
      const desc = (propSchema as OpenApiSchema).description || typeInfo.description || '';
      lines.push(`| ${propName} | ${typeInfo.type} | ${isRequired} | ${desc} |`);
    }
  }

  return lines;
}

/**
 * Generate output table rows from a schema
 */
function generateOutputTableRows(
  schema: OpenApiSchema,
  schemas: Record<string, unknown>
): string[] {
  const lines: string[] = [];

  // Resolve $ref if present
  let resolvedSchema = schema;
  if (schema.$ref) {
    const refName = schema.$ref.split('/').pop() || '';
    resolvedSchema = (schemas as Record<string, OpenApiSchema>)[refName] || schema;
  }

  if (resolvedSchema.properties) {
    for (const [propName, propSchema] of Object.entries(resolvedSchema.properties)) {
      const typeInfo = getTypeDescription(propSchema as OpenApiSchema, schemas);
      const desc = (propSchema as OpenApiSchema).description || typeInfo.description || '';
      lines.push(`| ${propName} | ${typeInfo.type} | ${desc} |`);
    }
  }

  return lines;
}

/**
 * Generate example request/response
 */
function generateExample(op: ParsedOpenApiOperation, doc: ParsedOpenApiDocument): string | null {
  const lines: string[] = [];

  // Try to build example request
  if (op.requestBody?.content?.['application/json']?.schema) {
    const schema = op.requestBody.content['application/json'].schema;
    const example = generateExampleFromSchema(schema, doc.schemas);
    if (example && Object.keys(example).length > 0) {
      lines.push('Request:');
      lines.push('```json');
      lines.push(JSON.stringify(example, null, 2));
      lines.push('```');
    }
  }

  // Try to build example response
  const successResponse = op.responses?.['200'] || op.responses?.['201'];
  if (successResponse?.content?.['application/json']?.schema) {
    const schema = successResponse.content['application/json'].schema;
    const example = generateExampleFromSchema(schema, doc.schemas);
    if (example && Object.keys(example).length > 0) {
      if (lines.length > 0) lines.push('');
      lines.push('Response:');
      lines.push('```json');
      lines.push(JSON.stringify(example, null, 2));
      lines.push('```');
    }
  }

  return lines.length > 0 ? lines.join('\n') : null;
}

/**
 * Generate example value from a schema
 */
function generateExampleFromSchema(
  schema: OpenApiSchema,
  schemas: Record<string, unknown>,
  depth: number = 0,
  propName?: string
): unknown {
  if (depth > 3) return null; // Prevent infinite recursion

  // Use provided example if available
  if (schema.example !== undefined) return schema.example;

  // Resolve $ref
  if (schema.$ref) {
    const refName = schema.$ref.split('/').pop() || '';
    const resolvedSchema = (schemas as Record<string, OpenApiSchema>)[refName];
    if (resolvedSchema) {
      return generateExampleFromSchema(resolvedSchema, schemas, depth + 1, refName);
    }
    return {};
  }

  // Handle enum - use first value
  if (schema.enum && Array.isArray(schema.enum) && schema.enum.length > 0) {
    return schema.enum[0];
  }

  // Handle array
  if (schema.type === 'array' && schema.items) {
    const itemExample = generateExampleFromSchema(schema.items, schemas, depth + 1);
    return itemExample ? [itemExample] : [];
  }

  // Handle object
  if (schema.type === 'object' || schema.properties) {
    const obj: Record<string, unknown> = {};
    const required = new Set(schema.required || []);

    if (schema.properties) {
      for (const [fieldName, propSchema] of Object.entries(schema.properties)) {
        // Only include required fields and a few optional ones
        if (required.has(fieldName) || Object.keys(obj).length < 5) {
          const propExample = generateExampleFromSchema(propSchema as OpenApiSchema, schemas, depth + 1, fieldName);
          if (propExample !== null) {
            obj[fieldName] = propExample;
          }
        }
      }
    }
    return obj;
  }

  // Handle primitives with context-aware examples
  switch (schema.type) {
    case 'string':
      if (schema.format === 'date-time') return '2024-01-15T12:00:00Z';
      if (schema.format === 'date') return '2024-01-15';
      if (schema.format === 'email') return 'user@example.com';
      if (schema.format === 'uri') return 'https://example.com';
      // Context-aware string examples based on property name
      if (propName) {
        const lower = propName.toLowerCase();
        if (lower === 'role') return 'user';
        if (lower === 'content' || lower === 'text') return 'Hello, how are you?';
        if (lower === 'id') return 'msg_01XYZ';
        if (lower === 'name') return 'example';
        if (lower === 'description') return 'A sample description';
      }
      return 'string';
    case 'integer':
      // Context-aware integer examples
      if (propName) {
        const lower = propName.toLowerCase();
        if (lower.includes('token')) return 1024;
        if (lower === 'max_tokens') return 1024;
      }
      return schema.minimum !== undefined ? schema.minimum : 100;
    case 'number':
      if (propName?.toLowerCase() === 'temperature') return 0.7;
      return schema.minimum !== undefined ? schema.minimum : 1.0;
    case 'boolean':
      return true;
    default:
      return null;
  }
}

/**
 * Generate input interface from OpenAPI operation
 */
function generateInputInterface(op: ParsedOpenApiOperation, doc: ParsedOpenApiDocument): string {
  const lines: string[] = [];
  const interfaceName = `${pascalCase(op.operationId)}Request`;

  lines.push(`interface ${interfaceName} {`);

  // Path and query parameters
  if (op.parameters) {
    for (const param of op.parameters) {
      const optional = param.required ? '' : '?';
      const type = param.schema ? schemaToTypeScript(param.schema, '', doc.schemas, '  ') : 'string';
      const comment = param.description ? `  // ${param.description}` : '';
      const inComment = `// in: ${param.in}`;
      lines.push(`  ${param.name}${optional}: ${type};${comment || ' ' + inComment}`);
    }
  }

  // Request body
  if (op.requestBody?.content) {
    const jsonContent = op.requestBody.content['application/json'];
    if (jsonContent?.schema) {
      const bodyType = schemaToTypeScript(jsonContent.schema, 'body', doc.schemas, '  ');
      if (bodyType.startsWith('interface')) {
        // Inline the properties
        const propsMatch = bodyType.match(/\{([\s\S]*)\}/);
        if (propsMatch) {
          lines.push(propsMatch[1].trim());
        }
      } else {
        lines.push(`  body: ${bodyType};`);
      }
    }
  }

  lines.push('}');
  return lines.join('\n');
}

/**
 * Generate output interface from OpenAPI response
 */
function generateOutputInterface(
  op: ParsedOpenApiOperation,
  response: { content?: Record<string, { schema?: unknown }>; description?: string },
  doc: ParsedOpenApiDocument
): string {
  const interfaceName = `${pascalCase(op.operationId)}Response`;

  if (response.content?.['application/json']?.schema) {
    const schema = response.content['application/json'].schema;
    return schemaToTypeScript(schema as any, interfaceName, doc.schemas);
  }

  return `interface ${interfaceName} {\n  // ${response.description || 'Success'}\n}`;
}

/**
 * Determine dependencies for an OpenAPI operation
 */
function determineOpenApiDependencies(op: ParsedOpenApiOperation, doc: ParsedOpenApiDocument): string[] {
  const deps: string[] = [];

  // Auth dependency
  if (op.security && op.security.length > 0) {
    deps.push('auth');
  }

  // Schema dependencies (simplified - always include if we have schemas)
  if (Object.keys(doc.schemas).length > 0) {
    deps.push('schemas/types');
  }

  return deps;
}

/**
 * Convert string to PascalCase
 */
function pascalCase(str: string): string {
  return str
    .split(/[_.\-\s]+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('');
}
