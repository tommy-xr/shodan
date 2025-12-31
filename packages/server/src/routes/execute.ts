import { Router } from 'express';
import type { WorkflowNode, WorkflowEdge, ExecutionEvent } from '@shodan/core';
import { executeWorkflow, type ExecuteResult } from '../engine/executor.js';

export interface ExecuteRequest {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  rootDirectory?: string;
  startNodeId?: string;
}

export function createExecuteRouter(defaultProjectRoot: string): Router {
  const router = Router();

  // Standard synchronous execution endpoint
  router.post('/', async (req, res) => {
    try {
      const { nodes, edges, rootDirectory, startNodeId } = req.body as ExecuteRequest;

      if (!nodes || !Array.isArray(nodes)) {
        return res.status(400).json({ error: 'nodes array is required' });
      }

      if (!edges || !Array.isArray(edges)) {
        return res.status(400).json({ error: 'edges array is required' });
      }

      // Use provided rootDirectory, or fall back to discovered project root
      const effectiveRoot = rootDirectory || defaultProjectRoot;

      const result: ExecuteResult = await executeWorkflow(nodes, edges, {
        rootDirectory: effectiveRoot,
        startNodeId,
      });

      res.json(result);
    } catch (error) {
      console.error('Error executing workflow:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to execute workflow'
      });
    }
  });

  // Streaming execution endpoint with SSE events
  router.post('/stream', async (req, res) => {
    const { nodes, edges, rootDirectory, startNodeId } = req.body as ExecuteRequest;

    // Validate request
    if (!nodes || !Array.isArray(nodes)) {
      return res.status(400).json({ error: 'nodes array is required' });
    }

    if (!edges || !Array.isArray(edges)) {
      return res.status(400).json({ error: 'edges array is required' });
    }

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Helper to send SSE events
    const sendEvent = (event: ExecutionEvent) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    const effectiveRoot = rootDirectory || defaultProjectRoot;

    try {
      const result = await executeWorkflow(nodes, edges, {
        rootDirectory: effectiveRoot,
        startNodeId,
        onNodeStart: (nodeId, _node) => {
          sendEvent({ type: 'node-start', nodeId, timestamp: Date.now() });
        },
        onNodeComplete: (nodeId, nodeResult) => {
          sendEvent({ type: 'node-complete', nodeId, result: nodeResult, timestamp: Date.now() });
        },
        onNodeOutput: (nodeId, chunk) => {
          sendEvent({ type: 'node-output', nodeId, chunk, timestamp: Date.now() });
        },
        onEdgeExecuted: (edgeId, sourceNodeId, _data) => {
          sendEvent({ type: 'edge-executed', edgeId, sourceNodeId, timestamp: Date.now() });
        },
        onIterationStart: (loopId, iteration) => {
          sendEvent({ type: 'iteration-start', loopId, iteration, timestamp: Date.now() });
        },
        onIterationComplete: (loopId, iteration, success) => {
          sendEvent({ type: 'iteration-complete', loopId, iteration, success, timestamp: Date.now() });
        },
      });

      sendEvent({
        type: 'workflow-complete',
        success: result.success,
        error: result.error,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error('Error executing workflow:', error);
      sendEvent({
        type: 'workflow-complete',
        success: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp: Date.now(),
      });
    }

    res.end();
  });

  return router;
}
