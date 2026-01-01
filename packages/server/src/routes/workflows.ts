/**
 * Workflows API Routes
 *
 * Provides endpoints for discovering and querying workflows across workspaces.
 */

import { Router } from 'express';
import path from 'path';
import fs from 'fs/promises';
import yaml from 'js-yaml';
import {
  scanWorkflows,
  scanAllWorkspaces,
  getWorkflow,
  clearCache,
  type WorkflowInfo,
  type WorkspaceScanResult,
} from '../workspace/scanner.js';
import type { WorkflowSchema } from '@robomesh/core';

export function createWorkflowsRouter(workspaces: string[]): Router {
  const router = Router();

  /**
   * GET /api/workflows
   * List all workflows across all registered workspaces
   */
  router.get('/', async (_req, res) => {
    try {
      const results = await scanAllWorkspaces(workspaces);

      // Flatten into a single list with workspace info
      const allWorkflows: Array<WorkflowInfo & { workspace: string }> = [];

      for (const result of results) {
        for (const workflow of result.workflows) {
          allWorkflows.push({
            ...workflow,
            workspace: result.workspaceName,
          });
        }
      }

      res.json({
        workspaces: results.map(r => ({
          name: r.workspaceName,
          path: r.workspacePath,
          workflowCount: r.workflows.length,
        })),
        workflows: allWorkflows,
        total: allWorkflows.length,
      });
    } catch (err) {
      console.error('Error scanning workflows:', err);
      res.status(500).json({ error: 'Failed to scan workflows' });
    }
  });

  /**
   * GET /api/workflows/workspace/:workspace
   * List workflows for a specific workspace
   */
  router.get('/workspace/:workspace', async (req, res) => {
    try {
      const workspaceName = req.params.workspace;

      // Find the workspace by name
      const workspacePath = workspaces.find(
        ws => path.basename(ws) === workspaceName
      );

      if (!workspacePath) {
        return res.status(404).json({ error: 'Workspace not found' });
      }

      const result = await scanWorkflows(workspacePath);

      res.json({
        workspace: result.workspaceName,
        path: result.workspacePath,
        workflows: result.workflows,
        scannedAt: result.scannedAt,
      });
    } catch (err) {
      console.error('Error scanning workspace:', err);
      res.status(500).json({ error: 'Failed to scan workspace' });
    }
  });

  /**
   * GET /api/workflows/detail
   * Get detailed information about a specific workflow
   * Query params: workspace (name), path (relative path to workflow)
   */
  router.get('/detail', async (req, res) => {
    try {
      const workspaceName = req.query.workspace as string;
      const workflowPath = req.query.path as string;

      if (!workspaceName || !workflowPath) {
        return res.status(400).json({
          error: 'Missing required query params: workspace, path',
        });
      }

      // Find the workspace by name
      const workspacePath = workspaces.find(
        ws => path.basename(ws) === workspaceName
      );

      if (!workspacePath) {
        return res.status(404).json({ error: 'Workspace not found' });
      }

      const workflow = await getWorkflow(workspacePath, workflowPath);

      if (!workflow) {
        return res.status(404).json({ error: 'Workflow not found' });
      }

      // Also load the full workflow schema
      const content = await fs.readFile(workflow.absolutePath, 'utf-8');
      const schema = yaml.load(content) as WorkflowSchema;

      res.json({
        ...workflow,
        workspace: workspaceName,
        schema,
      });
    } catch (err) {
      console.error('Error getting workflow:', err);
      res.status(500).json({ error: 'Failed to get workflow' });
    }
  });

  /**
   * POST /api/workflows/refresh
   * Clear the cache and rescan workflows
   */
  router.post('/refresh', async (req, res) => {
    try {
      const workspaceName = req.body?.workspace as string | undefined;

      if (workspaceName) {
        // Find and refresh specific workspace
        const workspacePath = workspaces.find(
          ws => path.basename(ws) === workspaceName
        );

        if (!workspacePath) {
          return res.status(404).json({ error: 'Workspace not found' });
        }

        clearCache(workspacePath);
        const result = await scanWorkflows(workspacePath);

        res.json({
          message: 'Workspace refreshed',
          workspace: result.workspaceName,
          workflowCount: result.workflows.length,
        });
      } else {
        // Refresh all workspaces
        clearCache();
        const results = await scanAllWorkspaces(workspaces);

        res.json({
          message: 'All workspaces refreshed',
          workspaces: results.map(r => ({
            name: r.workspaceName,
            workflowCount: r.workflows.length,
          })),
        });
      }
    } catch (err) {
      console.error('Error refreshing workflows:', err);
      res.status(500).json({ error: 'Failed to refresh workflows' });
    }
  });

  return router;
}
