#!/usr/bin/env node

/**
 * MAPI CLI
 *
 * Command-line interface for converting API specifications to MAPI Skill format.
 *
 * Commands:
 *   mapi split <input>     Convert single-file MAPI to Skill format
 *   mapi convert <input>   Convert OpenAPI to Skill format
 *   mapi bundle <input>    Convert Skill folder to single-file MAPI (future)
 */

import { program } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  convertMapiToSkill,
  convertOpenApiToSkill,
  convertToSkill,
  detectFormat,
  SkillOutput,
  IntentGenerator,
  ConvertOptions,
} from 'mapi-converter';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read version from package.json
const packageJsonPath = path.resolve(__dirname, '..', 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

program
  .name('mapi')
  .description('Convert API specifications to MAPI Skill format')
  .version(packageJson.version);

/**
 * Create an LLM-based intent generator using Claude API
 */
function createLLMIntentGenerator(): IntentGenerator {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    console.error('Warning: ANTHROPIC_API_KEY not set. Using simple intent extraction.');
    return createSimpleIntentGenerator();
  }

  console.log('Using LLM for intent keyword generation...');

  return {
    async generate(capabilityId: string, description: string): Promise<string[]> {
      try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 200,
            messages: [
              {
                role: 'user',
                content: `Given this API capability:
- ID: ${capabilityId}
- Description: ${description}

Generate 5-8 intent keywords or short phrases a user might say when they want to use this capability. Include synonyms and task descriptions. Focus on action words and common variations.

Output ONLY a comma-separated list, nothing else. Example format:
create user, add user, register account, new user, sign up`,
              },
            ],
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`  Warning: LLM API error for ${capabilityId}: ${response.status}`);
          return extractSimpleIntents(capabilityId, description);
        }

        const data = await response.json() as { content: Array<{ text: string }> };
        const text = data.content[0]?.text || '';
        const keywords = text.split(',').map((s: string) => s.trim()).filter(Boolean);

        // Show progress
        process.stdout.write('.');

        return keywords;
      } catch (error) {
        console.error(`  Warning: LLM failed for ${capabilityId}: ${(error as Error).message}`);
        return extractSimpleIntents(capabilityId, description);
      }
    },
  };
}

/**
 * Create a simple intent generator (fallback)
 */
function createSimpleIntentGenerator(): IntentGenerator {
  return {
    async generate(capabilityId: string, description: string): Promise<string[]> {
      return extractSimpleIntents(capabilityId, description);
    },
  };
}

/**
 * Simple intent extraction logic
 */
function extractSimpleIntents(capabilityId: string, description: string): string[] {
  const keywords: string[] = [];
  const idParts = capabilityId.split('.');
  keywords.push(...idParts);

  const actionVerbs = [
    'create', 'get', 'list', 'update', 'delete', 'remove', 'add', 'fetch',
    'retrieve', 'search', 'find', 'send', 'post', 'upload', 'download',
    'subscribe', 'unsubscribe', 'connect', 'query', 'execute',
  ];

  const lower = description.toLowerCase();
  for (const verb of actionVerbs) {
    if (lower.includes(verb)) {
      keywords.push(verb);
    }
  }

  return [...new Set(keywords)];
}

interface CommandOptions {
  output: string;
  name?: string;
  generateIntents?: boolean;
}

/**
 * Build convert options from command options
 */
function buildConvertOptions(options: CommandOptions): ConvertOptions {
  return {
    apiName: options.name,
    intentGenerator: options.generateIntents ? createLLMIntentGenerator() : undefined,
  };
}

/**
 * Split command: Convert single-file MAPI to Skill format
 */
program
  .command('split <input>')
  .description('Convert a single-file MAPI document to Skill folder structure')
  .option('-o, --output <dir>', 'Output directory', './skill-output')
  .option('-n, --name <name>', 'API name override')
  .option('-g, --generate-intents', 'Use LLM to generate enhanced intent keywords')
  .action(async (input: string, options: CommandOptions) => {
    try {
      const inputPath = path.resolve(input);
      console.log(`Reading MAPI file: ${inputPath}`);

      if (!fs.existsSync(inputPath)) {
        console.error(`Error: File not found: ${inputPath}`);
        process.exit(1);
      }

      const content = fs.readFileSync(inputPath, 'utf-8');
      const convertOptions = buildConvertOptions(options);

      if (options.generateIntents) {
        console.log('Generating intent keywords with LLM');
      }

      const result = await convertMapiToSkill(content, convertOptions);

      if (options.generateIntents) {
        console.log(' done');
      }

      await writeSkillOutput(result, options.output);
      console.log(`\nSkill structure written to: ${path.resolve(options.output)}`);
    } catch (error) {
      console.error('Error:', (error as Error).message);
      process.exit(1);
    }
  });

/**
 * Convert command: Convert OpenAPI to Skill format
 */
program
  .command('convert <input>')
  .description('Convert an OpenAPI specification to Skill folder structure')
  .option('-o, --output <dir>', 'Output directory', './skill-output')
  .option('-n, --name <name>', 'API name override')
  .option('-g, --generate-intents', 'Use LLM to generate enhanced intent keywords')
  .action(async (input: string, options: CommandOptions) => {
    try {
      const inputPath = path.resolve(input);
      console.log(`Reading OpenAPI file: ${inputPath}`);

      if (!fs.existsSync(inputPath)) {
        console.error(`Error: File not found: ${inputPath}`);
        process.exit(1);
      }

      const content = fs.readFileSync(inputPath, 'utf-8');
      const convertOptions = buildConvertOptions(options);

      if (options.generateIntents) {
        console.log('Generating intent keywords with LLM');
      }

      const result = await convertOpenApiToSkill(content, convertOptions);

      if (options.generateIntents) {
        console.log(' done');
      }

      await writeSkillOutput(result, options.output);
      console.log(`\nSkill structure written to: ${path.resolve(options.output)}`);
    } catch (error) {
      console.error('Error:', (error as Error).message);
      process.exit(1);
    }
  });

/**
 * Auto command: Auto-detect format and convert
 */
program
  .command('auto <input>')
  .description('Auto-detect input format and convert to Skill folder structure')
  .option('-o, --output <dir>', 'Output directory', './skill-output')
  .option('-n, --name <name>', 'API name override')
  .option('-g, --generate-intents', 'Use LLM to generate enhanced intent keywords')
  .action(async (input: string, options: CommandOptions) => {
    try {
      const inputPath = path.resolve(input);
      console.log(`Reading file: ${inputPath}`);

      if (!fs.existsSync(inputPath)) {
        console.error(`Error: File not found: ${inputPath}`);
        process.exit(1);
      }

      const content = fs.readFileSync(inputPath, 'utf-8');
      const format = detectFormat(content);
      console.log(`Detected format: ${format}`);

      const convertOptions = buildConvertOptions(options);

      if (options.generateIntents) {
        console.log('Generating intent keywords with LLM');
      }

      const result = await convertToSkill(content, convertOptions);

      if (options.generateIntents) {
        console.log(' done');
      }

      await writeSkillOutput(result, options.output);
      console.log(`\nSkill structure written to: ${path.resolve(options.output)}`);
    } catch (error) {
      console.error('Error:', (error as Error).message);
      process.exit(1);
    }
  });

/**
 * Bundle command: Convert Skill folder to single-file MAPI (out of scope)
 */
program
  .command('bundle <input>')
  .description('Convert a Skill folder to single-file MAPI (out of scope)')
  .option('-o, --output <file>', 'Output file', './bundled.mapi.md')
  .action(async (input: string, options: { output: string }) => {
    console.log('Bundle command is out of scope for this version.');
    console.log(`Would bundle ${input} to ${options.output}`);
    process.exit(0);
  });

/**
 * Write SkillOutput to the file system
 */
async function writeSkillOutput(output: SkillOutput, outputDir: string): Promise<void> {
  const outPath = path.resolve(outputDir);

  // Create output directory
  fs.mkdirSync(outPath, { recursive: true });

  // Write Skill.md
  const skillMdPath = path.join(outPath, 'Skill.md');
  fs.writeFileSync(skillMdPath, output.skillMd);
  console.log(`  Created: Skill.md`);

  // Write common files
  if (Object.keys(output.common).length > 0) {
    const commonDir = path.join(outPath, 'common');
    fs.mkdirSync(commonDir, { recursive: true });

    for (const [filePath, content] of Object.entries(output.common)) {
      const fullPath = path.join(commonDir, filePath);
      const dir = path.dirname(fullPath);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(fullPath, content);
      console.log(`  Created: common/${filePath}`);
    }
  }

  // Write capability files
  if (Object.keys(output.capabilities).length > 0) {
    const capDir = path.join(outPath, 'capabilities');
    fs.mkdirSync(capDir, { recursive: true });

    for (const [filePath, content] of Object.entries(output.capabilities)) {
      const fullPath = path.join(capDir, filePath);
      fs.writeFileSync(fullPath, content);
      console.log(`  Created: capabilities/${filePath}`);
    }
  }

  // Summary
  console.log(`\nSummary:`);
  console.log(`  - 1 Skill.md index file`);
  console.log(`  - ${Object.keys(output.common).length} common files`);
  console.log(`  - ${Object.keys(output.capabilities).length} capability files`);
}

program.parse();
