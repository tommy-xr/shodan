#!/usr/bin/env node

import fs from 'fs/promises';
import path from 'path';
import yaml from 'js-yaml';
import { executeWorkflowSchema, createServer, type WorkflowSchema, type NodeResult } from '@robomesh/server';
import { getProjectRoot } from '@robomesh/server';
import { validateWorkflow as validateWorkflowSchema, formatValidationIssues } from '@robomesh/core';
import { addWorkspace, removeWorkspace, listWorkspaces, isValidWorkspace, initWorkspace } from './src/config.js';

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
${color('Robomesh', COLORS.bright, COLORS.cyan)} - AI Workflow Orchestration

${color('Usage:', COLORS.bright)}
  robomesh run <workflow.yaml> [options]    Run a workflow
  robomesh validate <workflow.yaml>         Validate a workflow file
  robomesh serve [--port 3000]              Start server with dashboard
  robomesh init [path]                      Initialize a new workspace
  robomesh add [path]                       Register a workspace
  robomesh remove [path]                    Unregister a workspace
  robomesh list                             Show registered workspaces
  robomesh help                             Show this help

${color('Run Options:', COLORS.bright)}
  --cwd <dir>         Override working directory
  --input <text>      Pass text input to trigger node
  --quiet             Only show errors and final result
  --verbose           Show detailed output for each node
  --no-validation     Skip schema validation (not recommended)

${color('Serve Options:', COLORS.bright)}
  --port <port>       Server port (default: 3000)

${color('Examples:', COLORS.bright)}
  robomesh run ./workflows/build.yaml
  robomesh run ./workflows/deploy.yaml --cwd /path/to/project
  robomesh run ./workflows/process.yaml --input "Hello World"
  robomesh validate ./workflows/*.yaml
  robomesh init .                           # Initialize current directory
  robomesh add .                            # Register current directory
  robomesh serve                            # Start dashboard server
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
    // Use project root discovery (looks for .robomesh, .git, package.json)
    schema.metadata.rootDirectory = getProjectRoot(workflowDir);
  }

  return schema;
}

async function runWorkflow(filePath: string, options: { cwd?: string; input?: string; quiet?: boolean; verbose?: boolean; skipValidation?: boolean }) {
  console.log(color(`\n▶ Running workflow: ${filePath}`, COLORS.bright));

  const schema = await loadWorkflow(filePath);

  // Override rootDirectory if --cwd provided
  if (options.cwd) {
    schema.metadata.rootDirectory = path.resolve(originalCwd, options.cwd);
  }

  // Run schema validation (unless skipped)
  if (!options.skipValidation) {
    const validation = validateWorkflowSchema(schema);

    // All issues (errors and warnings) are treated as errors by default
    if (validation.issues.length > 0) {
      console.error(color('\n✗ Workflow validation failed:', COLORS.red, COLORS.bright));
      console.error(formatValidationIssues(validation.issues));
      console.error('');
      console.error(color('Use --no-validation to skip (not recommended)', COLORS.dim));
      return 1;
    }
  }

  console.log(color(`  Workflow: ${schema.metadata.name}`, COLORS.dim));
  if (schema.metadata.rootDirectory) {
    console.log(color(`  Directory: ${schema.metadata.rootDirectory}`, COLORS.dim));
  }
  console.log(color(`  Nodes: ${schema.nodes.length}`, COLORS.dim));
  if (options.input) {
    console.log(color(`  Input: ${options.input}`, COLORS.dim));
  }
  console.log('');

  const startTime = Date.now();

  // Build trigger inputs if --input provided
  const triggerInputs = options.input ? { text: options.input } : undefined;

  // Track running nodes for parallel execution display
  const runningNodes = new Set<string>();
  const nodeLabels = new Map<string, string>();

  const result = await executeWorkflowSchema(schema, {
    triggerInputs,
    onNodeStart: (nodeId, node) => {
      const label = (node.data.label as string) || nodeId;
      nodeLabels.set(nodeId, label);
      runningNodes.add(nodeId);

      if (!options.quiet) {
        console.log(color(`  ● ${label}`, COLORS.yellow), color('running...', COLORS.dim));
      }
    },
    onNodeComplete: (nodeId, result) => {
      runningNodes.delete(nodeId);

      if (!options.quiet) {
        const icon = result.status === 'completed' ? color('✓', COLORS.green) : color('✗', COLORS.red);
        const label = nodeLabels.get(nodeId) || nodeId;

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
    onNodeOutput: (nodeId, chunk) => {
      if (options.verbose) {
        const label = nodeLabels.get(nodeId) || nodeId;
        // Prefix output with node label when multiple nodes are running
        if (runningNodes.size > 1) {
          const lines = chunk.split('\n');
          for (const line of lines) {
            if (line.trim()) {
              process.stdout.write(color(`[${label}] ${line}\n`, COLORS.dim));
            }
          }
        } else {
          process.stdout.write(color(chunk, COLORS.dim));
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

async function validateWorkflowFile(filePath: string): Promise<boolean> {
  try {
    const schema = await loadWorkflow(filePath);

    // Run schema validation
    const validation = validateWorkflowSchema(schema);

    // All issues (errors and warnings) fail validation
    if (validation.issues.length > 0) {
      console.log(color(`✗ ${filePath}`, COLORS.red), color(`(${schema.metadata.name}) - ${validation.issues.length} issue(s)`, COLORS.dim));
      console.log(formatValidationIssues(validation.issues));
      return false;
    }

    console.log(color(`✓ ${filePath}`, COLORS.green), color(`(${schema.metadata.name})`, COLORS.dim));
    return true;
  } catch (err) {
    console.log(color(`✗ ${filePath}`, COLORS.red), color(`- ${(err as Error).message}`, COLORS.dim));
    return false;
  }
}

async function handleInit(args: string[]) {
  const workspacePath = args[1] || '.';
  const absolutePath = path.resolve(originalCwd, workspacePath);
  const createWorkflows = args.includes('--with-workflows');

  // Check if already initialized
  const validation = await isValidWorkspace(absolutePath);
  if (validation.valid) {
    console.log(color(`\n● Workspace already initialized: ${absolutePath}`, COLORS.yellow));
    return;
  }

  try {
    await initWorkspace(absolutePath, { createWorkflows });
    console.log(color(`\n✓ Workspace initialized: ${absolutePath}`, COLORS.green));
    console.log(color(`  Created .robomesh/ directory`, COLORS.dim));
    if (createWorkflows) {
      console.log(color(`  Created workflows/hello-world.yaml`, COLORS.dim));
    }
    console.log(color(`\n  Next: run "robomesh add ${workspacePath}" to register this workspace`, COLORS.dim));
  } catch (err) {
    console.error(color(`\n✗ Failed to initialize: ${(err as Error).message}`, COLORS.red));
    process.exit(1);
  }
}

async function handleAdd(args: string[]) {
  const workspacePath = args[1] || '.';
  const absolutePath = path.resolve(originalCwd, workspacePath);

  // Validate the workspace
  const validation = await isValidWorkspace(absolutePath);
  if (!validation.valid) {
    console.error(color(`\n✗ Cannot add workspace: ${validation.reason}`, COLORS.red));
    console.error(color(`  Path: ${absolutePath}`, COLORS.dim));
    console.log('');
    console.log(color(`  To initialize this directory as a workspace, run:`, COLORS.dim));
    console.log(color(`    robomesh init ${workspacePath}`, COLORS.cyan));
    console.log(color(`    robomesh init ${workspacePath} --with-workflows  # also create sample workflow`, COLORS.dim));
    process.exit(1);
  }

  const added = await addWorkspace(absolutePath);
  if (added) {
    console.log(color(`\n✓ Workspace registered: ${absolutePath}`, COLORS.green));
  } else {
    console.log(color(`\n● Workspace already registered: ${absolutePath}`, COLORS.yellow));
  }
}

async function handleRemove(args: string[]) {
  const workspacePath = args[1] || '.';
  const absolutePath = path.resolve(originalCwd, workspacePath);

  const removed = await removeWorkspace(absolutePath);
  if (removed) {
    console.log(color(`\n✓ Workspace unregistered: ${absolutePath}`, COLORS.green));
  } else {
    console.log(color(`\n✗ Workspace not found: ${absolutePath}`, COLORS.red));
    process.exit(1);
  }
}

async function handleList() {
  const workspaces = await listWorkspaces();

  console.log(color('\nRegistered Workspaces:', COLORS.bright));
  if (workspaces.length === 0) {
    console.log(color('  (none)', COLORS.dim));
    console.log(color('\n  Use "robomesh add [path]" to register a workspace', COLORS.dim));
  } else {
    for (const workspace of workspaces) {
      // Check if workspace still exists
      const validation = await isValidWorkspace(workspace);
      const status = validation.valid
        ? color('✓', COLORS.green)
        : color('✗', COLORS.red);
      console.log(`  ${status} ${workspace}`);
    }
  }
  console.log('');
}

async function handleServe(args: string[]) {
  const portIndex = args.indexOf('--port');
  const port = portIndex !== -1 ? parseInt(args[portIndex + 1], 10) : 3000;

  const workspaces = await listWorkspaces();

  if (workspaces.length === 0) {
    console.error(color('\n✗ No workspaces registered', COLORS.red));
    console.error(color('  Use "robomesh add [path]" to register a workspace first', COLORS.dim));
    process.exit(1);
  }

  // Resolve designer path relative to this CLI package
  // When running from source (tsx): ../designer/dist from cli/
  // When running from dist: ../../designer/dist from cli/dist/
  // When published: will need to be bundled or resolved differently
  const __filename = new URL(import.meta.url).pathname;
  const __dirname = path.dirname(__filename);
  // Check if we're in a dist folder
  const isInDist = __dirname.endsWith('/dist') || __dirname.includes('/dist/');
  const designerPath = isInDist
    ? path.resolve(__dirname, '../../designer/dist')
    : path.resolve(__dirname, '../designer/dist');

  console.log(color('\n▶ Starting Robomesh server...', COLORS.bright));
  console.log(color(`  Port: ${port}`, COLORS.dim));
  console.log(color(`  Workspaces: ${workspaces.length}`, COLORS.dim));
  for (const workspace of workspaces) {
    console.log(color(`    - ${workspace}`, COLORS.dim));
  }

  const app = createServer({
    port,
    designerPath,
    workspaces,
  });

  app.listen(port, () => {
    console.log('');
    console.log(color(`✓ Server running at http://localhost:${port}`, COLORS.green, COLORS.bright));
    console.log(color(`  Dashboard: http://localhost:${port}`, COLORS.cyan));
    console.log(color(`  API: http://localhost:${port}/api`, COLORS.dim));
    console.log('');
    console.log(color('Press Ctrl+C to stop', COLORS.dim));
  });
}

async function main() {
  // Filter out '--' which npm/pnpm use to separate script args
  const args = process.argv.slice(2).filter(arg => arg !== '--');

  if (args.length === 0 || args[0] === 'help' || args[0] === '--help' || args[0] === '-h') {
    printUsage();
    process.exit(0);
  }

  const command = args[0];

  if (command === 'init') {
    await handleInit(args);
    process.exit(0);
  }

  if (command === 'add') {
    await handleAdd(args);
    process.exit(0);
  }

  if (command === 'remove') {
    await handleRemove(args);
    process.exit(0);
  }

  if (command === 'list') {
    await handleList();
    process.exit(0);
  }

  if (command === 'serve') {
    await handleServe(args);
    return; // Don't exit, server is running
  }

  if (command === 'run') {
    const filePath = args[1];
    if (!filePath) {
      console.error(color('Error: Please specify a workflow file', COLORS.red));
      process.exit(1);
    }

    const options = {
      cwd: args.includes('--cwd') ? args[args.indexOf('--cwd') + 1] : undefined,
      input: args.includes('--input') ? args[args.indexOf('--input') + 1] : undefined,
      quiet: args.includes('--quiet') || args.includes('-q'),
      verbose: args.includes('--verbose') || args.includes('-v'),
      skipValidation: args.includes('--no-validation'),
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
    const files = args.slice(1).filter(f => !f.startsWith('--'));
    if (files.length === 0) {
      console.error(color('Error: Please specify workflow file(s) to validate', COLORS.red));
      process.exit(1);
    }

    console.log(color('\nValidating workflows...\n', COLORS.bright));

    let allValid = true;
    for (const file of files) {
      const valid = await validateWorkflowFile(file);
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
