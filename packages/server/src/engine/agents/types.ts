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

  // Session management for resumable agents
  sessionId?: string;       // If provided, resume this session
  createSession?: boolean;  // If true, create new session and return ID
  conversationHistory?: ConversationMessage[];  // For API-based runners (OpenAI)

  // Streaming callback for real-time output
  onOutput?: (chunk: string) => void;
}

/**
 * Conversation message for API-based session management
 */
export interface ConversationMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
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

  // Session management
  sessionId?: string;  // Session ID (newly created or resumed)
  conversationHistory?: ConversationMessage[];  // Updated history for API-based runners
}

export interface AgentRunner {
  name: RunnerType;
  execute(config: AgentConfig): Promise<AgentResult>;
}
