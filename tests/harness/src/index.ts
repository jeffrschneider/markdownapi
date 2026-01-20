#!/usr/bin/env node

/**
 * MAPI Test Harness CLI
 *
 * A/B test comparing LLM comprehension of OpenAPI vs MAPI specs.
 *
 * IMPORTANT: This harness EXPOSES mistakes, it does NOT fix them.
 * - One shot per test case
 * - No retries
 * - No error correction
 * - Results recorded as-is
 */

import { Command } from 'commander';
import { runTests, saveResults } from './runner.js';
import { ModelTier, SpecFormat, ApiName, TestRunResult } from './types.js';

const program = new Command();

program
  .name('mapi-test')
  .description('A/B test harness for OpenAPI vs MAPI spec comprehension')
  .version('1.0.0');

program
  .command('run')
  .description('Run tests for a specific configuration')
  .requiredOption('-m, --model <tier>', 'Model tier: haiku, sonnet, or opus')
  .requiredOption('-s, --spec <format>', 'Spec format: openapi or mapi')
  .requiredOption('-a, --api <name>', 'API name: anthropic, github, notion, or google-cloud')
  .action(async (options) => {
    const model = options.model as ModelTier;
    const spec_format = options.spec as SpecFormat;
    const api = options.api as ApiName;

    // Validate inputs
    if (!['haiku', 'sonnet', 'opus'].includes(model)) {
      console.error(`Invalid model: ${model}. Must be haiku, sonnet, or opus.`);
      process.exit(1);
    }
    if (!['openapi', 'mapi'].includes(spec_format)) {
      console.error(`Invalid spec format: ${spec_format}. Must be openapi or mapi.`);
      process.exit(1);
    }
    if (!['anthropic', 'github', 'notion', 'google-cloud'].includes(api)) {
      console.error(`Invalid API: ${api}. Must be anthropic, github, notion, or google-cloud.`);
      process.exit(1);
    }

    console.log('═══════════════════════════════════════════════════════════');
    console.log('  MAPI Test Harness - A/B Spec Comprehension Test');
    console.log('═══════════════════════════════════════════════════════════');

    const result = await runTests({ model, spec_format, api });
    const filepath = saveResults(result);

    printSummary(result);
    console.log(`\nResults saved to: ${filepath}`);
  });

program
  .command('compare')
  .description('Run both OpenAPI and MAPI tests and compare results')
  .requiredOption('-m, --model <tier>', 'Model tier: haiku, sonnet, or opus')
  .requiredOption('-a, --api <name>', 'API name: anthropic, github, notion, or google-cloud')
  .action(async (options) => {
    const model = options.model as ModelTier;
    const api = options.api as ApiName;

    console.log('═══════════════════════════════════════════════════════════');
    console.log('  MAPI Test Harness - A/B Comparison');
    console.log('═══════════════════════════════════════════════════════════');

    // Run OpenAPI tests
    console.log('\n--- OpenAPI Tests ---');
    const openApiResult = await runTests({ model, spec_format: 'openapi', api });
    saveResults(openApiResult);

    // Run MAPI tests
    console.log('\n--- MAPI Tests ---');
    const mapiResult = await runTests({ model, spec_format: 'mapi', api });
    saveResults(mapiResult);

    // Print comparison
    printComparison(openApiResult, mapiResult);
  });

program
  .command('all')
  .description('Run all tests across all APIs and spec formats')
  .requiredOption('-m, --model <tier>', 'Model tier: haiku, sonnet, or opus')
  .action(async (options) => {
    const model = options.model as ModelTier;
    const apis: ApiName[] = ['anthropic', 'github', 'notion', 'google-cloud'];

    console.log('═══════════════════════════════════════════════════════════');
    console.log('  MAPI Test Harness - Full Test Suite');
    console.log('═══════════════════════════════════════════════════════════');

    const allResults: { api: ApiName; openapi: TestRunResult; mapi: TestRunResult }[] = [];

    for (const api of apis) {
      console.log(`\n${'═'.repeat(60)}`);
      console.log(`  API: ${api.toUpperCase()}`);
      console.log('═'.repeat(60));

      const openApiResult = await runTests({ model, spec_format: 'openapi', api });
      saveResults(openApiResult);

      const mapiResult = await runTests({ model, spec_format: 'mapi', api });
      saveResults(mapiResult);

      allResults.push({ api, openapi: openApiResult, mapi: mapiResult });
    }

    // Print full summary
    printFullSummary(allResults, model);
  });

function printSummary(result: TestRunResult): void {
  const { summary } = result;

  console.log('\n───────────────────────────────────────────────────────────');
  console.log('  Summary');
  console.log('───────────────────────────────────────────────────────────');
  console.log(`  Total tests:    ${summary.total}`);
  console.log(`  Correct:        ${summary.correct}`);
  console.log(`  Incorrect:      ${summary.incorrect}`);
  console.log(`  Parse errors:   ${summary.parse_errors}`);
  console.log(`  Accuracy:       ${(summary.accuracy * 100).toFixed(1)}%`);
  console.log(`  Avg latency:    ${summary.avg_latency_ms.toFixed(0)}ms`);
  console.log(`  Total tokens:   ${summary.total_input_tokens + summary.total_output_tokens}`);
}

function printComparison(openapi: TestRunResult, mapi: TestRunResult): void {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  A/B Comparison Results');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
  console.log('                    OpenAPI         MAPI');
  console.log('  ─────────────────────────────────────────────');
  console.log(`  Accuracy:         ${(openapi.summary.accuracy * 100).toFixed(1).padStart(5)}%         ${(mapi.summary.accuracy * 100).toFixed(1).padStart(5)}%`);
  console.log(`  Correct:          ${String(openapi.summary.correct).padStart(5)}          ${String(mapi.summary.correct).padStart(5)}`);
  console.log(`  Incorrect:        ${String(openapi.summary.incorrect).padStart(5)}          ${String(mapi.summary.incorrect).padStart(5)}`);
  console.log(`  Parse errors:     ${String(openapi.summary.parse_errors).padStart(5)}          ${String(mapi.summary.parse_errors).padStart(5)}`);
  console.log(`  Avg latency:      ${openapi.summary.avg_latency_ms.toFixed(0).padStart(5)}ms       ${mapi.summary.avg_latency_ms.toFixed(0).padStart(5)}ms`);
  console.log('');

  const diff = mapi.summary.accuracy - openapi.summary.accuracy;
  if (diff > 0) {
    console.log(`  MAPI wins by ${(diff * 100).toFixed(1)} percentage points`);
  } else if (diff < 0) {
    console.log(`  OpenAPI wins by ${(Math.abs(diff) * 100).toFixed(1)} percentage points`);
  } else {
    console.log('  Tie - both specs performed equally');
  }
}

function printFullSummary(
  results: { api: ApiName; openapi: TestRunResult; mapi: TestRunResult }[],
  model: ModelTier
): void {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(`  Full Summary (Model: ${model})`);
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
  console.log('  API                OpenAPI     MAPI        Δ');
  console.log('  ───────────────────────────────────────────────────');

  let totalOpenApi = 0;
  let totalMapi = 0;
  let totalTests = 0;

  for (const { api, openapi, mapi } of results) {
    const openAcc = (openapi.summary.accuracy * 100).toFixed(1);
    const mapiAcc = (mapi.summary.accuracy * 100).toFixed(1);
    const diff = ((mapi.summary.accuracy - openapi.summary.accuracy) * 100).toFixed(1);
    const diffStr = Number(diff) >= 0 ? `+${diff}` : diff;

    console.log(`  ${api.padEnd(18)} ${openAcc.padStart(5)}%      ${mapiAcc.padStart(5)}%     ${diffStr.padStart(6)}%`);

    totalOpenApi += openapi.summary.correct;
    totalMapi += mapi.summary.correct;
    totalTests += openapi.summary.total;
  }

  console.log('  ───────────────────────────────────────────────────');

  const overallOpenApi = ((totalOpenApi / totalTests) * 100).toFixed(1);
  const overallMapi = ((totalMapi / totalTests) * 100).toFixed(1);
  const overallDiff = (((totalMapi - totalOpenApi) / totalTests) * 100).toFixed(1);
  const overallDiffStr = Number(overallDiff) >= 0 ? `+${overallDiff}` : overallDiff;

  console.log(`  ${'OVERALL'.padEnd(18)} ${overallOpenApi.padStart(5)}%      ${overallMapi.padStart(5)}%     ${overallDiffStr.padStart(6)}%`);
  console.log('');
}

program.parse();
