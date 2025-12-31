// API client for communicating with Shodan server

const serverPort = import.meta.env.VITE_SERVER_PORT || '3000';
const API_BASE = import.meta.env.VITE_API_URL || `http://localhost:${serverPort}/api`;

// Config types
export interface ConfigResponse {
  projectRoot: string;
  rootMarker: string | null;
}

export async function getConfig(): Promise<ConfigResponse> {
  const response = await fetch(`${API_BASE}/config`);

  if (!response.ok) {
    throw new Error('Failed to fetch config');
  }

  return response.json();
}

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
    position: { x: number; y: number };
    data: Record<string, unknown>;
    // Loop container support
    parentId?: string;
    extent?: 'parent';
    style?: { width?: number; height?: number };
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    sourceHandle?: string | null;
    targetHandle?: string | null;
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

// Component types
export interface ComponentInfo {
  name: string;
  description?: string;
  path: string;
  inputs: Array<{
    name: string;
    type: string;
    required?: boolean;
    description?: string;
  }>;
  outputs: Array<{
    name: string;
    type: string;
    description?: string;
  }>;
}

export interface ListComponentsResponse {
  components: ComponentInfo[];
}

export async function listComponents(): Promise<ListComponentsResponse> {
  const response = await fetch(`${API_BASE}/components/list`);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to list components');
  }

  return response.json();
}

export async function getComponentInfo(path: string): Promise<ComponentInfo> {
  const params = new URLSearchParams({ path });
  const response = await fetch(`${API_BASE}/components/info?${params}`);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to get component info');
  }

  return response.json();
}

export interface ComponentWorkflow {
  name: string;
  description?: string;
  path: string;
  nodes: Array<{
    id: string;
    type: string;
    position: { x: number; y: number };
    data: Record<string, unknown>;
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    sourceHandle?: string;
    targetHandle?: string;
  }>;
  interface?: {
    inputs: Array<{
      name: string;
      type: string;
      required?: boolean;
      description?: string;
    }>;
    outputs: Array<{
      name: string;
      type: string;
      description?: string;
    }>;
  };
}

export async function getComponentWorkflow(path: string): Promise<ComponentWorkflow> {
  const params = new URLSearchParams({ path });
  const response = await fetch(`${API_BASE}/components/workflow?${params}`);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to load component workflow');
  }

  return response.json();
}

export interface SaveComponentRequest {
  path: string;
  nodes: ComponentWorkflow['nodes'];
  edges: ComponentWorkflow['edges'];
  metadata?: {
    name?: string;
    description?: string;
  };
  interface?: ComponentWorkflow['interface'];
}

export async function saveComponentWorkflow(request: SaveComponentRequest): Promise<{ success: boolean; path: string }> {
  const response = await fetch(`${API_BASE}/components/workflow`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to save component');
  }

  return response.json();
}

export interface CreateComponentRequest {
  name: string;
  description?: string;
  filename: string;
  inputs: Array<{
    name: string;
    type: string;
    required?: boolean;
    description?: string;
  }>;
  outputs: Array<{
    name: string;
    type: string;
    description?: string;
  }>;
}

export async function createComponent(request: CreateComponentRequest): Promise<ComponentInfo> {
  const response = await fetch(`${API_BASE}/components/create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to create component');
  }

  return response.json();
}
