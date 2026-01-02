/**
 * Execution Management API
 *
 * Handles starting, stopping, and tracking workflow execution status.
 */

import { Router } from 'express';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import yaml from 'js-yaml';
import { executeWorkflowSchema } from '../engine/executor.js';
import type { WorkflowSchema, NodeResult } from '@robomesh/core';

// Get robomesh home directory
function getRobomeshHome(): string {
  return process.env.ROBOMESH_HOME || path.join(os.homedir(), '.robomesh');
}

function getHistoryFile(): string {
  return path.join(getRobomeshHome(), 'history.json');
}

function getRunsDir(): string {
  return path.join(getRobomeshHome(), 'runs');
}

export interface ExecutionState {
  isRunning: boolean;
  workflowPath?: string;
  workspace?: string;
  workspacePath?: string;
  startedAt?: string;
  currentNode?: string;
  progress?: {
    completed: number;
    total: number;
  };
  results?: NodeResult[];
  error?: string;
}

export interface ExecutionHistoryEntry {
  id: string;
  workspace: string;
  workflowPath: string;
  startedAt: string;
  completedAt: string;
  status: 'completed' | 'failed' | 'cancelled';
  duration: number; // milliseconds
  nodeCount: number;
  error?: string;
  results?: NodeResult[];
}

// Global execution state (one workflow at a time per server for now)
let executionState: ExecutionState = { isRunning: false };

// Execution history (keyed by workspace/workflowPath)
const executionHistory: Map<string, ExecutionHistoryEntry[]> = new Map();
const MAX_HISTORY_PER_WORKFLOW = 10;

function getHistoryKey(workspace: string, workflowPath: string): string {
  return `${workspace}:${workflowPath}`;
}

async function addToHistory(entry: ExecutionHistoryEntry) {
  const key = getHistoryKey(entry.workspace, entry.workflowPath);
  const history = executionHistory.get(key) || [];

  // Add new entry at the beginning
  history.unshift(entry);

  // Keep only the last N entries
  if (history.length > MAX_HISTORY_PER_WORKFLOW) {
    history.pop();
  }

  executionHistory.set(key, history);

  // Persist to disk
  await saveRunResults(entry);
  await saveHistoryIndex();
}

function getLastRun(workspace: string, workflowPath: string): ExecutionHistoryEntry | undefined {
  const key = getHistoryKey(workspace, workflowPath);
  const history = executionHistory.get(key);
  return history?.[0];
}

// Ensure directories exist
async function ensureDirectories() {
  await fs.mkdir(getRobomeshHome(), { recursive: true });
  await fs.mkdir(getRunsDir(), { recursive: true });
}

// Load history from disk on startup
async function loadHistory() {
  try {
    await ensureDirectories();
    const historyFile = getHistoryFile();
    const data = await fs.readFile(historyFile, 'utf-8');
    const parsed = JSON.parse(data) as Record<string, ExecutionHistoryEntry[]>;

    // Restore to in-memory map
    for (const [key, entries] of Object.entries(parsed)) {
      executionHistory.set(key, entries);
    }
    console.log(`Loaded ${executionHistory.size} workflow histories from ${historyFile}`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error('Error loading history:', err);
    }
    // No history file yet, that's fine
  }
}

// Save history index to disk
async function saveHistoryIndex() {
  try {
    await ensureDirectories();

    // Convert Map to object for JSON serialization
    // Store only summary info in the index (no results)
    const indexData: Record<string, Array<Omit<ExecutionHistoryEntry, 'results'>>> = {};

    for (const [key, entries] of executionHistory) {
      indexData[key] = entries.map(({ results, ...summary }) => summary);
    }

    await fs.writeFile(getHistoryFile(), JSON.stringify(indexData, null, 2));
  } catch (err) {
    console.error('Error saving history index:', err);
  }
}

// Save individual run results to disk
async function saveRunResults(entry: ExecutionHistoryEntry) {
  try {
    await ensureDirectories();
    const runFile = path.join(getRunsDir(), `${entry.id}.json`);
    await fs.writeFile(runFile, JSON.stringify(entry, null, 2));
  } catch (err) {
    console.error('Error saving run results:', err);
  }
}

// Load individual run results from disk
async function loadRunResults(runId: string): Promise<ExecutionHistoryEntry | null> {
  try {
    const runFile = path.join(getRunsDir(), `${runId}.json`);
    const data = await fs.readFile(runFile, 'utf-8');
    return JSON.parse(data) as ExecutionHistoryEntry;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error('Error loading run results:', err);
    }
    return null;
  }
}

// Initialize: load history on module load
loadHistory().catch(console.error);

// Store workspaces for use by startWorkflow
let registeredWorkspaces: string[] = [];

/**
 * Start a workflow execution programmatically
 * Returns a promise that resolves when execution starts (not when it completes)
 */
export async function startWorkflow(
  workspace: string,
  workflowPath: string,
  options?: { triggeredBy?: string }
): Promise<{ success: boolean; error?: string; runId?: string }> {
  if (executionState.isRunning) {
    return {
      success: false,
      error: `A workflow is already running: ${executionState.workflowPath}`,
    };
  }

  // Find workspace path
  const workspacePath = registeredWorkspaces.find(ws => path.basename(ws) === workspace);
  if (!workspacePath) {
    return { success: false, error: 'Workspace not found' };
  }

  // Load workflow
  const absoluteWorkflowPath = path.resolve(workspacePath, workflowPath);

  // Security check
  if (!absoluteWorkflowPath.startsWith(workspacePath)) {
    return { success: false, error: 'Invalid workflow path' };
  }

  let schema: WorkflowSchema;
  try {
    const content = await fs.readFile(absoluteWorkflowPath, 'utf-8');
    schema = yaml.load(content) as WorkflowSchema;

    if (!schema?.metadata?.name || !Array.isArray(schema.nodes)) {
      return { success: false, error: 'Invalid workflow schema' };
    }

    // Set rootDirectory to workspace
    schema.metadata.rootDirectory = workspacePath;
  } catch (err) {
    return { success: false, error: `Failed to load workflow: ${(err as Error).message}` };
  }

  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Initialize execution state
  executionState = {
    isRunning: true,
    workflowPath,
    workspace,
    workspacePath,
    startedAt: new Date().toISOString(),
    currentNode: undefined,
    progress: {
      completed: 0,
      total: schema.nodes.length,
    },
    results: [],
  };

  // Log if triggered by cron
  if (options?.triggeredBy) {
    console.log(`[Trigger] Starting workflow ${workspace}/${workflowPath} (triggered by: ${options.triggeredBy})`);
  }

  // Execute in background
  const startTime = Date.now();

  executeWorkflowSchema(schema, {
    onNodeStart: (nodeId, node) => {
      executionState.currentNode = (node.data.label as string) || nodeId;
    },
    onNodeComplete: (_nodeId, result) => {
      if (executionState.progress) {
        executionState.progress.completed++;
      }
      executionState.results?.push(result);
    },
  })
    .then(result => {
      const completedAt = new Date().toISOString();
      const duration = Date.now() - startTime;

      // Check if any node failed
      const hasFailedNode = result.results.some(r => r.status === 'failed');
      const failedNode = result.results.find(r => r.status === 'failed');

      // Record to history
      addToHistory({
        id: runId,
        workspace,
        workflowPath,
        startedAt: executionState.startedAt!,
        completedAt,
        status: hasFailedNode ? 'failed' : 'completed',
        duration,
        nodeCount: result.results.length,
        error: failedNode?.error,
        results: result.results,
      });

      executionState = {
        isRunning: false,
        workflowPath,
        workspace,
        progress: executionState.progress,
        results: result.results,
        error: failedNode?.error,
      };

      if (options?.triggeredBy) {
        console.log(`[Trigger] Workflow ${workspace}/${workflowPath} completed (status: ${hasFailedNode ? 'failed' : 'completed'})`);
      }
    })
    .catch(err => {
      const completedAt = new Date().toISOString();
      const duration = Date.now() - startTime;

      // Record to history
      addToHistory({
        id: runId,
        workspace,
        workflowPath,
        startedAt: executionState.startedAt!,
        completedAt,
        status: 'failed',
        duration,
        nodeCount: executionState.results?.length || 0,
        error: (err as Error).message,
        results: executionState.results,
      });

      executionState = {
        isRunning: false,
        workflowPath,
        workspace,
        error: (err as Error).message,
      };

      if (options?.triggeredBy) {
        console.log(`[Trigger] Workflow ${workspace}/${workflowPath} failed: ${(err as Error).message}`);
      }
    });

  return { success: true, runId };
}

export function createExecutionRouter(workspaces: string[]): Router {
  const router = Router();

  // Store workspaces for startWorkflow
  registeredWorkspaces = workspaces;

  /**
   * GET /api/execution/status
   * Get current execution status
   */
  router.get('/status', (_req, res) => {
    res.json(executionState);
  });

  /**
   * POST /api/execution/start
   * Start executing a workflow
   */
  router.post('/start', async (req, res) => {
    const { workspace, workflowPath } = req.body;

    if (!workspace || !workflowPath) {
      return res.status(400).json({
        error: 'Missing required fields: workspace, workflowPath',
      });
    }

    const result = await startWorkflow(workspace, workflowPath);

    if (!result.success) {
      // Determine appropriate status code
      if (result.error?.includes('already running')) {
        return res.status(409).json({ error: result.error, currentWorkflow: executionState.workflowPath });
      } else if (result.error?.includes('not found')) {
        return res.status(404).json({ error: result.error });
      } else if (result.error?.includes('Invalid')) {
        return res.status(403).json({ error: result.error });
      } else {
        return res.status(400).json({ error: result.error });
      }
    }

    res.json({
      message: 'Workflow started',
      workflowPath,
      workspace,
      runId: result.runId,
    });
  });

  /**
   * POST /api/execution/cancel
   * Cancel the currently running workflow
   */
  router.post('/cancel', (_req, res) => {
    if (!executionState.isRunning) {
      return res.status(400).json({ error: 'No workflow is currently running' });
    }

    // TODO: Implement actual cancellation when executor supports abort signals

    const { workflowPath, workspace, startedAt, results } = executionState;

    // Record cancellation to history
    if (workspace && workflowPath && startedAt) {
      const completedAt = new Date().toISOString();
      const duration = Date.now() - new Date(startedAt).getTime();

      addToHistory({
        id: `${Date.now()}-cancelled`,
        workspace,
        workflowPath,
        startedAt,
        completedAt,
        status: 'cancelled',
        duration,
        nodeCount: results?.length || 0,
        error: 'Cancelled by user',
        results,
      });
    }

    executionState = {
      isRunning: false,
      workflowPath,
      workspace,
      error: 'Cancelled by user',
    };

    res.json({ message: 'Workflow cancelled' });
  });

  /**
   * GET /api/execution/history
   * Get execution history for a specific workflow or all workflows
   * Query params: workspace (optional), path (optional)
   */
  router.get('/history', (req, res) => {
    const workspace = req.query.workspace as string | undefined;
    const workflowPath = req.query.path as string | undefined;

    if (workspace && workflowPath) {
      // Get history for specific workflow
      const key = getHistoryKey(workspace, workflowPath);
      const history = executionHistory.get(key) || [];
      res.json({ history });
    } else {
      // Get all history entries
      const allHistory: ExecutionHistoryEntry[] = [];
      for (const entries of executionHistory.values()) {
        allHistory.push(...entries);
      }
      // Sort by completedAt descending
      allHistory.sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime());
      res.json({ history: allHistory.slice(0, 50) }); // Limit to 50 most recent
    }
  });

  /**
   * GET /api/execution/last-runs
   * Get last run info for all workflows (for dashboard display)
   */
  router.get('/last-runs', (_req, res) => {
    const lastRuns: Record<string, ExecutionHistoryEntry> = {};

    for (const [key, entries] of executionHistory) {
      if (entries.length > 0) {
        lastRuns[key] = entries[0];
      }
    }

    res.json({ lastRuns });
  });

  /**
   * GET /api/execution/run/:id
   * Get details for a specific run (loads from disk if needed)
   */
  router.get('/run/:id', async (req, res) => {
    const runId = req.params.id;

    // Try to load from disk
    const run = await loadRunResults(runId);

    if (!run) {
      return res.status(404).json({ error: 'Run not found' });
    }

    res.json(run);
  });

  return router;
}

/**
 * Get current execution state (for use by other modules)
 */
export function getExecutionState(): ExecutionState {
  return executionState;
}
