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
import type { WorkflowSchema, NodeResult } from '@shodan/core';
import { executeWorkflowSchema, type ExecuteOptions, type ExecuteResult } from './engine/executor.js';
import { loadWorkflow } from './engine/workflow-loader.js';

const WORKFLOWS_DIR = path.resolve(import.meta.dirname, '../../../workflows');
const PROJECT_ROOT = path.resolve(WORKFLOWS_DIR, '..');

// ============================================================================
// Test Helpers
// ============================================================================

interface RunOptions extends ExecuteOptions {
  rootDirectory?: string;
}

async function runWorkflow(filename: string, options?: RunOptions): Promise<ExecuteResult> {
  const content = await fs.readFile(path.join(WORKFLOWS_DIR, filename), 'utf-8');
  const schema = yaml.load(content) as WorkflowSchema;
  if (options?.rootDirectory) {
    schema.metadata.rootDirectory = options.rootDirectory;
  }
  const { rootDirectory: _, ...executeOptions } = options || {};
  return executeWorkflowSchema(schema, executeOptions);
}

function getNode(result: ExecuteResult, nodeId: string): NodeResult {
  const node = result.results.find((r: NodeResult) => r.nodeId === nodeId);
  assert.ok(node, `Should have ${nodeId} result`);
  return node;
}

function assertOutputContains(node: NodeResult, text: string, field: 'output' | 'rawOutput' | 'stdout' | 'stderr' = 'rawOutput') {
  const value = node[field];
  assert.ok(
    value?.includes(text),
    `${node.nodeId}.${field} should contain "${text}", got: ${value}`
  );
}

function assertOutputNotContains(node: NodeResult, text: string, field: 'output' | 'rawOutput' = 'output') {
  const value = node[field];
  assert.ok(
    !value?.includes(text),
    `${node.nodeId}.${field} should NOT contain "${text}", got: ${value}`
  );
}

function assertNodeCompleted(node: NodeResult) {
  assert.strictEqual(node.status, 'completed', `${node.nodeId} should be completed`);
}

function assertNodeFailed(node: NodeResult) {
  assert.strictEqual(node.status, 'failed', `${node.nodeId} should be failed`);
}

function assertNodeNotExecuted(result: ExecuteResult, nodeId: string) {
  const node = result.results.find((r: NodeResult) => r.nodeId === nodeId);
  assert.strictEqual(node, undefined, `${nodeId} should not have executed`);
}

// ============================================================================
// Tests
// ============================================================================

describe('Workflow Execution', () => {
  test('hello-world.yaml runs successfully', async () => {
    const result = await runWorkflow('hello-world.yaml');
    assert.strictEqual(result.success, true);

    const shell = getNode(result, 'shell_1');
    assertOutputContains(shell, 'Hello from Shodan!', 'output');
  });

  test('git-branch-info.yaml runs successfully', async () => {
    const result = await runWorkflow('git-branch-info.yaml', { rootDirectory: PROJECT_ROOT });
    assert.strictEqual(result.success, true);
    assert.ok(result.results.length > 0);
  });

  test('project-info.yaml runs with template substitution', async () => {
    const result = await runWorkflow('project-info.yaml', { rootDirectory: PROJECT_ROOT });
    assert.strictEqual(result.success, true);

    const summary = getNode(result, 'shell_summary');
    assertOutputNotContains(summary, '{{ ');
    assertOutputContains(summary, 'Project Summary', 'output');
  });

  test('multi-line-demo.yaml executes multi-line scripts correctly', async () => {
    const result = await runWorkflow('multi-line-demo.yaml', { rootDirectory: WORKFLOWS_DIR });
    assert.strictEqual(result.success, true);

    const loop = getNode(result, 'shell_loop');
    assertOutputContains(loop, 'Sum: 15');

    const conditional = getNode(result, 'shell_conditional');
    assertOutputContains(conditional, 'YAML files');

    const heredoc = getNode(result, 'shell_heredoc');
    assertOutputContains(heredoc, '=== Report ===');

    const summary = getNode(result, 'shell_summary');
    assertOutputContains(summary, 'Loop result: Sum: 15');
    assertOutputNotContains(summary, '{{ ');
  });
});

describe('Phase 2: I/O System', () => {
  test('test-phase2-io.yaml - trigger inputs and named outputs', async () => {
    const result = await runWorkflow('test-phase2-io.yaml', {
      triggerInputs: { text: 'Hello from tests!' }
    });
    assert.strictEqual(result.success, true);

    const shell2 = getNode(result, 'shell-2');
    assertOutputContains(shell2, 'Hello from tests!', 'output');

    const shell1 = getNode(result, 'shell-1');
    assertOutputContains(shell1, 'This is stdout output', 'stdout');
    assertOutputContains(shell1, 'This is stderr output', 'stderr');
    assert.strictEqual(shell1.exitCode, 0);
  });

  test('test-stderr-exitcode.yaml - continueOnFailure and non-zero exit codes', async () => {
    const result = await runWorkflow('test-stderr-exitcode.yaml');
    assert.strictEqual(result.success, false);

    const failNode = getNode(result, 'shell-fail');
    assertNodeFailed(failNode);
    assert.strictEqual(failNode.exitCode, 42);

    const verifyNode = getNode(result, 'shell-verify-exitcode');
    assertNodeCompleted(verifyNode);
    assertOutputContains(verifyNode, 'SUCCESS: Exit code 42 was captured correctly!', 'output');
  });

  test('test-failure-stops-workflow.yaml - workflow stops on failure', async () => {
    const result = await runWorkflow('test-failure-stops-workflow.yaml');
    assert.strictEqual(result.success, false);

    assertNodeCompleted(getNode(result, 'shell-success'));
    assertNodeFailed(getNode(result, 'shell-fail'));
    assertNodeNotExecuted(result, 'shell-should-not-run');
  });

  test('test-input-resolution-stops-workflow.yaml - stops on missing input', async () => {
    const result = await runWorkflow('test-input-resolution-stops-workflow.yaml');
    assert.strictEqual(result.success, false);

    assertNodeCompleted(getNode(result, 'shell-success'));

    const missingInput = getNode(result, 'shell-missing-input');
    assertNodeFailed(missingInput);
    assert.ok(missingInput.error?.includes('required_data'));

    assertNodeNotExecuted(result, 'shell-sibling');
  });
});

describe('Loop Execution', () => {
  test('test-loop-dock.yaml - dock-based loop', async () => {
    const result = await runWorkflow('test-loop-dock.yaml');
    assert.strictEqual(result.success, true);

    const loop = getNode(result, 'count-loop');
    assertNodeCompleted(loop);
    assertOutputContains(loop, '5 iterations', 'output');
  });

  test('test-loop-nested.yaml - nested loops', async () => {
    const result = await runWorkflow('test-loop-nested.yaml');
    assert.strictEqual(result.success, true);

    const outer = getNode(result, 'outer-loop');
    assertNodeCompleted(outer);
    assertOutputContains(outer, '3 iterations', 'output');
  });
});

describe('Constant Node', () => {
  test('test-constant.yaml - values pass through to shell', async () => {
    const result = await runWorkflow('test-constant.yaml');
    assert.strictEqual(result.success, true);

    const echo = getNode(result, 'echo-all');
    assertNodeCompleted(echo);
    assertOutputContains(echo, 'String: Hello, Shodan!');
    assertOutputContains(echo, 'Number: 42');
    assertOutputContains(echo, 'Boolean: true');
  });

  test('test-loop-constant-true.yaml - runs to max iterations', async () => {
    const result = await runWorkflow('test-loop-constant-true.yaml');
    assert.strictEqual(result.success, true);

    const loop = getNode(result, 'loop');
    assertNodeCompleted(loop);
    assertOutputContains(loop, '3 iterations', 'output');
    assertOutputContains(loop, 'max iterations reached', 'output');
  });

  test('test-loop-constant-false.yaml - stops after 1 iteration', async () => {
    const result = await runWorkflow('test-loop-constant-false.yaml');
    assert.strictEqual(result.success, true);

    const loop = getNode(result, 'loop');
    assertNodeCompleted(loop);
    assertOutputContains(loop, '1 iteration', 'output');
    assertOutputNotContains(loop, 'max iterations', 'output');
  });
});

describe('Workflow Validation', () => {
  test('all workflows in directory are valid', async () => {
    const files = await fs.readdir(WORKFLOWS_DIR);
    const yamlFiles = files.filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));

    assert.ok(yamlFiles.length > 0, 'Should have workflow files');

    for (const file of yamlFiles) {
      const content = await fs.readFile(path.join(WORKFLOWS_DIR, file), 'utf-8');
      const schema = yaml.load(content) as WorkflowSchema;

      assert.ok(typeof schema.version === 'number', `${file}: should have version`);
      assert.ok(schema.metadata?.name, `${file}: should have metadata.name`);
      assert.ok(Array.isArray(schema.nodes), `${file}: should have nodes array`);
      assert.ok(Array.isArray(schema.edges), `${file}: should have edges array`);
    }
  });
});

/**
 * Session persistence tests - require API keys/CLIs to be available
 * Set TEST_AGENTS=1 to run these tests
 */
const runAgentTests = process.env.TEST_AGENTS === '1';

describe('Session Persistence', { skip: !runAgentTests }, () => {
  test('test-session-persistence.yaml - Claude Code session persistence', async () => {
    const schema = await loadWorkflow('test-session-persistence.yaml');
    schema.metadata.rootDirectory = path.resolve(WORKFLOWS_DIR, '..');

    const result = await executeWorkflowSchema(schema);

    assert.strictEqual(result.success, true, 'Workflow should succeed');

    // Find the verify node result
    const verifyResult = result.results.find(r => r.nodeId === 'verify');
    assert.ok(verifyResult, 'Should have verify result');
    assert.ok(
      verifyResult.rawOutput?.includes('SUCCESS'),
      `Session persistence should work, got: ${verifyResult.rawOutput}`
    );
  });

  test('test-session-codex.yaml - Codex session persistence', async () => {
    const schema = await loadWorkflow('test-session-codex.yaml');
    schema.metadata.rootDirectory = path.resolve(WORKFLOWS_DIR, '..');

    const result = await executeWorkflowSchema(schema);

    assert.strictEqual(result.success, true, 'Workflow should succeed');

    // Find the verify node result
    const verifyResult = result.results.find(r => r.nodeId === 'verify');
    assert.ok(verifyResult, 'Should have verify result');
    assert.ok(
      verifyResult.rawOutput?.includes('SUCCESS'),
      `Session persistence should work, got: ${verifyResult.rawOutput}`
    );
  });

  test('test-session-openai.yaml - OpenAI conversation history persistence', async () => {
    const schema = await loadWorkflow('test-session-openai.yaml');
    schema.metadata.rootDirectory = path.resolve(WORKFLOWS_DIR, '..');

    const result = await executeWorkflowSchema(schema);

    assert.strictEqual(result.success, true, 'Workflow should succeed');

    // Find the verify node result
    const verifyResult = result.results.find(r => r.nodeId === 'verify');
    assert.ok(verifyResult, 'Should have verify result');
    assert.ok(
      verifyResult.rawOutput?.includes('SUCCESS'),
      `Session persistence should work, got: ${verifyResult.rawOutput}`
    );
  });

  // TODO: Loop session persistence test is complex and needs more work
  // test('test-session-loop.yaml - Session persistence across loop iterations', async () => {
  //   const schema = await loadWorkflow('test-session-loop.yaml');
  //   schema.metadata.rootDirectory = path.resolve(WORKFLOWS_DIR, '..');
  //   const result = await executeWorkflowSchema(schema);
  //   assert.strictEqual(result.success, true, 'Workflow should succeed');
  //   const verifyResult = result.results.find(r => r.nodeId === 'verify');
  //   assert.ok(verifyResult, 'Should have verify result');
  //   assert.ok(
  //     verifyResult.rawOutput?.includes('SUCCESS'),
  //     `Loop session persistence should work, got: ${verifyResult.rawOutput}`
  //   );
  // });
});
