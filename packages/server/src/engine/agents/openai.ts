/**
 * OpenAI direct API runner
 * Supports native structured output via response_format
 */

import type { AgentRunner, AgentConfig, AgentResult, ConversationMessage } from './types.js';

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

interface OpenAIRequestBody {
  model: string;
  messages: OpenAIMessage[];
  temperature: number;
  response_format?: {
    type: 'json_schema';
    json_schema: {
      name: string;
      strict: boolean;
      schema: object;
    };
  };
}

/**
 * Parse and prepare JSON schema for OpenAI's response_format
 * Adds required 'additionalProperties: false' for strict mode
 */
function prepareSchemaForOpenAI(schemaStr: string): object | null {
  try {
    const schema = JSON.parse(schemaStr);
    // OpenAI strict mode requires additionalProperties: false on objects
    if (schema.type === 'object' && schema.additionalProperties === undefined) {
      schema.additionalProperties = false;
    }
    return schema;
  } catch {
    return null;
  }
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

    // Build messages array, either from conversation history or fresh
    const messages: OpenAIMessage[] = [];

    // If sessionId is provided, parse it as JSON conversation history
    // (OpenAI doesn't have server-side sessions, so we serialize the history as the sessionId)
    let existingHistory: ConversationMessage[] = [];
    if (config.sessionId) {
      try {
        existingHistory = JSON.parse(config.sessionId) as ConversationMessage[];
        messages.push(...existingHistory.map(msg => ({
          role: msg.role,
          content: msg.content,
        })));
      } catch {
        // Invalid sessionId JSON, start fresh
        console.warn('Failed to parse OpenAI sessionId as conversation history, starting fresh');
      }
    } else if (config.conversationHistory && config.conversationHistory.length > 0) {
      // Legacy support for direct conversationHistory
      existingHistory = config.conversationHistory;
      messages.push(...config.conversationHistory.map(msg => ({
        role: msg.role,
        content: msg.content,
      })));
    }

    // Add the current user prompt
    messages.push({
      role: 'user',
      content: config.prompt,
    });

    // Build request body
    const requestBody: OpenAIRequestBody = {
      model: config.model || 'gpt-4o',
      messages,
      temperature: 0.7,
    };

    // Add native structured output if schema provided
    let parsedSchema: object | null = null;
    if (config.outputSchema) {
      parsedSchema = prepareSchemaForOpenAI(config.outputSchema);
      if (parsedSchema) {
        requestBody.response_format = {
          type: 'json_schema',
          json_schema: {
            name: 'structured_output',
            strict: true,
            schema: parsedSchema,
          },
        };
        // Add system message to help the model understand the task
        messages.unshift({
          role: 'system',
          content: 'You are a helpful assistant. Respond with valid JSON matching the requested schema.',
        });
      } else {
        // Schema parse failed, use legacy prompt-based approach
        messages.unshift({
          role: 'system',
          content: `You must respond with valid JSON matching this schema: ${config.outputSchema}`,
        });
      }
    }

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(requestBody),
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

      // Parse structured output if schema was provided
      let structuredOutput: unknown = undefined;
      if (config.outputSchema && content) {
        try {
          structuredOutput = JSON.parse(content);
        } catch {
          // Failed to parse JSON - leave structuredOutput undefined
          console.warn('Failed to parse OpenAI response as JSON:', content.substring(0, 100));
        }
      }

      // Build updated conversation history if session management is enabled
      let sessionId: string | undefined;
      let updatedHistory: ConversationMessage[] | undefined;
      if (config.createSession || config.sessionId || config.conversationHistory) {
        // Start with existing history or empty array
        updatedHistory = [...existingHistory];

        // Add the user message we sent
        updatedHistory.push({
          role: 'user',
          content: config.prompt,
        });

        // Add the assistant's response
        updatedHistory.push({
          role: 'assistant',
          content: content,
        });

        // Serialize as sessionId for consistency with other runners
        sessionId = JSON.stringify(updatedHistory);
      }

      return {
        success: true,
        output: content,
        structuredOutput,
        usage: data.usage ? {
          inputTokens: data.usage.prompt_tokens,
          outputTokens: data.usage.completion_tokens,
        } : undefined,
        sessionId,
        conversationHistory: updatedHistory,
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
