/**
 * Test Runner - executes test cases against LLMs
 *
 * IMPORTANT: This runner does NOT auto-fix issues.
 * Each test case gets ONE shot. The result is recorded as-is.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const POPULAR_APIS_DIR = path.resolve(__dirname, '../../popularAPIs');

/**
 * Map API names to their spec file names
 */
const SPEC_FILES: Record<ApiName, { openapi: string; mapi: string; skill: string }> = {
  'anthropic': {
    openapi: 'openapi-messages.yaml',
    mapi: 'anthropic.mapi.md',
    skill: 'skill',  // folder name
  },
  'github': {
    openapi: 'openapi.json',
    mapi: 'github.mapi.md',
    skill: 'skill',
  },
  'google-cloud': {
    openapi: 'cloud-billing-openapi.yaml',
    mapi: 'google-cloud-billing.mapi.md',
    skill: 'skill',
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
 * Load API spec (OpenAPI, MAPI, or Skill index)
 */
export function loadSpec(api: ApiName, format: SpecFormat): string {
  if (format === 'skill') {
    // For skill format, load just the Skill.md index
    const skillDir = path.join(POPULAR_APIS_DIR, api, SPEC_FILES[api].skill);
    const skillMdPath = path.join(skillDir, 'Skill.md');
    return fs.readFileSync(skillMdPath, 'utf-8');
  }
  const specFile = SPEC_FILES[api][format];
  const specPath = path.join(POPULAR_APIS_DIR, api, specFile);
  return fs.readFileSync(specPath, 'utf-8');
}

/**
 * Load a specific capability file from a Skill folder
 */
export function loadSkillCapability(api: ApiName, capabilityPath: string): string {
  const skillDir = path.join(POPULAR_APIS_DIR, api, SPEC_FILES[api].skill);
  const fullPath = path.join(skillDir, capabilityPath);
  if (fs.existsSync(fullPath)) {
    return fs.readFileSync(fullPath, 'utf-8');
  }
  return '';
}

/**
 * Load common files from a Skill folder
 */
export function loadSkillCommon(api: ApiName, commonPath: string): string {
  const skillDir = path.join(POPULAR_APIS_DIR, api, SPEC_FILES[api].skill);
  const fullPath = path.join(skillDir, 'common', commonPath);
  if (fs.existsSync(fullPath)) {
    return fs.readFileSync(fullPath, 'utf-8');
  }
  return '';
}

/**
 * Check if skill folder exists for an API
 */
export function skillExists(api: ApiName): boolean {
  const skillDir = path.join(POPULAR_APIS_DIR, api, SPEC_FILES[api].skill);
  const skillMdPath = path.join(skillDir, 'Skill.md');
  return fs.existsSync(skillMdPath);
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
    return await evaluate(testCase, llmResponse);
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
export async function runTests(config: TestRunConfig, limit?: number): Promise<TestRunResult> {
  let testCases = loadTestCases(config.api);
  const spec = loadSpec(config.api, config.spec_format);

  if (limit && limit < testCases.length) {
    testCases = testCases.slice(0, limit);
  }

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
 * Build system prompt for Skill index (Phase 1: Intent matching)
 */
function buildSkillIndexPrompt(skillMd: string): string {
  return `You are an API routing assistant. You will be given a Skill index containing API capabilities and their intent keywords.

Your task: Match the user's request to the most appropriate capability ID based on the intent keywords.

Here is the Skill index:

<skill-index>
${skillMd}
</skill-index>

Respond with ONLY a JSON object containing:
1. The capability ID that best matches the user's intent
2. The file path to load for that capability

Example:
{"capability": "messages.create", "file": "capabilities/messages.create.md", "dependencies": ["auth"]}

Do not explain your reasoning. Do not include any other text. Just the JSON object.`;
}

/**
 * Build system prompt for capability execution (Phase 2)
 */
function buildCapabilityPrompt(capabilityContent: string, commonContent: string): string {
  return `You are an API routing assistant. You have been given a specific API capability definition.

${commonContent ? `Common definitions:\n<common>\n${commonContent}\n</common>\n\n` : ''}

Capability definition:
<capability>
${capabilityContent}
</capability>

Confirm the capability ID from this definition.

Respond with ONLY a JSON object containing the capability ID. Example:
{"capability": "messages.create"}

Do not explain your reasoning. Do not include any other text. Just the JSON object.`;
}

/**
 * Run a single test case using progressive Skill loading (2-phase approach)
 */
async function runSkillTestCase(
  testCase: TestCase,
  skillMd: string,
  api: ApiName,
  config: TestRunConfig
): Promise<TestResult> {
  const startTime = Date.now();
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  try {
    // Phase 1: Intent matching with Skill index
    const indexPrompt = buildSkillIndexPrompt(skillMd);
    const userPrompt = buildUserPrompt(testCase.prose);

    const phase1Response = await callClaude(config.model, indexPrompt, userPrompt);
    totalInputTokens += phase1Response.input_tokens;
    totalOutputTokens += phase1Response.output_tokens;

    // Parse Phase 1 response to get capability file path
    let phase1Result: { capability: string; file?: string; dependencies?: string[] };
    try {
      const jsonMatch = phase1Response.content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }
      phase1Result = JSON.parse(jsonMatch[0]);
    } catch {
      return {
        test_id: testCase.id,
        prose: testCase.prose,
        expected_capability: testCase.expected_capability,
        selected_capability: null,
        correct: false,
        parse_error: `Phase 1 parse error: ${phase1Response.content}`,
        raw_output: phase1Response.content,
        latency_ms: Date.now() - startTime,
        input_tokens: totalInputTokens,
        output_tokens: totalOutputTokens,
      };
    }

    // Phase 2: Load capability file and verify
    const capabilityFile = phase1Result.file || `capabilities/${phase1Result.capability}.md`;
    const capabilityContent = loadSkillCapability(api, capabilityFile);

    if (!capabilityContent) {
      // Capability file doesn't exist - use phase 1 result directly
      const isCorrect = phase1Result.capability === testCase.expected_capability ||
        phase1Result.capability.includes(testCase.expected_capability) ||
        testCase.expected_capability.includes(phase1Result.capability);

      return {
        test_id: testCase.id,
        prose: testCase.prose,
        expected_capability: testCase.expected_capability,
        selected_capability: phase1Result.capability,
        correct: isCorrect,
        parse_error: null,
        raw_output: phase1Response.content,
        latency_ms: Date.now() - startTime,
        input_tokens: totalInputTokens,
        output_tokens: totalOutputTokens,
      };
    }

    // Load common dependencies
    let commonContent = '';
    if (phase1Result.dependencies) {
      for (const dep of phase1Result.dependencies) {
        const depContent = loadSkillCommon(api, `${dep}.md`);
        if (depContent) {
          commonContent += `\n--- ${dep} ---\n${depContent}\n`;
        }
      }
    }

    // Phase 2: Verify with capability content
    const capPrompt = buildCapabilityPrompt(capabilityContent, commonContent);
    const phase2Response = await callClaude(config.model, capPrompt, `Confirm capability for: "${testCase.prose}"`);
    totalInputTokens += phase2Response.input_tokens;
    totalOutputTokens += phase2Response.output_tokens;

    // Parse Phase 2 response
    let selectedCapability: string | null = null;
    try {
      const jsonMatch = phase2Response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        selectedCapability = parsed.capability;
      }
    } catch {
      selectedCapability = phase1Result.capability; // Fall back to phase 1
    }

    const totalLatency = Date.now() - startTime;

    // Evaluate correctness
    const isCorrect: boolean = !!(
      selectedCapability === testCase.expected_capability ||
      (selectedCapability && selectedCapability.includes(testCase.expected_capability)) ||
      (selectedCapability && testCase.expected_capability.includes(selectedCapability))
    );

    return {
      test_id: testCase.id,
      prose: testCase.prose,
      expected_capability: testCase.expected_capability,
      selected_capability: selectedCapability,
      correct: isCorrect,
      parse_error: null,
      raw_output: `Phase1: ${phase1Response.content}\nPhase2: ${phase2Response.content}`,
      latency_ms: totalLatency,
      input_tokens: totalInputTokens,
      output_tokens: totalOutputTokens,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      test_id: testCase.id,
      prose: testCase.prose,
      expected_capability: testCase.expected_capability,
      selected_capability: null,
      correct: false,
      parse_error: `API error: ${errorMessage}`,
      raw_output: '',
      latency_ms: Date.now() - startTime,
      input_tokens: totalInputTokens,
      output_tokens: totalOutputTokens,
    };
  }
}

/**
 * Run all test cases for Skill format (progressive loading)
 */
export async function runSkillTests(config: TestRunConfig, limit?: number): Promise<TestRunResult> {
  if (config.spec_format !== 'skill') {
    throw new Error('runSkillTests requires spec_format: skill');
  }

  let testCases = loadTestCases(config.api);
  const skillMd = loadSpec(config.api, 'skill');

  if (limit && limit < testCases.length) {
    testCases = testCases.slice(0, limit);
  }

  console.log(`\nRunning ${testCases.length} Skill tests (progressive loading)...`);
  console.log(`  Model: ${config.model}`);
  console.log(`  Spec: skill (2-phase)`);
  console.log(`  API: ${config.api}\n`);

  const results: TestResult[] = [];

  for (let i = 0; i < testCases.length; i++) {
    const testCase = testCases[i];
    process.stdout.write(`  [${i + 1}/${testCases.length}] ${testCase.id}... `);

    const result = await runSkillTestCase(testCase, skillMd, config.api, config);
    results.push(result);

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
