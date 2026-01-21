/**
 * End-to-End A/B/C Test Runner
 *
 * Compares OpenAPI vs MAPI vs Skill format with REAL API execution.
 *
 * For each test case, runs all three formats and tracks:
 * - Token usage (input/output)
 * - Latency (ms)
 * - Accuracy (correct capability match)
 * - API execution success
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
type SpecFormat = "openapi" | "mapi" | "skill";

interface E2ETestCase {
  id: string;
  userRequest: string;
  api: ApiType;
  expectedCapability: string;
  validateResponse: (response: any) => { pass: boolean; reason: string };
}

interface FormatResult {
  format: SpecFormat;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  matchedCapability: string | null;
  capabilityCorrect: boolean;
  apiSuccess: boolean;
  apiResponse: any;
  validationReason: string;
  error?: string;
  rateLimitSkipped?: boolean; // True if skipped due to rate limit exhaustion
}

interface TestResult {
  testId: string;
  userRequest: string;
  expectedCapability: string;
  results: Record<SpecFormat, FormatResult>;
}

const API_CONFIGS: Record<ApiType, {
  skillPath: string;
  baseUrl: string;
  getHeaders: () => Promise<Record<string, string>>;
  openApiFile: string;
  mapiFile: string;
}> = {
  anthropic: {
    skillPath: "../../popularAPIs/anthropic/skill",
    baseUrl: "https://api.anthropic.com",
    getHeaders: async () => ({
      "x-api-key": process.env.ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    }),
    openApiFile: "../../popularAPIs/anthropic/openapi-messages.yaml",
    mapiFile: "../../popularAPIs/anthropic/anthropic.mapi.md",
  },
  github: {
    skillPath: "../../popularAPIs/github/skill",
    baseUrl: "https://api.github.com",
    getHeaders: async () => ({
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    }),
    openApiFile: "../../popularAPIs/github/openapi.json",
    mapiFile: "../../popularAPIs/github/github.mapi.md",
  },
  "gcp-billing": {
    skillPath: "../../popularAPIs/google-cloud/skill",
    baseUrl: "https://cloudbilling.googleapis.com",
    getHeaders: async () => ({
      Authorization: `Bearer ${await getGcpToken()}`,
      "Content-Type": "application/json",
    }),
    openApiFile: "../../popularAPIs/google-cloud/cloud-billing-openapi.yaml",
    mapiFile: "../../popularAPIs/google-cloud/google-cloud-billing.mapi.md",
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
    userRequest: "Send a message to Claude asking what 2+2 equals. Use claude-3-5-haiku model with max 50 tokens.",
    api: "anthropic",
    expectedCapability: "messages.create",
    validateResponse: (resp) => {
      if (resp.content && resp.content[0]?.text) {
        const text = resp.content[0].text.toLowerCase();
        if (text.includes("4") || text.includes("four")) {
          return { pass: true, reason: `Claude answered correctly` };
        }
        return { pass: false, reason: `Unexpected answer: ${resp.content[0].text.substring(0, 30)}` };
      }
      if (resp.error) {
        return { pass: false, reason: `API error: ${resp.error.message}` };
      }
      return { pass: false, reason: "Missing content" };
    },
  },
  {
    id: "anthropic-003",
    userRequest: "Ask Claude what the capital of France is. Use claude-3-5-haiku with max 100 tokens.",
    api: "anthropic",
    expectedCapability: "messages.create",
    validateResponse: (resp) => {
      if (resp.content && resp.content[0]?.text) {
        const text = resp.content[0].text.toLowerCase();
        if (text.includes("paris")) {
          return { pass: true, reason: `Claude answered correctly` };
        }
        return { pass: false, reason: `Unexpected answer: ${resp.content[0].text.substring(0, 30)}` };
      }
      if (resp.error) {
        return { pass: false, reason: `API error: ${resp.error.message}` };
      }
      return { pass: false, reason: "Missing content" };
    },
  },
];

const GITHUB_TESTS: E2ETestCase[] = [
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
        return { pass: true, reason: `Got repo with ${resp.stargazers_count} stars` };
      }
      if (resp.message) {
        return { pass: false, reason: `API error: ${resp.message}` };
      }
      return { pass: false, reason: "Unexpected response" };
    },
  },
  {
    id: "github-003",
    userRequest: "List the open issues on facebook/react",
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
    id: "github-004",
    userRequest: "List all open pull requests in kubernetes/kubernetes",
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
  {
    id: "gcp-001",
    userRequest: "List all my billing accounts",
    api: "gcp-billing",
    expectedCapability: "billingAccounts.list",
    validateResponse: (resp) => {
      if (resp.billingAccounts && Array.isArray(resp.billingAccounts)) {
        return { pass: true, reason: `Got ${resp.billingAccounts.length} account(s)` };
      }
      if (resp.error) {
        return { pass: false, reason: `API error: ${resp.error.message}` };
      }
      return { pass: false, reason: "Expected billingAccounts array" };
    },
  },
  {
    id: "gcp-002",
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
  {
    id: "gcp-003",
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
];

const ALL_TESTS: E2ETestCase[] = [
  ...ANTHROPIC_TESTS,
  ...GITHUB_TESTS,
  ...GCP_BILLING_TESTS,
];

// =============================================================================
// SPEC LOADING FUNCTIONS
// =============================================================================

function loadOpenApiSpec(api: ApiType): string {
  const cfg = API_CONFIGS[api];
  const specPath = path.join(__dirname, cfg.openApiFile);
  return fs.readFileSync(specPath, "utf-8");
}

function loadMapiSpec(api: ApiType): string {
  const cfg = API_CONFIGS[api];
  const specPath = path.join(__dirname, cfg.mapiFile);
  return fs.readFileSync(specPath, "utf-8");
}

function loadSkillIndex(api: ApiType): string {
  const cfg = API_CONFIGS[api];
  const skillPath = path.join(__dirname, cfg.skillPath, "Skill.md");
  return fs.readFileSync(skillPath, "utf-8");
}

function loadCapability(api: ApiType, capabilityId: string): string {
  const cfg = API_CONFIGS[api];
  const capPath = path.join(__dirname, cfg.skillPath, "capabilities", `${capabilityId}.md`);
  if (!fs.existsSync(capPath)) {
    throw new Error(`Capability file not found: ${capPath}`);
  }
  return fs.readFileSync(capPath, "utf-8");
}

function loadCommon(api: ApiType, filename: string): string {
  const cfg = API_CONFIGS[api];
  const commonPath = path.join(__dirname, cfg.skillPath, "common", filename);
  if (!fs.existsSync(commonPath)) {
    return "";
  }
  return fs.readFileSync(commonPath, "utf-8");
}

// =============================================================================
// RATE LIMIT HANDLING
// =============================================================================

const MAX_RETRIES = 5;
const BASE_DELAY_MS = 3000;

// Custom error class to identify rate limit exhaustion
class RateLimitExhaustedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimitExhaustedError";
  }
}

// Check if error is a transient error that should be retried
function isTransientError(error: any): boolean {
  if (isRateLimitError(error)) return true;
  const msg = error?.message?.toLowerCase() || "";
  // Connection errors are often transient
  if (msg.includes("connection") || msg.includes("timeout") || msg.includes("econnreset")) return true;
  return false;
}

function isRateLimitError(error: any): boolean {
  if (error?.status === 429 || error?.status === 529) return true;
  if (error?.error?.type === "rate_limit_error") return true;
  const msg = error?.message?.toLowerCase() || "";
  if (msg.includes("429") || msg.includes("rate") || msg.includes("overloaded")) return true;
  // Connection errors after rate limiting often indicate we should back off
  if (msg.includes("connection error") || msg.includes("connection reset")) return true;
  return false;
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function withRetry<T>(
  fn: () => Promise<T>,
  context: string
): Promise<T> {
  let lastError: any;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      if (isTransientError(error) && attempt < MAX_RETRIES - 1) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt);
        const errorType = isRateLimitError(error) ? "rate limited" : "transient error";
        console.log(`\n    [${errorType} on ${context}, waiting ${delay}ms...]`);
        await sleep(delay);
      } else if (!isTransientError(error)) {
        throw error; // Non-transient error, don't retry
      }
    }
  }
  // If we get here and it was a rate limit error, throw special error
  if (isRateLimitError(lastError)) {
    throw new RateLimitExhaustedError(`Rate limit exhausted after ${MAX_RETRIES} retries on ${context}`);
  }
  throw lastError;
}

// =============================================================================
// LLM CALLS WITH TOKEN TRACKING
// =============================================================================

interface LLMResult {
  content: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

async function callLLM(systemPrompt: string, userPrompt: string): Promise<LLMResult> {
  const startTime = Date.now();

  const response = await withRetry(
    () => client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 500,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
    "LLM call"
  );

  const latencyMs = Date.now() - startTime;
  const content = response.content[0].type === "text" ? response.content[0].text.trim() : "";

  return {
    content,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    latencyMs,
  };
}

// =============================================================================
// TEST EXECUTION BY FORMAT
// =============================================================================

async function runWithOpenApi(
  testCase: E2ETestCase,
  spec: string
): Promise<FormatResult> {
  const result: FormatResult = {
    format: "openapi",
    inputTokens: 0,
    outputTokens: 0,
    latencyMs: 0,
    matchedCapability: null,
    capabilityCorrect: false,
    apiSuccess: false,
    apiResponse: null,
    validationReason: "",
  };

  try {
    // Phase 1: Match intent
    const matchResult = await callLLM(
      `You are an API routing agent. Given the OpenAPI specification below and a user request, identify which operation should handle it.\n\nOPENAPI SPEC:\n${spec}\n\nRespond with ONLY the operationId. Nothing else.`,
      testCase.userRequest
    );
    result.inputTokens += matchResult.inputTokens;
    result.outputTokens += matchResult.outputTokens;
    result.latencyMs += matchResult.latencyMs;
    result.matchedCapability = matchResult.content.replace(/['"]/g, "").trim();
    result.capabilityCorrect = result.matchedCapability === testCase.expectedCapability;

    // Phase 2: Construct request
    const constructResult = await callLLM(
      `You are an API request builder. Given the OpenAPI spec and user request, construct the HTTP request.\n\nOPENAPI SPEC:\n${spec}\n\nBASE URL: ${API_CONFIGS[testCase.api].baseUrl}\n\nRespond with ONLY valid JSON: {"method": "...", "path": "...", "body": ... or null}`,
      testCase.userRequest
    );
    result.inputTokens += constructResult.inputTokens;
    result.outputTokens += constructResult.outputTokens;
    result.latencyMs += constructResult.latencyMs;

    // Parse and execute
    let jsonStr = constructResult.content;
    if (jsonStr.startsWith("```")) {
      jsonStr = jsonStr.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    }
    const request = JSON.parse(jsonStr);

    // Execute API call with retry
    const cfg = API_CONFIGS[testCase.api];
    const headers = await cfg.getHeaders();
    const fetchOptions: RequestInit = { method: request.method, headers };
    if (request.body && request.method !== "GET") {
      fetchOptions.body = JSON.stringify(request.body);
    }

    result.apiResponse = await withRetry(async () => {
      const response = await fetch(`${cfg.baseUrl}${request.path}`, fetchOptions);
      if (response.status === 429 || response.status === 529) {
        const error: any = new Error(`Rate limited: ${response.status}`);
        error.status = response.status;
        throw error;
      }
      return response.json();
    }, "API call");

    // Validate
    const validation = testCase.validateResponse(result.apiResponse);
    result.apiSuccess = validation.pass;
    result.validationReason = validation.reason;

  } catch (error) {
    if (error instanceof RateLimitExhaustedError) {
      result.rateLimitSkipped = true;
      result.validationReason = "Skipped: rate limit exhausted";
    } else {
      result.error = (error as Error).message;
      result.validationReason = `Error: ${result.error}`;
    }
  }

  return result;
}

async function runWithMapi(
  testCase: E2ETestCase,
  spec: string
): Promise<FormatResult> {
  const result: FormatResult = {
    format: "mapi",
    inputTokens: 0,
    outputTokens: 0,
    latencyMs: 0,
    matchedCapability: null,
    capabilityCorrect: false,
    apiSuccess: false,
    apiResponse: null,
    validationReason: "",
  };

  try {
    // Phase 1: Match intent
    const matchResult = await callLLM(
      `You are an API routing agent. Given the MAPI specification below and a user request, identify which capability should handle it.\n\nMAPI SPEC:\n${spec}\n\nRespond with ONLY the capability ID. Nothing else.`,
      testCase.userRequest
    );
    result.inputTokens += matchResult.inputTokens;
    result.outputTokens += matchResult.outputTokens;
    result.latencyMs += matchResult.latencyMs;
    result.matchedCapability = matchResult.content.replace(/['"]/g, "").trim();
    result.capabilityCorrect = result.matchedCapability === testCase.expectedCapability;

    // Phase 2: Construct request
    const constructResult = await callLLM(
      `You are an API request builder. Given the MAPI spec and user request, construct the HTTP request.\n\nMAPI SPEC:\n${spec}\n\nBASE URL: ${API_CONFIGS[testCase.api].baseUrl}\n\nRespond with ONLY valid JSON: {"method": "...", "path": "...", "body": ... or null}`,
      testCase.userRequest
    );
    result.inputTokens += constructResult.inputTokens;
    result.outputTokens += constructResult.outputTokens;
    result.latencyMs += constructResult.latencyMs;

    // Parse and execute
    let jsonStr = constructResult.content;
    if (jsonStr.startsWith("```")) {
      jsonStr = jsonStr.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    }
    const request = JSON.parse(jsonStr);

    // Execute API call with retry
    const cfg = API_CONFIGS[testCase.api];
    const headers = await cfg.getHeaders();
    const fetchOptions: RequestInit = { method: request.method, headers };
    if (request.body && request.method !== "GET") {
      fetchOptions.body = JSON.stringify(request.body);
    }

    result.apiResponse = await withRetry(async () => {
      const response = await fetch(`${cfg.baseUrl}${request.path}`, fetchOptions);
      if (response.status === 429 || response.status === 529) {
        const error: any = new Error(`Rate limited: ${response.status}`);
        error.status = response.status;
        throw error;
      }
      return response.json();
    }, "MAPI API call");

    // Validate
    const validation = testCase.validateResponse(result.apiResponse);
    result.apiSuccess = validation.pass;
    result.validationReason = validation.reason;

  } catch (error) {
    if (error instanceof RateLimitExhaustedError) {
      result.rateLimitSkipped = true;
      result.validationReason = "Skipped: rate limit exhausted";
    } else {
      result.error = (error as Error).message;
      result.validationReason = `Error: ${result.error}`;
    }
  }

  return result;
}

async function runWithSkill(
  testCase: E2ETestCase,
  skillIndex: string
): Promise<FormatResult> {
  const result: FormatResult = {
    format: "skill",
    inputTokens: 0,
    outputTokens: 0,
    latencyMs: 0,
    matchedCapability: null,
    capabilityCorrect: false,
    apiSuccess: false,
    apiResponse: null,
    validationReason: "",
  };

  try {
    // Phase 1: Match intent (uses only Skill.md index - small!)
    const matchResult = await callLLM(
      `You are an API routing agent. Given the Skill index below and a user request, identify which capability should handle it.\n\nSKILL INDEX:\n${skillIndex}\n\nRespond with ONLY the capability ID. Nothing else.`,
      testCase.userRequest
    );
    result.inputTokens += matchResult.inputTokens;
    result.outputTokens += matchResult.outputTokens;
    result.latencyMs += matchResult.latencyMs;
    result.matchedCapability = matchResult.content.replace(/['"]/g, "").trim();
    result.capabilityCorrect = result.matchedCapability === testCase.expectedCapability;

    if (!result.matchedCapability) {
      throw new Error("Failed to match capability");
    }

    // Phase 2: Load capability file and construct request (progressive loading!)
    const capabilityContent = loadCapability(testCase.api, result.matchedCapability);
    const authContent = loadCommon(testCase.api, "auth.md");

    const constructResult = await callLLM(
      `You are an API request builder. Given the capability spec and user request, construct the HTTP request.\n\nCAPABILITY SPEC:\n${capabilityContent}\n\nAUTH INFO:\n${authContent}\n\nBASE URL: ${API_CONFIGS[testCase.api].baseUrl}\n\nRespond with ONLY valid JSON: {"method": "...", "path": "...", "body": ... or null}`,
      testCase.userRequest
    );
    result.inputTokens += constructResult.inputTokens;
    result.outputTokens += constructResult.outputTokens;
    result.latencyMs += constructResult.latencyMs;

    // Parse and execute
    let jsonStr = constructResult.content;
    if (jsonStr.startsWith("```")) {
      jsonStr = jsonStr.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    }
    const request = JSON.parse(jsonStr);

    // Execute API call with retry
    const cfg = API_CONFIGS[testCase.api];
    const headers = await cfg.getHeaders();
    const fetchOptions: RequestInit = { method: request.method, headers };
    if (request.body && request.method !== "GET") {
      fetchOptions.body = JSON.stringify(request.body);
    }

    result.apiResponse = await withRetry(async () => {
      const response = await fetch(`${cfg.baseUrl}${request.path}`, fetchOptions);
      if (response.status === 429 || response.status === 529) {
        const error: any = new Error(`Rate limited: ${response.status}`);
        error.status = response.status;
        throw error;
      }
      return response.json();
    }, "Skill API call");

    // Validate
    const validation = testCase.validateResponse(result.apiResponse);
    result.apiSuccess = validation.pass;
    result.validationReason = validation.reason;

  } catch (error) {
    if (error instanceof RateLimitExhaustedError) {
      result.rateLimitSkipped = true;
      result.validationReason = "Skipped: rate limit exhausted";
    } else {
      result.error = (error as Error).message;
      result.validationReason = `Error: ${result.error}`;
    }
  }

  return result;
}

// =============================================================================
// MAIN TEST RUNNER
// =============================================================================

async function runTest(testCase: E2ETestCase): Promise<TestResult> {
  console.log(`\n[${testCase.id}] ${testCase.userRequest.substring(0, 50)}...`);

  // Load specs once per test
  const openApiSpec = loadOpenApiSpec(testCase.api);
  const mapiSpec = loadMapiSpec(testCase.api);
  const skillIndex = loadSkillIndex(testCase.api);

  // Run all three formats
  const formatStatus = (r: FormatResult) => {
    if (r.rateLimitSkipped) return "⊘ (rate limited - skipped)";
    if (r.apiSuccess) return "✓";
    return `✗ (${r.validationReason.substring(0, 40)})`;
  };

  process.stdout.write("  OpenAPI: ");
  const openApiResult = await runWithOpenApi(testCase, openApiSpec);
  console.log(formatStatus(openApiResult));

  process.stdout.write("  MAPI:    ");
  const mapiResult = await runWithMapi(testCase, mapiSpec);
  console.log(formatStatus(mapiResult));

  process.stdout.write("  Skill:   ");
  const skillResult = await runWithSkill(testCase, skillIndex);
  console.log(formatStatus(skillResult));

  return {
    testId: testCase.id,
    userRequest: testCase.userRequest,
    expectedCapability: testCase.expectedCapability,
    results: {
      openapi: openApiResult,
      mapi: mapiResult,
      skill: skillResult,
    },
  };
}

async function main() {
  console.log("═══════════════════════════════════════════════════════════════════════════");
  console.log("  End-to-End A/B/C Test: OpenAPI vs MAPI vs Skill");
  console.log("═══════════════════════════════════════════════════════════════════════════");
  console.log("\nThis tests the FULL agent flow with REAL API execution.");
  console.log("Each test runs against all three spec formats and compares:\n");
  console.log("  - Token usage (input + output)");
  console.log("  - Latency (ms)");
  console.log("  - Capability matching accuracy");
  console.log("  - API execution success\n");

  const results: TestResult[] = [];

  for (const testCase of ALL_TESTS) {
    const result = await runTest(testCase);
    results.push(result);
  }

  // Aggregate stats (excluding rate-limited tests from counts)
  const stats: Record<SpecFormat, {
    totalInputTokens: number;
    totalOutputTokens: number;
    totalLatencyMs: number;
    correctMatches: number;
    apiSuccesses: number;
    total: number;        // Non-skipped tests
    skipped: number;      // Rate-limited tests
  }> = {
    openapi: { totalInputTokens: 0, totalOutputTokens: 0, totalLatencyMs: 0, correctMatches: 0, apiSuccesses: 0, total: 0, skipped: 0 },
    mapi: { totalInputTokens: 0, totalOutputTokens: 0, totalLatencyMs: 0, correctMatches: 0, apiSuccesses: 0, total: 0, skipped: 0 },
    skill: { totalInputTokens: 0, totalOutputTokens: 0, totalLatencyMs: 0, correctMatches: 0, apiSuccesses: 0, total: 0, skipped: 0 },
  };

  for (const result of results) {
    for (const format of ["openapi", "mapi", "skill"] as SpecFormat[]) {
      const r = result.results[format];
      // Rate-limited tests don't count as failures
      if (r.rateLimitSkipped) {
        stats[format].skipped += 1;
        continue;
      }
      stats[format].totalInputTokens += r.inputTokens;
      stats[format].totalOutputTokens += r.outputTokens;
      stats[format].totalLatencyMs += r.latencyMs;
      stats[format].correctMatches += r.capabilityCorrect ? 1 : 0;
      stats[format].apiSuccesses += r.apiSuccess ? 1 : 0;
      stats[format].total += 1;
    }
  }

  // Print comparison table
  console.log("\n═══════════════════════════════════════════════════════════════════════════");
  console.log("  A/B/C COMPARISON RESULTS");
  console.log("═══════════════════════════════════════════════════════════════════════════\n");

  console.log("                          OpenAPI          MAPI           Skill");
  console.log("  ───────────────────────────────────────────────────────────────────────");

  const openapi = stats.openapi;
  const mapi = stats.mapi;
  const skill = stats.skill;

  const openApiTokens = openapi.totalInputTokens + openapi.totalOutputTokens;
  const mapiTokens = mapi.totalInputTokens + mapi.totalOutputTokens;
  const skillTokens = skill.totalInputTokens + skill.totalOutputTokens;

  const pct = (n: number, d: number) => d > 0 ? ((n / d) * 100).toFixed(0) : "N/A";
  const avgLatency = (total: number, count: number) => count > 0 ? (total / count).toFixed(0) : "N/A";

  console.log(`  API Success Rate:       ${pct(openapi.apiSuccesses, openapi.total).padStart(5)}%         ${pct(mapi.apiSuccesses, mapi.total).padStart(5)}%         ${pct(skill.apiSuccesses, skill.total).padStart(5)}%`);
  console.log(`  Capability Accuracy:    ${pct(openapi.correctMatches, openapi.total).padStart(5)}%         ${pct(mapi.correctMatches, mapi.total).padStart(5)}%         ${pct(skill.correctMatches, skill.total).padStart(5)}%`);
  console.log(`  Total Input Tokens:     ${openapi.totalInputTokens.toString().padStart(6)}         ${mapi.totalInputTokens.toString().padStart(6)}         ${skill.totalInputTokens.toString().padStart(6)}`);
  console.log(`  Total Output Tokens:    ${openapi.totalOutputTokens.toString().padStart(6)}         ${mapi.totalOutputTokens.toString().padStart(6)}         ${skill.totalOutputTokens.toString().padStart(6)}`);
  console.log(`  Total Tokens:           ${openApiTokens.toString().padStart(6)}         ${mapiTokens.toString().padStart(6)}         ${skillTokens.toString().padStart(6)}`);
  console.log(`  Avg Latency (ms):       ${avgLatency(openapi.totalLatencyMs, openapi.total).padStart(6)}         ${avgLatency(mapi.totalLatencyMs, mapi.total).padStart(6)}         ${avgLatency(skill.totalLatencyMs, skill.total).padStart(6)}`);
  console.log(`  Total Latency (ms):     ${openapi.totalLatencyMs.toString().padStart(6)}         ${mapi.totalLatencyMs.toString().padStart(6)}         ${skill.totalLatencyMs.toString().padStart(6)}`);

  console.log("\n  ───────────────────────────────────────────────────────────────────────");
  console.log("  Token Efficiency vs OpenAPI:");
  console.log(`    MAPI:  ${((mapiTokens / openApiTokens) * 100).toFixed(1)}% of OpenAPI tokens`);
  console.log(`    Skill: ${((skillTokens / openApiTokens) * 100).toFixed(1)}% of OpenAPI tokens (${(100 - (skillTokens / openApiTokens) * 100).toFixed(1)}% reduction)`);

  // Show skipped tests info
  const totalSkipped = openapi.skipped + mapi.skipped + skill.skipped;
  if (totalSkipped > 0) {
    console.log("\n  Rate-Limited Tests (not counted as failures):");
    if (openapi.skipped > 0) console.log(`    OpenAPI: ${openapi.skipped} skipped`);
    if (mapi.skipped > 0) console.log(`    MAPI: ${mapi.skipped} skipped`);
    if (skill.skipped > 0) console.log(`    Skill: ${skill.skipped} skipped`);
  }

  console.log("\n═══════════════════════════════════════════════════════════════════════════");
  console.log(`  Tests: ${results.length} | OpenAPI: ${openapi.apiSuccesses}/${openapi.total} | MAPI: ${mapi.apiSuccesses}/${mapi.total} | Skill: ${skill.apiSuccesses}/${skill.total}`);
  if (totalSkipped > 0) {
    console.log(`  (${totalSkipped} test runs skipped due to rate limits - not counted as failures)`);
  }
  console.log("═══════════════════════════════════════════════════════════════════════════\n");

  const allPassed = openapi.apiSuccesses === openapi.total &&
                    mapi.apiSuccesses === mapi.total &&
                    skill.apiSuccesses === skill.total;
  process.exit(allPassed ? 0 : 1);
}

main().catch(console.error);
