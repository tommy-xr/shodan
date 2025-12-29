import { Router } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { glob } from 'glob';

export interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  modified?: string;
}

export function createFilesRouter(): Router {
  const router = Router();

  // List files in a directory
  router.get('/list', async (req, res) => {
    try {
      const rootDir = req.query.root as string;
      const subPath = (req.query.path as string) || '';

      if (!rootDir) {
        return res.status(400).json({ error: 'root parameter is required' });
      }

      const fullPath = path.resolve(rootDir, subPath);

      // Security: ensure we're not escaping the root directory
      if (!fullPath.startsWith(path.resolve(rootDir))) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const stat = await fs.stat(fullPath);
      if (!stat.isDirectory()) {
        return res.status(400).json({ error: 'Path is not a directory' });
      }

      const entries = await fs.readdir(fullPath, { withFileTypes: true });

      const files: FileEntry[] = await Promise.all(
        entries
          .filter(entry => !entry.name.startsWith('.')) // Hide hidden files
          .map(async (entry) => {
            const entryPath = path.join(fullPath, entry.name);
            const relativePath = path.join(subPath, entry.name);

            try {
              const entryStat = await fs.stat(entryPath);
              return {
                name: entry.name,
                path: relativePath,
                type: entry.isDirectory() ? 'directory' : 'file',
                size: entry.isFile() ? entryStat.size : undefined,
                modified: entryStat.mtime.toISOString(),
              } as FileEntry;
            } catch {
              return {
                name: entry.name,
                path: relativePath,
                type: entry.isDirectory() ? 'directory' : 'file',
              } as FileEntry;
            }
          })
      );

      // Sort: directories first, then alphabetically
      files.sort((a, b) => {
        if (a.type !== b.type) {
          return a.type === 'directory' ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });

      res.json({
        root: rootDir,
        path: subPath,
        files,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return res.status(404).json({ error: 'Directory not found' });
      }
      console.error('Error listing files:', error);
      res.status(500).json({ error: 'Failed to list files' });
    }
  });

  // Search files with glob pattern
  router.get('/search', async (req, res) => {
    try {
      const rootDir = req.query.root as string;
      const pattern = (req.query.pattern as string) || '**/*';

      if (!rootDir) {
        return res.status(400).json({ error: 'root parameter is required' });
      }

      const matches = await glob(pattern, {
        cwd: rootDir,
        nodir: true,
        ignore: ['**/node_modules/**', '**/.git/**'],
        maxDepth: 10,
      });

      // Limit results
      const limited = matches.slice(0, 100);

      res.json({
        root: rootDir,
        pattern,
        files: limited,
        truncated: matches.length > 100,
        total: matches.length,
      });
    } catch (error) {
      console.error('Error searching files:', error);
      res.status(500).json({ error: 'Failed to search files' });
    }
  });

  return router;
}
