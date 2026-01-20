/**
 * Test Runner - executes test cases against LLMs
 *
 * IMPORTANT: This runner does NOT auto-fix issues.
 * Each test case gets ONE shot. The result is recorded as-is.
 */

import * as fs from 'fs';
import * as path from 'path';
import { parse as parseYaml } from 'yaml';
import {
  TestCase,
  TestResult,
  TestRunConfig,
  TestRunResult,
  SpecFormat,
  ApiName
} from './types.js';
import { callClaude } from './llm/anthropic.js';
import { evaluate, summarize } from './evaluator.js';

const POPULAR_APIS_DIR = path.resolve(import.meta.dirname, '../../popularAPIs');

/**
 * Map API names to their spec file names
 */
const SPEC_FILES: Record<ApiName, { openapi: string; mapi: string }> = {
  'anthropic': {
    openapi: 'openapi.yaml',
    mapi: 'anthropic.mapi.md',
  },
  'github': {
    openapi: 'openapi.json',
    mapi: 'github.mapi.md',
  },
  'notion': {
    openapi: 'openapi.yaml',
    mapi: 'notion.mapi.md',
  },
  'google-cloud': {
    openapi: 'cloud-billing-openapi.yaml',
    mapi: 'google-cloud-billing.mapi.md',
  },
};

/**
 * Load test cases from YAML file
 */
export function loadTestCases(api: ApiName): TestCase[] {
  const testCasesPath = path.join(POPULAR_APIS_DIR, api, 'test-cases.yaml');
  const content = fs.readFileSync(testCasesPath, 'utf-8');
  return parseYaml(content) as TestCase[];
}

/**
 * Load API spec (OpenAPI or MAPI)
 */
export function loadSpec(api: ApiName, format: SpecFormat): string {
  const specFile = SPEC_FILES[api][format];
  const specPath = path.join(POPULAR_APIS_DIR, api, specFile);
  return fs.readFileSync(specPath, 'utf-8');
}

/**
 * Build the system prompt for the LLM.
 *
 * This prompt is IDENTICAL for OpenAPI and MAPI - no format-specific hints.
 * The spec itself should be self-explanatory.
 */
function buildSystemPrompt(spec: string): string {
  return `You are an API routing assistant. You will be given an API specification and a user request.

Your task: Identify which API capability (operation/endpoint) should handle the user's request.

Here is the API specification:

<spec>
${spec}
</spec>

Respond with ONLY a JSON object containing the capability ID. Example:
{"capability": "messages.create"}

Do not explain your reasoning. Do not include any other text. Just the JSON object.`;
}

/**
 * Build the user prompt (the prose trigger)
 */
function buildUserPrompt(prose: string): string {
  return `User request: "${prose}"`;
}

/**
 * Run a single test case
 */
async function runTestCase(
  testCase: TestCase,
  spec: string,
  config: TestRunConfig
): Promise<TestResult> {
  const systemPrompt = buildSystemPrompt(spec);
  const userPrompt = buildUserPrompt(testCase.prose);

  try {
    const llmResponse = await callClaude(config.model, systemPrompt, userPrompt);
    return evaluate(testCase, llmResponse);
  } catch (error) {
    // API error - record as a failure, don't retry
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      test_id: testCase.id,
      prose: testCase.prose,
      expected_capability: testCase.expected_capability,
      selected_capability: null,
      correct: false,
      parse_error: `API error: ${errorMessage}`,
      raw_output: '',
      latency_ms: 0,
      input_tokens: 0,
      output_tokens: 0,
    };
  }
}

/**
 * Run all test cases for a given configuration
 */
export async function runTests(config: TestRunConfig): Promise<TestRunResult> {
  const testCases = loadTestCases(config.api);
  const spec = loadSpec(config.api, config.spec_format);

  console.log(`\nRunning ${testCases.length} tests...`);
  console.log(`  Model: ${config.model}`);
  console.log(`  Spec: ${config.spec_format}`);
  console.log(`  API: ${config.api}\n`);

  const results: TestResult[] = [];

  for (let i = 0; i < testCases.length; i++) {
    const testCase = testCases[i];
    process.stdout.write(`  [${i + 1}/${testCases.length}] ${testCase.id}... `);

    const result = await runTestCase(testCase, spec, config);
    results.push(result);

    // Print result indicator
    if (result.correct) {
      console.log('✓');
    } else if (result.parse_error) {
      console.log(`✗ (parse error)`);
    } else {
      console.log(`✗ (expected: ${result.expected_capability}, got: ${result.selected_capability})`);
    }
  }

  const summary = summarize(results);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  return {
    config,
    timestamp,
    results,
    summary,
  };
}

/**
 * Save test results to the results folder
 */
export function saveResults(runResult: TestRunResult): string {
  const resultsDir = path.join(POPULAR_APIS_DIR, runResult.config.api, 'results');

  // Ensure results directory exists
  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true });
  }

  const filename = `${runResult.timestamp}_${runResult.config.spec_format}_${runResult.config.model}.json`;
  const filepath = path.join(resultsDir, filename);

  fs.writeFileSync(filepath, JSON.stringify(runResult, null, 2));

  return filepath;
}
