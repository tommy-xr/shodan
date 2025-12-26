import { Router } from 'express';
import {
  executeWorkflow,
  type WorkflowNode,
  type WorkflowEdge,
  type ExecuteResult,
} from '../engine/executor.js';

export interface ExecuteRequest {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  rootDirectory?: string;
  startNodeId?: string;
}

export function createExecuteRouter(defaultProjectRoot: string): Router {
  const router = Router();

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

  return router;
}
