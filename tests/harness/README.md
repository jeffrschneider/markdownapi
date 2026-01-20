# MAPI Test Harness

A/B test harness comparing LLM comprehension of OpenAPI vs MAPI specifications.

## Philosophy

**This harness EXPOSES mistakes. It does NOT fix them.**

- Each test case gets ONE shot
- No retries on failure
- No "try again" prompts
- No error correction
- Results recorded exactly as they happen

If a spec fails to communicate clearly, we want to know.

## Setup

```bash
cd tests/harness
npm install
```

Set your Anthropic API key:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

## Usage

### Run a single test

```bash
# Test MAPI spec with Haiku model on Notion API
npm run dev -- run -m haiku -s mapi -a notion

# Test OpenAPI spec with Sonnet model on GitHub API
npm run dev -- run -m sonnet -s openapi -a github
```

### Compare OpenAPI vs MAPI

```bash
# Run both specs and compare results
npm run dev -- compare -m haiku -a anthropic
```

### Run full test suite

```bash
# Test all APIs with both spec formats
npm run dev -- all -m haiku
```

## Options

**Models (`-m, --model`):**
- `haiku` - Claude 3.5 Haiku (fast, cheap, more likely to fail)
- `sonnet` - Claude Sonnet 4 (balanced)
- `opus` - Claude Opus 4 (most capable)

**Spec formats (`-s, --spec`):**
- `openapi` - Original OpenAPI/Swagger spec
- `mapi` - MarkdownAPI spec

**APIs (`-a, --api`):**
- `anthropic` - Anthropic Claude API (15 test cases)
- `github` - GitHub REST API (45 test cases)
- `notion` - Notion API (47 test cases)
- `google-cloud` - Google Cloud Billing API (38 test cases)

## Output

Results are saved to `tests/popularAPIs/{api}/results/` with filenames like:

```
2024-01-15T14-30-22-000Z_mapi_haiku.json
```

Each result file contains:
- Full configuration
- Individual test results (including failures)
- Summary statistics

## Interpreting Results

The key metric is **accuracy** - what percentage of test cases did the LLM correctly route to the expected capability?

A successful test for MAPI would show:
- Higher accuracy with MAPI specs than OpenAPI specs
- The gap is larger with smaller models (Haiku)
- Parse errors are rare (the LLM understood the output format)

A failed test might reveal:
- Ambiguous capability descriptions in the spec
- Missing information needed to distinguish similar operations
- Overly complex spec structure confusing the model

## Test Case Format

Test cases in `test-cases.yaml`:

```yaml
- id: notion-001
  prose: "Find all pages about Q4 planning"
  expected_capability: search
```

The `prose` is the natural language request. The `expected_capability` is the capability ID that should handle it.
