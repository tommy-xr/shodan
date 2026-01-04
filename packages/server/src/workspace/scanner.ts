/**
 * Workspace Scanner
 *
 * Scans workspace directories for workflow files and extracts metadata.
 */

import fs from 'fs/promises';
import path from 'path';
import yaml from 'js-yaml';
import { glob } from 'glob';
import type { WorkflowSchema, WorkflowNode } from '@robomesh/core';

export interface TriggerInfo {
  nodeId: string;
  label: string;
  type: string; // 'manual' | 'cron' | 'idle'
  cron?: string; // For cron triggers
  idleMinutes?: number; // For idle triggers
}

export interface WorkflowInfo {
  path: string; // Relative path from workspace root
  absolutePath: string;
  name: string;
  description?: string;
  triggers: TriggerInfo[];
  nodeCount: number;
  lastModified: Date;
}

export interface WorkspaceScanResult {
  workspacePath: string;
  workspaceName: string;
  workflows: WorkflowInfo[];
  scannedAt: Date;
}

// Cache for scan results
interface CacheEntry {
  result: WorkspaceScanResult;
  fileStats: Map<string, number>; // path -> mtime
}

const cache = new Map<string, CacheEntry>();

// Default workflow directory relative to workspace root
const DEFAULT_WORKFLOW_DIRS = ['.robomesh/workflows'];

/**
 * Extract trigger information from workflow nodes
 */
export function getWorkflowTriggers(nodes: WorkflowNode[]): TriggerInfo[] {
  const triggers: TriggerInfo[] = [];

  for (const node of nodes) {
    if (node.type === 'trigger') {
      triggers.push({
        nodeId: node.id,
        label: (node.data.label as string) || 'Trigger',
        type: (node.data.triggerType as string) || 'manual',
        cron: node.data.cron as string | undefined,
        idleMinutes: node.data.idleMinutes as number | undefined,
      });
    }
  }

  return triggers;
}

/**
 * Parse a workflow file and extract metadata
 */
async function parseWorkflowFile(
  absolutePath: string,
  workspaceRoot: string
): Promise<WorkflowInfo | null> {
  try {
    const content = await fs.readFile(absolutePath, 'utf-8');
    const stat = await fs.stat(absolutePath);

    let schema: WorkflowSchema;
    if (absolutePath.endsWith('.json')) {
      schema = JSON.parse(content);
    } else {
      schema = yaml.load(content) as WorkflowSchema;
    }

    // Validate basic structure
    if (!schema?.metadata?.name || !Array.isArray(schema.nodes)) {
      return null;
    }

    const relativePath = path.relative(workspaceRoot, absolutePath);

    return {
      path: relativePath,
      absolutePath,
      name: schema.metadata.name,
      description: schema.metadata.description,
      triggers: getWorkflowTriggers(schema.nodes),
      nodeCount: schema.nodes.length,
      lastModified: stat.mtime,
    };
  } catch (err) {
    // Skip files that can't be parsed
    console.warn(`Warning: Could not parse workflow ${absolutePath}:`, (err as Error).message);
    return null;
  }
}

/**
 * Check if cache is still valid by comparing file mtimes
 */
async function isCacheValid(workspacePath: string): Promise<boolean> {
  const entry = cache.get(workspacePath);
  if (!entry) return false;

  for (const [filePath, cachedMtime] of entry.fileStats) {
    try {
      const stat = await fs.stat(filePath);
      if (stat.mtimeMs !== cachedMtime) {
        return false;
      }
    } catch {
      // File was deleted
      return false;
    }
  }

  return true;
}

export interface ScanOptions {
  /** Workflow directories to scan (relative to workspace root). Defaults to ['.robomesh/workflows'] */
  workflowDirs?: string[];
}

/**
 * Scan a workspace directory for workflow files
 */
export async function scanWorkflows(
  workspacePath: string,
  options?: ScanOptions
): Promise<WorkspaceScanResult> {
  const absoluteWorkspacePath = path.resolve(workspacePath);

  // Check cache
  if (await isCacheValid(absoluteWorkspacePath)) {
    return cache.get(absoluteWorkspacePath)!.result;
  }

  const workflowDirs = options?.workflowDirs || DEFAULT_WORKFLOW_DIRS;
  const files: string[] = [];

  // Scan each configured workflow directory
  for (const dir of workflowDirs) {
    const workflowsDir = path.join(absoluteWorkspacePath, dir);

    try {
      await fs.stat(workflowsDir);

      const found = await glob('**/*.{yaml,yml}', {
        cwd: workflowsDir,
        nodir: true,
        ignore: ['**/node_modules/**', '**/components/**'],
      });

      // Convert to absolute paths
      files.push(...found.map(f => path.join(workflowsDir, f)));
    } catch {
      // Directory doesn't exist, skip
    }
  }

  // Parse each workflow file
  const workflows: WorkflowInfo[] = [];
  const fileStats = new Map<string, number>();

  for (const file of files) {
    const info = await parseWorkflowFile(file, absoluteWorkspacePath);
    if (info) {
      workflows.push(info);
      const stat = await fs.stat(file);
      fileStats.set(file, stat.mtimeMs);
    }
  }

  // Sort by name
  workflows.sort((a, b) => a.name.localeCompare(b.name));

  const result: WorkspaceScanResult = {
    workspacePath: absoluteWorkspacePath,
    workspaceName: path.basename(absoluteWorkspacePath),
    workflows,
    scannedAt: new Date(),
  };

  // Update cache
  cache.set(absoluteWorkspacePath, { result, fileStats });

  return result;
}

/**
 * Scan multiple workspaces
 */
export async function scanAllWorkspaces(workspacePaths: string[]): Promise<WorkspaceScanResult[]> {
  const results: WorkspaceScanResult[] = [];

  for (const workspacePath of workspacePaths) {
    try {
      const result = await scanWorkflows(workspacePath);
      results.push(result);
    } catch (err) {
      console.warn(`Warning: Could not scan workspace ${workspacePath}:`, (err as Error).message);
    }
  }

  return results;
}

/**
 * Get a single workflow by path
 */
export async function getWorkflow(
  workspacePath: string,
  workflowPath: string
): Promise<WorkflowInfo | null> {
  const absoluteWorkspacePath = path.resolve(workspacePath);
  const absoluteWorkflowPath = path.resolve(absoluteWorkspacePath, workflowPath);

  // Security: ensure path is within workspace
  if (!absoluteWorkflowPath.startsWith(absoluteWorkspacePath)) {
    return null;
  }

  return parseWorkflowFile(absoluteWorkflowPath, absoluteWorkspacePath);
}

/**
 * Clear the cache for a workspace (or all if not specified)
 */
export function clearCache(workspacePath?: string): void {
  if (workspacePath) {
    cache.delete(path.resolve(workspacePath));
  } else {
    cache.clear();
  }
}
