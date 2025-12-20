/**
 * Agent runner types and interfaces
 */

export type RunnerType = 'openai' | 'claude-code' | 'codex' | 'gemini-cli';

export interface AgentConfig {
  runner: RunnerType;
  model?: string;
  prompt: string;
  promptFiles?: string[];
  outputSchema?: string;
  cwd: string;
}

export interface AgentResult {
  success: boolean;
  output: string;
  error?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
}

export interface AgentRunner {
  name: RunnerType;
  execute(config: AgentConfig): Promise<AgentResult>;
}
