/**
 * Structured output extraction utility
 * Uses OpenAI API to extract structured data from free-form text
 * Used by CLI-based agents (Claude Code, Codex, Gemini CLI)
 */

interface ExtractionResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

interface OpenAIResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
  error?: {
    message: string;
  };
}

/**
 * Extract structured data from raw text using OpenAI's structured output
 *
 * @param rawText The raw text output from a CLI agent
 * @param schemaStr JSON Schema string defining the expected structure
 * @param model OpenAI model to use for extraction (default: gpt-4o-mini for cost efficiency)
 * @returns ExtractionResult with parsed data or error
 */
export async function extractStructuredOutput(
  rawText: string,
  schemaStr: string,
  model: string = 'gpt-4o-mini'
): Promise<ExtractionResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      success: false,
      error: 'OPENAI_API_KEY not set - cannot extract structured output',
    };
  }

  // Parse and prepare schema
  let schema: object;
  try {
    schema = JSON.parse(schemaStr);
    // OpenAI strict mode requires additionalProperties: false
    if ((schema as { type?: string }).type === 'object') {
      (schema as { additionalProperties?: boolean }).additionalProperties = false;
    }
  } catch {
    return {
      success: false,
      error: `Invalid JSON schema: ${schemaStr.substring(0, 100)}...`,
    };
  }

  // Truncate very long outputs to avoid hitting token limits
  const maxLength = 50000; // ~12k tokens
  const truncatedText = rawText.length > maxLength
    ? rawText.substring(0, maxLength) + '\n\n[Output truncated...]'
    : rawText;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: `You are a data extraction assistant. Extract structured information from the provided text according to the schema. If information is not found, use null for optional fields or reasonable defaults for required fields.`,
          },
          {
            role: 'user',
            content: `Extract structured data from the following text:\n\n---\n${truncatedText}\n---\n\nRespond with JSON matching the required schema.`,
          },
        ],
        temperature: 0, // Deterministic extraction
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'extracted_data',
            strict: true,
            schema,
          },
        },
      }),
    });

    const data = await response.json() as OpenAIResponse;

    if (!response.ok || data.error) {
      return {
        success: false,
        error: data.error?.message || `OpenAI API error: ${response.status}`,
      };
    }

    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      return {
        success: false,
        error: 'No content in OpenAI response',
      };
    }

    // Parse the extracted JSON
    try {
      const extracted = JSON.parse(content);
      return {
        success: true,
        data: extracted,
      };
    } catch {
      return {
        success: false,
        error: `Failed to parse extraction result: ${content.substring(0, 100)}`,
      };
    }
  } catch (err) {
    return {
      success: false,
      error: `Extraction request failed: ${(err as Error).message}`,
    };
  }
}
