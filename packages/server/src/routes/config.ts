import { Router } from 'express';
import { getProjectRoot, getProjectRootMarker } from '../utils/project-root.js';

export interface ConfigResponse {
  projectRoot: string;
  rootMarker: string | null;
}

export function createConfigRouter(): Router {
  const router = Router();

  // Discover and cache project root on router creation
  const projectRoot = getProjectRoot();
  const rootMarker = getProjectRootMarker(projectRoot);

  router.get('/', (_req, res) => {
    res.json({
      projectRoot,
      rootMarker,
    } as ConfigResponse);
  });

  return router;
}
