/**
 * ChatApp - Main ink component for chat command
 *
 * Renders workflow execution progress with streaming output.
 * When multiple nodes run in parallel, shows compact view with Ctrl+N hotkeys to expand.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { executeWorkflowSchema, type WorkflowSchema } from '@robomesh/server';
import type { NodeResult, WorkflowNode } from '@robomesh/core';

// Check if we're in an interactive terminal
const isInteractive = process.stdin.isTTY === true;

export interface ExecutionResult {
  success: boolean;
  duration: number;
  nodeCount: number;
  results: NodeResult[];
  error?: string;
}

interface Props {
  schema: WorkflowSchema;
  userInput: string;
  dangerouslySkipPermissions?: boolean;
  onComplete?: (result: ExecutionResult) => void;
}

interface RunningNode {
  id: string;
  label: string;
  type: string;
  inputs: Record<string, unknown>;
  output: string[];
  status: 'running' | 'completed' | 'failed';
}

type Phase = 'running' | 'completed' | 'failed';

export function ChatApp({ schema, userInput, dangerouslySkipPermissions, onComplete }: Props) {
  const { exit } = useApp();
  const [phase, setPhase] = useState<Phase>('running');
  const [nodes, setNodes] = useState<Map<string, RunningNode>>(new Map());
  const [executionOrder, setExecutionOrder] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [duration, setDuration] = useState<number>(0);
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);

  // Get currently running nodes
  const runningNodes = useMemo(() => {
    return Array.from(nodes.values()).filter((n) => n.status === 'running');
  }, [nodes]);

  // Handle keyboard input for node focus switching (only in interactive mode)
  useInput(
    (input, key) => {
      // 1-9 to focus nodes (no modifier needed since user isn't typing during execution)
      if (input >= '1' && input <= '9') {
        const idx = parseInt(input) - 1;
        if (idx < runningNodes.length) {
          setFocusedIndex(focusedIndex === idx ? null : idx);
        }
      }
      // Escape to unfocus
      if (key.escape) {
        setFocusedIndex(null);
      }
    },
    { isActive: isInteractive }
  );

  useEffect(() => {
    const startTime = Date.now();

    executeWorkflowSchema(schema, {
      triggerInputs: { text: userInput },
      dangerouslySkipPermissions,
      onNodeStart: (nodeId: string, node: WorkflowNode) => {
        const label = (node.data.label as string) || nodeId;
        const nodeType = (node.data.nodeType as string) || node.type || 'unknown';

        setNodes((prev) => {
          const next = new Map(prev);
          next.set(nodeId, {
            id: nodeId,
            label,
            type: nodeType,
            inputs: {},
            output: [],
            status: 'running',
          });
          return next;
        });

        setExecutionOrder((prev) => {
          if (!prev.includes(nodeId)) {
            return [...prev, nodeId];
          }
          return prev;
        });
      },
      onNodeOutput: (nodeId: string, chunk: string) => {
        setNodes((prev) => {
          const next = new Map(prev);
          const node = next.get(nodeId);
          if (node) {
            // Split chunk into lines and append
            const lines = chunk.split('\n');
            const newOutput = [...node.output];

            for (let i = 0; i < lines.length; i++) {
              if (i === 0 && newOutput.length > 0) {
                // Append to last line
                newOutput[newOutput.length - 1] += lines[i];
              } else {
                newOutput.push(lines[i]);
              }
            }

            next.set(nodeId, { ...node, output: newOutput });
          }
          return next;
        });
      },
      onNodeComplete: (nodeId: string, result: NodeResult) => {
        setNodes((prev) => {
          const next = new Map(prev);
          const node = next.get(nodeId);
          if (node) {
            // Use result.output if we didn't get streaming output
            let output = node.output;
            if (output.length === 0 && result.output) {
              output = result.output.split('\n');
            }
            next.set(nodeId, {
              ...node,
              inputs: result.inputs || {},
              output,
              status: result.status === 'completed' ? 'completed' : 'failed',
            });
          }
          return next;
        });
        // Clear focus when focused node completes
        setFocusedIndex(null);
      },
    })
      .then((result) => {
        const elapsed = Date.now() - startTime;
        setDuration(elapsed);
        if (result.success) {
          setPhase('completed');
          onComplete?.({
            success: true,
            duration: elapsed,
            nodeCount: result.results.length,
            results: result.results,
          });
        } else {
          setPhase('failed');
          setError(result.error || 'Workflow failed');
          onComplete?.({
            success: false,
            duration: elapsed,
            nodeCount: result.results.length,
            results: result.results,
            error: result.error || 'Workflow failed',
          });
        }
        // Exit after a brief delay to ensure final render
        setTimeout(() => exit(), 100);
      })
      .catch((err) => {
        const elapsed = Date.now() - startTime;
        setDuration(elapsed);
        setPhase('failed');
        const errorMessage = (err as Error).message;
        setError(errorMessage);
        onComplete?.({
          success: false,
          duration: elapsed,
          nodeCount: 0,
          results: [],
          error: errorMessage,
        });
        setTimeout(() => exit(), 100);
      });
  }, [schema, userInput, exit, onComplete]);

  // Determine if we should show compact parallel view
  const showCompactParallel = runningNodes.length > 1 && focusedIndex === null;

  return (
    <Box flexDirection="column" paddingTop={1}>
      {/* Completed nodes always show in full */}
      {executionOrder.map((nodeId) => {
        const node = nodes.get(nodeId);
        if (!node) return null;

        // Skip running nodes when showing compact view OR focused view
        // (FocusedView handles rendering running nodes when focused)
        if (node.status === 'running' && runningNodes.length > 1) {
          return null;
        }

        return <NodeBox key={nodeId} node={node} />;
      })}

      {/* Compact parallel view */}
      {showCompactParallel && (
        <CompactParallelView nodes={runningNodes} />
      )}

      {/* Focused node with other running nodes in status bar */}
      {runningNodes.length > 1 && focusedIndex !== null && (
        <FocusedView
          focusedNode={runningNodes[focusedIndex]}
          otherNodes={runningNodes.filter((_, i) => i !== focusedIndex)}
          focusedIndex={focusedIndex}
        />
      )}

      {/* Summary */}
      {phase !== 'running' && (
        <Box marginTop={1}>
          {phase === 'completed' ? (
            <Text color="green" bold>
              ✓ Workflow completed
            </Text>
          ) : (
            <Text color="red" bold>
              ✗ Workflow failed
            </Text>
          )}
          <Text dimColor> ({(duration / 1000).toFixed(2)}s)</Text>
        </Box>
      )}

      {/* Error message */}
      {error && (
        <Box marginTop={1}>
          <Text color="red">{error}</Text>
        </Box>
      )}
    </Box>
  );
}

interface NodeBoxProps {
  node: RunningNode;
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') {
    // Truncate long strings to single line
    const clean = value.replace(/\n/g, ' ').trim();
    return clean.length > 50 ? clean.slice(0, 47) + '...' : clean;
  }
  if (value === null || value === undefined) return '';
  return String(value);
}

function NodeBox({ node }: NodeBoxProps) {
  const statusIcon =
    node.status === 'running' ? '●' : node.status === 'completed' ? '✓' : '✗';

  const statusColor =
    node.status === 'running' ? 'yellow' : node.status === 'completed' ? 'green' : 'red';

  // Format inputs for display
  const inputEntries = Object.entries(node.inputs).filter(([_, v]) => v !== undefined && v !== '');

  return (
    <Box flexDirection="column" marginBottom={1}>
      {/* Header */}
      <Text>
        <Text color={statusColor}>{statusIcon} </Text>
        <Text bold>{node.label}</Text>
        <Text dimColor> ({node.type})</Text>
      </Text>

      {/* Inputs */}
      {inputEntries.length > 0 && (
        <Box paddingLeft={2}>
          <Text dimColor>
            ⎿ {inputEntries.map(([k, v]) => `${k}: ${formatValue(v)}`).join(', ')}
          </Text>
        </Box>
      )}

      {/* Output lines */}
      {node.output.length > 0 && (
        <Box flexDirection="column" paddingLeft={2}>
          {node.output.slice(-20).map((line, i) => (
            <Text key={i}>{line}</Text>
          ))}
        </Box>
      )}
    </Box>
  );
}

interface CompactParallelViewProps {
  nodes: RunningNode[];
}

function CompactParallelView({ nodes }: CompactParallelViewProps) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text dimColor>Running {nodes.length} nodes in parallel:</Text>

      {nodes.map((node, index) => {
        // Get preview - last 40 chars of combined output
        const allOutput = node.output.join(' ').trim();
        const preview = allOutput.length > 40
          ? '...' + allOutput.slice(-37)
          : allOutput;

        return (
          <Box key={node.id} paddingLeft={2}>
            <Text>
              {isInteractive && <Text color="cyan">[{index + 1}] </Text>}
              <Text color="yellow">● </Text>
              <Text>{node.label}</Text>
              {preview && <Text dimColor> - {preview}</Text>}
            </Text>
          </Box>
        );
      })}

      {isInteractive && (
        <Box paddingLeft={2}>
          <Text dimColor>Press 1-{nodes.length} to expand</Text>
        </Box>
      )}
    </Box>
  );
}

interface FocusedViewProps {
  focusedNode: RunningNode | undefined;
  otherNodes: RunningNode[];
  focusedIndex: number;
}

function FocusedView({ focusedNode, otherNodes, focusedIndex }: FocusedViewProps) {
  if (!focusedNode) return null;

  return (
    <Box flexDirection="column" marginBottom={1}>
      {/* Focused node full output */}
      <NodeBox node={focusedNode} />

      {/* Status bar with other running nodes */}
      <Box paddingLeft={2}>
        <Text dimColor>Also running: </Text>
        {otherNodes.map((node, i) => {
          const actualIndex = i < focusedIndex ? i : i + 1;
          return (
            <Text key={node.id}>
              <Text color="cyan">[{actualIndex + 1}]</Text>
              <Text> {node.label} </Text>
              <Text color="yellow">●  </Text>
            </Text>
          );
        })}
      </Box>
      <Box paddingLeft={2}>
        <Text dimColor>Press 1-9 to switch, Esc to collapse</Text>
      </Box>
    </Box>
  );
}
