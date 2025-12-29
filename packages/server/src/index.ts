import express, { type Express } from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { createFilesRouter } from './routes/files.js';
import { createExecuteRouter } from './routes/execute.js';
import { createConfigRouter } from './routes/config.js';
import { createComponentsRouter } from './routes/components.js';
import { getProjectRoot, getProjectRootMarker } from './utils/project-root.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Re-export for CLI and other consumers
export { executeWorkflowSchema, type NodeResult } from './engine/executor.js';
export type { WorkflowSchema, WorkflowNode, WorkflowEdge } from '@shodan/core';
export { getProjectRoot } from './utils/project-root.js';

export interface ServerConfig {
  port: number;
  designerPath?: string; // Path to designer dist folder
}

export function createServer(config: ServerConfig): Express {
  const app = express();

  // Middleware
  app.use(cors());
  app.use(express.json());

  // Discover project root
  const projectRoot = getProjectRoot();
  const rootMarker = getProjectRootMarker(projectRoot);

  // API routes
  app.use('/api/config', createConfigRouter());
  app.use('/api/files', createFilesRouter());
  app.use('/api/execute', createExecuteRouter(projectRoot));
  app.use('/api/components', createComponentsRouter(projectRoot));

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
  const config: ServerConfig = {
    port: parseInt(process.env.PORT || '3000', 10),
    designerPath: process.env.DESIGNER_PATH || path.join(__dirname, '../../designer/dist'),
  };

  const app = createServer(config);

  // Discover project root for logging
  const discoveredRoot = getProjectRoot();
  const discoveredMarker = getProjectRootMarker(discoveredRoot);

  app.listen(config.port, () => {
    console.log(`Shodan server running at http://localhost:${config.port}`);
    console.log(`  API: http://localhost:${config.port}/api`);
    console.log(`  Project root: ${discoveredRoot} (${discoveredMarker || 'fallback'})`);
    if (config.designerPath) {
      console.log(`  Designer: http://localhost:${config.port}`);
    }
  });
}
