# AsyncAPI to MAPI Conversion

**Purpose:** Convert an AsyncAPI specification to MAPI format.

## Field Mapping

| AsyncAPI | MAPI |
|----------|------|
| `info.title` | `# Document Title` |
| `info.version` | `~~~meta` → `version:` |
| `servers.{name}.url` | `~~~meta` → `base_url:` |
| `channels.{path}` | `## Capability:` |
| `subscribe` | Server → Client messages |
| `publish` | Client → Server messages |
| `message.payload` | TypeScript interface |
| `components.schemas` | `## Global Types` |
| `components.messages` | Event definitions |

## Transport Mapping

| AsyncAPI Protocol | MAPI Transport |
|-------------------|----------------|
| `ws` / `wss` | `WS /path` |
| `http` with SSE | `HTTP POST /path (SSE)` |
| `kafka`, `amqp`, etc. | `WS /path` (adapt as needed) |

## WebSocket Template

```markdown
## Capability: {Channel Name}

~~~meta
id: {derive from channel}
transport: WS {channel path}
auth: connection
~~~

### Intention

{Describe the purpose of this realtime channel.}
{When should an agent connect? What data flows through?}

### Client Messages

` ` `typescript
// From AsyncAPI publish.message
type ClientMessage = 
  | { type: 'subscribe'; topics: string[] }
  | { type: 'unsubscribe'; topics: string[] };
` ` `

### Server Messages

` ` `typescript
// From AsyncAPI subscribe.message
type ServerMessage =
  | { type: 'event'; topic: string; payload: unknown }
  | { type: 'error'; code: number; message: string };
` ` `
```

## SSE Template

```markdown
## Capability: {Stream Name}

~~~meta
id: {operationId}
transport: HTTP POST {path} (SSE)
~~~

### Intention

{Describe the streaming endpoint.}

### Input

` ` `typescript
// Request body that initiates the stream
interface StreamRequest { ... }
` ` `

### Events

~~~events
{eventName}:
  {description from AsyncAPI message}
  payload: { type: '{eventName}'; ... }

{anotherEvent}:
  {description}
  payload: { ... }
~~~
```

## Converting Message Types

AsyncAPI `message` with `payload` schema becomes event definition:

```yaml
# AsyncAPI
messages:
  UserSignedUp:
    payload:
      type: object
      properties:
        userId: { type: string }
        email: { type: string }
```

```markdown
# MAPI
~~~events
user_signed_up:
  A new user completed registration
  payload: { type: 'user_signed_up'; userId: string; email: string }
~~~
```

## Handling Multiple Messages

AsyncAPI `oneOf` messages become multiple events:

```yaml
# AsyncAPI
message:
  oneOf:
    - $ref: '#/components/messages/Started'
    - $ref: '#/components/messages/Progress'
    - $ref: '#/components/messages/Completed'
```

```markdown
# MAPI
~~~events
started:
  payload: { type: 'started'; ... }

progress:
  payload: { type: 'progress'; percent: number }

completed:
  payload: { type: 'completed'; result: ... }
~~~
```

---

**Wrong card?** See [MAPI-DISCLOSURE.md](MAPI-DISCLOSURE.md) to find the right resource.

**Need more detail?** See the full [MAPI Specification](mapi-specification-v0.94.md).
