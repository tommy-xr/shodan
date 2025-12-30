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
import type { WorkflowSchema } from '@shodan/core';
import { executeWorkflowSchema } from './engine/executor.js';

const WORKFLOWS_DIR = path.resolve(import.meta.dirname, '../../../workflows');

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

  test('multi-line-demo.yaml executes multi-line scripts correctly', async () => {
    const schema = await loadWorkflow('multi-line-demo.yaml');
    schema.metadata.rootDirectory = WORKFLOWS_DIR;

    const result = await executeWorkflowSchema(schema);

    assert.strictEqual(result.success, true, 'Workflow should succeed');

    // Test for loop output
    const loopResult = result.results.find(r => r.nodeId === 'shell_loop');
    assert.ok(loopResult, 'Should have shell_loop result');
    assert.ok(
      loopResult.rawOutput?.includes('Sum: 15'),
      `Loop should calculate sum correctly, got: ${loopResult.rawOutput}`
    );

    // Test conditional output
    const conditionalResult = result.results.find(r => r.nodeId === 'shell_conditional');
    assert.ok(conditionalResult, 'Should have shell_conditional result');
    assert.ok(
      conditionalResult.rawOutput?.includes('YAML files'),
      `Conditional should find YAML files, got: ${conditionalResult.rawOutput}`
    );

    // Test here-doc output
    const heredocResult = result.results.find(r => r.nodeId === 'shell_heredoc');
    assert.ok(heredocResult, 'Should have shell_heredoc result');
    assert.ok(
      heredocResult.rawOutput?.includes('=== Report ==='),
      `Heredoc should contain report header, got: ${heredocResult.rawOutput}`
    );

    // Test summary has correct template substitution (uses rawOutput from previous nodes)
    const summaryResult = result.results.find(r => r.nodeId === 'shell_summary');
    assert.ok(summaryResult, 'Should have shell_summary result');
    assert.ok(
      summaryResult.rawOutput?.includes('Loop result: Sum: 15'),
      `Summary should have substituted loop result, got: ${summaryResult.rawOutput}`
    );
    assert.ok(
      !summaryResult.output?.includes('{{ '),
      `Summary should not have unreplaced templates, got: ${summaryResult.output}`
    );
  });
});

describe('Phase 2: I/O System', () => {
  test('test-phase2-io.yaml - trigger inputs and named outputs', async () => {
    const schema = await loadWorkflow('test-phase2-io.yaml');
    const result = await executeWorkflowSchema(schema, {
      triggerInputs: { text: 'Hello from tests!' }
    });

    assert.strictEqual(result.success, true, 'Workflow should succeed');

    // Verify trigger outputs were used
    const shell2 = result.results.find(r => r.nodeId === 'shell-2');
    assert.ok(shell2, 'Should have shell-2 result');
    assert.ok(
      shell2.output?.includes('Hello from tests!'),
      `Should use trigger text input, got: ${shell2.output}`
    );

    // Verify stdout output capture
    const shell1 = result.results.find(r => r.nodeId === 'shell-1');
    assert.ok(shell1?.stdout, 'shell-1 should have stdout');
    assert.ok(
      shell1.stdout?.includes('This is stdout output'),
      `stdout should contain expected text, got: ${shell1.stdout}`
    );

    // Verify stderr output capture
    assert.ok(shell1?.stderr, 'shell-1 should have stderr');
    assert.ok(
      shell1.stderr?.includes('This is stderr output'),
      `stderr should contain expected text, got: ${shell1.stderr}`
    );

    // Verify exitCode output
    assert.strictEqual(shell1?.exitCode, 0, 'shell-1 should have exitCode 0');
  });

  test('test-stderr-exitcode.yaml - continueOnFailure and non-zero exit codes', async () => {
    const schema = await loadWorkflow('test-stderr-exitcode.yaml');
    const result = await executeWorkflowSchema(schema);

    // Workflow should fail overall (a node failed) but continue execution
    assert.strictEqual(result.success, false, 'Workflow should fail overall');

    // Verify the failing node executed
    const failNode = result.results.find(r => r.nodeId === 'shell-fail');
    assert.ok(failNode, 'Should have shell-fail result');
    assert.strictEqual(failNode.status, 'failed', 'shell-fail should be marked as failed');
    assert.strictEqual(failNode.exitCode, 42, 'shell-fail should have exitCode 42');

    // Verify execution continued after failure
    const verifyNode = result.results.find(r => r.nodeId === 'shell-verify-exitcode');
    assert.ok(verifyNode, 'Should have shell-verify-exitcode result (execution continued)');
    assert.strictEqual(verifyNode.status, 'completed', 'Verify node should succeed');
    assert.ok(
      verifyNode.output?.includes('SUCCESS: Exit code 42 was captured correctly!'),
      `Verify node should confirm exit code, got: ${verifyNode.output}`
    );
  });

  test('test-failure-stops-workflow.yaml - workflow stops on failure without continueOnFailure', async () => {
    const schema = await loadWorkflow('test-failure-stops-workflow.yaml');
    const result = await executeWorkflowSchema(schema);

    assert.strictEqual(result.success, false, 'Workflow should fail');

    // Verify success node ran
    const successNode = result.results.find(r => r.nodeId === 'shell-success');
    assert.ok(successNode, 'Should have shell-success result');
    assert.strictEqual(successNode.status, 'completed', 'First node should succeed');

    // Verify failure node ran
    const failNode = result.results.find(r => r.nodeId === 'shell-fail');
    assert.ok(failNode, 'Should have shell-fail result');
    assert.strictEqual(failNode.status, 'failed', 'Second node should fail');

    // Verify third node did NOT run (workflow should have stopped)
    const shouldNotRun = result.results.find(r => r.nodeId === 'shell-should-not-run');
    assert.strictEqual(shouldNotRun, undefined, 'Third node should not have executed');
  });

  test('test-input-resolution-stops-workflow.yaml - workflow stops when input resolution fails', async () => {
    const schema = await loadWorkflow('test-input-resolution-stops-workflow.yaml');
    const result = await executeWorkflowSchema(schema);

    assert.strictEqual(result.success, false, 'Workflow should fail');

    // Verify first shell node ran successfully
    const successNode = result.results.find(r => r.nodeId === 'shell-success');
    assert.ok(successNode, 'Should have shell-success result');
    assert.strictEqual(successNode.status, 'completed', 'First node should succeed');

    // Verify the node with missing required input failed
    const missingInputNode = result.results.find(r => r.nodeId === 'shell-missing-input');
    assert.ok(missingInputNode, 'Should have shell-missing-input result');
    assert.strictEqual(missingInputNode.status, 'failed', 'Node with missing input should fail');
    assert.ok(
      missingInputNode.error?.includes('required_data'),
      `Error should mention missing required input, got: ${missingInputNode.error}`
    );

    // Verify sibling node did NOT run (workflow should have stopped on input resolution failure)
    // This is the key assertion - sibling was already queued but should not execute
    const siblingNode = result.results.find(r => r.nodeId === 'shell-sibling');
    assert.strictEqual(siblingNode, undefined, 'Sibling node should not have executed after input resolution failure');
  });
});

describe('Loop Execution', () => {
  test('test-loop-dock.yaml - dock-based loop executes correct number of iterations', async () => {
    const schema = await loadWorkflow('test-loop-dock.yaml');
    const result = await executeWorkflowSchema(schema);

    assert.strictEqual(result.success, true, 'Workflow should succeed');
    assert.ok(result.results.length > 0, 'Should have node results');

    // Find the loop node result
    const loopResult = result.results.find(r => r.nodeId === 'count-loop');
    assert.ok(loopResult, 'Should have count-loop result');
    assert.strictEqual(loopResult.status, 'completed', 'Loop should complete successfully');

    // Loop should have counted to 5 (default target)
    assert.ok(
      loopResult.output?.includes('5 iterations'),
      `Loop should complete 5 iterations, got: ${loopResult.output}`
    );
  });

  test('test-loop-nested.yaml - nested loops execute correctly', async () => {
    const schema = await loadWorkflow('test-loop-nested.yaml');
    const result = await executeWorkflowSchema(schema);

    assert.strictEqual(result.success, true, 'Workflow should succeed');
    assert.ok(result.results.length > 0, 'Should have node results');

    // Find the outer loop result
    const outerLoopResult = result.results.find(r => r.nodeId === 'outer-loop');
    assert.ok(outerLoopResult, 'Should have outer-loop result');
    assert.strictEqual(outerLoopResult.status, 'completed', 'Outer loop should complete successfully');

    // Outer loop should complete 3 iterations (i=1,2,3)
    assert.ok(
      outerLoopResult.output?.includes('3 iterations'),
      `Outer loop should complete 3 iterations, got: ${outerLoopResult.output}`
    );
  });
});

describe('Constant Node', () => {
  test('test-constant.yaml - constant values pass through to shell nodes', async () => {
    const schema = await loadWorkflow('test-constant.yaml');
    const result = await executeWorkflowSchema(schema);

    assert.strictEqual(result.success, true, 'Workflow should succeed');

    // Find the echo-all shell node result
    const echoResult = result.results.find(r => r.nodeId === 'echo-all');
    assert.ok(echoResult, 'Should have echo-all result');
    assert.strictEqual(echoResult.status, 'completed', 'Echo node should complete');

    // Verify all three constant types were passed correctly
    assert.ok(
      echoResult.rawOutput?.includes('String: Hello, Shodan!'),
      `Should have string constant, got: ${echoResult.rawOutput}`
    );
    assert.ok(
      echoResult.rawOutput?.includes('Number: 42'),
      `Should have number constant, got: ${echoResult.rawOutput}`
    );
    assert.ok(
      echoResult.rawOutput?.includes('Boolean: true'),
      `Should have boolean constant, got: ${echoResult.rawOutput}`
    );
  });

  test('test-loop-constant-true.yaml - constant true runs loop to max iterations', async () => {
    const schema = await loadWorkflow('test-loop-constant-true.yaml');
    const result = await executeWorkflowSchema(schema);

    assert.strictEqual(result.success, true, 'Workflow should succeed');

    // Find the loop node result
    const loopResult = result.results.find(r => r.nodeId === 'loop');
    assert.ok(loopResult, 'Should have loop result');
    assert.strictEqual(loopResult.status, 'completed', 'Loop should complete');

    // Loop should run to max iterations (3)
    assert.ok(
      loopResult.output?.includes('3 iterations'),
      `Loop should run 3 iterations, got: ${loopResult.output}`
    );
    assert.ok(
      loopResult.output?.includes('max iterations reached'),
      `Loop should hit max iterations, got: ${loopResult.output}`
    );
  });

  test('test-loop-constant-false.yaml - constant false stops loop after 1 iteration', async () => {
    const schema = await loadWorkflow('test-loop-constant-false.yaml');
    const result = await executeWorkflowSchema(schema);

    assert.strictEqual(result.success, true, 'Workflow should succeed');

    // Find the loop node result
    const loopResult = result.results.find(r => r.nodeId === 'loop');
    assert.ok(loopResult, 'Should have loop result');
    assert.strictEqual(loopResult.status, 'completed', 'Loop should complete');

    // Loop should stop after 1 iteration
    assert.ok(
      loopResult.output?.includes('1 iteration'),
      `Loop should run only 1 iteration, got: ${loopResult.output}`
    );
    assert.ok(
      !loopResult.output?.includes('max iterations'),
      `Loop should not hit max iterations, got: ${loopResult.output}`
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
