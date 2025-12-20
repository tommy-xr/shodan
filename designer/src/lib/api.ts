// API client for communicating with Shodan server

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

export interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  modified?: string;
}

export interface ListFilesResponse {
  root: string;
  path: string;
  files: FileEntry[];
}

export interface SearchFilesResponse {
  root: string;
  pattern: string;
  files: string[];
  truncated: boolean;
  total: number;
}

export async function listFiles(rootDir: string, subPath: string = ''): Promise<ListFilesResponse> {
  const params = new URLSearchParams({ root: rootDir, path: subPath });
  const response = await fetch(`${API_BASE}/files/list?${params}`);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to list files');
  }

  return response.json();
}

export async function searchFiles(rootDir: string, pattern: string): Promise<SearchFilesResponse> {
  const params = new URLSearchParams({ root: rootDir, pattern });
  const response = await fetch(`${API_BASE}/files/search?${params}`);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to search files');
  }

  return response.json();
}

// Execution types
export type NodeStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface NodeResult {
  nodeId: string;
  status: NodeStatus;
  output?: string;
  error?: string;
  exitCode?: number;
  startTime?: string;
  endTime?: string;
}

export interface ExecuteResponse {
  success: boolean;
  results: NodeResult[];
  executionOrder: string[];
}

export interface ExecuteRequest {
  nodes: Array<{
    id: string;
    type: string;
    data: Record<string, unknown>;
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
  }>;
  rootDirectory?: string;
}

export async function executeWorkflow(request: ExecuteRequest): Promise<ExecuteResponse> {
  const response = await fetch(`${API_BASE}/execute`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to execute workflow');
  }

  return response.json();
}
