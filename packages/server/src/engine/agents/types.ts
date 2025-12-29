/**
 * Agent runner types and interfaces
 */

export type RunnerType = 'openai' | 'claude-code' | 'codex' | 'gemini-cli';

export interface AgentConfig {
  runner: RunnerType;
  model?: string;
  prompt: string;
  promptFiles?: string[];
  outputSchema?: string;  // JSON Schema as string
  cwd: string;
  inputValues?: Record<string, unknown>;  // Input port values for template injection
}

export interface AgentResult {
  success: boolean;
  output: string;  // Raw text output
  structuredOutput?: unknown;  // Parsed JSON if schema was provided
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
