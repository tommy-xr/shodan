import { Router } from 'express';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import type { WorkflowNode, WorkflowEdge, ExecutionEvent, NodeResult } from '@robomesh/core';
import { executeWorkflow, type ExecuteResult } from '../engine/executor.js';

export interface ExecuteRequest {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  rootDirectory?: string;
  startNodeId?: string;
  // Optional: for recording run history
  workspace?: string;
  workflowPath?: string;
}

// Get robomesh home directory
function getRobomeshHome(): string {
  return process.env.ROBOMESH_HOME || path.join(os.homedir(), '.robomesh');
}

function getRunsDir(): string {
  return path.join(getRobomeshHome(), 'runs');
}

function getHistoryFile(): string {
  return path.join(getRobomeshHome(), 'history.json');
}

interface ExecutionHistoryEntry {
  id: string;
  workspace: string;
  workflowPath: string;
  startedAt: string;
  completedAt: string;
  status: 'completed' | 'failed' | 'cancelled';
  duration: number;
  nodeCount: number;
  error?: string;
  results?: NodeResult[];
}

// Save run to history (simplified version for execute route)
async function recordRunToHistory(entry: ExecutionHistoryEntry): Promise<void> {
  try {
    const runsDir = getRunsDir();
    const historyFile = getHistoryFile();

    // Ensure directories exist
    await fs.mkdir(runsDir, { recursive: true });

    // Save full run results
    await fs.writeFile(
      path.join(runsDir, `${entry.id}.json`),
      JSON.stringify(entry, null, 2)
    );

    // Update history index
    let history: Record<string, Array<Omit<ExecutionHistoryEntry, 'results'>>> = {};
    try {
      const data = await fs.readFile(historyFile, 'utf-8');
      history = JSON.parse(data);
    } catch {
      // No history file yet
    }

    const key = `${entry.workspace}:${entry.workflowPath}`;
    if (!history[key]) {
      history[key] = [];
    }

    // Add new entry (without results for index)
    const { results, ...summary } = entry;
    history[key].unshift(summary);

    // Keep only last 10
    if (history[key].length > 10) {
      history[key] = history[key].slice(0, 10);
    }

    await fs.writeFile(historyFile, JSON.stringify(history, null, 2));
  } catch (err) {
    console.error('Failed to record run to history:', err);
  }
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

      // Get dangerouslySkipPermissions from server config (set via --yolo flag)
      const dangerouslySkipPermissions = req.app.locals.dangerouslySkipPermissions || false;

      const result: ExecuteResult = await executeWorkflow(nodes, edges, {
        rootDirectory: effectiveRoot,
        startNodeId,
        dangerouslySkipPermissions,
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
    const { nodes, edges, rootDirectory, startNodeId, workspace, workflowPath } = req.body as ExecuteRequest;

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

    // Track execution for history
    const startTime = Date.now();
    const startedAt = new Date().toISOString();
    const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const collectedResults: NodeResult[] = [];

    // Get dangerouslySkipPermissions from server config (set via --yolo flag)
    const dangerouslySkipPermissions = req.app.locals.dangerouslySkipPermissions || false;

    try {
      const result = await executeWorkflow(nodes, edges, {
        rootDirectory: effectiveRoot,
        startNodeId,
        dangerouslySkipPermissions,
        onNodeStart: (nodeId, _node) => {
          sendEvent({ type: 'node-start', nodeId, timestamp: Date.now() });
        },
        onNodeComplete: (nodeId, nodeResult) => {
          collectedResults.push(nodeResult);
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

      // Record to history if workspace/path provided
      if (workspace && workflowPath) {
        const hasFailedNode = collectedResults.some(r => r.status === 'failed');
        const failedNode = collectedResults.find(r => r.status === 'failed');

        await recordRunToHistory({
          id: runId,
          workspace,
          workflowPath,
          startedAt,
          completedAt: new Date().toISOString(),
          status: hasFailedNode ? 'failed' : 'completed',
          duration: Date.now() - startTime,
          nodeCount: collectedResults.length,
          error: failedNode?.error,
          results: collectedResults,
        });
      }
    } catch (error) {
      console.error('Error executing workflow:', error);
      sendEvent({
        type: 'workflow-complete',
        success: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp: Date.now(),
      });

      // Record failed run to history if workspace/path provided
      if (workspace && workflowPath) {
        await recordRunToHistory({
          id: runId,
          workspace,
          workflowPath,
          startedAt,
          completedAt: new Date().toISOString(),
          status: 'failed',
          duration: Date.now() - startTime,
          nodeCount: collectedResults.length,
          error: error instanceof Error ? error.message : String(error),
          results: collectedResults,
        });
      }
    }

    res.end();
  });

  return router;
}
