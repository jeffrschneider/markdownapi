# MAPI Auth Reference

**Purpose:** Document authentication requirements in MAPI specifications.

## Philosophy

MAPI treats authentication as a **cross-cutting concern**, not a siloed section. Auth is documented through three complementary mechanisms:

| Where | What | For Whom |
|-------|------|----------|
| **Metadata** | Structured fields (`auth`, `auth_flow`, `auth_scopes`) | Tooling, code generators |
| **Auth Intention** | Prose explaining how to authenticate | LLMs, developers |
| **Logic Constraints** | Runtime auth behaviors | LLMs, developers |

## Document-Level Auth Metadata

Set these in your document's `~~~meta` block:

```yaml
~~~meta
version: 1.0.0
base_url: https://api.example.com/v1
auth: oauth2
auth_flow: authorization_code
auth_scopes: [read, write]
auth_docs_url: https://docs.example.com/auth
~~~
```

| Field | Values | When to Use |
|-------|--------|-------------|
| `auth` | bearer, api_key, basic, oauth2, none | Always required |
| `auth_header` | Header name (default: Authorization) | Non-standard header |
| `auth_flow` | authorization_code, client_credentials, implicit, password | OAuth2 only |
| `auth_scopes` | Array of scope strings | OAuth2 with scopes |
| `auth_docs_url` | URL to auth docs | Complex auth flows |

## Capability-Level Auth Metadata

Override document defaults for specific capabilities:

```yaml
~~~meta
id: admin.delete_user
transport: HTTP DELETE /users/{id}
auth: required
auth_scopes: [admin:write]
~~~
```

## Writing Auth Intentions

The Auth Intention section explains *how* to authenticate—the context that metadata alone cannot convey.

**Include when:**
- OAuth2 flows with specific guidance
- Multiple auth methods available
- Capability-specific auth requirements
- Token refresh or expiry considerations

**Skip when:**
- Simple API key authentication
- Auth is self-explanatory from metadata

### Template

```markdown
### Auth Intention

[How to obtain credentials - the onboarding path]

[Which scopes/permissions are required and why]

[Any capability-specific considerations]

[Alternatives for different integration patterns]
```

### Examples

**OAuth2 with user consent:**
```markdown
### Auth Intention

Requires OAuth2 with `payments:write` scope. Users obtain tokens through
the authorization code flow at `/oauth/authorize`.

For server-to-server integrations without user context, use
client_credentials flow with a service account.

Tokens expire after 1 hour; implement refresh for long-running processes.
```

**API key with tiers:**
```markdown
### Auth Intention

Pass your API key in the `X-API-Key` header. Keys are created in the
Dashboard under Settings > API Keys.

Standard keys: 100 requests/minute
Premium keys: 10,000 requests/minute

For production workloads, use separate keys per environment.
```

**Mixed authentication:**
```markdown
### Auth Intention

Accepts either OAuth2 Bearer tokens or API keys. Use OAuth2 for user-facing
applications; use API keys for server-to-server automation.

API key requests cannot access user-specific data—use OAuth2 with
appropriate scopes for user context.
```

## Auth Logic Constraints

Document authentication *behaviors* in Logic Constraints:

```markdown
### Logic Constraints

- Requests without valid credentials return 401 Unauthorized
- Expired tokens return 401 with `error: token_expired`
- Insufficient scopes return 403 with `required_scopes` in response
- Rate limits: 100/min (standard tier), 1000/min (premium tier)
- Tokens from revoked applications fail immediately
```

**Use Logic Constraints for:**
- Error response behaviors
- Token expiry and refresh rules
- Rate limiting tied to auth tier
- Scope inheritance and overrides
- Token type restrictions

## Complete Example

```markdown
## Capability: Create Payment

~~~meta
id: payments.create
transport: HTTP POST /payments
auth: required
auth_flow: authorization_code
auth_scopes: [payments:write]
~~~

### Intention

Initiates a payment from the authenticated user's account. Use this for
one-time payments; for recurring charges, see subscriptions.create.

### Auth Intention

Requires OAuth2 with `payments:write` scope. Users authorize through
the standard consent flow at `/oauth/authorize`.

For PCI-compliant server-to-server payments, use client_credentials
with a payment processor service account.

### Logic Constraints

- Tokens must include `payments:write` scope
- Service accounts require additional `processor:payments` scope
- Failed auth returns 401 before payment validation
- Insufficient scope returns 403 with required scopes listed

### Input

` ` `typescript
interface CreatePaymentRequest {
  amount: number;        // in cents, min: 50
  currency: string;      // ISO 4217, e.g., "USD"
  recipient_id: string;
}
` ` `

### Output

~~~response 201
` ` `typescript
interface CreatePaymentResponse {
  payment_id: string;
  status: "pending" | "completed";
}
` ` `
~~~

> Errors: standard (400, 401, 403, 429)
```

## Common Mistakes

1. **Auth in wrong place** — Use metadata for *what*, Auth Intention for *how*, Logic Constraints for *behavior*
2. **Over-documenting standard errors** — 401/403 don't need custom schemas
3. **Missing scope guidance** — Always explain what scopes are needed and why
4. **Ignoring M2M flows** — Document both user and service account patterns
5. **Forgetting token lifecycle** — Mention expiry, refresh, and revocation

---

**Need more context?** See the [MAPI Specification](mapi-specification-v0.94.md) section "A Note on Authentication" for the philosophy behind this approach.

**Writing a spec?** See [MAPI-AUTHOR.md](MAPI-AUTHOR.md) for the complete authoring guide.
