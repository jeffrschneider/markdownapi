# MAPI Disclosure

**Purpose:** Route to the right MAPI resource based on your task.

## Reference Cards

| Task | Load |
|------|------|
| Invoke/call an API described in MAPI | [MAPI-CONSUMER.md](MAPI-CONSUMER.md) |
| Write a new MAPI spec from scratch | [MAPI-AUTHOR.md](MAPI-AUTHOR.md) |
| Convert OpenAPI/Swagger → MAPI | [OPENAPI-TO-MAPI.md](OPENAPI-TO-MAPI.md) |
| Convert AsyncAPI → MAPI | [ASYNCAPI-TO-MAPI.md](ASYNCAPI-TO-MAPI.md) |
| Export MAPI → OpenAPI | [MAPI-TO-OPENAPI.md](MAPI-TO-OPENAPI.md) |
| Validate a MAPI document | [MAPI-VALIDATOR.md](MAPI-VALIDATOR.md) |

## Task Patterns

- "call this API", "invoke", "use this endpoint", "make a request" → **MAPI-CONSUMER**
- "write a spec", "document this API", "create MAPI for" → **MAPI-AUTHOR**
- "convert from OpenAPI", "migrate from swagger", "openapi.yaml to MAPI" → **OPENAPI-TO-MAPI**
- "convert from AsyncAPI", "event-driven spec to MAPI" → **ASYNCAPI-TO-MAPI**
- "export to OpenAPI", "generate swagger", "need OpenAPI for tooling" → **MAPI-TO-OPENAPI**
- "is this valid", "check the spec", "lint", "verify MAPI" → **MAPI-VALIDATOR**

## Fallback

For edge cases, ambiguity, or detailed specification questions, load the full spec:

→ [mapi-specification-v0.94.md](mapi-specification-v0.94.md)
