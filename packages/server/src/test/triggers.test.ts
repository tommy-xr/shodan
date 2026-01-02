/**
 * Trigger System Tests
 *
 * Tests the TriggerManager with an injectable clock for deterministic testing.
 */

import { TriggerManager, type Clock } from '../triggers/index.js';

// Helper to create a mock clock
function createMockClock(initialTime: Date): Clock & { advance: (ms: number) => void; set: (date: Date) => void } {
  let currentTime = initialTime;
  return {
    now: () => currentTime,
    advance: (ms: number) => {
      currentTime = new Date(currentTime.getTime() + ms);
    },
    set: (date: Date) => {
      currentTime = date;
    },
  };
}

// Helper to create a TriggerManager for testing (no persistence)
function createTestManager(clock: Clock) {
  return new TriggerManager({ clock, triggersFile: null });
}

// Simple test helpers
function test(name: string, fn: () => void | Promise<void>) {
  return { name, fn };
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

// Test cases
const tests = [
  test('isValidCron returns true for valid expressions', () => {
    const clock = createMockClock(new Date('2025-01-01T09:00:00Z'));
    const manager = createTestManager(clock);

    assert(manager.isValidCron('0 0 9 * * *'), 'Should accept "0 0 9 * * *"');
    assert(manager.isValidCron('0 */5 * * * *'), 'Should accept "0 */5 * * * *"');
    assert(manager.isValidCron('0 0 0 1 1 *'), 'Should accept "0 0 0 1 1 *"');
  }),

  test('isValidCron returns false for invalid expressions', () => {
    const clock = createMockClock(new Date('2025-01-01T09:00:00Z'));
    const manager = createTestManager(clock);

    assert(!manager.isValidCron('invalid'), 'Should reject "invalid"');
    assert(!manager.isValidCron(''), 'Should reject empty string');
    assert(!manager.isValidCron('99 99 99 99 99 99'), 'Should reject out of range values');
  }),

  test('getNextRunTime calculates correct next run', () => {
    const clock = createMockClock(new Date('2025-01-01T08:00:00Z'));
    const manager = createTestManager(clock);

    // Next run at 9:00
    const nextRun = manager.getNextRunTime('0 0 9 * * *');
    assertEqual(nextRun.getUTCHours(), 9, 'Next run should be at 9:00');
    assertEqual(nextRun.getUTCMinutes(), 0, 'Next run should be at 9:00');
  }),

  test('getNextRunTime advances to next day if time passed', () => {
    const clock = createMockClock(new Date('2025-01-01T10:00:00Z'));
    const manager = createTestManager(clock);

    // 9:00 already passed, should be next day
    const nextRun = manager.getNextRunTime('0 0 9 * * *');
    assertEqual(nextRun.getUTCDate(), 2, 'Next run should be on day 2');
    assertEqual(nextRun.getUTCHours(), 9, 'Next run should be at 9:00');
  }),

  test('register adds trigger to manager', () => {
    const clock = createMockClock(new Date('2025-01-01T08:00:00Z'));
    const manager = createTestManager(clock);

    const trigger = manager.register('workspace1', 'workflow.yaml', 'trigger_1', 'My Trigger', {
      type: 'cron',
      cron: '0 0 9 * * *',
    });

    assert(trigger !== undefined, 'Should return registered trigger');
    assertEqual(trigger.workspace, 'workspace1', 'Trigger workspace');
    assertEqual(trigger.workflowPath, 'workflow.yaml', 'Trigger workflowPath');
    assertEqual(trigger.enabled, true, 'Trigger should be enabled by default');
    assert(trigger.nextRun !== undefined, 'Should have nextRun');
  }),

  test('getAll returns all registered triggers', () => {
    const clock = createMockClock(new Date('2025-01-01T08:00:00Z'));
    const manager = createTestManager(clock);

    manager.register('ws1', 'wf1.yaml', 't1', 'Trigger 1', { type: 'cron', cron: '0 0 9 * * *' });
    manager.register('ws1', 'wf2.yaml', 't2', 'Trigger 2', { type: 'cron', cron: '0 0 10 * * *' });
    manager.register('ws2', 'wf3.yaml', 't3', 'Trigger 3', { type: 'cron', cron: '0 0 11 * * *' });

    const all = manager.getAll();
    assertEqual(all.length, 3, 'Should have 3 triggers');
  }),

  test('getByWorkspace filters by workspace', () => {
    const clock = createMockClock(new Date('2025-01-01T08:00:00Z'));
    const manager = createTestManager(clock);

    manager.register('ws1', 'wf1.yaml', 't1', 'Trigger 1', { type: 'cron', cron: '0 0 9 * * *' });
    manager.register('ws1', 'wf2.yaml', 't2', 'Trigger 2', { type: 'cron', cron: '0 0 10 * * *' });
    manager.register('ws2', 'wf3.yaml', 't3', 'Trigger 3', { type: 'cron', cron: '0 0 11 * * *' });

    const ws1Triggers = manager.getByWorkspace('ws1');
    assertEqual(ws1Triggers.length, 2, 'Should have 2 triggers for ws1');
  }),

  test('getDueTriggers returns triggers past their nextRun time', () => {
    const clock = createMockClock(new Date('2025-01-01T08:59:00Z'));
    const manager = createTestManager(clock);

    manager.register('ws1', 'wf1.yaml', 't1', 'Trigger 1', { type: 'cron', cron: '0 0 9 * * *' });
    manager.register('ws1', 'wf2.yaml', 't2', 'Trigger 2', { type: 'cron', cron: '0 0 10 * * *' });

    // Before 9:00, no triggers due
    let due = manager.getDueTriggers();
    assertEqual(due.length, 0, 'No triggers due at 8:59');

    // Advance to 9:00
    clock.set(new Date('2025-01-01T09:00:00Z'));
    due = manager.getDueTriggers();
    assertEqual(due.length, 1, 'One trigger due at 9:00');
    assertEqual(due[0].label, 'Trigger 1', 'Should be Trigger 1');

    // Advance to 10:00
    clock.set(new Date('2025-01-01T10:00:00Z'));
    due = manager.getDueTriggers();
    assertEqual(due.length, 2, 'Two triggers due at 10:00');
  }),

  test('markFired updates lastRun and calculates next run', () => {
    const clock = createMockClock(new Date('2025-01-01T09:00:00Z'));
    const manager = createTestManager(clock);

    const trigger = manager.register('ws1', 'wf1.yaml', 't1', 'Trigger 1', {
      type: 'cron',
      cron: '0 0 9 * * *'
    });

    // Trigger was due at 9:00, mark as fired
    manager.markFired(trigger);

    assert(trigger.lastRun !== undefined, 'Should have lastRun');
    assertEqual(trigger.lastRun!.toISOString(), '2025-01-01T09:00:00.000Z', 'lastRun should be now');

    // Next run should be tomorrow at 9:00
    assert(trigger.nextRun !== undefined, 'Should have nextRun');
    assertEqual(trigger.nextRun!.getUTCDate(), 2, 'Next run should be day 2');
    assertEqual(trigger.nextRun!.getUTCHours(), 9, 'Next run should be at 9:00');
  }),

  test('setEnabled toggles trigger enabled state', () => {
    const clock = createMockClock(new Date('2025-01-01T08:00:00Z'));
    const manager = createTestManager(clock);

    manager.register('ws1', 'wf1.yaml', 't1', 'Trigger 1', { type: 'cron', cron: '0 0 9 * * *' });

    let trigger = manager.get('ws1', 'wf1.yaml', 't1');
    assertEqual(trigger?.enabled, true, 'Should be enabled by default');

    manager.setEnabled('ws1', 'wf1.yaml', 't1', false);
    trigger = manager.get('ws1', 'wf1.yaml', 't1');
    assertEqual(trigger?.enabled, false, 'Should be disabled');
  }),

  test('disabled triggers are not included in getDueTriggers', () => {
    const clock = createMockClock(new Date('2025-01-01T09:00:00Z'));
    const manager = createTestManager(clock);

    manager.register('ws1', 'wf1.yaml', 't1', 'Trigger 1', { type: 'cron', cron: '0 0 9 * * *' });

    // Disable the trigger
    manager.setEnabled('ws1', 'wf1.yaml', 't1', false);

    const due = manager.getDueTriggers();
    assertEqual(due.length, 0, 'Disabled triggers should not be due');
  }),

  test('checkAndFire executes callback for due triggers', async () => {
    // Register trigger before 9:00
    const clock = createMockClock(new Date('2025-01-01T08:59:00Z'));
    const manager = createTestManager(clock);

    manager.register('ws1', 'wf1.yaml', 't1', 'Trigger 1', { type: 'cron', cron: '0 0 9 * * *' });

    const firedTriggers: string[] = [];
    manager.onFire(async (trigger) => {
      firedTriggers.push(trigger.id);
    });

    // Before 9:00, nothing should fire
    let fired = await manager.checkAndFire();
    assertEqual(fired.length, 0, 'Should not fire before 9:00');

    // Advance to 9:00
    clock.set(new Date('2025-01-01T09:00:00Z'));
    fired = await manager.checkAndFire();

    assertEqual(fired.length, 1, 'Should fire one trigger');
    assertEqual(firedTriggers.length, 1, 'Callback should be called once');
    assertEqual(firedTriggers[0], 'ws1:wf1.yaml:t1', 'Should fire correct trigger');
  }),

  test('unregister removes trigger', () => {
    const clock = createMockClock(new Date('2025-01-01T08:00:00Z'));
    const manager = createTestManager(clock);

    manager.register('ws1', 'wf1.yaml', 't1', 'Trigger 1', { type: 'cron', cron: '0 0 9 * * *' });
    assertEqual(manager.getAll().length, 1, 'Should have 1 trigger');

    const removed = manager.unregister('ws1', 'wf1.yaml', 't1');
    assert(removed, 'Should return true when removing');
    assertEqual(manager.getAll().length, 0, 'Should have 0 triggers');
  }),

  test('unregisterWorkflow removes all triggers for workflow', () => {
    const clock = createMockClock(new Date('2025-01-01T08:00:00Z'));
    const manager = createTestManager(clock);

    manager.register('ws1', 'wf1.yaml', 't1', 'Trigger 1', { type: 'cron', cron: '0 0 9 * * *' });
    manager.register('ws1', 'wf1.yaml', 't2', 'Trigger 2', { type: 'cron', cron: '0 0 10 * * *' });
    manager.register('ws1', 'wf2.yaml', 't3', 'Trigger 3', { type: 'cron', cron: '0 0 11 * * *' });

    const count = manager.unregisterWorkflow('ws1', 'wf1.yaml');
    assertEqual(count, 2, 'Should remove 2 triggers');
    assertEqual(manager.getAll().length, 1, 'Should have 1 trigger left');
  }),
];

// Run tests
async function runTests() {
  console.log('Running Trigger Manager tests...\n');

  let passed = 0;
  let failed = 0;

  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.log(`  ✗ ${name}`);
      console.log(`    ${(err as Error).message}`);
      failed++;
    }
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
