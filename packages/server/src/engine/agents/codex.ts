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

async function runCodexCli(config: AgentConfig): Promise<AgentResult> {
  return new Promise((resolve) => {
    // Build the codex command arguments
    // Use 'exec' subcommand for non-interactive execution
    const args: string[] = ['exec'];

    // Add model if specified
    if (config.model) {
      args.push('--model', config.model);
    }

    // Add the prompt
    args.push(config.prompt);

    const proc = spawn('codex', args, {
      cwd: config.cwd,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
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
          error: stderr || `Codex exited with code ${code}`,
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
        error: `Failed to start Codex: ${err.message}. Is 'codex' CLI installed?`,
      });
    });
  });
}
