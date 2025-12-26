import type { Node, Edge } from '@xyflow/react';
import yaml from 'js-yaml';
import type { BaseNodeData } from '../nodes';

// Schema version - increment when making breaking changes
export const WORKFLOW_SCHEMA_VERSION = 2;

export interface WorkflowMetadata {
  name: string;
  description?: string;
  rootDirectory?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowSchema {
  version: number;
  metadata: WorkflowMetadata;
  nodes: SerializedNode[];
  edges: SerializedEdge[];
}

export interface SerializedNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

export interface SerializedEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

/**
 * Upgrade workflow from older schema versions to current
 */
function upgradeWorkflow(workflow: WorkflowSchema): WorkflowSchema {
  let current = workflow;

  // Migrate from v1 to v2: Add default I/O ports to all nodes
  if (current.version === 1) {
    current = {
      ...current,
      version: 2,
      nodes: current.nodes.map((node) => {
        const nodeType = (node.data.nodeType as string) || node.type;

        // All nodes get a default 'output' output port
        const outputs = [{ name: 'output', type: 'string' as const }];

        // Non-trigger nodes get a default 'input' input port
        const inputs =
          nodeType === 'trigger'
            ? []
            : [{ name: 'input', type: 'any' as const }];

        return {
          ...node,
          data: {
            ...node.data,
            inputs,
            outputs,
          },
        };
      }),
      edges: current.edges.map((edge) => ({
        ...edge,
        // Source always uses 'output' handle, target uses 'input' handle
        sourceHandle: edge.sourceHandle || 'output:output',
        targetHandle: edge.targetHandle || 'input:input',
      })),
    };
  }

  if (current.version > WORKFLOW_SCHEMA_VERSION) {
    throw new Error(
      `Workflow version ${current.version} is newer than supported version ${WORKFLOW_SCHEMA_VERSION}. Please upgrade Shodan.`
    );
  }

  return current;
}

/**
 * Convert React Flow nodes/edges to serializable workflow schema
 */
export function serializeWorkflow(
  nodes: Node<BaseNodeData>[],
  edges: Edge[],
  metadata: Partial<WorkflowMetadata> = {}
): WorkflowSchema {
  const now = new Date().toISOString();

  return {
    version: WORKFLOW_SCHEMA_VERSION,
    metadata: {
      name: metadata.name || 'Untitled Workflow',
      description: metadata.description,
      createdAt: metadata.createdAt || now,
      updatedAt: now,
    },
    nodes: nodes.map((node) => ({
      id: node.id,
      type: node.type || 'agent',
      position: { x: node.position.x, y: node.position.y },
      data: { ...node.data },
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
    })),
  };
}

/**
 * Convert workflow schema back to React Flow nodes/edges
 */
export function deserializeWorkflow(workflow: WorkflowSchema): {
  nodes: Node<BaseNodeData>[];
  edges: Edge[];
  metadata: WorkflowMetadata;
} {
  const upgraded = upgradeWorkflow(workflow);

  return {
    nodes: upgraded.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      position: node.position,
      data: node.data as BaseNodeData,
    })),
    edges: upgraded.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
    })),
    metadata: upgraded.metadata,
  };
}

/**
 * Export workflow to JSON string
 */
export function exportToJSON(
  nodes: Node<BaseNodeData>[],
  edges: Edge[],
  metadata?: Partial<WorkflowMetadata>
): string {
  const workflow = serializeWorkflow(nodes, edges, metadata);
  return JSON.stringify(workflow, null, 2);
}

/**
 * Export workflow to YAML string
 */
export function exportToYAML(
  nodes: Node<BaseNodeData>[],
  edges: Edge[],
  metadata?: Partial<WorkflowMetadata>
): string {
  const workflow = serializeWorkflow(nodes, edges, metadata);
  return yaml.dump(workflow, {
    indent: 2,
    lineWidth: 120,
    noRefs: true,
  });
}

/**
 * Import workflow from JSON string
 */
export function importFromJSON(json: string): {
  nodes: Node<BaseNodeData>[];
  edges: Edge[];
  metadata: WorkflowMetadata;
} {
  const parsed = JSON.parse(json) as WorkflowSchema;

  if (typeof parsed.version !== 'number') {
    throw new Error('Invalid workflow file: missing version field');
  }

  return deserializeWorkflow(parsed);
}

/**
 * Import workflow from YAML string
 */
export function importFromYAML(yamlStr: string): {
  nodes: Node<BaseNodeData>[];
  edges: Edge[];
  metadata: WorkflowMetadata;
} {
  const parsed = yaml.load(yamlStr) as WorkflowSchema;

  if (typeof parsed.version !== 'number') {
    throw new Error('Invalid workflow file: missing version field');
  }

  return deserializeWorkflow(parsed);
}

/**
 * Detect format and import workflow
 */
export function importWorkflow(content: string): {
  nodes: Node<BaseNodeData>[];
  edges: Edge[];
  metadata: WorkflowMetadata;
} {
  const trimmed = content.trim();

  // Try JSON first (starts with {)
  if (trimmed.startsWith('{')) {
    return importFromJSON(trimmed);
  }

  // Otherwise try YAML
  return importFromYAML(trimmed);
}

/**
 * Download a file to the user's computer
 */
export function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Open file picker and read file contents
 */
export function openFilePicker(accept: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;

    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) {
        reject(new Error('No file selected'));
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        resolve(reader.result as string);
      };
      reader.onerror = () => {
        reject(new Error('Failed to read file'));
      };
      reader.readAsText(file);
    };

    input.click();
  });
}
