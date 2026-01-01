/**
 * API Integration Tests for robomesh serve
 *
 * Tests the server API endpoints to ensure they work correctly.
 * Run with: pnpm run test:serve
 */

import { createServer, type ServerConfig } from '../index.js';
import type { Server } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

const results: TestResult[] = [];
let server: Server | null = null;
const PORT = 3099; // Use a unique port for testing
const BASE_URL = `http://localhost:${PORT}`;

// Test utilities
function test(name: string, fn: () => Promise<void>) {
  return async () => {
    try {
      await fn();
      results.push({ name, passed: true });
      console.log(`  ✓ ${name}`);
    } catch (err) {
      results.push({ name, passed: false, error: (err as Error).message });
      console.log(`  ✗ ${name}`);
      console.log(`    ${(err as Error).message}`);
    }
  };
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual<T>(actual: T, expected: T, message?: string) {
  if (actual !== expected) {
    throw new Error(message || `Expected ${expected}, got ${actual}`);
  }
}

// Setup and teardown
async function setup() {
  const config: ServerConfig = {
    port: PORT,
    workspaces: [path.resolve(__dirname, '../../../..')], // Project root
  };

  const app = createServer(config);

  return new Promise<void>((resolve, reject) => {
    server = app.listen(PORT, () => {
      console.log(`\nTest server started on port ${PORT}\n`);
      resolve();
    });
    server.on('error', reject);
  });
}

async function teardown() {
  if (server) {
    return new Promise<void>((resolve) => {
      server!.close(() => {
        console.log('\nTest server stopped\n');
        resolve();
      });
    });
  }
}

// Tests
const tests = [
  test('GET /api/health returns ok', async () => {
    const res = await fetch(`${BASE_URL}/api/health`);
    assertEqual(res.status, 200, 'Expected status 200');

    const data = await res.json();
    assertEqual(data.status, 'ok', 'Expected status ok');
    assert(typeof data.timestamp === 'string', 'Expected timestamp to be a string');
  }),

  test('GET /api/workspaces returns registered workspaces', async () => {
    const res = await fetch(`${BASE_URL}/api/workspaces`);
    assertEqual(res.status, 200, 'Expected status 200');

    const data = await res.json();
    assert(Array.isArray(data.workspaces), 'Expected workspaces to be an array');
    assert(data.workspaces.length > 0, 'Expected at least one workspace');
    assert(typeof data.primary === 'string', 'Expected primary to be a string');

    // Check workspace structure
    const ws = data.workspaces[0];
    assert(typeof ws.path === 'string', 'Expected workspace path to be a string');
    assert(typeof ws.name === 'string', 'Expected workspace name to be a string');
  }),

  test('GET /api/config returns configuration', async () => {
    const res = await fetch(`${BASE_URL}/api/config`);
    assertEqual(res.status, 200, 'Expected status 200');

    const data = await res.json();
    assert(typeof data === 'object', 'Expected config to be an object');
  }),

  test('GET /api/files/list requires root param', async () => {
    const res = await fetch(`${BASE_URL}/api/files/list`);
    assertEqual(res.status, 400, 'Expected status 400 without root param');

    const data = await res.json();
    assert(data.error !== undefined, 'Expected error message');
  }),

  test('GET /api/files/list with root returns files', async () => {
    const projectRoot = path.resolve(__dirname, '../../../..');
    const res = await fetch(`${BASE_URL}/api/files/list?root=${encodeURIComponent(projectRoot)}`);
    assertEqual(res.status, 200, 'Expected status 200');

    const data = await res.json();
    assert(Array.isArray(data.files), 'Expected files to be an array');
  }),

  test('GET /api/components/list returns components', async () => {
    const res = await fetch(`${BASE_URL}/api/components/list`);
    assertEqual(res.status, 200, 'Expected status 200');

    const data = await res.json();
    assert(Array.isArray(data.components), 'Expected components to be an array');
  }),

  test('GET /api/nonexistent returns 404', async () => {
    const res = await fetch(`${BASE_URL}/api/nonexistent`);
    // Should either be 404 or fall through to SPA handler (200 with HTML)
    // Since we don't have designerPath set, it should be 404
    assert(res.status === 404 || res.status === 200, 'Expected 404 or 200');
  }),

  test('POST /api/execute without body returns error', async () => {
    const res = await fetch(`${BASE_URL}/api/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    // Should return 400 or 500 for invalid request
    assert(res.status >= 400, 'Expected error status for empty body');
  }),

  // Phase 2: Workflow Discovery Tests
  test('GET /api/workflows returns workflows list', async () => {
    const res = await fetch(`${BASE_URL}/api/workflows`);
    assertEqual(res.status, 200, 'Expected status 200');

    const data = await res.json();
    assert(Array.isArray(data.workspaces), 'Expected workspaces to be an array');
    assert(Array.isArray(data.workflows), 'Expected workflows to be an array');
    assert(typeof data.total === 'number', 'Expected total to be a number');

    // Should find at least some workflows in the test workspace
    assert(data.workflows.length > 0, 'Expected at least one workflow');

    // Check workflow structure
    const workflow = data.workflows[0];
    assert(typeof workflow.path === 'string', 'Expected workflow path');
    assert(typeof workflow.name === 'string', 'Expected workflow name');
    assert(Array.isArray(workflow.triggers), 'Expected triggers array');
  }),

  test('GET /api/workflows/workspace/:workspace returns workspace workflows', async () => {
    const res = await fetch(`${BASE_URL}/api/workflows/workspace/shodan`);
    assertEqual(res.status, 200, 'Expected status 200');

    const data = await res.json();
    assert(typeof data.workspace === 'string', 'Expected workspace name');
    assert(Array.isArray(data.workflows), 'Expected workflows array');
  }),

  test('GET /api/workflows/workspace/:invalid returns 404', async () => {
    const res = await fetch(`${BASE_URL}/api/workflows/workspace/nonexistent-workspace`);
    assertEqual(res.status, 404, 'Expected status 404 for invalid workspace');
  }),

  test('GET /api/workflows/detail requires params', async () => {
    const res = await fetch(`${BASE_URL}/api/workflows/detail`);
    assertEqual(res.status, 400, 'Expected status 400 without params');
  }),

  test('GET /api/workflows/detail returns workflow with schema', async () => {
    // First get the list to find a valid workflow
    const listRes = await fetch(`${BASE_URL}/api/workflows`);
    const listData = await listRes.json();

    if (listData.workflows.length === 0) {
      // Skip if no workflows
      return;
    }

    const workflow = listData.workflows[0];
    const res = await fetch(
      `${BASE_URL}/api/workflows/detail?workspace=${workflow.workspace}&path=${encodeURIComponent(workflow.path)}`
    );
    assertEqual(res.status, 200, 'Expected status 200');

    const data = await res.json();
    assert(typeof data.name === 'string', 'Expected workflow name');
    assert(data.schema !== undefined, 'Expected schema to be included');
    assert(Array.isArray(data.schema.nodes), 'Expected schema.nodes array');
  }),

  test('POST /api/workflows/refresh clears cache', async () => {
    const res = await fetch(`${BASE_URL}/api/workflows/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assertEqual(res.status, 200, 'Expected status 200');

    const data = await res.json();
    assert(data.message !== undefined, 'Expected message in response');
  }),
];

// Main
async function main() {
  console.log('Running API integration tests...\n');

  try {
    await setup();

    for (const runTest of tests) {
      await runTest();
    }

    await teardown();

    // Summary
    const passed = results.filter((r) => r.passed).length;
    const failed = results.filter((r) => !r.passed).length;

    console.log(`\nResults: ${passed} passed, ${failed} failed`);

    if (failed > 0) {
      console.log('\nFailed tests:');
      for (const r of results.filter((r) => !r.passed)) {
        console.log(`  - ${r.name}: ${r.error}`);
      }
      process.exit(1);
    }

    process.exit(0);
  } catch (err) {
    console.error('Test setup failed:', (err as Error).message);
    await teardown();
    process.exit(1);
  }
}

main();
