import dotenv from 'dotenv';
import express, { type Express } from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { createFilesRouter } from './routes/files.js';
import { createExecuteRouter } from './routes/execute.js';
import { createConfigRouter } from './routes/config.js';
import { createComponentsRouter } from './routes/components.js';
import { createWorkflowsRouter } from './routes/workflows.js';
import { createExecutionRouter, startWorkflow } from './routes/execution.js';
import { createTriggersRouter } from './routes/triggers.js';
import { getTriggerManager } from './triggers/index.js';
import { getProjectRoot, getProjectRootMarker } from './utils/project-root.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env from project root (found by walking up directory tree)
const projectRoot = getProjectRoot();
dotenv.config({ path: path.join(projectRoot, '.env') });

// Re-export for CLI and other consumers
export { executeWorkflowSchema } from './engine/executor.js';
export type { WorkflowSchema, WorkflowNode, WorkflowEdge, NodeResult, NodeStatus } from '@robomesh/core';
export { getProjectRoot } from './utils/project-root.js';

export interface ServerConfig {
  port: number;
  designerPath?: string; // Path to designer dist folder
  workspaces?: string[]; // Registered workspace directories
  enableTriggers?: boolean; // Enable trigger scheduling (default: true)
  triggerCheckInterval?: number; // Trigger check interval in ms (default: 10000)
}

export function createServer(config: ServerConfig): Express {
  const app = express();

  // Middleware
  app.use(cors());
  app.use(express.json());

  // Determine project root(s)
  // If workspaces provided, use first one as primary (for backward compat)
  // Otherwise, auto-discover from current directory
  const workspaces = config.workspaces || [];
  const primaryRoot = workspaces[0] || getProjectRoot();

  // API routes
  app.use('/api/config', createConfigRouter());
  app.use('/api/files', createFilesRouter());
  app.use('/api/execute', createExecuteRouter(primaryRoot));
  app.use('/api/components', createComponentsRouter(primaryRoot));
  app.use('/api/workflows', createWorkflowsRouter(workspaces));
  app.use('/api/execution', createExecutionRouter(workspaces));
  app.use('/api/triggers', createTriggersRouter());

  // Initialize trigger manager
  const triggerManager = getTriggerManager();
  triggerManager.load().catch(console.error);

  // Wire up trigger firing to execute workflows
  triggerManager.onFire(async (trigger) => {
    console.log(`[Trigger] Firing trigger: ${trigger.id} (${trigger.label})`);
    const result = await startWorkflow(trigger.workspace, trigger.workflowPath, {
      triggeredBy: `cron:${trigger.config.cron}`,
    });
    if (!result.success) {
      console.error(`[Trigger] Failed to start workflow: ${result.error}`);
      throw new Error(result.error);
    }
  });

  // Start trigger scheduler if enabled (default: true)
  if (config.enableTriggers !== false) {
    const checkInterval = config.triggerCheckInterval || 10000;
    triggerManager.start(checkInterval);
  }

  // Workspaces endpoint
  app.get('/api/workspaces', (_req, res) => {
    res.json({
      workspaces: workspaces.map(ws => ({
        path: ws,
        name: path.basename(ws),
      })),
      primary: primaryRoot,
    });
  });

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Serve designer UI if path provided
  if (config.designerPath) {
    app.use(express.static(config.designerPath));

    // SPA fallback
    app.get('*', (_req, res) => {
      res.sendFile(path.join(config.designerPath!, 'index.html'));
    });
  }

  return app;
}

// Start server if run directly (not when imported by other modules)
// Check if this is the main module by looking for 'server' in the path
const isMainModule = process.argv[1]?.includes('server/dist/index.js') ||
                     process.argv[1]?.includes('server/src/index.ts');
if (isMainModule) {
  // Auto-discover project root as workspace when running directly
  const discoveredRoot = getProjectRoot();
  const discoveredMarker = getProjectRootMarker(discoveredRoot);

  const config: ServerConfig = {
    port: parseInt(process.env.PORT || '3000', 10),
    designerPath: process.env.DESIGNER_PATH || path.join(__dirname, '../../designer/dist'),
    workspaces: [discoveredRoot], // Use discovered root as workspace
  };

  const app = createServer(config);

  app.listen(config.port, () => {
    console.log(`Robomesh server running at http://localhost:${config.port}`);
    console.log(`  API: http://localhost:${config.port}/api`);
    console.log(`  Project root: ${discoveredRoot} (${discoveredMarker || 'fallback'})`);
    if (config.designerPath) {
      console.log(`  Designer: http://localhost:${config.port}`);
    }
  });
}
