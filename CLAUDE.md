# Claude Project Instructions

## Testing Requirements

When testing API specifications (MAPI, OpenAPI, or Skills), tests are **only valid** if they:

1. **Actually invoke the APIs** - Execute real HTTP requests against live endpoints
2. **View the HTTP response** - Verify the status code and headers
3. **View the response payload** - Validate the actual data returned

Tests that only verify LLM comprehension (e.g., "can the LLM pick the right capability?") are **not sufficient** for proving end-to-end functionality. They measure spec readability, not usability.

### Valid Test Example

```
[test-001] Phase 1: Matching intent...
  Matched: billingAccounts.list ✓
[test-001] Phase 2: Constructing request...
  Request: GET /v1/billingAccounts
[test-001] Phase 3: Executing request...    ← MUST ACTUALLY EXECUTE
  Response: {"billingAccounts":[...]}       ← MUST SEE REAL RESPONSE
[test-001] Phase 4: Validating response...
  ✓ Got 1 billing account(s)
```

### Invalid Test Example

```
[test-001] Asked LLM which capability handles "list billing accounts"
  LLM answered: billingAccounts.list ✓
  TEST PASSED                               ← NOT VALID (no API execution)
```

## Test Model

The default model for testing is `claude-haiku-4-5-20251001`. This ensures tests measure spec quality rather than relying on a more capable model to compensate for unclear specifications.

## E2E Test Runner

Use `tests/harness/src/e2e-runner.ts` to run valid end-to-end tests:

```bash
cd tests/harness
npx tsx src/e2e-runner.ts
```

This runner tests the full agent flow:
1. Load Skill.md index
2. LLM matches intent → capability
3. Load capability + dependencies
4. LLM constructs HTTP request
5. **Execute the request against the real API**
6. **Validate the actual response**

## Rate Limit Handling

**Rate limit errors (429, 529) must NEVER be counted as test failures.**

When hitting rate limits:
1. Implement exponential backoff with retries (starting at 3 seconds, doubling each retry)
2. Retry up to 5 times before giving up
3. If rate limits persist after all retries, **skip the test** - don't count it as a failure
4. Only count as failure if the request fails with a non-rate-limit error

Rate limits indicate infrastructure constraints, not test failures. A test that gets rate-limited is either:
- **Passing** if it succeeds on retry
- **Skipped** if rate limits persist (not counted in success/failure stats)
