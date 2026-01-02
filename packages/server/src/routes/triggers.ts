/**
 * Trigger Management API
 *
 * Provides endpoints for viewing and managing workflow triggers.
 */

import { Router } from 'express';
import { getTriggerManager } from '../triggers/index.js';

export function createTriggersRouter(): Router {
  const router = Router();
  const manager = getTriggerManager();

  /**
   * GET /api/triggers
   * List all registered triggers
   */
  router.get('/', (_req, res) => {
    const triggers = manager.getAll();

    res.json({
      triggers: triggers.map(t => ({
        ...t,
        nextRun: t.nextRun?.toISOString(),
        lastRun: t.lastRun?.toISOString(),
      })),
      count: triggers.length,
    });
  });

  /**
   * GET /api/triggers/workspace/:workspace
   * List triggers for a specific workspace
   */
  router.get('/workspace/:workspace', (req, res) => {
    const { workspace } = req.params;
    const triggers = manager.getByWorkspace(workspace);

    res.json({
      workspace,
      triggers: triggers.map(t => ({
        ...t,
        nextRun: t.nextRun?.toISOString(),
        lastRun: t.lastRun?.toISOString(),
      })),
      count: triggers.length,
    });
  });

  /**
   * GET /api/triggers/due
   * List triggers that are due to fire
   */
  router.get('/due', (_req, res) => {
    const triggers = manager.getDueTriggers();

    res.json({
      triggers: triggers.map(t => ({
        ...t,
        nextRun: t.nextRun?.toISOString(),
        lastRun: t.lastRun?.toISOString(),
      })),
      count: triggers.length,
    });
  });

  /**
   * POST /api/triggers/enable
   * Enable a trigger
   */
  router.post('/enable', (req, res) => {
    const { workspace, workflowPath, nodeId } = req.body;

    if (!workspace || !workflowPath || !nodeId) {
      return res.status(400).json({
        error: 'Missing required fields: workspace, workflowPath, nodeId',
      });
    }

    const success = manager.setEnabled(workspace, workflowPath, nodeId, true);

    if (!success) {
      return res.status(404).json({ error: 'Trigger not found' });
    }

    // Save state
    manager.save().catch(console.error);

    res.json({ message: 'Trigger enabled', workspace, workflowPath, nodeId });
  });

  /**
   * POST /api/triggers/disable
   * Disable a trigger
   */
  router.post('/disable', (req, res) => {
    const { workspace, workflowPath, nodeId } = req.body;

    if (!workspace || !workflowPath || !nodeId) {
      return res.status(400).json({
        error: 'Missing required fields: workspace, workflowPath, nodeId',
      });
    }

    const success = manager.setEnabled(workspace, workflowPath, nodeId, false);

    if (!success) {
      return res.status(404).json({ error: 'Trigger not found' });
    }

    // Save state
    manager.save().catch(console.error);

    res.json({ message: 'Trigger disabled', workspace, workflowPath, nodeId });
  });

  /**
   * POST /api/triggers/check
   * Manually check and fire due triggers (for testing)
   */
  router.post('/check', async (_req, res) => {
    try {
      const fired = await manager.checkAndFire();

      res.json({
        message: `Checked triggers, ${fired.length} fired`,
        fired: fired.map(t => ({
          id: t.id,
          label: t.label,
          workspace: t.workspace,
          workflowPath: t.workflowPath,
        })),
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  /**
   * GET /api/triggers/validate
   * Validate a cron expression
   */
  router.get('/validate', (req, res) => {
    const cron = req.query.cron as string;

    if (!cron) {
      return res.status(400).json({ error: 'Missing cron query parameter' });
    }

    const valid = manager.isValidCron(cron);

    if (valid) {
      try {
        const nextRun = manager.getNextRunTime(cron);
        res.json({
          valid: true,
          cron,
          nextRun: nextRun.toISOString(),
        });
      } catch {
        res.json({ valid: false, cron, error: 'Failed to calculate next run' });
      }
    } else {
      res.json({ valid: false, cron, error: 'Invalid cron expression' });
    }
  });

  return router;
}
