/**
 * Trigger System Types
 */

export type TriggerType = 'manual' | 'cron' | 'idle';

export interface TriggerConfig {
  type: TriggerType;
  cron?: string;        // Cron expression for 'cron' type
  idleMinutes?: number; // Idle duration for 'idle' type
}

export interface RegisteredTrigger {
  id: string;           // Unique trigger ID (workspace:workflowPath:nodeId)
  workspace: string;
  workflowPath: string;
  nodeId: string;
  label: string;
  config: TriggerConfig;
  enabled: boolean;
  nextRun?: Date;       // Next scheduled run (for cron triggers)
  lastRun?: Date;       // Last time this trigger fired
}

export interface TriggerState {
  triggers: Record<string, RegisteredTrigger>;
  lastUpdated: string;
}

export interface Clock {
  now(): Date;
}

export const realClock: Clock = {
  now: () => new Date(),
};
