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
  type ScanOptions,
} from '../workspace/scanner.js';
import { getTriggerManager, type TriggerConfig } from '../triggers/index.js';
import type { WorkflowSchema } from '@robomesh/core';

/**
 * Register triggers from scanned workflows with the TriggerManager
 */
function registerTriggersFromWorkflows(
  workspaceName: string,
  workflows: WorkflowInfo[]
): number {
  const manager = getTriggerManager();
  let count = 0;

  for (const workflow of workflows) {
    for (const trigger of workflow.triggers) {
      // Only register cron and idle triggers (not manual)
      if (trigger.type === 'cron' || trigger.type === 'idle') {
        const config: TriggerConfig = {
          type: trigger.type as 'cron' | 'idle',
          cron: trigger.cron,
          idleMinutes: trigger.idleMinutes,
        };

        manager.register(
          workspaceName,
          workflow.path,
          trigger.nodeId,
          trigger.label,
          config
        );
        count++;
      }
    }
  }

  return count;
}

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
      let totalTriggers = 0;

      for (const result of results) {
        // Register triggers from this workspace
        totalTriggers += registerTriggersFromWorkflows(result.workspaceName, result.workflows);

        for (const workflow of result.workflows) {
          allWorkflows.push({
            ...workflow,
            workspace: result.workspaceName,
          });
        }
      }

      // Save trigger state after registration
      if (totalTriggers > 0) {
        getTriggerManager().save().catch(console.error);
      }

      res.json({
        workspaces: results.map(r => ({
          name: r.workspaceName,
          path: r.workspacePath,
          workflowCount: r.workflows.length,
        })),
        workflows: allWorkflows,
        total: allWorkflows.length,
        triggersRegistered: totalTriggers,
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
        workspacePath,
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

  /**
   * PUT /api/workflows/save
   * Save a workflow back to its file
   * Body: { workspace: string, path: string, schema: WorkflowSchema }
   */
  router.put('/save', async (req, res) => {
    try {
      const { workspace: workspaceName, path: workflowPath, schema } = req.body;

      if (!workspaceName || !workflowPath || !schema) {
        return res.status(400).json({
          error: 'Missing required fields: workspace, path, schema',
        });
      }

      // Find the workspace by name
      const workspacePath = workspaces.find(
        ws => path.basename(ws) === workspaceName
      );

      if (!workspacePath) {
        return res.status(404).json({ error: 'Workspace not found' });
      }

      // Resolve and validate path
      const absolutePath = path.resolve(workspacePath, workflowPath);

      // Security check
      if (!absolutePath.startsWith(workspacePath)) {
        return res.status(403).json({ error: 'Invalid workflow path' });
      }

      // Write the workflow
      await fs.writeFile(absolutePath, yaml.dump(schema, { lineWidth: -1 }));

      // Clear cache so changes are reflected
      clearCache(workspacePath);

      res.json({
        message: 'Workflow saved',
        workspace: workspaceName,
        path: workflowPath,
      });
    } catch (err) {
      console.error('Error saving workflow:', err);
      res.status(500).json({ error: 'Failed to save workflow' });
    }
  });

  /**
   * POST /api/workflows/create
   * Create a new workflow in a workspace
   * Body: { workspace: string, name: string, filename?: string }
   */
  router.post('/create', async (req, res) => {
    try {
      const { workspace: workspaceName, name, filename } = req.body;

      if (!workspaceName || !name) {
        return res.status(400).json({
          error: 'Missing required fields: workspace, name',
        });
      }

      // Find the workspace by name
      const workspacePath = workspaces.find(
        ws => path.basename(ws) === workspaceName
      );

      if (!workspacePath) {
        return res.status(404).json({ error: 'Workspace not found' });
      }

      // Create filename from name if not provided
      const safeFilename = filename || name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.yaml';

      // Ensure .robomesh/workflows directory exists
      const workflowsDir = path.join(workspacePath, '.robomesh', 'workflows');
      await fs.mkdir(workflowsDir, { recursive: true });

      const workflowPath = path.join(workflowsDir, safeFilename);
      const relativePath = path.relative(workspacePath, workflowPath);

      // Check if file already exists
      try {
        await fs.stat(workflowPath);
        return res.status(409).json({ error: 'Workflow already exists', path: relativePath });
      } catch {
        // File doesn't exist, good to create
      }

      // Create minimal workflow schema
      const schema: WorkflowSchema = {
        version: 1,
        metadata: {
          name,
          description: '',
        },
        nodes: [
          {
            id: 'trigger_1',
            type: 'trigger',
            position: { x: 250, y: 100 },
            data: {
              label: 'Start',
              triggerType: 'manual',
            },
          },
        ],
        edges: [],
      };

      await fs.writeFile(workflowPath, yaml.dump(schema, { lineWidth: -1 }));

      // Clear cache so the new workflow is picked up
      clearCache(workspacePath);

      res.json({
        message: 'Workflow created',
        workspace: workspaceName,
        path: relativePath,
        name,
      });
    } catch (err) {
      console.error('Error creating workflow:', err);
      res.status(500).json({ error: 'Failed to create workflow' });
    }
  });

  return router;
}
