import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { createFilesRouter } from './routes/files.js';
import { createExecuteRouter } from './routes/execute.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface ServerConfig {
  port: number;
  designerPath?: string; // Path to designer dist folder
}

export function createServer(config: ServerConfig) {
  const app = express();

  // Middleware
  app.use(cors());
  app.use(express.json());

  // API routes
  app.use('/api/files', createFilesRouter());
  app.use('/api/execute', createExecuteRouter());

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

// Start server if run directly
const isMainModule = process.argv[1]?.includes('index');
if (isMainModule) {
  const config: ServerConfig = {
    port: parseInt(process.env.PORT || '3000', 10),
    designerPath: process.env.DESIGNER_PATH || path.join(__dirname, '../../designer/dist'),
  };

  const app = createServer(config);

  app.listen(config.port, () => {
    console.log(`Shodan server running at http://localhost:${config.port}`);
    console.log(`  API: http://localhost:${config.port}/api`);
    if (config.designerPath) {
      console.log(`  Designer: http://localhost:${config.port}`);
    }
  });
}
