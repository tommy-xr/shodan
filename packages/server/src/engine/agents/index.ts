/**
 * Agent executor module
 * Routes agent execution to the appropriate runner
 */

import type { AgentRunner, AgentConfig, AgentResult, RunnerType } from './types.js';
import { openaiRunner } from './openai.js';
import { claudeCodeRunner } from './claude-code.js';
import { codexRunner } from './codex.js';
import { geminiCliRunner } from './gemini-cli.js';

export type { AgentRunner, AgentConfig, AgentResult, RunnerType } from './types.js';

const runners: Map<RunnerType, AgentRunner> = new Map([
  ['openai', openaiRunner],
  ['claude-code', claudeCodeRunner],
  ['codex', codexRunner],
  ['gemini-cli', geminiCliRunner],
]);

/**
 * Execute an agent with the specified runner
 */
export async function executeAgent(config: AgentConfig): Promise<AgentResult> {
  const runner = runners.get(config.runner);

  if (!runner) {
    return {
      success: false,
      output: '',
      error: `Unknown runner: ${config.runner}. Available runners: ${Array.from(runners.keys()).join(', ')}`,
    };
  }

  if (!config.prompt?.trim()) {
    return {
      success: false,
      output: '',
      error: 'Prompt is required',
    };
  }


  return runner.execute(config);
}

/**
 * Check if a runner is available
 */
export function isRunnerAvailable(runner: RunnerType): boolean {
  return runners.has(runner);
}

/**
 * Get list of available runners
 */
export function getAvailableRunners(): RunnerType[] {
  return Array.from(runners.keys());
}
