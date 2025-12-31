/**
 * SSE Parser - Stateful parser for Server-Sent Events with chunk buffering.
 *
 * Handles partial data across network chunks, ensuring JSON events
 * are only parsed when complete.
 */

import type { ExecutionEvent } from '@shodan/core';

export class SSEParser {
  private buffer = '';

  /**
   * Feed a chunk of data and return any complete events.
   * Incomplete data is buffered for the next chunk.
   */
  parse(chunk: string): ExecutionEvent[] {
    this.buffer += chunk;
    const events: ExecutionEvent[] = [];

    // Split on double newline (SSE event boundary)
    const parts = this.buffer.split('\n\n');

    // Last part may be incomplete - keep in buffer
    this.buffer = parts.pop() || '';

    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed || !trimmed.startsWith('data: ')) continue;

      try {
        const json = trimmed.slice(6); // Remove 'data: ' prefix
        events.push(JSON.parse(json));
      } catch (e) {
        console.warn('Failed to parse SSE event:', trimmed, e);
      }
    }

    return events;
  }

  /** Reset buffer (call on stream end or error) */
  reset(): void {
    this.buffer = '';
  }
}
