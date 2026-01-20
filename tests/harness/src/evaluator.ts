/**
 * Evaluator - compares LLM output against expected capability
 *
 * IMPORTANT: This evaluator does NOT fix mistakes.
 * - If the JSON doesn't parse, that's a parse_error.
 * - If the capability doesn't match, that's incorrect.
 * - We record exactly what happened, warts and all.
 */

import { TestCase, TestResult, LLMResponse } from './types.js';

/**
 * Attempt to extract a capability from the LLM's raw output.
 *
 * We try to be somewhat flexible in parsing (JSON, plain text, etc.)
 * but we do NOT retry or ask for clarification.
 *
 * Returns the extracted capability or null if we can't parse it.
 */
function extractCapability(rawOutput: string): { capability: string | null; error: string | null } {
  const trimmed = rawOutput.trim();

  // Try 1: Parse as JSON object with "capability" field
  try {
    // Handle markdown code blocks
    let jsonStr = trimmed;
    const jsonMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    const parsed = JSON.parse(jsonStr);
    if (typeof parsed === 'object' && parsed !== null && 'capability' in parsed) {
      const cap = parsed.capability;
      if (typeof cap === 'string' && cap.length > 0) {
        return { capability: cap, error: null };
      }
    }
  } catch {
    // JSON parse failed, continue to other methods
  }

  // Try 2: Look for a capability pattern in the text (e.g., "capability: foo.bar")
  const capMatch = trimmed.match(/capability["\s:]+([a-zA-Z_][a-zA-Z0-9_.]*)/i);
  if (capMatch) {
    return { capability: capMatch[1], error: null };
  }

  // Try 3: If the entire response looks like a capability ID (single dotted identifier)
  if (/^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(trimmed) && trimmed.length < 100) {
    return { capability: trimmed, error: null };
  }

  // Failed to extract
  return {
    capability: null,
    error: `Could not extract capability from output: ${trimmed.slice(0, 200)}${trimmed.length > 200 ? '...' : ''}`
  };
}

/**
 * Evaluate a single test case against the LLM response.
 *
 * Returns a TestResult with all details, including failures.
 */
export function evaluate(
  testCase: TestCase,
  llmResponse: LLMResponse
): TestResult {
  const { capability, error } = extractCapability(llmResponse.content);

  // Normalize for comparison (case-insensitive, trim whitespace)
  const normalizedExpected = testCase.expected_capability.toLowerCase().trim();
  const normalizedSelected = capability?.toLowerCase().trim() ?? null;

  const correct = normalizedSelected !== null && normalizedSelected === normalizedExpected;

  return {
    test_id: testCase.id,
    prose: testCase.prose,
    expected_capability: testCase.expected_capability,
    selected_capability: capability,
    correct,
    parse_error: error,
    raw_output: llmResponse.content,
    latency_ms: llmResponse.latency_ms,
    input_tokens: llmResponse.input_tokens,
    output_tokens: llmResponse.output_tokens,
  };
}

/**
 * Generate summary statistics for a test run.
 */
export function summarize(results: TestResult[]) {
  const total = results.length;
  const correct = results.filter(r => r.correct).length;
  const incorrect = results.filter(r => !r.correct && r.parse_error === null).length;
  const parse_errors = results.filter(r => r.parse_error !== null).length;

  const totalLatency = results.reduce((sum, r) => sum + r.latency_ms, 0);
  const totalInputTokens = results.reduce((sum, r) => sum + r.input_tokens, 0);
  const totalOutputTokens = results.reduce((sum, r) => sum + r.output_tokens, 0);

  return {
    total,
    correct,
    incorrect,
    parse_errors,
    accuracy: total > 0 ? correct / total : 0,
    avg_latency_ms: total > 0 ? totalLatency / total : 0,
    total_input_tokens: totalInputTokens,
    total_output_tokens: totalOutputTokens,
  };
}
