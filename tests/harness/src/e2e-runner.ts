/**
 * End-to-End Skill Test Runner
 *
 * Tests the FULL agent flow with REAL API execution:
 * 1. Load Skill.md index
 * 2. LLM matches intent → capability
 * 3. Load capability + dependencies
 * 4. LLM constructs API request
 * 5. Execute the request against live APIs
 * 6. Validate the response
 *
 * Only includes READ-ONLY tests that don't modify data.
 */

import { config } from "dotenv";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleAuth } from "google-auth-library";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

// Load environment variables from project root
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
config({ path: path.join(__dirname, "../../../.env.local"), override: true });

const client = new Anthropic();

// Google Auth client (lazily initialized)
let gcpAuth: GoogleAuth | null = null;
async function getGcpToken(): Promise<string> {
  if (!gcpAuth) {
    gcpAuth = new GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/cloud-billing.readonly"],
    });
  }
  const authClient = await gcpAuth.getClient();
  const token = await authClient.getAccessToken();
  return token.token!;
}

type ApiType = "anthropic" | "github" | "gcp-billing";

interface E2ETestCase {
  id: string;
  userRequest: string;
  api: ApiType;
  expectedCapability: string;
  validateResponse: (response: any) => { pass: boolean; reason: string };
}

interface E2ETestResult {
  testId: string;
  userRequest: string;
  phase1_matchedCapability: string | null;
  phase1_correct: boolean;
  phase2_requestConstructed: any | null;
  phase3_responseReceived: any | null;
  phase4_validationPassed: boolean;
  phase4_validationReason: string;
  overallPass: boolean;
  error?: string;
}

const API_CONFIGS: Record<ApiType, {
  skillPath: string;
  baseUrl: string;
  getHeaders: () => Promise<Record<string, string>>;
}> = {
  anthropic: {
    skillPath: "../../popularAPIs/anthropic/skill",
    baseUrl: "https://api.anthropic.com",
    getHeaders: async () => ({
      "x-api-key": process.env.ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    }),
  },
  github: {
    skillPath: "../../popularAPIs/github/skill",
    baseUrl: "https://api.github.com",
    getHeaders: async () => ({
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    }),
  },
  "gcp-billing": {
    skillPath: "../../popularAPIs/google-cloud/skill",
    baseUrl: "https://cloudbilling.googleapis.com",
    getHeaders: async () => ({
      Authorization: `Bearer ${await getGcpToken()}`,
      "Content-Type": "application/json",
    }),
  },
};

// =============================================================================
// TEST CASES - READ-ONLY ONLY
// =============================================================================

const ANTHROPIC_TESTS: E2ETestCase[] = [
  {
    id: "anthropic-001",
    userRequest: "Count how many tokens are in the message 'Hello, world!'",
    api: "anthropic",
    expectedCapability: "messages.count_tokens",
    validateResponse: (resp) => {
      if (resp.input_tokens && typeof resp.input_tokens === "number") {
        return { pass: true, reason: `Token count: ${resp.input_tokens}` };
      }
      if (resp.error) {
        return { pass: false, reason: `API error: ${resp.error.message}` };
      }
      return { pass: false, reason: "Missing input_tokens field" };
    },
  },
  {
    id: "anthropic-002",
    userRequest: "Count tokens in: 'The quick brown fox jumps over the lazy dog'",
    api: "anthropic",
    expectedCapability: "messages.count_tokens",
    validateResponse: (resp) => {
      if (resp.input_tokens && typeof resp.input_tokens === "number") {
        return { pass: true, reason: `Token count: ${resp.input_tokens}` };
      }
      if (resp.error) {
        return { pass: false, reason: `API error: ${resp.error.message}` };
      }
      return { pass: false, reason: "Missing input_tokens field" };
    },
  },
  {
    id: "anthropic-003",
    userRequest: "Send a message to Claude asking what 2+2 equals. Use claude-3-5-haiku model with max 50 tokens.",
    api: "anthropic",
    expectedCapability: "messages.create",
    validateResponse: (resp) => {
      if (resp.content && resp.content[0]?.text) {
        const text = resp.content[0].text.toLowerCase();
        if (text.includes("4") || text.includes("four")) {
          return { pass: true, reason: `Claude answered: ${resp.content[0].text.substring(0, 50)}` };
        }
        return { pass: false, reason: `Unexpected answer: ${resp.content[0].text.substring(0, 50)}` };
      }
      if (resp.error) {
        return { pass: false, reason: `API error: ${resp.error.message}` };
      }
      return { pass: false, reason: "Missing content" };
    },
  },
  {
    id: "anthropic-004",
    userRequest: "Ask Claude what the capital of France is. Use claude-3-5-haiku with max 100 tokens.",
    api: "anthropic",
    expectedCapability: "messages.create",
    validateResponse: (resp) => {
      if (resp.content && resp.content[0]?.text) {
        const text = resp.content[0].text.toLowerCase();
        if (text.includes("paris")) {
          return { pass: true, reason: `Claude answered: ${resp.content[0].text.substring(0, 50)}` };
        }
        return { pass: false, reason: `Unexpected answer: ${resp.content[0].text.substring(0, 50)}` };
      }
      if (resp.error) {
        return { pass: false, reason: `API error: ${resp.error.message}` };
      }
      return { pass: false, reason: "Missing content" };
    },
  },
  {
    id: "anthropic-005",
    userRequest: "Ask Claude to write a one-line haiku about code. Use claude-3-5-haiku with max 100 tokens.",
    api: "anthropic",
    expectedCapability: "messages.create",
    validateResponse: (resp) => {
      if (resp.content && resp.content[0]?.text && resp.content[0].text.length > 5) {
        return { pass: true, reason: `Claude wrote: ${resp.content[0].text.substring(0, 60)}...` };
      }
      if (resp.error) {
        return { pass: false, reason: `API error: ${resp.error.message}` };
      }
      return { pass: false, reason: "Missing or empty content" };
    },
  },
];

const GITHUB_TESTS: E2ETestCase[] = [
  // repos.get tests
  {
    id: "github-001",
    userRequest: "Get details about the repository jeffrschneider/markdownapi",
    api: "github",
    expectedCapability: "repos.get",
    validateResponse: (resp) => {
      if (resp.full_name === "jeffrschneider/markdownapi") {
        return { pass: true, reason: `Got repo: ${resp.full_name}` };
      }
      if (resp.message) {
        return { pass: false, reason: `API error: ${resp.message}` };
      }
      return { pass: false, reason: "Unexpected response" };
    },
  },
  {
    id: "github-002",
    userRequest: "Get information about the facebook/react repository",
    api: "github",
    expectedCapability: "repos.get",
    validateResponse: (resp) => {
      if (resp.full_name === "facebook/react") {
        return { pass: true, reason: `Got repo: ${resp.full_name}, stars: ${resp.stargazers_count}` };
      }
      if (resp.message) {
        return { pass: false, reason: `API error: ${resp.message}` };
      }
      return { pass: false, reason: "Unexpected response" };
    },
  },
  {
    id: "github-003",
    userRequest: "Show me details of the microsoft/vscode repository",
    api: "github",
    expectedCapability: "repos.get",
    validateResponse: (resp) => {
      if (resp.full_name === "microsoft/vscode") {
        return { pass: true, reason: `Got repo: ${resp.full_name}` };
      }
      if (resp.message) {
        return { pass: false, reason: `API error: ${resp.message}` };
      }
      return { pass: false, reason: "Unexpected response" };
    },
  },
  // issues.list tests
  {
    id: "github-004",
    userRequest: "List the open issues on jeffrschneider/markdownapi",
    api: "github",
    expectedCapability: "issues.list",
    validateResponse: (resp) => {
      if (Array.isArray(resp)) {
        return { pass: true, reason: `Got ${resp.length} issues` };
      }
      if (resp.message) {
        return { pass: false, reason: `API error: ${resp.message}` };
      }
      return { pass: false, reason: "Expected array" };
    },
  },
  {
    id: "github-005",
    userRequest: "List open issues in the facebook/react repository",
    api: "github",
    expectedCapability: "issues.list",
    validateResponse: (resp) => {
      if (Array.isArray(resp)) {
        return { pass: true, reason: `Got ${resp.length} issues` };
      }
      if (resp.message) {
        return { pass: false, reason: `API error: ${resp.message}` };
      }
      return { pass: false, reason: "Expected array" };
    },
  },
  // pulls.list tests
  {
    id: "github-006",
    userRequest: "List all open pull requests in facebook/react",
    api: "github",
    expectedCapability: "pulls.list",
    validateResponse: (resp) => {
      if (Array.isArray(resp)) {
        return { pass: true, reason: `Got ${resp.length} PRs` };
      }
      if (resp.message) {
        return { pass: false, reason: `API error: ${resp.message}` };
      }
      return { pass: false, reason: "Expected array" };
    },
  },
  {
    id: "github-007",
    userRequest: "Show me PRs in kubernetes/kubernetes",
    api: "github",
    expectedCapability: "pulls.list",
    validateResponse: (resp) => {
      if (Array.isArray(resp)) {
        return { pass: true, reason: `Got ${resp.length} PRs` };
      }
      if (resp.message) {
        return { pass: false, reason: `API error: ${resp.message}` };
      }
      return { pass: false, reason: "Expected array" };
    },
  },
];

const GCP_BILLING_TESTS: E2ETestCase[] = [
  // billingAccounts.list tests
  {
    id: "gcp-001",
    userRequest: "List all my billing accounts",
    api: "gcp-billing",
    expectedCapability: "billingAccounts.list",
    validateResponse: (resp) => {
      if (resp.billingAccounts && Array.isArray(resp.billingAccounts)) {
        return { pass: true, reason: `Got ${resp.billingAccounts.length} billing account(s)` };
      }
      if (resp.error) {
        return { pass: false, reason: `API error: ${resp.error.message}` };
      }
      return { pass: false, reason: "Expected billingAccounts array" };
    },
  },
  {
    id: "gcp-002",
    userRequest: "Show me the billing accounts I have access to",
    api: "gcp-billing",
    expectedCapability: "billingAccounts.list",
    validateResponse: (resp) => {
      if (resp.billingAccounts && Array.isArray(resp.billingAccounts)) {
        return { pass: true, reason: `Got ${resp.billingAccounts.length} billing account(s)` };
      }
      if (resp.error) {
        return { pass: false, reason: `API error: ${resp.error.message}` };
      }
      return { pass: false, reason: "Expected billingAccounts array" };
    },
  },
  // billingAccounts.get tests
  {
    id: "gcp-003",
    userRequest: "Get details for billing account 00F713-8B305A-24E5FA",
    api: "gcp-billing",
    expectedCapability: "billingAccounts.get",
    validateResponse: (resp) => {
      if (resp.name && resp.displayName) {
        return { pass: true, reason: `Got: ${resp.displayName}` };
      }
      if (resp.error) {
        return { pass: false, reason: `API error: ${resp.error.message}` };
      }
      return { pass: false, reason: "Expected billing account details" };
    },
  },
  // services.list tests
  {
    id: "gcp-004",
    userRequest: "List all Google Cloud services available",
    api: "gcp-billing",
    expectedCapability: "services.list",
    validateResponse: (resp) => {
      if (resp.services && Array.isArray(resp.services)) {
        return { pass: true, reason: `Got ${resp.services.length} services` };
      }
      if (resp.error) {
        return { pass: false, reason: `API error: ${resp.error.message}` };
      }
      return { pass: false, reason: "Expected services array" };
    },
  },
  {
    id: "gcp-005",
    userRequest: "Show me the catalog of GCP services",
    api: "gcp-billing",
    expectedCapability: "services.list",
    validateResponse: (resp) => {
      if (resp.services && Array.isArray(resp.services)) {
        return { pass: true, reason: `Got ${resp.services.length} services` };
      }
      if (resp.error) {
        return { pass: false, reason: `API error: ${resp.error.message}` };
      }
      return { pass: false, reason: "Expected services array" };
    },
  },
];

// Combine all tests
const ALL_TESTS: E2ETestCase[] = [
  ...ANTHROPIC_TESTS,
  ...GITHUB_TESTS,
  ...GCP_BILLING_TESTS,
];

// =============================================================================
// SKILL LOADING FUNCTIONS
// =============================================================================

async function loadSkillIndex(api: ApiType): Promise<string> {
  const cfg = API_CONFIGS[api];
  const skillPath = path.join(__dirname, cfg.skillPath, "Skill.md");
  return fs.readFileSync(skillPath, "utf-8");
}

async function loadCapability(api: ApiType, capabilityId: string): Promise<string> {
  const cfg = API_CONFIGS[api];
  const capPath = path.join(__dirname, cfg.skillPath, "capabilities", `${capabilityId}.md`);

  if (!fs.existsSync(capPath)) {
    throw new Error(`Capability file not found: ${capPath}`);
  }

  return fs.readFileSync(capPath, "utf-8");
}

async function loadCommon(api: ApiType, filename: string): Promise<string> {
  const cfg = API_CONFIGS[api];
  const commonPath = path.join(__dirname, cfg.skillPath, "common", filename);

  if (!fs.existsSync(commonPath)) {
    return "";
  }

  return fs.readFileSync(commonPath, "utf-8");
}

// =============================================================================
// TEST PHASES
// =============================================================================

async function phase1_matchIntent(
  skillIndex: string,
  userRequest: string
): Promise<string | null> {
  const response = await client.messages.create({
    model: "claude-3-5-haiku-20241022",
    max_tokens: 100,
    messages: [
      {
        role: "user",
        content: `You are an API routing agent. Given the Skill index below and a user request, identify which capability should handle it.

SKILL INDEX:
${skillIndex}

USER REQUEST: ${userRequest}

Respond with ONLY the capability ID (e.g., "messages.create" or "repos.get"). Nothing else.`,
      },
    ],
  });

  const text = response.content[0].type === "text" ? response.content[0].text.trim() : null;
  return text;
}

async function phase2_constructRequest(
  capabilityContent: string,
  authContent: string,
  userRequest: string,
  baseUrl: string
): Promise<any> {
  const response = await client.messages.create({
    model: "claude-3-5-haiku-20241022",
    max_tokens: 500,
    messages: [
      {
        role: "user",
        content: `You are an API request builder. Given the capability spec and user request, construct the exact HTTP request.

CAPABILITY SPEC:
${capabilityContent}

AUTH INFO:
${authContent}

BASE URL: ${baseUrl}

USER REQUEST: ${userRequest}

Respond with ONLY valid JSON in this exact format (no markdown, no explanation):
{"method": "GET|POST|etc", "path": "/v1/...", "body": {...} or null}`,
      },
    ],
  });

  const text = response.content[0].type === "text" ? response.content[0].text.trim() : "";

  // Clean up potential markdown formatting
  let jsonStr = text;
  if (jsonStr.startsWith("```")) {
    jsonStr = jsonStr.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
  }

  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    console.error("Failed to parse LLM response as JSON:", text);
    throw new Error(`Invalid JSON from LLM: ${text}`);
  }
}

async function phase3_executeRequest(
  api: ApiType,
  request: { method: string; path: string; body?: any }
): Promise<any> {
  const cfg = API_CONFIGS[api];
  const url = `${cfg.baseUrl}${request.path}`;
  const headers = await cfg.getHeaders();

  const fetchOptions: RequestInit = {
    method: request.method,
    headers,
  };

  if (request.body && request.method !== "GET") {
    fetchOptions.body = JSON.stringify(request.body);
  }

  const response = await fetch(url, fetchOptions);
  return response.json();
}

// =============================================================================
// TEST RUNNER
// =============================================================================

async function runE2ETest(testCase: E2ETestCase): Promise<E2ETestResult> {
  const result: E2ETestResult = {
    testId: testCase.id,
    userRequest: testCase.userRequest,
    phase1_matchedCapability: null,
    phase1_correct: false,
    phase2_requestConstructed: null,
    phase3_responseReceived: null,
    phase4_validationPassed: false,
    phase4_validationReason: "",
    overallPass: false,
  };

  try {
    // Phase 1: Load skill index and match intent
    console.log(`\n[${testCase.id}] Phase 1: Matching intent...`);
    const skillIndex = await loadSkillIndex(testCase.api);
    const matchedCapability = await phase1_matchIntent(skillIndex, testCase.userRequest);
    result.phase1_matchedCapability = matchedCapability;
    result.phase1_correct = matchedCapability === testCase.expectedCapability;
    console.log(`  Matched: ${matchedCapability} (expected: ${testCase.expectedCapability}) ${result.phase1_correct ? "✓" : "✗"}`);

    if (!matchedCapability) {
      throw new Error("Failed to match capability");
    }

    // Phase 2: Load capability and construct request
    console.log(`[${testCase.id}] Phase 2: Constructing request...`);
    const capabilityContent = await loadCapability(testCase.api, matchedCapability);
    const authContent = await loadCommon(testCase.api, "auth.md");
    const apiConfig = API_CONFIGS[testCase.api];

    const request = await phase2_constructRequest(
      capabilityContent,
      authContent,
      testCase.userRequest,
      apiConfig.baseUrl
    );
    result.phase2_requestConstructed = request;
    console.log(`  Request: ${request.method} ${request.path}`);
    if (request.body) console.log(`  Body: ${JSON.stringify(request.body).substring(0, 100)}...`);

    // Phase 3: Execute the request
    console.log(`[${testCase.id}] Phase 3: Executing request...`);
    const response = await phase3_executeRequest(testCase.api, request);
    result.phase3_responseReceived = response;
    console.log(`  Response: ${JSON.stringify(response).substring(0, 150)}...`);

    // Phase 4: Validate the response
    console.log(`[${testCase.id}] Phase 4: Validating response...`);
    const validation = testCase.validateResponse(response);
    result.phase4_validationPassed = validation.pass;
    result.phase4_validationReason = validation.reason;
    console.log(`  ${validation.pass ? "✓" : "✗"} ${validation.reason}`);

    // Overall pass requires all phases to succeed
    result.overallPass = result.phase1_correct && result.phase4_validationPassed;

  } catch (error) {
    result.error = (error as Error).message;
    console.error(`  ERROR: ${result.error}`);
  }

  return result;
}

async function main() {
  const args = process.argv.slice(2);
  const apiFilter = args.find(a => a.startsWith("--api="))?.split("=")[1] as ApiType | undefined;

  console.log("═══════════════════════════════════════════════════════════════════");
  console.log("  End-to-End Skill Test Runner");
  console.log("═══════════════════════════════════════════════════════════════════");
  console.log("\nThis tests the FULL agent flow with REAL API execution:");
  console.log("  1. Load Skill.md index");
  console.log("  2. LLM matches intent → capability");
  console.log("  3. Load capability, LLM constructs request");
  console.log("  4. Execute REAL API call");
  console.log("  5. Validate response\n");

  // Filter tests if API specified
  let testsToRun = ALL_TESTS;
  if (apiFilter) {
    testsToRun = ALL_TESTS.filter(t => t.api === apiFilter);
    console.log(`Filtering to ${apiFilter} tests only (${testsToRun.length} tests)\n`);
  } else {
    console.log(`Running all ${ALL_TESTS.length} tests\n`);
  }

  const results: E2ETestResult[] = [];

  for (const testCase of testsToRun) {
    const result = await runE2ETest(testCase);
    results.push(result);
  }

  // Summary by API
  console.log("\n═══════════════════════════════════════════════════════════════════");
  console.log("  RESULTS SUMMARY");
  console.log("═══════════════════════════════════════════════════════════════════\n");

  const byApi: Record<string, E2ETestResult[]> = {};
  for (const r of results) {
    const api = r.testId.split("-")[0];
    if (!byApi[api]) byApi[api] = [];
    byApi[api].push(r);
  }

  let totalPassed = 0;
  let totalFailed = 0;

  for (const [api, apiResults] of Object.entries(byApi)) {
    const passed = apiResults.filter(r => r.overallPass).length;
    const failed = apiResults.length - passed;
    totalPassed += passed;
    totalFailed += failed;

    console.log(`  ${api.toUpperCase()}: ${passed}/${apiResults.length} passed`);
    for (const r of apiResults) {
      const status = r.overallPass ? "✓" : "✗";
      console.log(`    ${status} ${r.testId}: ${r.userRequest.substring(0, 45)}...`);
      if (!r.overallPass && r.error) {
        console.log(`      Error: ${r.error.substring(0, 60)}`);
      } else if (!r.overallPass && !r.phase4_validationPassed) {
        console.log(`      ${r.phase4_validationReason}`);
      }
    }
    console.log("");
  }

  console.log("───────────────────────────────────────────────────────────────────");
  console.log(`  TOTAL: ${totalPassed} passed, ${totalFailed} failed out of ${results.length}`);
  console.log("═══════════════════════════════════════════════════════════════════\n");

  process.exit(totalFailed > 0 ? 1 : 0);
}

main().catch(console.error);
