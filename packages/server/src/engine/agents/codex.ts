/**
 * Codex CLI runner (OpenAI's coding agent CLI)
 * Runs the codex CLI in headless/non-interactive mode
 * Supports structured output extraction via OpenAI when outputSchema is provided
 */

import { spawn } from 'child_process';
import type { AgentRunner, AgentConfig, AgentResult } from './types.js';
import { extractStructuredOutput } from './extraction.js';

export const codexRunner: AgentRunner = {
  name: 'codex',

  async execute(config: AgentConfig): Promise<AgentResult> {
    const cliResult = await runCodexCli(config);

    // If CLI failed or no schema, return as-is
    if (!cliResult.success || !config.outputSchema) {
      return cliResult;
    }

    // Extract structured output using OpenAI
    const extraction = await extractStructuredOutput(
      cliResult.output,
      config.outputSchema
    );

    if (extraction.success) {
      return {
        ...cliResult,
        structuredOutput: extraction.data,
      };
    } else {
      console.warn(`Structured output extraction failed: ${extraction.error}`);
      return cliResult;
    }
  },
};

// Codex outputs JSONL (JSON Lines) format with these event types:
interface CodexThreadStarted {
  type: 'thread.started';
  thread_id: string;
}

interface CodexItemCompleted {
  type: 'item.completed';
  item: {
    id: string;
    type: 'reasoning' | 'agent_message';
    text: string;
  };
}

type CodexJsonLine = CodexThreadStarted | CodexItemCompleted | { type: string };

/**
 * Parse Codex JSONL output to extract thread_id and final message
 */
function parseCodexJsonl(output: string): { threadId?: string; message?: string } {
  const lines = output.trim().split('\n');
  let threadId: string | undefined;
  let message: string | undefined;

  for (const line of lines) {
    try {
      const json = JSON.parse(line) as CodexJsonLine;
      if (json.type === 'thread.started') {
        threadId = (json as CodexThreadStarted).thread_id;
      } else if (json.type === 'item.completed') {
        const item = (json as CodexItemCompleted).item;
        if (item.type === 'agent_message') {
          message = item.text;  // Use last agent_message
        }
      }
    } catch {
      // Skip non-JSON lines
    }
  }

  return { threadId, message };
}

async function runCodexCli(config: AgentConfig): Promise<AgentResult> {
  return new Promise((resolve) => {
    // Build the codex command arguments
    // Use 'exec' subcommand for non-interactive execution
    const args: string[] = ['exec'];

    // Add permission bypass flag if enabled
    // --dangerously-bypass-approvals-and-sandbox skips all prompts and sandbox restrictions
    // This gives full network and filesystem access
    if (config.dangerouslySkipPermissions) {
      args.push('--dangerously-bypass-approvals-and-sandbox');
    }

    // Determine if we're resuming an existing session
    const isResuming = !!config.sessionId;

    if (isResuming) {
      // Resume existing session: codex exec resume THREAD_ID "prompt"
      args.push('resume', config.sessionId!, config.prompt);
    } else {
      // New session or one-shot execution
      // Add model if specified
      if (config.model) {
        args.push('--model', config.model);
      }

      // Use --json to capture thread_id when creating a session
      if (config.createSession) {
        args.push('--json');
      }

      // Add the prompt
      args.push(config.prompt);
    }

    const proc = spawn('codex', args, {
      cwd: config.cwd,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      const chunk = data.toString();
      stdout += chunk;
      // Stream output to callback if provided
      if (config.onOutput) {
        // Parse JSONL and extract just the text content for streaming
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const json = JSON.parse(line) as CodexJsonLine;
            if (json.type === 'item.completed') {
              const item = (json as CodexItemCompleted).item;
              // Stream both reasoning and agent_message text
              if (item.type === 'reasoning' || item.type === 'agent_message') {
                config.onOutput(item.text + '\n');
              }
            }
            // Skip other event types (thread.started, turn.started, etc.)
          } catch {
            // Non-JSON line - stream as-is (fallback for non-JSONL output)
            config.onOutput(line + '\n');
          }
        }
      }
    });

    proc.stderr.on('data', (data) => {
      const chunk = data.toString();
      stderr += chunk;
      // Also stream stderr as it may contain progress info
      if (config.onOutput) {
        config.onOutput(chunk);
      }
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        resolve({
          success: false,
          output: stdout,
          error: stderr || `Codex exited with code ${code}`,
        });
        return;
      }

      // If we're creating a session, parse JSONL to extract thread_id and message
      if (config.createSession && !isResuming) {
        const parsed = parseCodexJsonl(stdout);
        resolve({
          success: true,
          output: parsed.message?.trim() || stdout.trim(),
          sessionId: parsed.threadId,  // Return thread_id as sessionId
        });
      } else {
        // No session management, return raw output
        // When resuming, return the provided sessionId to maintain continuity
        resolve({
          success: true,
          output: stdout.trim(),
          sessionId: isResuming ? config.sessionId : undefined,
        });
      }
    });

    proc.on('error', (err) => {
      resolve({
        success: false,
        output: '',
        error: `Failed to start Codex: ${err.message}. Is 'codex' CLI installed?`,
      });
    });
  });
}
