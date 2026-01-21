/**
 * Test harness types
 *
 * IMPORTANT: This harness is designed to EXPOSE mistakes, not fix them.
 * Failed parses, wrong selections, and errors are all valid test outcomes.
 */

export type ModelTier = 'haiku' | 'sonnet' | 'opus';

export type SpecFormat = 'openapi' | 'mapi' | 'skill';

export type ApiName = 'anthropic' | 'github' | 'google-cloud';

export interface TestCase {
  id: string;
  prose: string;
  expected_capability: string;
}

export interface TestResult {
  test_id: string;
  prose: string;
  expected_capability: string;
  selected_capability: string | null;  // null if parse failed
  correct: boolean;
  parse_error: string | null;          // null if parsed successfully
  raw_output: string;                  // exact LLM response
  latency_ms: number;
  input_tokens: number;
  output_tokens: number;
}

export interface TestRunConfig {
  model: ModelTier;
  spec_format: SpecFormat;
  api: ApiName;
}

export interface TestRunResult {
  config: TestRunConfig;
  timestamp: string;
  results: TestResult[];
  summary: TestRunSummary;
}

export interface TestRunSummary {
  total: number;
  correct: number;
  incorrect: number;
  parse_errors: number;
  accuracy: number;           // correct / total
  avg_latency_ms: number;
  total_input_tokens: number;
  total_output_tokens: number;
}

export interface LLMResponse {
  content: string;
  latency_ms: number;
  input_tokens: number;
  output_tokens: number;
}

export const MODEL_IDS: Record<ModelTier, string> = {
  haiku: 'claude-3-5-haiku-20241022',
  sonnet: 'claude-sonnet-4-20250514',
  opus: 'claude-opus-4-20250514',
};
