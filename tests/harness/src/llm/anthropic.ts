/**
 * Anthropic Claude API client
 *
 * Simple wrapper that calls the API and returns raw results.
 * NO retry logic. NO error correction. If it fails, we record the failure.
 */

import Anthropic from '@anthropic-ai/sdk';
import { ModelTier, MODEL_IDS, LLMResponse } from '../types.js';

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY environment variable is required');
    }
    client = new Anthropic({ apiKey });
  }
  return client;
}

/**
 * Send a prompt to Claude and get the raw response.
 *
 * NO retries. NO error handling beyond what's necessary to return a result.
 * If the API fails, we throw. If the model returns garbage, we return the garbage.
 */
export async function callClaude(
  model: ModelTier,
  systemPrompt: string,
  userPrompt: string
): Promise<LLMResponse> {
  const anthropic = getClient();
  const modelId = MODEL_IDS[model];

  const startTime = Date.now();

  const response = await anthropic.messages.create({
    model: modelId,
    max_tokens: 256,  // We only need a capability name
    system: systemPrompt,
    messages: [
      { role: 'user', content: userPrompt }
    ]
  });

  const latency_ms = Date.now() - startTime;

  // Extract text content
  const textBlock = response.content.find(block => block.type === 'text');
  const content = textBlock?.type === 'text' ? textBlock.text : '';

  return {
    content,
    latency_ms,
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
  };
}
