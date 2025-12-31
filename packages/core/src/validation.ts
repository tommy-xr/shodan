/**
 * Workflow Validation
 *
 * Validates workflow schemas for consistency and correctness.
 * Used by the CLI to catch schema issues at runtime.
 */

import type { WorkflowSchema, WorkflowNode, WorkflowEdge } from './workflow-types.js';
import type { PortDefinition } from './io-types.js';
import { getNodePortDefaults, getWellKnownOutputs, getWellKnownInputs } from './node-defaults.js';

/**
 * Validation issue severity
 */
export type ValidationSeverity = 'error' | 'warning';

/**
 * A single validation issue
 */
export interface ValidationIssue {
  severity: ValidationSeverity;
  nodeId?: string;
  edgeId?: string;
  message: string;
  suggestion?: string;
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

/**
 * Node types that have dynamic ports (not validated against defaults)
 */
const DYNAMIC_PORT_TYPES = new Set([
  'loop',
  'component',
  'interface-input',
  'interface-output',
  'interface-continue',
  'function',  // User-defined inputs/outputs
  'constant',  // User-defined output type
]);

/**
 * Validate a workflow schema
 */
export function validateWorkflow(workflow: WorkflowSchema): ValidationResult {
  const issues: ValidationIssue[] = [];

  // Build maps for efficient lookup
  const nodeMap = new Map<string, WorkflowNode>();
  const nodeLabelMap = new Map<string, WorkflowNode>();

  for (const node of workflow.nodes) {
    nodeMap.set(node.id, node);
    if (node.data.label) {
      // Normalize label for lookup (lowercase, spaces to underscores)
      const normalizedLabel = node.data.label.toLowerCase().replace(/\s+/g, '_');
      nodeLabelMap.set(normalizedLabel, node);
    }
  }

  // Validate each node
  for (const node of workflow.nodes) {
    const nodeIssues = validateNode(node);
    issues.push(...nodeIssues);
  }

  // Validate edges
  for (const edge of workflow.edges) {
    const edgeIssues = validateEdge(edge, nodeMap, nodeLabelMap);
    issues.push(...edgeIssues);
  }

  // Check for orphan nodes (nodes with no edges)
  const orphanIssues = validateOrphanNodes(workflow.nodes, workflow.edges);
  issues.push(...orphanIssues);

  return {
    valid: issues.filter(i => i.severity === 'error').length === 0,
    issues,
  };
}

/**
 * Node types that don't require edges (entry points)
 */
const ENTRY_POINT_TYPES = new Set(['trigger', 'workdir']);

/**
 * Validate that nodes have at least one edge connection
 * Nodes without any edges are likely errors (disconnected from workflow)
 */
function validateOrphanNodes(nodes: WorkflowNode[], edges: WorkflowEdge[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Build set of nodes that have at least one edge
  const connectedNodes = new Set<string>();
  for (const edge of edges) {
    connectedNodes.add(edge.source);
    connectedNodes.add(edge.target);
  }

  // Check each node
  for (const node of nodes) {
    const nodeType = node.data.nodeType || node.type;

    // Skip entry point types - they only need outgoing edges
    // and that's checked separately
    if (ENTRY_POINT_TYPES.has(nodeType)) {
      // But entry points should still have at least one outgoing edge
      const hasOutgoing = edges.some(e => e.source === node.id);
      if (!hasOutgoing) {
        issues.push({
          severity: 'warning',
          nodeId: node.id,
          message: `${nodeType} node '${node.data.label || node.id}' has no outgoing edges`,
          suggestion: 'Connect this node to at least one other node',
        });
      }
      continue;
    }

    // Skip interface nodes (they have special connection semantics)
    if (nodeType.startsWith('interface-')) {
      continue;
    }

    // Check if node has any edges
    if (!connectedNodes.has(node.id)) {
      issues.push({
        severity: 'warning',
        nodeId: node.id,
        message: `Node '${node.data.label || node.id}' has no edges (disconnected from workflow)`,
        suggestion: 'Connect this node or remove it from the workflow',
      });
    }
  }

  return issues;
}

/**
 * Validate a single node
 */
function validateNode(node: WorkflowNode): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const nodeType = node.data.nodeType || node.type;

  // Skip validation for dynamic port types
  if (DYNAMIC_PORT_TYPES.has(nodeType)) {
    return issues;
  }

  const defaults = getNodePortDefaults(nodeType);
  if (!defaults) {
    // Unknown node type - just warn
    issues.push({
      severity: 'warning',
      nodeId: node.id,
      message: `Unknown node type: ${nodeType}`,
    });
    return issues;
  }

  const definedOutputs = node.data.outputs as PortDefinition[] | undefined;
  const definedInputs = node.data.inputs as PortDefinition[] | undefined;
  const definedOutputNames = new Set(definedOutputs?.map(p => p.name) || []);
  const definedInputNames = new Set(definedInputs?.map(p => p.name) || []);

  // Check that all default output ports are defined
  for (const defaultOutput of defaults.outputs) {
    if (!definedOutputNames.has(defaultOutput.name)) {
      issues.push({
        severity: 'warning',
        nodeId: node.id,
        message: `Missing required output port '${defaultOutput.name}' on ${nodeType} node '${node.data.label || node.id}'`,
        suggestion: `Add output: { name: '${defaultOutput.name}', type: '${defaultOutput.type}' }`,
      });
    }
  }

  // Check that all default input ports are defined
  for (const defaultInput of defaults.inputs) {
    if (!definedInputNames.has(defaultInput.name)) {
      issues.push({
        severity: 'warning',
        nodeId: node.id,
        message: `Missing required input port '${defaultInput.name}' on ${nodeType} node '${node.data.label || node.id}'`,
        suggestion: `Add input: { name: '${defaultInput.name}', type: '${defaultInput.type}' }`,
      });
    }
  }

  // Check that defined output ports have correct types
  if (definedOutputs) {
    const wellKnownOutputNames = getWellKnownOutputs(nodeType);

    for (const output of definedOutputs) {
      if (wellKnownOutputNames.includes(output.name)) {
        // This is a well-known output - validate type matches
        const expectedPort = defaults.outputs.find(p => p.name === output.name);
        if (expectedPort && expectedPort.type !== 'any' && output.type !== expectedPort.type) {
          issues.push({
            severity: 'warning',
            nodeId: node.id,
            message: `Output port '${output.name}' has type '${output.type}' but expected '${expectedPort.type}'`,
            suggestion: `Change type to '${expectedPort.type}'`,
          });
        }
      }
    }
  }

  // Check that defined input ports have correct types
  if (definedInputs) {
    const wellKnownInputNames = getWellKnownInputs(nodeType);

    for (const input of definedInputs) {
      if (wellKnownInputNames.includes(input.name)) {
        // This is a well-known input - validate type matches
        const expectedPort = defaults.inputs.find(p => p.name === input.name);
        if (expectedPort && expectedPort.type !== 'any' && input.type !== expectedPort.type) {
          issues.push({
            severity: 'warning',
            nodeId: node.id,
            message: `Input port '${input.name}' has type '${input.type}' but expected '${expectedPort.type}'`,
            suggestion: `Change type to '${expectedPort.type}'`,
          });
        }
      }
    }
  }

  return issues;
}

/**
 * Parse a handle string to extract port name
 * Handle formats: "output:portName", "input:portName", "dock:name:output", etc.
 */
function parseHandle(handle: string | undefined): { type: string; name: string } | null {
  if (!handle) return null;

  const parts = handle.split(':');
  if (parts.length < 2) return null;

  // Handle dock slots: "dock:name:output" or "dock:name:input"
  if (parts[0] === 'dock') {
    return { type: parts[2] || 'output', name: parts[1] };
  }

  // Standard format: "output:name" or "input:name"
  return { type: parts[0], name: parts[1] };
}

/**
 * Get all defined ports for a node (combining defaults and explicit definitions)
 */
function getNodePorts(node: WorkflowNode): { inputs: string[]; outputs: string[] } {
  const nodeType = node.data.nodeType || node.type;
  const defaults = getNodePortDefaults(nodeType);

  // Start with defaults
  const inputs = new Set<string>(defaults?.inputs.map(p => p.name) || []);
  const outputs = new Set<string>(defaults?.outputs.map(p => p.name) || []);

  // Add explicitly defined ports
  const definedInputs = node.data.inputs as PortDefinition[] | undefined;
  const definedOutputs = node.data.outputs as PortDefinition[] | undefined;

  if (definedInputs) {
    for (const input of definedInputs) {
      inputs.add(input.name);
    }
  }

  if (definedOutputs) {
    for (const output of definedOutputs) {
      outputs.add(output.name);
    }
  }

  // Special handling for trigger nodes - they can also output directly via 'output' handle
  if (nodeType === 'trigger') {
    outputs.add('output');
  }

  // Special handling for nodes that can output via generic 'output' handle
  if (['shell', 'script', 'agent', 'function'].includes(nodeType)) {
    outputs.add('output');
  }

  return {
    inputs: Array.from(inputs),
    outputs: Array.from(outputs),
  };
}

/**
 * Validate a single edge
 */
function validateEdge(
  edge: WorkflowEdge,
  nodeMap: Map<string, WorkflowNode>,
  _nodeLabelMap: Map<string, WorkflowNode>
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Check source node exists
  const sourceNode = nodeMap.get(edge.source);
  if (!sourceNode) {
    issues.push({
      severity: 'error',
      edgeId: edge.id,
      message: `Edge references non-existent source node: ${edge.source}`,
    });
    return issues;
  }

  // Check target node exists
  const targetNode = nodeMap.get(edge.target);
  if (!targetNode) {
    issues.push({
      severity: 'error',
      edgeId: edge.id,
      message: `Edge references non-existent target node: ${edge.target}`,
    });
    return issues;
  }

  const sourceType = sourceNode.data.nodeType || sourceNode.type;
  const targetType = targetNode.data.nodeType || targetNode.type;

  // Skip port validation for dynamic port types
  if (DYNAMIC_PORT_TYPES.has(sourceType) || DYNAMIC_PORT_TYPES.has(targetType)) {
    return issues;
  }

  // Validate source handle (output port)
  if (edge.sourceHandle) {
    const parsed = parseHandle(edge.sourceHandle);
    if (parsed && parsed.type === 'output') {
      const ports = getNodePorts(sourceNode);
      if (!ports.outputs.includes(parsed.name)) {
        issues.push({
          severity: 'warning',
          edgeId: edge.id,
          nodeId: sourceNode.id,
          message: `Edge references undefined output port '${parsed.name}' on node '${sourceNode.data.label || sourceNode.id}'`,
          suggestion: `Available outputs: ${ports.outputs.join(', ') || 'none defined'}`,
        });
      }
    }
  }

  // Validate target handle (input port)
  // Note: Generic 'input' handles are allowed as they enable template interpolation
  // without explicit port definitions (a common pattern in the codebase)
  if (edge.targetHandle) {
    const parsed = parseHandle(edge.targetHandle);
    if (parsed && parsed.type === 'input') {
      // Skip validation for generic 'input' handle - used for simple wiring
      // where template interpolation handles the actual data passing
      if (parsed.name === 'input') {
        // Generic input is always allowed (backwards compatibility)
        return issues;
      }

      const ports = getNodePorts(targetNode);
      if (!ports.inputs.includes(parsed.name)) {
        // Check if it might be a well-known input that wasn't explicitly defined
        const wellKnown = getWellKnownInputs(targetType);
        if (wellKnown.includes(parsed.name)) {
          issues.push({
            severity: 'warning',
            edgeId: edge.id,
            nodeId: targetNode.id,
            message: `Edge uses well-known input '${parsed.name}' on node '${targetNode.data.label || targetNode.id}' but it's not explicitly defined`,
            suggestion: `Add '${parsed.name}' to the node's inputs array`,
          });
        } else {
          issues.push({
            severity: 'warning',
            edgeId: edge.id,
            nodeId: targetNode.id,
            message: `Edge references undefined input port '${parsed.name}' on node '${targetNode.data.label || targetNode.id}'`,
            suggestion: `Available inputs: ${ports.inputs.join(', ') || 'none defined'}`,
          });
        }
      }
    }
  }

  return issues;
}

/**
 * Format validation issues for display
 */
export function formatValidationIssues(issues: ValidationIssue[]): string {
  if (issues.length === 0) return '';

  const lines: string[] = [];

  const errors = issues.filter(i => i.severity === 'error');
  const warnings = issues.filter(i => i.severity === 'warning');

  if (errors.length > 0) {
    lines.push(`Errors (${errors.length}):`);
    for (const issue of errors) {
      const location = issue.nodeId ? ` [node: ${issue.nodeId}]` : issue.edgeId ? ` [edge: ${issue.edgeId}]` : '';
      lines.push(`  - ${issue.message}${location}`);
      if (issue.suggestion) {
        lines.push(`    Suggestion: ${issue.suggestion}`);
      }
    }
  }

  if (warnings.length > 0) {
    if (errors.length > 0) lines.push('');
    lines.push(`Warnings (${warnings.length}):`);
    for (const issue of warnings) {
      const location = issue.nodeId ? ` [node: ${issue.nodeId}]` : issue.edgeId ? ` [edge: ${issue.edgeId}]` : '';
      lines.push(`  - ${issue.message}${location}`);
      if (issue.suggestion) {
        lines.push(`    Suggestion: ${issue.suggestion}`);
      }
    }
  }

  return lines.join('\n');
}
