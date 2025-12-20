#!/usr/bin/env npx tsx
/**
 * Minimal workflow test runner using Node's built-in test module.
 * Validates workflow execution and output.
 *
 * Usage: npx tsx src/test-workflows.ts
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'fs/promises';
import path from 'path';
import yaml from 'js-yaml';
import { executeWorkflowSchema, type WorkflowSchema } from './engine/executor.js';

const WORKFLOWS_DIR = path.resolve(import.meta.dirname, '../../workflows');

async function loadWorkflow(filename: string): Promise<WorkflowSchema> {
  const content = await fs.readFile(path.join(WORKFLOWS_DIR, filename), 'utf-8');
  return yaml.load(content) as WorkflowSchema;
}

describe('Workflow Execution', () => {
  test('hello-world.yaml runs successfully', async () => {
    const schema = await loadWorkflow('hello-world.yaml');
    const result = await executeWorkflowSchema(schema);

    assert.strictEqual(result.success, true, 'Workflow should succeed');
    assert.ok(result.results.length > 0, 'Should have node results');

    // Find the shell node output
    const shellResult = result.results.find(r => r.nodeId === 'shell_1');
    assert.ok(shellResult, 'Should have shell_1 result');
    assert.ok(
      shellResult.output?.includes('Hello from Shodan!'),
      `Output should contain greeting, got: ${shellResult.output}`
    );
  });

  test('git-branch-info.yaml runs successfully', async () => {
    const schema = await loadWorkflow('git-branch-info.yaml');
    // Set rootDirectory to project root for git commands
    schema.metadata.rootDirectory = path.resolve(WORKFLOWS_DIR, '..');

    const result = await executeWorkflowSchema(schema);

    assert.strictEqual(result.success, true, 'Workflow should succeed');
    assert.ok(result.results.length > 0, 'Should have node results');
  });

  test('project-info.yaml runs with template substitution', async () => {
    const schema = await loadWorkflow('project-info.yaml');
    // Set rootDirectory to project root
    schema.metadata.rootDirectory = path.resolve(WORKFLOWS_DIR, '..');

    const result = await executeWorkflowSchema(schema);

    assert.strictEqual(result.success, true, 'Workflow should succeed');

    // Find the summary node - it should have templated values filled in
    const summaryResult = result.results.find(r => r.nodeId === 'shell_summary');
    assert.ok(summaryResult, 'Should have shell_summary result');

    // The output should NOT contain unreplaced template variables
    assert.ok(
      !summaryResult.output?.includes('{{ '),
      `Output should not have unreplaced templates, got: ${summaryResult.output}`
    );

    // Should contain "Project Summary"
    assert.ok(
      summaryResult.output?.includes('Project Summary'),
      `Output should contain summary header, got: ${summaryResult.output}`
    );
  });
});

describe('Workflow Validation', () => {
  test('all workflows in directory are valid', async () => {
    const files = await fs.readdir(WORKFLOWS_DIR);
    const yamlFiles = files.filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));

    assert.ok(yamlFiles.length > 0, 'Should have workflow files to test');

    for (const file of yamlFiles) {
      const schema = await loadWorkflow(file);

      assert.ok(typeof schema.version === 'number', `${file}: should have version`);
      assert.ok(schema.metadata?.name, `${file}: should have metadata.name`);
      assert.ok(Array.isArray(schema.nodes), `${file}: should have nodes array`);
      assert.ok(Array.isArray(schema.edges), `${file}: should have edges array`);
    }
  });
});
