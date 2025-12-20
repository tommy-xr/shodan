/**
 * Claude Code CLI runner
 * Runs the claude CLI in headless/non-interactive mode with JSON output
 */

import { spawn } from 'child_process';
import type { AgentRunner, AgentConfig, AgentResult } from './types.js';

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
    return new Promise((resolve) => {
      // Build the claude command arguments
      const args: string[] = [
        '--print',              // Non-interactive, print response and exit
        '--output-format', 'json',  // JSON output for reliable parsing
        '-p', config.prompt,    // Pass prompt via -p flag
      ];

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
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
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

        // Parse JSON output
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
          });
        } catch {
          // Fallback to raw output if JSON parsing fails
          resolve({
            success: true,
            output: stdout.trim(),
          });
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
  },
};
