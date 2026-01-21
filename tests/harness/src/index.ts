#!/usr/bin/env node

/**
 * MAPI Test Harness CLI
 *
 * A/B test comparing LLM comprehension of OpenAPI vs MAPI vs Skill specs.
 *
 * IMPORTANT: This harness EXPOSES mistakes, it does NOT fix them.
 * - One shot per test case
 * - No retries
 * - No error correction
 * - Results recorded as-is
 */

import * as path from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';

// Load environment variables from .env.local in project root
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
config({ path: path.resolve(__dirname, '../../../.env.local') });

import { Command } from 'commander';
import { runTests, runSkillTests, saveResults, skillExists } from './runner.js';
import { ModelTier, SpecFormat, ApiName, TestRunResult } from './types.js';

const program = new Command();

program
  .name('mapi-test')
  .description('A/B test harness for OpenAPI vs MAPI vs Skill spec comprehension')
  .version('1.0.0');

program
  .command('run')
  .description('Run tests for a specific configuration')
  .requiredOption('-m, --model <tier>', 'Model tier: haiku, sonnet, or opus')
  .requiredOption('-s, --spec <format>', 'Spec format: openapi, mapi, or skill')
  .requiredOption('-a, --api <name>', 'API name: anthropic, github, or google-cloud')
  .option('-l, --limit <count>', 'Limit number of tests to run')
  .action(async (options) => {
    const model = options.model as ModelTier;
    const spec_format = options.spec as SpecFormat;
    const api = options.api as ApiName;
    const limit = options.limit ? parseInt(options.limit, 10) : undefined;

    // Validate inputs
    if (!['haiku', 'sonnet', 'opus'].includes(model)) {
      console.error(`Invalid model: ${model}. Must be haiku, sonnet, or opus.`);
      process.exit(1);
    }
    if (!['openapi', 'mapi', 'skill'].includes(spec_format)) {
      console.error(`Invalid spec format: ${spec_format}. Must be openapi, mapi, or skill.`);
      process.exit(1);
    }
    if (!['anthropic', 'github', 'google-cloud'].includes(api)) {
      console.error(`Invalid API: ${api}. Must be anthropic, github, or google-cloud.`);
      process.exit(1);
    }

    // Check if skill folder exists when skill format requested
    if (spec_format === 'skill' && !skillExists(api)) {
      console.error(`Skill folder not found for ${api}. Run 'mapi split' first to generate it.`);
      process.exit(1);
    }

    console.log('═══════════════════════════════════════════════════════════');
    console.log('  MAPI Test Harness - A/B Spec Comprehension Test');
    console.log('═══════════════════════════════════════════════════════════');

    let result: TestRunResult;
    if (spec_format === 'skill') {
      result = await runSkillTests({ model, spec_format, api }, limit);
    } else {
      result = await runTests({ model, spec_format, api }, limit);
    }
    const filepath = saveResults(result);

    printSummary(result);
    console.log(`\nResults saved to: ${filepath}`);
  });

program
  .command('compare')
  .description('Run OpenAPI, MAPI, and Skill tests and compare results')
  .requiredOption('-m, --model <tier>', 'Model tier: haiku, sonnet, or opus')
  .requiredOption('-a, --api <name>', 'API name: anthropic, github, or google-cloud')
  .option('-l, --limit <count>', 'Limit number of tests to run')
  .option('--skip-skill', 'Skip Skill format tests')
  .action(async (options) => {
    const model = options.model as ModelTier;
    const api = options.api as ApiName;
    const limit = options.limit ? parseInt(options.limit, 10) : undefined;
    const skipSkill = options.skipSkill || !skillExists(api);

    console.log('═══════════════════════════════════════════════════════════');
    console.log('  MAPI Test Harness - A/B/C Comparison');
    console.log('═══════════════════════════════════════════════════════════');

    // Run OpenAPI tests
    console.log('\n--- OpenAPI Tests ---');
    const openApiResult = await runTests({ model, spec_format: 'openapi', api }, limit);
    saveResults(openApiResult);

    // Run MAPI tests
    console.log('\n--- MAPI Tests ---');
    const mapiResult = await runTests({ model, spec_format: 'mapi', api }, limit);
    saveResults(mapiResult);

    // Run Skill tests (if available)
    let skillResult: TestRunResult | null = null;
    if (!skipSkill) {
      console.log('\n--- Skill Tests (Progressive Loading) ---');
      skillResult = await runSkillTests({ model, spec_format: 'skill', api }, limit);
      saveResults(skillResult);
    } else {
      console.log('\n--- Skill Tests: Skipped (no skill folder) ---');
    }

    // Print comparison
    printComparison(openApiResult, mapiResult, skillResult);
  });

program
  .command('all')
  .description('Run all tests across all APIs and spec formats')
  .requiredOption('-m, --model <tier>', 'Model tier: haiku, sonnet, or opus')
  .action(async (options) => {
    const model = options.model as ModelTier;
    const apis: ApiName[] = ['anthropic', 'github', 'google-cloud'];

    console.log('═══════════════════════════════════════════════════════════');
    console.log('  MAPI Test Harness - Full Test Suite');
    console.log('═══════════════════════════════════════════════════════════');

    const allResults: { api: ApiName; openapi: TestRunResult; mapi: TestRunResult; skill: TestRunResult | null }[] = [];

    for (const api of apis) {
      console.log(`\n${'═'.repeat(60)}`);
      console.log(`  API: ${api.toUpperCase()}`);
      console.log('═'.repeat(60));

      const openApiResult = await runTests({ model, spec_format: 'openapi', api });
      saveResults(openApiResult);

      const mapiResult = await runTests({ model, spec_format: 'mapi', api });
      saveResults(mapiResult);

      let skillResult: TestRunResult | null = null;
      if (skillExists(api)) {
        skillResult = await runSkillTests({ model, spec_format: 'skill', api });
        saveResults(skillResult);
      }

      allResults.push({ api, openapi: openApiResult, mapi: mapiResult, skill: skillResult });
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

function formatTime(ms: number): string {
  const seconds = ms / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = (seconds % 60).toFixed(0);
  return `${minutes}m ${remainingSeconds}s`;
}

function printComparison(openapi: TestRunResult, mapi: TestRunResult, skill: TestRunResult | null): void {
  const openApiTestTime = openapi.summary.avg_latency_ms * openapi.summary.total;
  const mapiTestTime = mapi.summary.avg_latency_ms * mapi.summary.total;
  const skillTestTime = skill ? skill.summary.avg_latency_ms * skill.summary.total : 0;

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  A/B/C Comparison Results');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');

  if (skill) {
    console.log('                    OpenAPI      MAPI         Skill');
    console.log('  ─────────────────────────────────────────────────────────');
    console.log(`  Accuracy:         ${(openapi.summary.accuracy * 100).toFixed(1).padStart(5)}%      ${(mapi.summary.accuracy * 100).toFixed(1).padStart(5)}%       ${(skill.summary.accuracy * 100).toFixed(1).padStart(5)}%`);
    console.log(`  Correct:          ${String(openapi.summary.correct).padStart(5)}       ${String(mapi.summary.correct).padStart(5)}        ${String(skill.summary.correct).padStart(5)}`);
    console.log(`  Incorrect:        ${String(openapi.summary.incorrect).padStart(5)}       ${String(mapi.summary.incorrect).padStart(5)}        ${String(skill.summary.incorrect).padStart(5)}`);
    console.log(`  Parse errors:     ${String(openapi.summary.parse_errors).padStart(5)}       ${String(mapi.summary.parse_errors).padStart(5)}        ${String(skill.summary.parse_errors).padStart(5)}`);
    console.log(`  Avg latency:      ${openapi.summary.avg_latency_ms.toFixed(0).padStart(5)}ms    ${mapi.summary.avg_latency_ms.toFixed(0).padStart(5)}ms     ${skill.summary.avg_latency_ms.toFixed(0).padStart(5)}ms`);
    console.log(`  Total test time:  ${formatTime(openApiTestTime).padStart(6)}     ${formatTime(mapiTestTime).padStart(6)}      ${formatTime(skillTestTime).padStart(6)}`);
    console.log(`  Input tokens:     ${String(openapi.summary.total_input_tokens).padStart(5)}       ${String(mapi.summary.total_input_tokens).padStart(5)}        ${String(skill.summary.total_input_tokens).padStart(5)}`);
    console.log(`  Output tokens:    ${String(openapi.summary.total_output_tokens).padStart(5)}       ${String(mapi.summary.total_output_tokens).padStart(5)}        ${String(skill.summary.total_output_tokens).padStart(5)}`);
    console.log('');

    // Token efficiency
    const openApiTokens = openapi.summary.total_input_tokens + openapi.summary.total_output_tokens;
    const mapiTokens = mapi.summary.total_input_tokens + mapi.summary.total_output_tokens;
    const skillTokens = skill.summary.total_input_tokens + skill.summary.total_output_tokens;

    console.log('  Token Efficiency:');
    console.log(`    OpenAPI: ${openApiTokens} tokens (baseline)`);
    console.log(`    MAPI:    ${mapiTokens} tokens (${((mapiTokens / openApiTokens) * 100).toFixed(0)}% of OpenAPI)`);
    console.log(`    Skill:   ${skillTokens} tokens (${((skillTokens / openApiTokens) * 100).toFixed(0)}% of OpenAPI)`);
    console.log('');

    // Winner
    const scores = [
      { name: 'OpenAPI', accuracy: openapi.summary.accuracy, tokens: openApiTokens },
      { name: 'MAPI', accuracy: mapi.summary.accuracy, tokens: mapiTokens },
      { name: 'Skill', accuracy: skill.summary.accuracy, tokens: skillTokens },
    ];
    const winner = scores.sort((a, b) => {
      if (b.accuracy !== a.accuracy) return b.accuracy - a.accuracy;
      return a.tokens - b.tokens; // Lower tokens wins tie
    })[0];
    console.log(`  Best: ${winner.name} (${(winner.accuracy * 100).toFixed(1)}% accuracy, ${winner.tokens} tokens)`);
  } else {
    // Original 2-way comparison
    console.log('                    OpenAPI         MAPI');
    console.log('  ─────────────────────────────────────────────');
    console.log(`  Accuracy:         ${(openapi.summary.accuracy * 100).toFixed(1).padStart(5)}%         ${(mapi.summary.accuracy * 100).toFixed(1).padStart(5)}%`);
    console.log(`  Correct:          ${String(openapi.summary.correct).padStart(5)}          ${String(mapi.summary.correct).padStart(5)}`);
    console.log(`  Incorrect:        ${String(openapi.summary.incorrect).padStart(5)}          ${String(mapi.summary.incorrect).padStart(5)}`);
    console.log(`  Parse errors:     ${String(openapi.summary.parse_errors).padStart(5)}          ${String(mapi.summary.parse_errors).padStart(5)}`);
    console.log(`  Avg latency:      ${openapi.summary.avg_latency_ms.toFixed(0).padStart(5)}ms       ${mapi.summary.avg_latency_ms.toFixed(0).padStart(5)}ms`);
    console.log(`  Total test time:  ${formatTime(openApiTestTime).padStart(6)}        ${formatTime(mapiTestTime).padStart(6)}`);
    console.log(`  Input tokens:     ${String(openapi.summary.total_input_tokens).padStart(5)}          ${String(mapi.summary.total_input_tokens).padStart(5)}`);
    console.log(`  Output tokens:    ${String(openapi.summary.total_output_tokens).padStart(5)}          ${String(mapi.summary.total_output_tokens).padStart(5)}`);
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
}

function printFullSummary(
  results: { api: ApiName; openapi: TestRunResult; mapi: TestRunResult; skill: TestRunResult | null }[],
  model: ModelTier
): void {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(`  Full Summary (Model: ${model})`);
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
  console.log('  API                OpenAPI     MAPI        Skill       Best');
  console.log('  ─────────────────────────────────────────────────────────────');

  let totalOpenApi = 0;
  let totalMapi = 0;
  let totalSkill = 0;
  let totalTests = 0;
  let skillTests = 0;

  for (const { api, openapi, mapi, skill } of results) {
    const openAcc = (openapi.summary.accuracy * 100).toFixed(1);
    const mapiAcc = (mapi.summary.accuracy * 100).toFixed(1);
    const skillAcc = skill ? (skill.summary.accuracy * 100).toFixed(1) : 'N/A';

    // Determine best
    const scores = [
      { name: 'OpenAPI', acc: openapi.summary.accuracy },
      { name: 'MAPI', acc: mapi.summary.accuracy },
    ];
    if (skill) {
      scores.push({ name: 'Skill', acc: skill.summary.accuracy });
    }
    const best = scores.sort((a, b) => b.acc - a.acc)[0].name;

    console.log(`  ${api.padEnd(18)} ${openAcc.padStart(5)}%      ${mapiAcc.padStart(5)}%      ${skillAcc.toString().padStart(5)}%      ${best}`);

    totalOpenApi += openapi.summary.correct;
    totalMapi += mapi.summary.correct;
    totalTests += openapi.summary.total;
    if (skill) {
      totalSkill += skill.summary.correct;
      skillTests += skill.summary.total;
    }
  }

  console.log('  ─────────────────────────────────────────────────────────────');

  const overallOpenApi = ((totalOpenApi / totalTests) * 100).toFixed(1);
  const overallMapi = ((totalMapi / totalTests) * 100).toFixed(1);
  const overallSkill = skillTests > 0 ? ((totalSkill / skillTests) * 100).toFixed(1) : 'N/A';

  console.log(`  ${'OVERALL'.padEnd(18)} ${overallOpenApi.padStart(5)}%      ${overallMapi.padStart(5)}%      ${overallSkill.toString().padStart(5)}%`);
  console.log('');
}

program.parse();
