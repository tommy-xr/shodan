/**
 * Streaming execution client for progressive workflow results.
 *
 * Uses streaming HTTP POST with SSE-formatted events to receive
 * real-time updates as workflow nodes execute.
 */

import type { ExecutionEvent, NodeResult } from '@shodan/core';
import { SSEParser } from './sse-parser';
import type { ExecuteRequest } from './api';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

/**
 * Handlers for streaming execution events
 */
export interface StreamHandlers {
  onNodeStart: (nodeId: string) => void;
  onNodeComplete: (nodeId: string, result: NodeResult) => void;
  onNodeOutput: (nodeId: string, chunk: string) => void;
  onEdgeExecuted: (edgeId: string) => void;
  onIterationStart: (loopId: string, iteration: number) => void;
  onIterationComplete: (loopId: string, iteration: number, success: boolean) => void;
  onComplete: (success: boolean, error?: string) => void;
}

/**
 * Execute a workflow with streaming updates.
 *
 * @param request - The workflow execution request
 * @param handlers - Callbacks for execution events
 * @returns A function to cancel the execution
 */
export function executeWorkflowStream(
  request: ExecuteRequest,
  handlers: StreamHandlers
): () => void {
  const controller = new AbortController();
  const parser = new SSEParser();

  fetch(`${API_BASE}/execute/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal: controller.signal,
  })
    .then(async (response) => {
      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        handlers.onComplete(false, error.error || `HTTP ${response.status}`);
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        handlers.onComplete(false, 'No response body');
        return;
      }

      const decoder = new TextDecoder();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const text = decoder.decode(value, { stream: true });
          const events = parser.parse(text);

          for (const event of events) {
            dispatchEvent(event, handlers);
          }
        }
      } finally {
        parser.reset();
      }
    })
    .catch((error) => {
      if (error.name !== 'AbortError') {
        handlers.onComplete(false, error.message);
      }
      parser.reset();
    });

  return () => controller.abort();
}

/**
 * Dispatch an execution event to the appropriate handler
 */
function dispatchEvent(event: ExecutionEvent, handlers: StreamHandlers): void {
  switch (event.type) {
    case 'node-start':
      handlers.onNodeStart(event.nodeId);
      break;
    case 'node-complete':
      handlers.onNodeComplete(event.nodeId, event.result);
      break;
    case 'node-output':
      handlers.onNodeOutput(event.nodeId, event.chunk);
      break;
    case 'edge-executed':
      handlers.onEdgeExecuted(event.edgeId);
      break;
    case 'iteration-start':
      handlers.onIterationStart(event.loopId, event.iteration);
      break;
    case 'iteration-complete':
      handlers.onIterationComplete(event.loopId, event.iteration, event.success);
      break;
    case 'workflow-complete':
      handlers.onComplete(event.success, event.error);
      break;
  }
}
