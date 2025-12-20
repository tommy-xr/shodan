/**
 * Gemini CLI runner (Google's Gemini CLI)
 * Runs the gemini CLI in headless/non-interactive mode
 */

import { spawn } from 'child_process';
import type { AgentRunner, AgentConfig, AgentResult } from './types.js';

export const geminiCliRunner: AgentRunner = {
  name: 'gemini-cli',

  async execute(config: AgentConfig): Promise<AgentResult> {
    return new Promise((resolve) => {
      // Build the gemini command arguments
      const args: string[] = [];

      // Add model if specified
      if (config.model) {
        args.push('--model', config.model);
      }

      // Add non-interactive/headless flags
      args.push('--non-interactive');

      // Add the prompt via -p flag
      args.push('-p', config.prompt);

      const proc = spawn('gemini', args, {
        cwd: config.cwd,
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe'],  // Close stdin
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
            error: stderr || `Gemini CLI exited with code ${code}`,
          });
        } else {
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
          error: `Failed to start Gemini CLI: ${err.message}. Is 'gemini' CLI installed?`,
        });
      });
    });
  },
};
