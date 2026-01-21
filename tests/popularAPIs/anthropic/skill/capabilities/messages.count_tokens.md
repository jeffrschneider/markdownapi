# Capability: Count Tokens

~~~meta
id: messages.count_tokens
transport: HTTP POST /v1/messages/count_tokens
auth: required
idempotent: true
~~~

## Intention

Count the number of tokens in a message payload without actually running the model. Use this to check if your request fits within context limits before sending, or for cost estimation.

## Input

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| model | string | yes | Model ID to use for tokenization. Use `claude-sonnet-4-20250514`, `claude-3-5-haiku-20241022`, or `claude-opus-4-20250514`. |
| messages | array | yes | Array of message objects with `role` ("user" or "assistant") and `content` (string). |

## Output

| Field | Type | Description |
|-------|------|-------------|
| input_tokens | integer | Number of tokens in the input messages. |

## Example

Request:
```json
{
  "model": "claude-3-5-haiku-20241022",
  "messages": [
    {"role": "user", "content": "Hello, world!"}
  ]
}
```

Response:
```json
{
  "input_tokens": 10
}
```

## Logic Constraints

- Does not consume rate limit quota (separate from message creation)
