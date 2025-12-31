/**
 * Claude Code CLI runner
 * Runs the claude CLI in headless/non-interactive mode with JSON output
 * Supports structured output extraction via OpenAI when outputSchema is provided
 * Supports session persistence via --session-id and --resume flags
 */

import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import type { AgentRunner, AgentConfig, AgentResult } from './types.js';
import { extractStructuredOutput } from './extraction.js';

interface ClaudeJsonOutput {
  result?: string;
  is_error?: boolean;
  error?: string;
  cost_usd?: number;
  duration_ms?: number;
  duration_api_ms?: number;
  num_turns?: number;
}

export const claudeCodeRunner: AgentRunner = {
  name: 'claude-code',

  async execute(config: AgentConfig): Promise<AgentResult> {
    const cliResult = await runClaudeCli(config);

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
      // Extraction failed but CLI succeeded - return with warning
      console.warn(`Structured output extraction failed: ${extraction.error}`);
      return cliResult;
    }
  },
};

async function runClaudeCli(config: AgentConfig): Promise<AgentResult> {
  return new Promise((resolve) => {
    // Determine session ID for this run
    let sessionId: string | undefined;

    if (config.sessionId) {
      // Resume existing session
      sessionId = config.sessionId;
    } else if (config.createSession) {
      // Create new session with generated ID
      sessionId = randomUUID();
    }

    // Use stream-json format when streaming callback is provided for real-time output
    const outputFormat = config.onOutput ? 'stream-json' : 'json';

    // Build the claude command arguments
    const args: string[] = [
      '--print',              // Non-interactive, print response and exit
      '--output-format', outputFormat,
      '-p', config.prompt,    // Pass prompt via -p flag
    ];

    // stream-json requires --verbose flag
    if (outputFormat === 'stream-json') {
      args.push('--verbose');
    }

    // Add session management flags
    if (sessionId) {
      if (config.sessionId) {
        // Resuming existing session
        args.push('--resume', sessionId);
      } else {
        // Creating new session
        args.push('--session-id', sessionId);
      }
    }

    // Add model if specified
    if (config.model) {
      args.push('--model', config.model);
    }

    const proc = spawn('claude', args, {
      cwd: config.cwd,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],  // Close stdin, capture stdout/stderr
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      const chunk = data.toString();
      stdout += chunk;
      // Stream output to callback if provided
      if (config.onOutput) {
        // For stream-json format, parse each line and extract assistant text
        if (outputFormat === 'stream-json') {
          const lines = chunk.split('\n');
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const event = JSON.parse(line);
              // Extract text from assistant messages
              if (event.type === 'assistant' && event.message?.content) {
                for (const block of event.message.content) {
                  if (block.type === 'text' && block.text) {
                    config.onOutput(block.text);
                  }
                }
              }
            } catch {
              // Not valid JSON, skip
            }
          }
        } else {
          config.onOutput(chunk);
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
          error: stderr || `Claude Code exited with code ${code}`,
        });
        return;
      }

      // Parse output based on format
      if (outputFormat === 'stream-json') {
        // Parse JSONL stream format - extract text from assistant messages
        const lines = stdout.split('\n');
        const textParts: string[] = [];
        let hasError = false;
        let errorMessage = '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line);
            if (event.type === 'assistant' && event.message?.content) {
              for (const block of event.message.content) {
                if (block.type === 'text' && block.text) {
                  textParts.push(block.text);
                }
              }
            } else if (event.type === 'result' && event.is_error) {
              hasError = true;
              errorMessage = event.error || 'Claude Code returned an error';
            }
          } catch {
            // Skip non-JSON lines
          }
        }

        if (hasError) {
          resolve({
            success: false,
            output: textParts.join(''),
            error: errorMessage,
          });
        } else {
          resolve({
            success: true,
            output: textParts.join('').trim(),
            sessionId,
          });
        }
      } else {
        // Parse single JSON output
        try {
          const json = JSON.parse(stdout) as ClaudeJsonOutput;

          if (json.is_error || json.error) {
            resolve({
              success: false,
              output: '',
              error: json.error || 'Claude Code returned an error',
            });
            return;
          }

          resolve({
            success: true,
            output: json.result?.trim() || '',
            sessionId,  // Return session ID if session was created/resumed
          });
        } catch {
          // Fallback to raw output if JSON parsing fails
          resolve({
            success: true,
            output: stdout.trim(),
            sessionId,  // Return session ID if session was created/resumed
          });
        }
      }
    });

    proc.on('error', (err) => {
      resolve({
        success: false,
        output: '',
        error: `Failed to start Claude Code: ${err.message}. Is 'claude' CLI installed?`,
      });
    });
  });
}
