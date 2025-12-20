/**
 * OpenAI direct API runner
 */

import type { AgentRunner, AgentConfig, AgentResult } from './types.js';

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OpenAIResponse {
  id: string;
  choices: Array<{
    message: {
      content: string;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
  };
  error?: {
    message: string;
  };
}

export const openaiRunner: AgentRunner = {
  name: 'openai',

  async execute(config: AgentConfig): Promise<AgentResult> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return {
        success: false,
        output: '',
        error: 'OPENAI_API_KEY environment variable is not set',
      };
    }

    const messages: OpenAIMessage[] = [
      {
        role: 'user',
        content: config.prompt,
      },
    ];

    // Add system message for structured output if schema provided
    if (config.outputSchema) {
      messages.unshift({
        role: 'system',
        content: `You must respond with valid JSON matching this schema: ${config.outputSchema}`,
      });
    }

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          messages,
          temperature: 0.7,
        }),
      });

      const data = await response.json() as OpenAIResponse;

      if (!response.ok || data.error) {
        return {
          success: false,
          output: '',
          error: data.error?.message || `OpenAI API error: ${response.status}`,
        };
      }

      const content = data.choices?.[0]?.message?.content || '';

      return {
        success: true,
        output: content,
        usage: data.usage ? {
          inputTokens: data.usage.prompt_tokens,
          outputTokens: data.usage.completion_tokens,
        } : undefined,
      };
    } catch (err) {
      return {
        success: false,
        output: '',
        error: `OpenAI API request failed: ${(err as Error).message}`,
      };
    }
  },
};
