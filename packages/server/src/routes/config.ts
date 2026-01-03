import { Router } from 'express';
import { getProjectRoot, getProjectRootMarker } from '../utils/project-root.js';

export interface ConfigResponse {
  projectRoot: string;
  rootMarker: string | null;
  dangerouslySkipPermissions: boolean;
}

export function createConfigRouter(): Router {
  const router = Router();

  // Discover and cache project root on router creation
  const projectRoot = getProjectRoot();
  const rootMarker = getProjectRootMarker(projectRoot);

  router.get('/', (req, res) => {
    // Read dangerouslySkipPermissions from app.locals (set in createServer)
    const dangerouslySkipPermissions = req.app.locals.dangerouslySkipPermissions || false;

    res.json({
      projectRoot,
      rootMarker,
      dangerouslySkipPermissions,
    } as ConfigResponse);
  });

  return router;
}
