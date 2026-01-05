/**
 * Chat command - interactive CLI for running workflows
 *
 * Usage:
 *   robomesh chat plan              # runs workflows/plan.yaml
 *   robomesh chat ./my-workflow.yaml # runs explicit path
 */

import fs from 'fs/promises';
import path from 'path';
import * as readline from 'readline';
import React from 'react';
import { render } from 'ink';
import yaml from 'js-yaml';
import { executeWorkflowSchema, getProjectRoot, recordExecution, type WorkflowSchema } from '@robomesh/server';
import { validateWorkflow, formatValidationIssues } from '@robomesh/core';
import type { NodeResult } from '@robomesh/core';
import { ChatApp, type ExecutionResult } from './ChatApp.js';

// Use INIT_CWD if available (set by npm to the original working directory)
const originalCwd = process.env.INIT_CWD || process.cwd();

export interface ChatOptions {
  cwd?: string;
  input?: string;
  skipValidation?: boolean;
  dangerouslySkipPermissions?: boolean;
}

/**
 * Resolve a workflow argument to a full path
 *
 * If the arg looks like a path (contains / or ends with .yaml/.yml), use as-is.
 * Otherwise, treat as shorthand and look in standard locations.
 */
export async function resolveWorkflowPath(arg: string, cwd: string): Promise<string> {
  // If it looks like a path, use as-is
  if (arg.includes('/') || arg.includes('\\') || arg.endsWith('.yaml') || arg.endsWith('.yml')) {
    return path.resolve(cwd, arg);
  }

  // Shorthand: look for workflow by name in standard locations
  const candidates = [
    `.robomesh/workflows/${arg}.yaml`,
    `.robomesh/workflows/${arg}.yml`,
    `workflows/${arg}.yaml`,
    `workflows/${arg}.yml`,
    `.robomesh/${arg}.yaml`,
    `.robomesh/${arg}.yml`,
  ];

  for (const candidate of candidates) {
    const fullPath = path.resolve(cwd, candidate);
    try {
      await fs.access(fullPath);
      return fullPath;
    } catch {
      // Continue to next candidate
    }
  }

  throw new Error(`Workflow not found: ${arg}\nLooked in: ${candidates.join(', ')}`);
}

/**
 * Load and validate a workflow from a file path
 */
async function loadWorkflow(filePath: string): Promise<WorkflowSchema> {
  const content = await fs.readFile(filePath, 'utf-8');

  let schema: WorkflowSchema;
  if (filePath.endsWith('.json')) {
    schema = JSON.parse(content);
  } else {
    schema = yaml.load(content) as WorkflowSchema;
  }

  // Basic structure validation
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

  return schema;
}

/**
 * Prompt for user input (simple readline for now)
 */
async function promptForInput(prompt: string = '> '): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

/**
 * Check if stdin is a TTY (interactive) or piped
 */
function isInteractive(): boolean {
  return process.stdin.isTTY === true;
}

/**
 * Read piped input from stdin
 */
async function readPipedInput(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => {
      resolve(data.trim());
    });
  });
}

/**
 * Main chat command handler
 */
export async function runChat(workflowArg: string, options: ChatOptions = {}): Promise<number> {
  // Use options.cwd if provided, otherwise use original cwd (where user ran the command)
  const cwd = options.cwd ? path.resolve(originalCwd, options.cwd) : originalCwd;

  // Resolve workflow path
  let workflowPath: string;
  try {
    workflowPath = await resolveWorkflowPath(workflowArg, cwd);
  } catch (err) {
    console.error(`\x1b[31mError: ${(err as Error).message}\x1b[0m`);
    return 1;
  }

  // Load workflow
  let schema: WorkflowSchema;
  try {
    schema = await loadWorkflow(workflowPath);
  } catch (err) {
    console.error(`\x1b[31mError loading workflow: ${(err as Error).message}\x1b[0m`);
    return 1;
  }

  // Validate workflow
  if (!options.skipValidation) {
    const validation = validateWorkflow(schema);

    // Show issues but only fail on actual errors (not warnings)
    if (validation.issues.length > 0) {
      const hasErrors = !validation.valid;
      if (hasErrors) {
        console.error('\x1b[31m\x1b[1mWorkflow validation failed:\x1b[0m');
        console.error(formatValidationIssues(validation.issues));
        return 1;
      }
      // Just warnings - show them but continue
      console.error('\x1b[33mWorkflow validation warnings:\x1b[0m');
      console.error(formatValidationIssues(validation.issues));
      console.error('');
    }
  }

  // Set root directory:
  // 1. If --cwd is provided, use that (user explicitly wants this directory)
  // 2. Otherwise, use project root discovery from workflow location
  if (options.cwd) {
    // User explicitly provided --cwd, use it as root directory
    schema.metadata.rootDirectory = cwd;
  } else if (!schema.metadata.rootDirectory) {
    // No --cwd and no rootDirectory in workflow, discover from workflow location
    const workflowDir = path.dirname(workflowPath);
    schema.metadata.rootDirectory = getProjectRoot(workflowDir);
  } else if (!path.isAbsolute(schema.metadata.rootDirectory)) {
    // Workflow has relative rootDirectory, resolve from workflow location
    const workflowDir = path.dirname(workflowPath);
    schema.metadata.rootDirectory = path.resolve(workflowDir, schema.metadata.rootDirectory);
  }

  // Show warning if running with permission bypass
  if (options.dangerouslySkipPermissions) {
    console.log('\x1b[33m\x1b[1m⚠️  WARNING: Running with --yolo / --dangerously-skip-permissions\x1b[0m');
    console.log('\x1b[33m   Agents will have full write permissions without prompting.\x1b[0m');
    console.log('\x1b[33m   Only use this in sandboxed/isolated environments.\x1b[0m\n');
  }

  // Get user input - use provided input, prompt interactively, or read from pipe
  let userInput: string;
  if (options.input !== undefined) {
    userInput = options.input;
  } else if (isInteractive()) {
    userInput = await promptForInput('> ');
  } else {
    userInput = await readPipedInput();
  }

  // Determine workspace info for history
  const projectRoot = schema.metadata.rootDirectory || cwd;
  const workspace = path.basename(projectRoot);
  const relativeWorkflowPath = path.relative(projectRoot, workflowPath);

  // Track workflow result
  const resultRef: { current: ExecutionResult | null } = { current: null };
  const startedAt = new Date().toISOString();

  // Render the ink app
  const { waitUntilExit } = render(
    React.createElement(ChatApp, {
      schema,
      userInput,
      dangerouslySkipPermissions: options.dangerouslySkipPermissions,
      onComplete: (result: ExecutionResult) => {
        resultRef.current = result;
      },
    })
  );

  await waitUntilExit();

  // Record execution to history
  const executionResult = resultRef.current;
  if (executionResult) {
    try {
      await recordExecution({
        workspace,
        workflowPath: relativeWorkflowPath,
        startedAt,
        completedAt: new Date().toISOString(),
        status: executionResult.success ? 'completed' : 'failed',
        duration: executionResult.duration,
        nodeCount: executionResult.nodeCount,
        source: 'cli',
        error: executionResult.error,
        results: executionResult.results,
      });
    } catch (err) {
      // Don't fail the command if history recording fails
      console.error(`Warning: Failed to record execution history: ${(err as Error).message}`);
    }
  }

  return executionResult?.success ? 0 : 1;
}
