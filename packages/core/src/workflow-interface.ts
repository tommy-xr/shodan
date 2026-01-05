/**
 * Workflow Interface Derivation
 *
 * Utilities for deriving component interfaces from workflows.
 * Used when nesting workflows as components - inputs come from triggers,
 * outputs come from interface-output nodes or leaf nodes.
 */

import type { WorkflowSchema, WorkflowNode, WorkflowEdge } from './workflow-types.js';
import type { PortDefinition } from './io-types.js';

/**
 * Derive component inputs from workflow triggers.
 *
 * Collects output ports from all manual trigger nodes and unions them.
 * If multiple triggers have the same output name, first occurrence wins.
 */
export function deriveWorkflowInputs(workflow: WorkflowSchema): PortDefinition[] {
  const inputs: PortDefinition[] = [];
  const seen = new Set<string>();

  // Find all manual trigger nodes
  const triggers = workflow.nodes.filter(
    (n) => n.data.nodeType === 'trigger' &&
           (n.data.triggerType === 'manual' || !n.data.triggerType) // default is manual
  );

  for (const trigger of triggers) {
    const outputs = (trigger.data.outputs as PortDefinition[]) || [];
    for (const output of outputs) {
      if (!seen.has(output.name)) {
        inputs.push({
          name: output.name,
          type: output.type,
          required: output.required,
          description: output.description,
        });
        seen.add(output.name);
      }
    }
  }

  return inputs;
}

/**
 * Derive component outputs from workflow.
 *
 * Priority:
 * 1. If workflow has interface-output nodes, use their inputs as outputs
 * 2. Otherwise, find leaf nodes (no outgoing edges) and use their outputs
 */
export function deriveWorkflowOutputs(
  workflow: WorkflowSchema
): PortDefinition[] {
  // Check for interface-output nodes first
  const interfaceOutputNodes = workflow.nodes.filter(
    (n) => n.data.nodeType === 'interface-output'
  );

  if (interfaceOutputNodes.length > 0) {
    // Use interface-output node inputs as component outputs
    const outputs: PortDefinition[] = [];
    const seen = new Set<string>();

    for (const node of interfaceOutputNodes) {
      const inputs = (node.data.inputs as PortDefinition[]) || [];
      for (const input of inputs) {
        if (!seen.has(input.name)) {
          outputs.push({
            name: input.name,
            type: input.type,
            description: input.description,
          });
          seen.add(input.name);
        }
      }
    }

    return outputs;
  }

  // Fall back to leaf nodes (nodes with no outgoing edges)
  const sourceNodes = new Set(workflow.edges.map((e) => e.source));
  const leafNodes = workflow.nodes.filter(
    (n) => !sourceNodes.has(n.id) && n.data.nodeType !== 'trigger'
  );

  const outputs: PortDefinition[] = [];
  const seen = new Set<string>();

  for (const node of leafNodes) {
    const nodeOutputs = (node.data.outputs as PortDefinition[]) || [];
    for (const output of nodeOutputs) {
      // Prefix with node label to avoid collisions
      const label = (node.data.label as string) || node.id;
      const prefixedName = leafNodes.length > 1 ? `${label}_${output.name}` : output.name;

      if (!seen.has(prefixedName)) {
        outputs.push({
          name: prefixedName,
          type: output.type,
          description: output.description || `Output from ${label}`,
        });
        seen.add(prefixedName);
      }
    }
  }

  return outputs;
}

/**
 * Check if a workflow can be nested as a component.
 *
 * Requirements:
 * - Has at least one manual trigger node
 * - No cron or idle triggers (they don't make sense as component inputs)
 */
export function isNestableWorkflow(workflow: WorkflowSchema): boolean {
  const triggers = workflow.nodes.filter((n) => n.data.nodeType === 'trigger');

  if (triggers.length === 0) {
    return false;
  }

  // Check that all triggers are manual (or default, which is manual)
  const hasNonManualTrigger = triggers.some(
    (t) => t.data.triggerType && t.data.triggerType !== 'manual'
  );

  return !hasNonManualTrigger;
}

/**
 * Derive the full component interface from a workflow.
 */
export function deriveWorkflowInterface(workflow: WorkflowSchema): {
  inputs: PortDefinition[];
  outputs: PortDefinition[];
  isNestable: boolean;
} {
  return {
    inputs: deriveWorkflowInputs(workflow),
    outputs: deriveWorkflowOutputs(workflow),
    isNestable: isNestableWorkflow(workflow),
  };
}
