/**
 * Trigger Manager
 *
 * Manages workflow triggers (cron, idle) with support for:
 * - Registering/unregistering triggers from workflow scans
 * - Calculating next run times for cron triggers
 * - Checking and firing triggers when their time comes
 * - Persisting trigger state to disk
 */

import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { CronExpressionParser } from 'cron-parser';
import type {
  Clock,
  RegisteredTrigger,
  TriggerConfig,
  TriggerState
} from './types.js';
import { realClock } from './types.js';

function getRobomeshHome(): string {
  return process.env.ROBOMESH_HOME || path.join(os.homedir(), '.robomesh');
}

function getDefaultTriggersFile(): string {
  return path.join(getRobomeshHome(), 'triggers.json');
}

export interface TriggerManagerOptions {
  clock?: Clock;
  /** Custom path for triggers file. Set to null to disable persistence. */
  triggersFile?: string | null;
}

export class TriggerManager {
  private triggers: Map<string, RegisteredTrigger> = new Map();
  private clock: Clock;
  private checkInterval: ReturnType<typeof setInterval> | null = null;
  private onTriggerFire?: (trigger: RegisteredTrigger) => Promise<void>;
  private triggersFile: string | null;

  constructor(options?: TriggerManagerOptions) {
    this.clock = options?.clock ?? realClock;
    this.triggersFile = options?.triggersFile === undefined ? getDefaultTriggersFile() : options.triggersFile;
  }

  /**
   * Generate a unique trigger ID
   */
  private getTriggerKey(workspace: string, workflowPath: string, nodeId: string): string {
    return `${workspace}:${workflowPath}:${nodeId}`;
  }

  /**
   * Calculate next run time for a cron expression
   */
  getNextRunTime(cronExpr: string, from?: Date): Date {
    const baseTime = from || this.clock.now();
    try {
      const expr = CronExpressionParser.parse(cronExpr, {
        currentDate: baseTime,
        tz: 'UTC',
      });
      return expr.next().toDate();
    } catch (err) {
      throw new Error(`Invalid cron expression "${cronExpr}": ${(err as Error).message}`);
    }
  }

  /**
   * Validate a cron expression
   */
  isValidCron(cronExpr: string): boolean {
    if (!cronExpr || cronExpr.trim() === '') {
      return false;
    }
    try {
      CronExpressionParser.parse(cronExpr);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Register a trigger from a workflow
   */
  register(
    workspace: string,
    workflowPath: string,
    nodeId: string,
    label: string,
    config: TriggerConfig
  ): RegisteredTrigger {
    const id = this.getTriggerKey(workspace, workflowPath, nodeId);

    // Calculate next run for cron triggers
    let nextRun: Date | undefined;
    if (config.type === 'cron' && config.cron) {
      try {
        nextRun = this.getNextRunTime(config.cron);
      } catch (err) {
        console.warn(`Invalid cron for ${id}: ${(err as Error).message}`);
      }
    }

    const trigger: RegisteredTrigger = {
      id,
      workspace,
      workflowPath,
      nodeId,
      label,
      config,
      enabled: true,
      nextRun,
      lastRun: this.triggers.get(id)?.lastRun, // Preserve last run from existing
    };

    this.triggers.set(id, trigger);
    return trigger;
  }

  /**
   * Unregister a trigger
   */
  unregister(workspace: string, workflowPath: string, nodeId: string): boolean {
    const id = this.getTriggerKey(workspace, workflowPath, nodeId);
    return this.triggers.delete(id);
  }

  /**
   * Unregister all triggers for a workflow
   */
  unregisterWorkflow(workspace: string, workflowPath: string): number {
    const prefix = `${workspace}:${workflowPath}:`;
    let count = 0;
    for (const id of this.triggers.keys()) {
      if (id.startsWith(prefix)) {
        this.triggers.delete(id);
        count++;
      }
    }
    return count;
  }

  /**
   * Get a trigger by ID
   */
  get(workspace: string, workflowPath: string, nodeId: string): RegisteredTrigger | undefined {
    const id = this.getTriggerKey(workspace, workflowPath, nodeId);
    return this.triggers.get(id);
  }

  /**
   * Get all registered triggers
   */
  getAll(): RegisteredTrigger[] {
    return Array.from(this.triggers.values());
  }

  /**
   * Get triggers for a specific workspace
   */
  getByWorkspace(workspace: string): RegisteredTrigger[] {
    return this.getAll().filter(t => t.workspace === workspace);
  }

  /**
   * Get triggers that are due to fire
   */
  getDueTriggers(): RegisteredTrigger[] {
    const now = this.clock.now();
    return this.getAll().filter(trigger => {
      if (!trigger.enabled) return false;
      if (trigger.config.type !== 'cron') return false;
      if (!trigger.nextRun) return false;
      return trigger.nextRun <= now;
    });
  }

  /**
   * Enable/disable a trigger
   */
  setEnabled(workspace: string, workflowPath: string, nodeId: string, enabled: boolean): boolean {
    const trigger = this.get(workspace, workflowPath, nodeId);
    if (!trigger) return false;
    trigger.enabled = enabled;
    return true;
  }

  /**
   * Mark a trigger as fired and calculate next run
   */
  markFired(trigger: RegisteredTrigger): void {
    trigger.lastRun = this.clock.now();

    // Calculate next run for cron triggers
    if (trigger.config.type === 'cron' && trigger.config.cron) {
      try {
        trigger.nextRun = this.getNextRunTime(trigger.config.cron);
      } catch {
        trigger.nextRun = undefined;
      }
    }
  }

  /**
   * Set callback for when triggers fire
   */
  onFire(callback: (trigger: RegisteredTrigger) => Promise<void>): void {
    this.onTriggerFire = callback;
  }

  /**
   * Check for due triggers and fire them
   */
  async checkAndFire(): Promise<RegisteredTrigger[]> {
    const dueTriggers = this.getDueTriggers();
    const firedTriggers: RegisteredTrigger[] = [];

    for (const trigger of dueTriggers) {
      if (this.onTriggerFire) {
        try {
          await this.onTriggerFire(trigger);
          this.markFired(trigger);
          firedTriggers.push(trigger);
        } catch (err) {
          console.error(`Error firing trigger ${trigger.id}:`, err);
        }
      } else {
        // No callback, just mark as fired
        this.markFired(trigger);
        firedTriggers.push(trigger);
      }
    }

    // Save state after firing
    if (firedTriggers.length > 0) {
      await this.save();
    }

    return firedTriggers;
  }

  /**
   * Start the trigger check loop
   */
  start(intervalMs: number = 10000): void {
    if (this.checkInterval) {
      this.stop();
    }

    this.checkInterval = setInterval(async () => {
      try {
        await this.checkAndFire();
      } catch (err) {
        console.error('Error in trigger check loop:', err);
      }
    }, intervalMs);

    console.log(`Trigger manager started (checking every ${intervalMs}ms)`);
  }

  /**
   * Stop the trigger check loop
   */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
      console.log('Trigger manager stopped');
    }
  }

  /**
   * Load trigger state from disk
   */
  async load(): Promise<void> {
    if (!this.triggersFile) return; // Persistence disabled

    try {
      const data = await fs.readFile(this.triggersFile, 'utf-8');
      const state = JSON.parse(data) as TriggerState;

      // Restore triggers, converting date strings back to Date objects
      for (const [id, trigger] of Object.entries(state.triggers)) {
        this.triggers.set(id, {
          ...trigger,
          nextRun: trigger.nextRun ? new Date(trigger.nextRun) : undefined,
          lastRun: trigger.lastRun ? new Date(trigger.lastRun) : undefined,
        });
      }

      console.log(`Loaded ${this.triggers.size} triggers from ${this.triggersFile}`);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('Error loading triggers:', err);
      }
      // No triggers file yet, that's fine
    }
  }

  /**
   * Save trigger state to disk
   */
  async save(): Promise<void> {
    if (!this.triggersFile) return; // Persistence disabled

    try {
      await fs.mkdir(path.dirname(this.triggersFile), { recursive: true });

      const state: TriggerState = {
        triggers: Object.fromEntries(this.triggers),
        lastUpdated: this.clock.now().toISOString(),
      };

      await fs.writeFile(this.triggersFile, JSON.stringify(state, null, 2));
    } catch (err) {
      console.error('Error saving triggers:', err);
    }
  }

  /**
   * Clear all triggers (for testing)
   */
  clear(): void {
    this.triggers.clear();
  }
}

// Singleton instance for the application
let instance: TriggerManager | null = null;

export function getTriggerManager(options?: TriggerManagerOptions): TriggerManager {
  if (!instance) {
    instance = new TriggerManager(options);
  }
  return instance;
}

export function resetTriggerManager(): void {
  if (instance) {
    instance.stop();
    instance = null;
  }
}
