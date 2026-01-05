import type { Node, Edge } from '@xyflow/react';
import yaml from 'js-yaml';
import type { BaseNodeData } from '../nodes';
import type { InlineComponent } from '@robomesh/core';

// Schema version - increment when making breaking changes
export const WORKFLOW_SCHEMA_VERSION = 3;

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
  components?: Record<string, InlineComponent>;  // Inline component definitions
  nodes: SerializedNode[];
  edges: SerializedEdge[];
}

export interface SerializedNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Record<string, unknown>;
  // Loop container support
  parentId?: string;
  extent?: 'parent';
  style?: { width?: number; height?: number };
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
 *
 * NOTE: Schema migration is disabled during early development while the data model
 * is still being stabilized. Workflows should be updated inline when the schema changes.
 * Re-enable migrations once the schema is stable.
 */
function upgradeWorkflow(workflow: WorkflowSchema): WorkflowSchema {
  // No migrations during early development - just pass through
  return workflow;
}

/**
 * Convert React Flow nodes/edges to serializable workflow schema
 */
export function serializeWorkflow(
  nodes: Node<BaseNodeData>[],
  edges: Edge[],
  metadata: Partial<WorkflowMetadata> = {},
  components?: Record<string, InlineComponent>
): WorkflowSchema {
  const now = new Date().toISOString();

  const schema: WorkflowSchema = {
    version: WORKFLOW_SCHEMA_VERSION,
    metadata: {
      name: metadata.name || 'Untitled Workflow',
      description: metadata.description,
      createdAt: metadata.createdAt || now,
      updatedAt: now,
    },
    nodes: nodes.map((node) => {
      const serialized: SerializedNode = {
        id: node.id,
        type: node.type || 'agent',
        position: { x: node.position.x, y: node.position.y },
        data: { ...node.data },
      };
      // Preserve loop container properties
      if (node.parentId) {
        serialized.parentId = node.parentId;
      }
      if (node.extent === 'parent') {
        serialized.extent = 'parent';
      }
      if (node.style && (node.style.width || node.style.height)) {
        serialized.style = {
          width: node.style.width as number | undefined,
          height: node.style.height as number | undefined,
        };
      }
      return serialized;
    }),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
    })),
  };

  // Only include components if there are any
  if (components && Object.keys(components).length > 0) {
    schema.components = components;
  }

  return schema;
}

/**
 * Convert workflow schema back to React Flow nodes/edges
 */
export function deserializeWorkflow(workflow: WorkflowSchema): {
  nodes: Node<BaseNodeData>[];
  edges: Edge[];
  metadata: WorkflowMetadata;
  components?: Record<string, InlineComponent>;
} {
  const upgraded = upgradeWorkflow(workflow);

  return {
    nodes: upgraded.nodes.map((node) => {
      const deserialized: Node<BaseNodeData> = {
        id: node.id,
        type: node.type,
        position: node.position,
        data: node.data as BaseNodeData,
      };
      // Restore loop container properties
      if (node.parentId) {
        deserialized.parentId = node.parentId;
      }
      if (node.extent === 'parent') {
        deserialized.extent = 'parent';
      }
      if (node.style) {
        deserialized.style = node.style;
      }
      return deserialized;
    }),
    edges: upgraded.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
    })),
    metadata: upgraded.metadata,
    components: upgraded.components,
  };
}

/**
 * Export workflow to JSON string
 */
export function exportToJSON(
  nodes: Node<BaseNodeData>[],
  edges: Edge[],
  metadata?: Partial<WorkflowMetadata>,
  components?: Record<string, InlineComponent>
): string {
  const workflow = serializeWorkflow(nodes, edges, metadata, components);
  return JSON.stringify(workflow, null, 2);
}

/**
 * Export workflow to YAML string
 */
export function exportToYAML(
  nodes: Node<BaseNodeData>[],
  edges: Edge[],
  metadata?: Partial<WorkflowMetadata>,
  components?: Record<string, InlineComponent>
): string {
  const workflow = serializeWorkflow(nodes, edges, metadata, components);
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
  components?: Record<string, InlineComponent>;
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
  components?: Record<string, InlineComponent>;
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
  components?: Record<string, InlineComponent>;
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
