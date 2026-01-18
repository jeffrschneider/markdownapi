# MAPI to OpenAPI Export

**Purpose:** Generate OpenAPI specification from MAPI for legacy tooling compatibility.

## Field Mapping

| MAPI | OpenAPI |
|------|---------|
| `# Document Title` | `info.title` |
| `~~~meta version:` | `info.version` |
| `~~~meta base_url:` | `servers[0].url` |
| `~~~meta auth:` | `securityDefinitions` + `security` |
| `## Capability:` | `paths.{path}.{method}` |
| `~~~meta id:` | `operationId` |
| `### Intention` | `summary` (first sentence) + `description` |
| `### Logic Constraints` | `description` or `x-mapi-constraints` |
| `### Input` TypeScript | `parameters` + `requestBody.schema` |
| `~~~response 200` | `responses.200.content.schema` |
| `> Errors: standard` | Expand to full `responses` entries |
| `## Global Types` | `components.schemas` |

## TypeScript → JSON Schema

| TypeScript | JSON Schema |
|------------|-------------|
| `field: string` | `"field": { "type": "string" }` |
| `field: number` | `"field": { "type": "number" }` |
| `field: boolean` | `"field": { "type": "boolean" }` |
| `field: Type[]` | `"field": { "type": "array", "items": {...} }` |
| `field: 'a' \| 'b'` | `"field": { "enum": ["a", "b"] }` |
| `field: TypeA \| TypeB` | `"field": { "oneOf": [...] }` |
| `field?: type` | Not in `required` array |
| `field: type // required` | Add to `required` array |
| `// range: 1-100` | `"minimum": 1, "maximum": 100` |
| `// length: 1-50` | `"minLength": 1, "maxLength": 50` |
| `// default: value` | `"default": value` |
| `// format: email` | `"format": "email"` |

## Expanding Standard Errors

MAPI `> Errors: standard (400, 401, 429)` expands to:

```yaml
responses:
  '400':
    description: Bad Request
    content:
      application/json:
        schema:
          $ref: '#/components/schemas/Error'
  '401':
    description: Unauthorized
    content:
      application/json:
        schema:
          $ref: '#/components/schemas/Error'
  '429':
    description: Rate Limited
    content:
      application/json:
        schema:
          $ref: '#/components/schemas/Error'
```

## Preserving MAPI-Specific Content

Features without OpenAPI equivalents go into extensions:

| MAPI Feature | OpenAPI Extension |
|--------------|-------------------|
| `### Intention` (beyond summary) | `x-mapi-intention` |
| `### Logic Constraints` | `x-mapi-constraints` |
| Capability grouping concept | `x-mapi-capability` |

```yaml
paths:
  /messages:
    post:
      operationId: messages.create
      summary: Send a conversation to Claude
      x-mapi-intention: |
        Send a conversation to Claude and receive a response.
        Use this when you want the complete response at once.
      x-mapi-constraints:
        - If stream is true, use the streaming endpoint
        - Messages must alternate user/assistant
```

## Handling SSE Endpoints

MAPI `HTTP POST /path (SSE)` becomes:

```yaml
/path:
  post:
    responses:
      '200':
        description: Event stream
        content:
          text/event-stream:
            schema:
              type: string
              description: See x-mapi-events for event definitions
    x-mapi-events:
      message_start:
        payload: { type: 'message_start', message: Message }
      content_block_delta:
        payload: { type: 'content_block_delta', delta: Delta }
```

Note: OpenAPI cannot fully express SSE event schemas. The `x-mapi-events` extension preserves the information.

## Handling WebSockets

OpenAPI 3.x does not support WebSocket. Options:

1. **Omit** — Skip WebSocket capabilities in OpenAPI output
2. **Extension** — Use `x-mapi-websocket` to preserve definition
3. **Separate file** — Generate AsyncAPI for WebSocket channels

Recommended: Generate both OpenAPI (REST) and AsyncAPI (events) from MAPI.

## Template

```yaml
openapi: 3.1.0
info:
  title: {from # heading}
  version: {from ~~~meta version}
servers:
  - url: {from ~~~meta base_url}
security:
  - {from ~~~meta auth}
paths:
  {path from transport}:
    {method from transport}:
      operationId: {from ~~~meta id}
      summary: {first sentence of Intention}
      description: {rest of Intention}
      x-mapi-constraints: {from Logic Constraints}
      requestBody:
        content:
          application/json:
            schema:
              {convert Input TypeScript}
      responses:
        '200':
          content:
            application/json:
              schema:
                {convert Output TypeScript}
        {expand standard errors}
components:
  schemas:
    {convert Global Types}
```

---

**Wrong card?** See [MAPI-DISCLOSURE.md](MAPI-DISCLOSURE.md) to find the right resource.

**Need more detail?** See the full [MAPI Specification](mapi-specification-v0.94.md).
