# Capability: Create Message

~~~meta
id: messages.create
transport: HTTP POST /v1/messages
auth: required
idempotent: false
~~~

## Intention

Send a conversation to Claude and receive a response. This is the primary endpoint for all Claude interactions. The model processes the full conversation history provided in the messages array, so include all relevant context.

## Auth Intention

Requires an API key passed in the `x-api-key` header. Obtain keys from the Anthropic Console at console.anthropic.com. Keys are scoped to a workspace and subject to rate limits based on your usage tier.

## Input

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| model | string | yes | Model ID. Use `claude-sonnet-4-20250514`, `claude-3-5-haiku-20241022`, or `claude-opus-4-20250514`. |
| messages | array | yes | Array of message objects with `role` ("user" or "assistant") and `content` (string). |
| max_tokens | integer | yes | Maximum tokens to generate (1-4096). |
| system | string | no | System prompt to set context for Claude. |

## Output

| Field | Type | Description |
|-------|------|-------------|
| id | string | Unique message ID. |
| type | string | Always "message". |
| role | string | Always "assistant". |
| content | array | Array of content blocks. Each has `type` ("text") and `text` (string). |
| stop_reason | string | Why generation stopped: "end_turn", "max_tokens", or "stop_sequence". |
| usage | object | Token counts: `input_tokens` and `output_tokens`. |

## Example

Request:
```json
{
  "model": "claude-3-5-haiku-20241022",
  "max_tokens": 100,
  "messages": [
    {"role": "user", "content": "What is 2+2?"}
  ]
}
```

Response:
```json
{
  "id": "msg_01XFDUDYJgAACzvnptvVoYEL",
  "type": "message",
  "role": "assistant",
  "content": [{"type": "text", "text": "2+2 equals 4."}],
  "stop_reason": "end_turn",
  "usage": {"input_tokens": 12, "output_tokens": 8}
}
```

## Logic Constraints

- Messages must alternate between `user` and `assistant` roles

## Errors

- `overloaded` (529): API is temporarily overloaded. Retry with exponential backoff.
