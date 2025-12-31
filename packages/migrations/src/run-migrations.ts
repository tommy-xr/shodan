#!/usr/bin/env node
/**
 * Migration Runner
 *
 * Runs all migrations on workflow files in the workflows/ directory.
 */

import fs from 'fs/promises';
import path from 'path';
import yaml from 'js-yaml';
import { glob } from 'glob';
import type { WorkflowSchema } from '@robomesh/core';

// Import migrations
import * as migration001 from './001-add-default-ports.js';

const MIGRATIONS = [
  migration001,
];

const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

function color(text: string, ...codes: string[]): string {
  return `${codes.join('')}${text}${COLORS.reset}`;
}

async function loadWorkflow(filePath: string): Promise<WorkflowSchema> {
  const content = await fs.readFile(filePath, 'utf-8');
  return yaml.load(content) as WorkflowSchema;
}

async function saveWorkflow(filePath: string, workflow: WorkflowSchema): Promise<void> {
  // Custom YAML dump options for cleaner output
  const content = yaml.dump(workflow, {
    indent: 2,
    lineWidth: 120,
    noRefs: true,
    sortKeys: false,
    quotingType: '"',
    forceQuotes: false,
  });
  await fs.writeFile(filePath, content, 'utf-8');
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  // Default to project root's workflows directory
  const projectRoot = path.resolve(import.meta.dirname, '../../..');
  const defaultWorkflowsDir = path.join(projectRoot, 'workflows');
  const workflowsDir = args.find(a => !a.startsWith('--')) || defaultWorkflowsDir;

  console.log(color('\nRobomesh Workflow Migrations', COLORS.bright, COLORS.cyan));
  console.log(color('==========================\n', COLORS.dim));

  if (dryRun) {
    console.log(color('DRY RUN MODE - No files will be modified\n', COLORS.yellow));
  }

  // Find all workflow files
  const pattern = path.join(workflowsDir, '**/*.yaml');
  const files = await glob(pattern);

  if (files.length === 0) {
    console.log(color(`No workflow files found in ${workflowsDir}/`, COLORS.yellow));
    return;
  }

  console.log(`Found ${files.length} workflow files\n`);

  let totalChanged = 0;
  let totalErrors = 0;

  for (const file of files) {
    try {
      let workflow = await loadWorkflow(file);
      let fileChanged = false;

      // Run all migrations
      for (const migration of MIGRATIONS) {
        const result = migration.migrate(workflow);
        if (result.changed) {
          fileChanged = true;
          workflow = result.workflow;
        }
      }

      if (fileChanged) {
        totalChanged++;
        if (dryRun) {
          console.log(color(`  [WOULD UPDATE] ${file}`, COLORS.yellow));
        } else {
          await saveWorkflow(file, workflow);
          console.log(color(`  [UPDATED] ${file}`, COLORS.green));
        }
      } else {
        console.log(color(`  [OK] ${file}`, COLORS.dim));
      }
    } catch (err) {
      totalErrors++;
      console.log(color(`  [ERROR] ${file}: ${(err as Error).message}`, COLORS.red));
    }
  }

  console.log('');
  console.log(color('Summary:', COLORS.bright));
  console.log(`  Files scanned: ${files.length}`);
  console.log(`  Files ${dryRun ? 'would be ' : ''}updated: ${totalChanged}`);
  if (totalErrors > 0) {
    console.log(color(`  Errors: ${totalErrors}`, COLORS.red));
  }
  console.log('');

  if (dryRun && totalChanged > 0) {
    console.log(color('Run without --dry-run to apply changes', COLORS.yellow));
  }
}

main().catch(err => {
  console.error(color(`\nFatal error: ${err.message}`, COLORS.red));
  process.exit(1);
});
