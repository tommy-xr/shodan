#!/usr/bin/env node

import fs from 'fs/promises';
import path from 'path';
import yaml from 'js-yaml';
import type { WorkflowSchema, NodeResult } from '@shodan/core';
import { executeWorkflowSchema } from './engine/executor.js';
import { getProjectRoot } from './utils/project-root.js';

// Use INIT_CWD if available (set by npm to the original working directory)
const originalCwd = process.env.INIT_CWD || process.cwd();

const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  blue: '\x1b[34m',
};

function color(text: string, ...codes: string[]): string {
  return `${codes.join('')}${text}${COLORS.reset}`;
}

function printUsage() {
  console.log(`
${color('Shodan', COLORS.bright, COLORS.cyan)} - AI Workflow Orchestration

${color('Usage:', COLORS.bright)}
  shodan run <workflow.yaml> [options]    Run a workflow
  shodan validate <workflow.yaml>         Validate a workflow file
  shodan help                             Show this help

${color('Options:', COLORS.bright)}
  --cwd <dir>       Override working directory
  --quiet           Only show errors and final result
  --verbose         Show detailed output for each node

${color('Examples:', COLORS.bright)}
  shodan run ./workflows/build.yaml
  shodan run ./workflows/deploy.yaml --cwd /path/to/project
  shodan validate ./workflows/*.yaml
`);
}

async function loadWorkflow(filePath: string): Promise<WorkflowSchema> {
  // Resolve relative to original working directory (where user ran the command)
  const absolutePath = path.resolve(originalCwd, filePath);
  const content = await fs.readFile(absolutePath, 'utf-8');

  let schema: WorkflowSchema;
  if (filePath.endsWith('.json')) {
    schema = JSON.parse(content);
  } else {
    schema = yaml.load(content) as WorkflowSchema;
  }

  // Validate basic structure
  if (typeof schema.version !== 'number') {
    throw new Error('Invalid workflow: missing version field');
  }
  if (!schema.metadata?.name) {
    throw new Error('Invalid workflow: missing metadata.name');
  }
  if (!Array.isArray(schema.nodes)) {
    throw new Error('Invalid workflow: nodes must be an array');
  }
  if (!Array.isArray(schema.edges)) {
    throw new Error('Invalid workflow: edges must be an array');
  }

  // Resolve rootDirectory - use project root discovery
  const workflowDir = path.dirname(absolutePath);
  if (schema.metadata.rootDirectory) {
    // If specified and relative, resolve relative to workflow file
    if (!path.isAbsolute(schema.metadata.rootDirectory)) {
      schema.metadata.rootDirectory = path.resolve(workflowDir, schema.metadata.rootDirectory);
    }
  } else {
    // Use project root discovery (looks for .shodan, .git, package.json)
    schema.metadata.rootDirectory = getProjectRoot(workflowDir);
  }

  return schema;
}

async function runWorkflow(filePath: string, options: { cwd?: string; quiet?: boolean; verbose?: boolean }) {
  console.log(color(`\n▶ Running workflow: ${filePath}`, COLORS.bright));

  const schema = await loadWorkflow(filePath);

  // Override rootDirectory if --cwd provided
  if (options.cwd) {
    schema.metadata.rootDirectory = path.resolve(originalCwd, options.cwd);
  }

  console.log(color(`  Workflow: ${schema.metadata.name}`, COLORS.dim));
  if (schema.metadata.rootDirectory) {
    console.log(color(`  Directory: ${schema.metadata.rootDirectory}`, COLORS.dim));
  }
  console.log(color(`  Nodes: ${schema.nodes.length}`, COLORS.dim));
  console.log('');

  const startTime = Date.now();

  const result = await executeWorkflowSchema(schema, {
    onNodeStart: (nodeId, node) => {
      if (!options.quiet) {
        const label = node.data.label || nodeId;
        console.log(color(`  ● ${label}`, COLORS.yellow), color('running...', COLORS.dim));
      }
    },
    onNodeComplete: (nodeId, result) => {
      if (!options.quiet) {
        const icon = result.status === 'completed' ? color('✓', COLORS.green) : color('✗', COLORS.red);
        const node = schema.nodes.find(n => n.id === nodeId);
        const label = node?.data.label || nodeId;

        // Move cursor up and rewrite the line
        process.stdout.write('\x1b[1A\x1b[2K');
        console.log(`  ${icon} ${label}`);

        if (options.verbose && result.output) {
          const indented = result.output.split('\n').map(l => `      ${l}`).join('\n');
          console.log(color(indented, COLORS.dim));
        }

        if (result.status === 'failed' && result.error) {
          console.log(color(`      Error: ${result.error}`, COLORS.red));
        }
      }
    },
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log('');
  if (result.success) {
    console.log(color(`✓ Workflow completed successfully`, COLORS.green, COLORS.bright), color(`(${elapsed}s)`, COLORS.dim));
  } else {
    console.log(color(`✗ Workflow failed`, COLORS.red, COLORS.bright), color(`(${elapsed}s)`, COLORS.dim));

    // Show failed node output
    const failedResult = result.results.find(r => r.status === 'failed');
    if (failedResult?.output) {
      console.log(color('\nOutput:', COLORS.bright));
      console.log(failedResult.output);
    }
  }
  console.log('');

  return result.success ? 0 : 1;
}

async function validateWorkflow(filePath: string): Promise<boolean> {
  try {
    const schema = await loadWorkflow(filePath);
    console.log(color(`✓ ${filePath}`, COLORS.green), color(`(${schema.metadata.name})`, COLORS.dim));
    return true;
  } catch (err) {
    console.log(color(`✗ ${filePath}`, COLORS.red), color(`- ${(err as Error).message}`, COLORS.dim));
    return false;
  }
}

async function main() {
  // Filter out '--' which npm/pnpm use to separate script args
  const args = process.argv.slice(2).filter(arg => arg !== '--');

  if (args.length === 0 || args[0] === 'help' || args[0] === '--help' || args[0] === '-h') {
    printUsage();
    process.exit(0);
  }

  const command = args[0];

  if (command === 'run') {
    const filePath = args[1];
    if (!filePath) {
      console.error(color('Error: Please specify a workflow file', COLORS.red));
      process.exit(1);
    }

    const options = {
      cwd: args.includes('--cwd') ? args[args.indexOf('--cwd') + 1] : undefined,
      quiet: args.includes('--quiet') || args.includes('-q'),
      verbose: args.includes('--verbose') || args.includes('-v'),
    };

    try {
      const exitCode = await runWorkflow(filePath, options);
      process.exit(exitCode);
    } catch (err) {
      console.error(color(`\nError: ${(err as Error).message}`, COLORS.red));
      process.exit(1);
    }
  }

  if (command === 'validate') {
    const files = args.slice(1);
    if (files.length === 0) {
      console.error(color('Error: Please specify workflow file(s) to validate', COLORS.red));
      process.exit(1);
    }

    console.log(color('\nValidating workflows...\n', COLORS.bright));

    let allValid = true;
    for (const file of files) {
      const valid = await validateWorkflow(file);
      if (!valid) allValid = false;
    }

    console.log('');
    process.exit(allValid ? 0 : 1);
  }

  console.error(color(`Unknown command: ${command}`, COLORS.red));
  printUsage();
  process.exit(1);
}

main();
