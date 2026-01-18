# MAPI Consumer Reference

**Purpose:** Understand and invoke an API described in MAPI format.

## Finding Capabilities

Look for `## Capability: <Name>` headings. Each is one callable operation.

## Reading Metadata

```markdown
~~~meta
id: messages.create          ← Operation identifier
transport: HTTP POST /messages   ← Method + path
auth: required               ← Authentication needed
~~~
```

**Transport patterns:**
- `HTTP GET /path` → GET request
- `HTTP POST /path` → POST request  
- `HTTP POST /path/{id}` → Path parameter (substitute `{id}`)
- `HTTP POST /path (SSE)` → Returns Server-Sent Events stream
- `WS /path` → WebSocket connection
- `INTERNAL` → Client-side execution, no network call

## Reading Schemas

TypeScript interfaces define JSON shapes:

```typescript
interface CreateMessageRequest {
  model: string;              // required
  messages: Message[];        // required, minItems: 1
  max_tokens: number;         // required, range: 1-100000
  temperature?: number;       // optional, range: 0-1, default: 1
}
```

**Mapping to JSON:**
- `field: string` → `"field": "value"`
- `field?: type` → optional field (can omit)
- `field: Type[]` → array of Type
- `'a' | 'b'` → enum, one of the literal values
- `// required` → must include
- `// range: min-max` → numeric bounds
- `// default: value` → used if omitted

## Understanding Intent

**`### Intention`** explains *when* to use this capability. Read this to decide if it's the right operation for your task.

**`### Logic Constraints`** lists business rules:
- Cross-field dependencies ("if X, then Y")
- Ordering requirements
- Behavioral conditions

## Handling Responses

**`~~~response 200`** contains the success schema.

**`> Errors: standard (400, 401, 429)`** means standard HTTP error semantics apply.

## SSE Events

If transport includes `(SSE)`, look for `### Events` or `~~~events` block:

```markdown
~~~events
message_start:
  payload: { type: 'message_start'; message: Message }

content_block_delta:
  payload: { type: 'content_block_delta'; delta: Delta }
~~~
```

Events arrive in order listed. Handle by `type` field in payload.

---

**Wrong card?** See [MAPI-DISCLOSURE.md](MAPI-DISCLOSURE.md) to find the right resource.

**Need more detail?** See the full [MAPI Specification](mapi-specification-v0.94.md).
