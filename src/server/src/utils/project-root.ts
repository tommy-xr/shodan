import { existsSync } from 'fs';
import { dirname, join, resolve } from 'path';

/**
 * Primary marker - highest priority, searched first across all directories
 */
const PRIMARY_MARKER = '.shodan';

/**
 * Fallback markers - only used if primary marker not found anywhere
 */
const FALLBACK_MARKERS = [
  '.git',         // Git repository
  'package.json', // Node.js project
];

/**
 * Walk up the directory tree to find a marker.
 */
function findMarkerUpward(startDir: string, marker: string): string | null {
  let currentDir = resolve(startDir);
  const fsRoot = '/';

  while (currentDir !== fsRoot) {
    const markerPath = join(currentDir, marker);
    if (existsSync(markerPath)) {
      return currentDir;
    }
    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) break; // Reached filesystem root
    currentDir = parentDir;
  }

  return null;
}

/**
 * Walk up the directory tree to find a project root.
 * Prioritizes .shodan folder - searches all directories for it first.
 * Falls back to .git or package.json only if .shodan not found.
 */
export function findProjectRoot(startDir: string = process.cwd()): string | null {
  // First, search for .shodan anywhere up the tree
  const shodanRoot = findMarkerUpward(startDir, PRIMARY_MARKER);
  if (shodanRoot) {
    return shodanRoot;
  }

  // Fall back to other markers
  for (const marker of FALLBACK_MARKERS) {
    const root = findMarkerUpward(startDir, marker);
    if (root) {
      return root;
    }
  }

  return null;
}

/**
 * Get the project root, falling back to cwd if not found.
 */
export function getProjectRoot(startDir: string = process.cwd()): string {
  return findProjectRoot(startDir) || process.cwd();
}

/**
 * Check which marker was found at the project root.
 */
export function getProjectRootMarker(projectRoot: string): string | null {
  // Check primary marker first
  const primaryPath = join(projectRoot, PRIMARY_MARKER);
  if (existsSync(primaryPath)) {
    return PRIMARY_MARKER;
  }

  // Check fallback markers
  for (const marker of FALLBACK_MARKERS) {
    const markerPath = join(projectRoot, marker);
    if (existsSync(markerPath)) {
      return marker;
    }
  }
  return null;
}
