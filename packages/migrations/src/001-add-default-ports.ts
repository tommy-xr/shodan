/**
 * Migration 001: Add Default Ports
 *
 * This migration adds standard default ports to nodes that are missing them.
 * See README.md for detailed explanation of why this migration is needed.
 */

import type { WorkflowSchema, WorkflowNode } from '@robomesh/core';
import { getNodePortDefaults } from '@robomesh/core';

export const MIGRATION_ID = '001-add-default-ports';
export const MIGRATION_DATE = '2024-12-31';
export const MIGRATION_DESCRIPTION = 'Add standard default ports to nodes missing them';

/**
 * Node types that have dynamic ports (not migrated)
 */
const DYNAMIC_PORT_TYPES = new Set([
  'loop',
  'component',
  'interface-input',
  'interface-output',
  'interface-continue',
]);

/**
 * Migrate a single node to add missing default ports
 */
function migrateNode(node: WorkflowNode): { changed: boolean; node: WorkflowNode } {
  const nodeType = node.data.nodeType || node.type;

  // Skip dynamic port types
  if (DYNAMIC_PORT_TYPES.has(nodeType)) {
    return { changed: false, node };
  }

  const defaults = getNodePortDefaults(nodeType);
  if (!defaults) {
    return { changed: false, node };
  }

  let changed = false;
  const newData = { ...node.data };

  // Get existing ports
  const existingInputs = (node.data.inputs as Array<{ name: string }>) || [];
  const existingOutputs = (node.data.outputs as Array<{ name: string }>) || [];
  const existingInputNames = new Set(existingInputs.map(p => p.name));
  const existingOutputNames = new Set(existingOutputs.map(p => p.name));

  // Add missing input ports
  const newInputs = [...existingInputs];
  for (const defaultInput of defaults.inputs) {
    if (!existingInputNames.has(defaultInput.name)) {
      newInputs.push({ ...defaultInput });
      changed = true;
    }
  }

  // Add missing output ports
  const newOutputs = [...existingOutputs];
  for (const defaultOutput of defaults.outputs) {
    if (!existingOutputNames.has(defaultOutput.name)) {
      newOutputs.push({ ...defaultOutput });
      changed = true;
    }
  }

  if (changed) {
    newData.inputs = newInputs;
    newData.outputs = newOutputs;
  }

  return {
    changed,
    node: changed ? { ...node, data: newData } : node,
  };
}

/**
 * Migrate a workflow schema
 */
export function migrate(workflow: WorkflowSchema): { changed: boolean; workflow: WorkflowSchema } {
  let anyChanged = false;
  const newNodes: WorkflowNode[] = [];

  for (const node of workflow.nodes) {
    const { changed, node: migratedNode } = migrateNode(node);
    if (changed) {
      anyChanged = true;
    }
    newNodes.push(migratedNode);
  }

  if (!anyChanged) {
    return { changed: false, workflow };
  }

  return {
    changed: true,
    workflow: {
      ...workflow,
      nodes: newNodes,
    },
  };
}
