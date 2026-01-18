# OpenAPI to MAPI Conversion

**Purpose:** Convert an OpenAPI (Swagger) specification to MAPI format.

## Field Mapping

| OpenAPI | MAPI |
|---------|------|
| `info.title` | `# Document Title` |
| `info.version` | `~~~meta` → `version:` |
| `servers[0].url` | `~~~meta` → `base_url:` |
| `securityDefinitions` | `~~~meta` → `auth:` (bearer/api_key/basic) |
| `paths.{path}.{method}` | `## Capability:` (one per operation) |
| `operationId` | `~~~meta` → `id:` |
| `summary` | First line of `### Intention` |
| `description` | Expand into `### Intention` + `### Logic Constraints` |
| `parameters` | TypeScript interface fields |
| `requestBody.schema` | `### Input` TypeScript interface |
| `responses.200.schema` | `~~~response 200` block |
| `responses.4xx/5xx` | `> Errors: standard (...)` unless custom |
| `components.schemas` | `## Global Types` |

## JSON Schema → TypeScript

| JSON Schema | TypeScript |
|-------------|------------|
| `"type": "string"` | `field: string` |
| `"type": "integer"` | `field: number` |
| `"type": "number"` | `field: number` |
| `"type": "boolean"` | `field: boolean` |
| `"type": "array", "items": X` | `field: X[]` |
| `"type": "object"` | `field: Record<string, unknown>` or inline interface |
| `"enum": ["a", "b"]` | `field: 'a' \| 'b'` |
| `"$ref": "#/.../Name"` | `field: Name` (reference by name) |
| `"required": ["field"]` | `field: type; // required` |
| `"minimum": 1, "maximum": 100` | `// range: 1-100` |
| `"minLength": 1, "maxLength": 50` | `// length: 1-50` |
| `"default": "value"` | `// default: value` |
| `"format": "email"` | `// format: email` |

## Template

```markdown
# {info.title}

{info.description}

~~~meta
version: {info.version}
base_url: {servers[0].url}
auth: {derive from securityDefinitions}
~~~

## Global Types

` ` `typescript
// Convert each components.schemas entry
interface {SchemaName} {
  {properties as TypeScript fields}
}
` ` `

---

## Capability: {Derive name from summary or operationId}

~~~meta
id: {operationId}
transport: HTTP {METHOD} {path}
~~~

### Intention

{Expand summary + description into meaningful prose.}
{Add: when should an agent use this? What's the context?}

### Logic Constraints

{Extract any behavioral rules from description}
{Cross-field dependencies, ordering, conditions}

### Input

` ` `typescript
interface {OperationId}Request {
  {Convert parameters + requestBody}
}
` ` `

### Output

~~~response 200
` ` `typescript
{Convert responses.200.schema}
` ` `
~~~

> Errors: standard ({list applicable codes})
```

## Handling oneOf/anyOf

OpenAPI `oneOf` becomes TypeScript union:

```yaml
# OpenAPI
oneOf:
  - $ref: '#/components/schemas/UserSearch'
  - $ref: '#/components/schemas/OrgSearch'
```

```typescript
// MAPI
type SearchQuery = UserSearch | OrgSearch;
```

For discriminated unions, use a `type` field in each variant.

## Error Consolidation

**Don't convert each error response.** Instead:

1. Check if errors follow standard HTTP semantics
2. Use `> Errors: standard (400, 401, 403, 429, 500)`
3. Only create `~~~response` blocks for custom error shapes

---

**Wrong card?** See [MAPI-DISCLOSURE.md](MAPI-DISCLOSURE.md) to find the right resource.

**Need more detail?** See the full [MAPI Specification](mapi-specification-v0.94.md).
