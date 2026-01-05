import { useCallback, useState, useRef, useEffect, useMemo } from 'react';
import type { DragEvent } from 'react';
import { useParams } from 'react-router-dom';
import {
  ReactFlow,
  Controls,
  addEdge,
  applyEdgeChanges,
  useNodesState,
  useEdgesState,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react';
import type { Connection, Node, Edge, EdgeChange } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { getNodePortDefaults, type PortDefinition } from '@robomesh/core';

import { nodeTypes } from './nodes';
import type { BaseNodeData, NodeType } from './nodes';
import { edgeTypes } from './edges';
import type { AnimatedEdgeData } from './edges';
import { Sidebar, operatorPresets } from './components/Sidebar';
import { ConfigPanel } from './components/ConfigPanel';
import { Header } from './components/Header';
import { loadFromLocalStorage, saveToLocalStorage, clearLocalStorage } from './lib/storage';
import { getConfig, getComponentWorkflow, saveComponentWorkflow, saveWorkflow } from './lib/api';
import { executeWorkflowStream } from './lib/execute-stream';
import type { ComponentWorkflow } from './lib/api';
import type { ExecutionStatus } from './nodes';
import './App.css';

// Strip execution state from node data before saving to file
// Execution state is runtime-only and should not be persisted in workflow YAML
const stripExecutionState = (data: Record<string, unknown>): Record<string, unknown> => {
  const { executionStatus, executionOutput, executionError, ...cleanData } = data;
  return cleanData;
};

// Navigation stack item for component drill-down
interface NavigationItem {
  name: string;
  path?: string;  // undefined for root workflow
  nodes: Node<BaseNodeData>[];
  edges: Edge[];
  viewport?: { x: number; y: number; zoom: number };
  interface?: ComponentWorkflow['interface'];  // Component interface for saving
}

// Load initial state from localStorage
const stored = loadFromLocalStorage();
const initialNodes: Node<BaseNodeData>[] = stored?.nodes || [];
const initialEdges: Edge[] = stored?.edges || [];

let nodeId = 0;
const getNodeId = () => `node_${nodeId++}`;

// Reset node ID counter based on existing nodes
const updateNodeIdCounter = (nodes: Node[]) => {
  const maxId = nodes.reduce((max, node) => {
    const match = node.id.match(/^node_(\d+)$/);
    if (match) {
      return Math.max(max, parseInt(match[1], 10));
    }
    return max;
  }, -1);
  nodeId = maxId + 1;
};

/**
 * Expand array inputs into individual slots.
 * An input with array: true becomes values[0], and more slots are added as needed.
 */
function expandArrayInputs(inputs: PortDefinition[]): PortDefinition[] {
  const expanded: PortDefinition[] = [];
  for (const input of inputs) {
    if (input.array) {
      // Create the first slot for the array input
      expanded.push({
        ...input,
        name: `${input.name}[0]`,
        label: `${input.label || input.name}[0]`,
        arrayParent: input.name,
        arrayIndex: 0,
        array: undefined, // Remove array flag from expanded slot
      });
    } else {
      expanded.push(input);
    }
  }
  return expanded;
}

/**
 * Check if a node needs a new array slot added after a connection.
 * Returns the updated inputs array if a new slot was added, or null if no change needed.
 */
function maybeAddArraySlot(
  nodeInputs: PortDefinition[],
  connectedHandle: string,
  allEdges: Edge[],
  nodeId: string
): PortDefinition[] | null {
  // Parse the handle to find the array parent and index
  // Handle format: "input:values[0]"
  const match = connectedHandle.match(/^input:(.+)\[(\d+)\]$/);
  if (!match) return null;

  const arrayParent = match[1];
  const connectedIndex = parseInt(match[2], 10);

  // Find all slots for this array parent
  const arraySlots = nodeInputs.filter(inp => inp.arrayParent === arrayParent);
  if (arraySlots.length === 0) return null;

  // Find the highest index
  const maxIndex = Math.max(...arraySlots.map(s => s.arrayIndex ?? 0));

  // Check if the connected slot is the last one
  if (connectedIndex !== maxIndex) return null;

  // Check if this slot is now connected (it should be, since we just connected it)
  const slotHandle = `input:${arrayParent}[${connectedIndex}]`;
  const isConnected = allEdges.some(
    e => e.target === nodeId && e.targetHandle === slotHandle
  );
  if (!isConnected) return null;

  // Find the template for this array (first slot has the type info)
  const firstSlot = arraySlots.find(s => s.arrayIndex === 0);
  if (!firstSlot) return null;

  // Add a new slot
  const newIndex = maxIndex + 1;
  const newSlot: PortDefinition = {
    name: `${arrayParent}[${newIndex}]`,
    label: `${arrayParent}[${newIndex}]`,
    type: firstSlot.type,
    arrayParent,
    arrayIndex: newIndex,
  };

  // Insert the new slot after the last array slot
  const lastSlotIndex = nodeInputs.findIndex(
    inp => inp.arrayParent === arrayParent && inp.arrayIndex === maxIndex
  );
  const newInputs = [...nodeInputs];
  newInputs.splice(lastSlotIndex + 1, 0, newSlot);

  return newInputs;
}

/**
 * Clean up empty trailing array slots after edge disconnection.
 * Keeps at least one slot so users can still connect.
 */
interface CleanupResult {
  inputs: PortDefinition[];
  edgeRemaps: Map<string, string>; // old handleId -> new handleId
}

function cleanupArraySlots(
  nodeInputs: PortDefinition[],
  edges: Edge[],
  nodeId: string
): CleanupResult | null {
  // Group inputs by array parent
  const arrayGroups = new Map<string, PortDefinition[]>();
  const nonArrayInputs: PortDefinition[] = [];

  for (const input of nodeInputs) {
    if (input.arrayParent !== undefined) {
      const group = arrayGroups.get(input.arrayParent) || [];
      group.push(input);
      arrayGroups.set(input.arrayParent, group);
    } else {
      nonArrayInputs.push(input);
    }
  }

  if (arrayGroups.size === 0) return null;

  let changed = false;
  const cleanedInputs: PortDefinition[] = [...nonArrayInputs];
  const edgeRemaps = new Map<string, string>();

  for (const [parentName, slots] of arrayGroups) {
    // Sort by index
    slots.sort((a, b) => (a.arrayIndex ?? 0) - (b.arrayIndex ?? 0));

    // Find which slots are connected
    const connectedSlots: PortDefinition[] = [];

    for (const slot of slots) {
      const handleId = `input:${slot.name}`;
      const isConnected = edges.some(
        e => e.target === nodeId && e.targetHandle === handleId
      );
      if (isConnected) {
        connectedSlots.push(slot);
      }
    }

    // Renumber connected slots to be contiguous starting from 0
    const renumberedSlots: PortDefinition[] = [];
    for (let i = 0; i < connectedSlots.length; i++) {
      const oldSlot = connectedSlots[i];
      const oldName = oldSlot.name;
      const newName = `${parentName}[${i}]`;

      // Track if we need to remap this edge
      if (oldName !== newName) {
        edgeRemaps.set(`input:${oldName}`, `input:${newName}`);
        changed = true;
      }

      renumberedSlots.push({
        ...oldSlot,
        name: newName,
        label: newName,
        arrayIndex: i,
      });
    }

    // Add one empty slot at the end
    const nextEmptyIndex = connectedSlots.length;
    const template = slots[0];
    renumberedSlots.push({
      name: `${parentName}[${nextEmptyIndex}]`,
      label: `${parentName}[${nextEmptyIndex}]`,
      type: template.type,
      arrayParent: parentName,
      arrayIndex: nextEmptyIndex,
    });

    // Check if the total number of slots changed
    if (renumberedSlots.length !== slots.length) {
      changed = true;
    }

    cleanedInputs.push(...renumberedSlots);
  }

  return changed ? { inputs: cleanedInputs, edgeRemaps } : null;
}

function Flow() {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges] = useEdgesState(initialEdges);
  const [selectedNode, setSelectedNode] = useState<Node<BaseNodeData> | null>(null);
  const [workflowName, setWorkflowName] = useState(stored?.workflowName || 'Untitled Workflow');
  const [rootDirectory, setRootDirectory] = useState(stored?.rootDirectory || '');
  const [isExecuting, setIsExecuting] = useState(false);
  const [edgeExecutionData, setEdgeExecutionData] = useState<Map<string, { count: number; animating: boolean }>>(new Map());
  const [navigationStack, setNavigationStack] = useState<NavigationItem[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [dragOverLoopId, setDragOverLoopId] = useState<string | null>(null);
  const [urlWorkflowLoaded, setUrlWorkflowLoaded] = useState(false);
  const [currentWorkspace, setCurrentWorkspace] = useState<string | null>(null);
  const [currentWorkflowPath, setCurrentWorkflowPath] = useState<string | null>(null);
  const [lastSaveTime, setLastSaveTime] = useState<number>(0);
  const [yoloMode, setYoloMode] = useState(false);
  const { screenToFlowPosition, fitView, getViewport, setViewport } = useReactFlow();

  // Get URL params for workspace/workflow routing
  const { workspace, '*': rawWorkflowPath } = useParams();
  // Decode the workflow path since it was URL-encoded in the dashboard
  const workflowPath = rawWorkflowPath ? decodeURIComponent(rawWorkflowPath) : undefined;

  // Load workflow from URL params (when navigating from dashboard)
  useEffect(() => {
    if (!workspace || !workflowPath || urlWorkflowLoaded) return;

    const loadWorkflowFromUrl = async () => {
      try {
        const res = await fetch(
          `/api/workflows/detail?workspace=${encodeURIComponent(workspace)}&path=${encodeURIComponent(workflowPath)}`
        );
        if (!res.ok) {
          console.error('Failed to load workflow from URL');
          return;
        }

        const data = await res.json();
        const schema = data.schema;

        // Convert workflow nodes to ReactFlow nodes
        const importedNodes: Node<BaseNodeData>[] = schema.nodes.map((n: { id: string; type: string; position: { x: number; y: number }; data: Record<string, unknown>; parentId?: string; extent?: string; style?: { width?: number; height?: number } }) => ({
          id: n.id,
          type: n.type,
          position: n.position,
          parentId: n.parentId,
          extent: n.extent === 'parent' ? 'parent' as const : undefined,
          style: n.style,
          data: {
            ...n.data,
            nodeType: n.type as NodeType,
          } as BaseNodeData,
        }));

        // Convert edges
        const importedEdges: Edge[] = schema.edges.map((e: { id: string; source: string; target: string; sourceHandle?: string; targetHandle?: string }) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: e.sourceHandle,
          targetHandle: e.targetHandle,
        }));

        // Update state
        updateNodeIdCounter(importedNodes);
        setNodes(importedNodes);
        setEdges(importedEdges);
        setWorkflowName(data.name || schema.metadata?.name || 'Untitled Workflow');
        setRootDirectory(data.workspacePath || '');
        setSelectedNode(null);
        setEdgeExecutionData(new Map());
        setUrlWorkflowLoaded(true);

        // Track file-based workflow for autosave
        setCurrentWorkspace(workspace);
        setCurrentWorkflowPath(workflowPath);
        setLastSaveTime(Date.now()); // Mark as just loaded to prevent immediate "unsaved"
        setHasUnsavedChanges(false);

        // Fit view after loading
        setTimeout(() => fitView({ padding: 0.2 }), 50);
      } catch (err) {
        console.error('Failed to load workflow from URL:', err);
      }
    };

    loadWorkflowFromUrl();
  }, [workspace, workflowPath, urlWorkflowLoaded, setNodes, setEdges, fitView]);

  // Helper: Find the loop container that contains a given position (in flow coordinates)
  const findContainingLoop = useCallback((position: { x: number; y: number }, excludeNodeId?: string): Node<BaseNodeData> | null => {
    const loopNodes = nodes.filter(
      n => n.data.nodeType === 'loop' && n.id !== excludeNodeId
    );

    for (const loop of loopNodes) {
      const loopWidth = (loop.style?.width as number) || 500;
      const loopHeight = (loop.style?.height as number) || 350;
      const dockHeight = 70; // Leave space for dock at bottom

      // Check if position is inside loop bounds (above dock area)
      if (
        position.x >= loop.position.x &&
        position.x <= loop.position.x + loopWidth &&
        position.y >= loop.position.y &&
        position.y <= loop.position.y + loopHeight - dockHeight
      ) {
        return loop;
      }
    }
    return null;
  }, [nodes]);

  // Check if currently editing a component (not at root level)
  const isEditingComponent = navigationStack.length > 1;
  const currentComponentPath = isEditingComponent
    ? navigationStack[navigationStack.length - 1].path
    : undefined;

  // Initialize node ID counter and restore viewport from loaded state
  useEffect(() => {
    if (initialNodes.length > 0) {
      updateNodeIdCounter(initialNodes);
    }
    if (stored?.viewport) {
      setViewport(stored.viewport);
    }
  }, [setViewport]);

  // Fetch server config (project root and yolo mode)
  useEffect(() => {
    getConfig()
      .then((config) => {
        // Set yolo mode from server config
        setYoloMode(config.dangerouslySkipPermissions || false);
        // Set project root if not already set or if relative
        const needsProjectRoot = !rootDirectory || rootDirectory === '.' || !rootDirectory.startsWith('/');
        if (needsProjectRoot && config.projectRoot) {
          setRootDirectory(config.projectRoot);
        }
      })
      .catch((err) => {
        console.warn('Failed to fetch project config:', err);
      });
  }, []);

  // Auto-save to localStorage on changes (debounced)
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      saveToLocalStorage(nodes, edges, workflowName, rootDirectory, getViewport());
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [nodes, edges, workflowName, rootDirectory, getViewport]);

  // Track unsaved changes for file-based workflows
  useEffect(() => {
    // Skip if not a file-based workflow or just loaded
    if (!currentWorkspace || !currentWorkflowPath) return;
    if (Date.now() - lastSaveTime < 500) return; // Just loaded or just saved
    // Skip during execution - execution state changes shouldn't mark as unsaved
    if (isExecuting) return;

    setHasUnsavedChanges(true);
  }, [nodes, edges, workflowName, rootDirectory, currentWorkspace, currentWorkflowPath, lastSaveTime, isExecuting]);

  // Auto-save to file for file-based workflows (debounced, less frequent)
  useEffect(() => {
    // Skip if not a file-based workflow or no nodes yet
    if (!currentWorkspace || !currentWorkflowPath || nodes.length === 0) return;
    // Skip if no unsaved changes
    if (!hasUnsavedChanges) return;
    // Skip during execution - don't save while running
    if (isExecuting) return;

    // Debounce file saves (2 seconds)
    const timeoutId = setTimeout(async () => {
      setIsSaving(true);
      try {
        const schema = {
          version: 1,
          metadata: {
            name: workflowName,
            description: '',
            rootDirectory: rootDirectory || undefined,
          },
          nodes: nodes.map((n) => ({
            id: n.id,
            type: n.type || 'agent',
            position: n.position,
            data: stripExecutionState(n.data as Record<string, unknown>),
            parentId: n.parentId,
            extent: n.extent === 'parent' ? ('parent' as const) : undefined,
            style: n.style as { width?: number; height?: number },
          })),
          edges: edges.map((e) => ({
            id: e.id,
            source: e.source,
            target: e.target,
            sourceHandle: e.sourceHandle ?? undefined,
            targetHandle: e.targetHandle ?? undefined,
          })),
        };

        await saveWorkflow({
          workspace: currentWorkspace,
          path: currentWorkflowPath,
          schema,
        });
        setLastSaveTime(Date.now());
        setHasUnsavedChanges(false);
      } catch (err) {
        console.error('Failed to autosave workflow:', err);
      } finally {
        setIsSaving(false);
      }
    }, 2000);

    return () => clearTimeout(timeoutId);
  }, [nodes, edges, workflowName, rootDirectory, currentWorkspace, currentWorkflowPath, hasUnsavedChanges, isExecuting]);

  const onConnect = useCallback(
    (connection: Connection) => {
      // Validate connection: only one edge per input port (unless it's an array port)
      if (connection.targetHandle) {
        setEdges((eds) => {
          // Check if there's already an edge connected to this input
          const existingEdge = eds.find(
            (edge) =>
              edge.target === connection.target &&
              edge.targetHandle === connection.targetHandle
          );

          let newEdges: Edge[];
          if (existingEdge) {
            // Remove the existing edge and add the new one
            newEdges = addEdge(connection, eds.filter((e) => e.id !== existingEdge.id));
          } else {
            newEdges = addEdge(connection, eds);
          }

          // Check if we need to add a new array slot
          if (connection.target && connection.targetHandle) {
            const targetNode = nodes.find(n => n.id === connection.target);
            if (targetNode?.data.inputs) {
              const updatedInputs = maybeAddArraySlot(
                targetNode.data.inputs as PortDefinition[],
                connection.targetHandle,
                newEdges,
                connection.target
              );
              if (updatedInputs) {
                // Update the node with new inputs
                setNodes(nds => nds.map(n => {
                  if (n.id === connection.target) {
                    return {
                      ...n,
                      data: {
                        ...n.data,
                        inputs: updatedInputs,
                      },
                    };
                  }
                  return n;
                }));
              }
            }
          }

          return newEdges;
        });
      } else {
        setEdges((eds) => addEdge(connection, eds));
      }
    },
    [setEdges, setNodes, nodes]
  );

  // Custom edge change handler that cleans up array slots after edge removal
  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      // Apply the changes first
      const newEdges = applyEdgeChanges(changes, edges);
      setEdges(newEdges);

      // Check if any edges were removed
      const removedEdges = changes.filter(c => c.type === 'remove');
      if (removedEdges.length === 0) return;

      // For each removed edge, check if we need to clean up array slots
      const affectedNodeIds = new Set<string>();
      for (const change of removedEdges) {
        if (change.type === 'remove') {
          // Find the original edge to get the target node
          const originalEdge = edges.find(e => e.id === change.id);
          if (originalEdge?.target) {
            affectedNodeIds.add(originalEdge.target);
          }
        }
      }

      // Clean up array slots for affected nodes and collect edge remappings
      if (affectedNodeIds.size > 0) {
        // Collect all edge remappings across affected nodes
        const allEdgeRemaps = new Map<string, { nodeId: string; newHandle: string }>();
        const nodeUpdates = new Map<string, PortDefinition[]>();

        setNodes(nds => {
          for (const node of nds) {
            if (!affectedNodeIds.has(node.id)) continue;
            if (!node.data.inputs) continue;

            const result = cleanupArraySlots(
              node.data.inputs as PortDefinition[],
              newEdges,
              node.id
            );

            if (result) {
              nodeUpdates.set(node.id, result.inputs);
              for (const [oldHandle, newHandle] of result.edgeRemaps) {
                allEdgeRemaps.set(`${node.id}:${oldHandle}`, { nodeId: node.id, newHandle });
              }
            }
          }

          return nds.map(node => {
            const newInputs = nodeUpdates.get(node.id);
            if (newInputs) {
              return {
                ...node,
                data: {
                  ...node.data,
                  inputs: newInputs,
                },
              };
            }
            return node;
          });
        });

        // Apply edge remappings if any
        if (allEdgeRemaps.size > 0) {
          setEdges(eds => eds.map(edge => {
            const key = `${edge.target}:${edge.targetHandle}`;
            const remap = allEdgeRemaps.get(key);
            if (remap) {
              return { ...edge, targetHandle: remap.newHandle };
            }
            return edge;
          }));
        }
      }
    },
    [edges, setEdges, setNodes]
  );

  const onDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';

    // Check if dragging over a loop container for visual feedback
    const position = screenToFlowPosition({
      x: event.clientX,
      y: event.clientY,
    });
    const hoverLoop = findContainingLoop(position);
    setDragOverLoopId(hoverLoop?.id || null);
  }, [screenToFlowPosition, findContainingLoop]);

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      setDragOverLoopId(null); // Clear drag hover state

      const type = event.dataTransfer.getData('application/reactflow') as NodeType;
      if (!type) return;

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      // Check if this is a component being dropped
      const componentDataStr = event.dataTransfer.getData('application/component');
      // Check if this is a preset (e.g., NOT, AND, OR operators)
      const presetName = event.dataTransfer.getData('application/preset');

      // Check if drop is inside a loop container (not for loops themselves)
      const targetLoop = type !== 'loop' ? findContainingLoop(position) : null;

      // Calculate final position (relative if inside loop, absolute otherwise)
      let finalPosition = position;
      let parentId: string | undefined;
      let extent: 'parent' | undefined;

      if (targetLoop) {
        parentId = targetLoop.id;
        extent = 'parent';
        finalPosition = {
          x: position.x - targetLoop.position.x,
          y: position.y - targetLoop.position.y,
        };
        // Ensure node stays within bounds (above dock)
        const loopHeight = (targetLoop.style?.height as number) || 350;
        const dockHeight = 70;
        const maxY = loopHeight - dockHeight - 100;
        finalPosition.y = Math.min(Math.max(finalPosition.y, 40), maxY);
        finalPosition.x = Math.max(finalPosition.x, 10);
      }

      let newNodes: Node<BaseNodeData>[] = [];

      if (type === 'component' && componentDataStr) {
        // Parse component data and create a component node with its interface
        const componentData = JSON.parse(componentDataStr);
        newNodes = [{
          id: getNodeId(),
          type,
          position: finalPosition,
          parentId,
          extent,
          data: {
            label: componentData.name,
            nodeType: type,
            workflowPath: componentData.path,
            // Map component interface to node I/O
            inputs: componentData.inputs?.map((input: { name: string; type: string; required?: boolean; description?: string }) => ({
              name: input.name,
              type: input.type || 'any',
              required: input.required,
              description: input.description,
            })) || [],
            outputs: componentData.outputs?.map((output: { name: string; type: string; description?: string }) => ({
              name: output.name,
              type: output.type || 'any',
              description: output.description,
            })) || [],
          },
        }];
      } else if (type === 'loop') {
        // Create loop container with dock slots (no interface nodes needed)
        const loopWidth = 500;
        const loopHeight = 350;

        // Loop container node with default dock slots
        const loopNode: Node<BaseNodeData> = {
          id: getNodeId(),
          type: 'loop',
          position,
          style: { width: loopWidth, height: loopHeight },
          data: {
            label: 'New Loop',
            nodeType: 'loop',
            maxIterations: 10,
            // External I/O ports (so loop can be wired to other nodes)
            inputs: [
              { name: 'input', type: 'any', description: 'Trigger input to start the loop' },
            ],
            outputs: [
              { name: 'output', type: 'any', description: 'Final output after loop completes' },
            ],
            // Default dock slots for iteration control
            dockSlots: [
              { name: 'iteration', type: 'iteration', valueType: 'number', label: 'Iteration' },
              { name: 'continue', type: 'continue', valueType: 'boolean', label: 'Continue' },
              { name: 'feedback', type: 'feedback', valueType: 'string', label: 'Feedback' },
            ],
          },
        };

        newNodes = [loopNode];
      } else if (type === 'constant') {
        // Initialize constant nodes with default type and value
        newNodes = [{
          id: getNodeId(),
          type,
          position: finalPosition,
          parentId,
          extent,
          data: {
            label: 'Constant',
            nodeType: type,
            valueType: 'string',
            value: '',
            outputs: [{ name: 'value', type: 'string' }],
          },
        }];
      } else if (type === 'function' && presetName && operatorPresets[presetName]) {
        // Pre-configured function node (logic operators)
        const preset = operatorPresets[presetName];
        // Expand any array inputs into individual slots
        const expandedInputs = expandArrayInputs(preset.inputs as PortDefinition[]);
        newNodes = [{
          id: getNodeId(),
          type: 'function',
          position: finalPosition,
          parentId,
          extent,
          data: {
            label: preset.label,
            nodeType: 'function',
            code: preset.code,
            inputs: expandedInputs,
            outputs: preset.outputs,
          },
        }];
      } else {
        // Get default ports for this node type (if any)
        const portDefaults = getNodePortDefaults(type);

        newNodes = [{
          id: getNodeId(),
          type,
          position: finalPosition,
          parentId,
          extent,
          data: {
            label: `New ${type.charAt(0).toUpperCase() + type.slice(1)}`,
            nodeType: type,
            // Apply default inputs/outputs from node-defaults if available
            ...(portDefaults && {
              inputs: portDefaults.inputs,
              outputs: portDefaults.outputs,
            }),
          },
        }];
      }

      setNodes((nds) => [...nds, ...newNodes]);
    },
    [screenToFlowPosition, setNodes, findContainingLoop]
  );

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      setSelectedNode(node as Node<BaseNodeData>);
    },
    []
  );

  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
  }, []);

  // Handle node drag stop - detect if node moved into/out of a loop
  const onNodeDragStop = useCallback(
    (_event: React.MouseEvent, node: Node<BaseNodeData>) => {
      // Don't process loop nodes themselves
      if (node.data.nodeType === 'loop') return;

      // Get the node's absolute position (for nodes with parentId, we need to calculate it)
      let absolutePosition = { ...node.position };
      if (node.parentId) {
        const parentNode = nodes.find(n => n.id === node.parentId);
        if (parentNode) {
          absolutePosition = {
            x: parentNode.position.x + node.position.x,
            y: parentNode.position.y + node.position.y,
          };
        }
      }

      // Find if the node is now inside a loop container
      const targetLoop = findContainingLoop(absolutePosition, node.id);

      // Check current parent
      const currentParentId = node.parentId;

      // Case 1: Node moved INTO a loop (wasn't in one, now is)
      if (targetLoop && currentParentId !== targetLoop.id) {
        setNodes(nds =>
          nds.map(n => {
            if (n.id === node.id) {
              // Convert to relative position
              const relativePosition = {
                x: absolutePosition.x - targetLoop.position.x,
                y: absolutePosition.y - targetLoop.position.y,
              };

              // Ensure node stays within bounds (above dock)
              const loopHeight = (targetLoop.style?.height as number) || 350;
              const dockHeight = 70;
              const maxY = loopHeight - dockHeight - 100; // 100px buffer for node height
              relativePosition.y = Math.min(Math.max(relativePosition.y, 40), maxY); // 40px for header
              relativePosition.x = Math.max(relativePosition.x, 10);

              return {
                ...n,
                position: relativePosition,
                parentId: targetLoop.id,
                extent: 'parent' as const,
              };
            }
            return n;
          })
        );
      }
      // Case 2: Node moved OUT of a loop (was in one, now isn't)
      else if (!targetLoop && currentParentId) {
        setNodes(nds =>
          nds.map(n => {
            if (n.id === node.id) {
              // Convert to absolute position (already calculated above)
              const { parentId, extent, ...rest } = n;
              return {
                ...rest,
                position: absolutePosition,
              };
            }
            return n;
          })
        );
      }
      // Case 3: Node moved from one loop to another
      else if (targetLoop && currentParentId && currentParentId !== targetLoop.id) {
        setNodes(nds =>
          nds.map(n => {
            if (n.id === node.id) {
              // Convert to relative position for new parent
              const relativePosition = {
                x: absolutePosition.x - targetLoop.position.x,
                y: absolutePosition.y - targetLoop.position.y,
              };

              // Ensure node stays within bounds
              const loopHeight = (targetLoop.style?.height as number) || 350;
              const dockHeight = 70;
              const maxY = loopHeight - dockHeight - 100;
              relativePosition.y = Math.min(Math.max(relativePosition.y, 40), maxY);
              relativePosition.x = Math.max(relativePosition.x, 10);

              return {
                ...n,
                position: relativePosition,
                parentId: targetLoop.id,
                extent: 'parent' as const,
              };
            }
            return n;
          })
        );
      }
    },
    [nodes, findContainingLoop, setNodes]
  );

  // Double-click on a component node to drill into it
  const onNodeDoubleClick = useCallback(
    async (_: React.MouseEvent, node: Node<BaseNodeData>) => {
      // Only drill into component nodes
      if (node.data.nodeType !== 'component' || !node.data.workflowPath) {
        return;
      }

      try {
        // Load component workflow
        const workflow = await getComponentWorkflow(node.data.workflowPath);

        // Convert workflow nodes to ReactFlow nodes
        const componentNodes: Node<BaseNodeData>[] = workflow.nodes.map((n) => ({
          id: n.id,
          type: n.type,
          position: n.position,
          data: {
            ...n.data,
            nodeType: n.type as NodeType,
          } as BaseNodeData,
        }));

        // Convert edges
        const componentEdges: Edge[] = workflow.edges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: e.sourceHandle,
          targetHandle: e.targetHandle,
        }));

        // Build new navigation stack
        let newStack: NavigationItem[];

        if (navigationStack.length === 0) {
          // First drill-down from root - push root workflow and new component
          newStack = [
            {
              name: workflowName,
              nodes: nodes,
              edges: edges,
              viewport: getViewport(),
            },
            {
              name: workflow.name,
              path: node.data.workflowPath,
              nodes: componentNodes,
              edges: componentEdges,
              interface: workflow.interface,
            },
          ];
        } else {
          // Subsequent drill-down - update current item's viewport and add new component
          const updatedStack = navigationStack.map((item, index) =>
            index === navigationStack.length - 1
              ? { ...item, nodes, edges, viewport: getViewport() }
              : item
          );
          newStack = [
            ...updatedStack,
            {
              name: workflow.name,
              path: node.data.workflowPath,
              nodes: componentNodes,
              edges: componentEdges,
              interface: workflow.interface,
            },
          ];
        }

        setNavigationStack(newStack);

        // Update canvas
        updateNodeIdCounter(componentNodes);
        setNodes(componentNodes);
        setEdges(componentEdges);
        setWorkflowName(workflow.name);
        setSelectedNode(null);

        // Fit view after loading
        setTimeout(() => fitView({ padding: 0.2 }), 50);
      } catch (err) {
        console.error('Failed to load component:', err);
      }
    },
    [nodes, edges, workflowName, navigationStack, getViewport, setNodes, setEdges, fitView]
  );

  // Navigate back to a specific level in the stack
  const onNavigateBreadcrumb = useCallback(
    async (index: number) => {
      if (index >= navigationStack.length - 1) return;

      const targetItem = navigationStack[index];

      // If navigating to a component (has path), reload from YAML for fresh handles
      if (targetItem.path) {
        try {
          const workflow = await getComponentWorkflow(targetItem.path);
          const componentNodes: Node<BaseNodeData>[] = workflow.nodes.map((n) => ({
            id: n.id,
            type: n.type,
            position: n.position,
            data: {
              ...n.data,
              nodeType: n.type as NodeType,
            } as BaseNodeData,
          }));
          const componentEdges: Edge[] = workflow.edges.map((e) => ({
            id: e.id,
            source: e.source,
            target: e.target,
            sourceHandle: e.sourceHandle,
            targetHandle: e.targetHandle,
          }));

          updateNodeIdCounter(componentNodes);
          setNodes(componentNodes);
          setEdges(componentEdges);
          setWorkflowName(workflow.name);
        } catch (err) {
          console.error('Failed to reload component:', err);
          // Fall back to cached state
          updateNodeIdCounter(targetItem.nodes);
          setNodes(targetItem.nodes);
          setEdges(targetItem.edges);
          setWorkflowName(targetItem.name);
        }
      } else {
        // Root workflow - use cached state
        updateNodeIdCounter(targetItem.nodes);
        setNodes(targetItem.nodes);
        setEdges(targetItem.edges);
        setWorkflowName(targetItem.name);
      }

      setSelectedNode(null);

      // Restore viewport
      if (targetItem.viewport) {
        setViewport(targetItem.viewport);
      } else {
        setTimeout(() => fitView({ padding: 0.2 }), 50);
      }

      // Trim navigation stack
      setNavigationStack(navigationStack.slice(0, index + 1));
    },
    [navigationStack, setNodes, setEdges, setViewport, fitView]
  );

  // Get breadcrumb items from navigation stack
  const breadcrumbItems = navigationStack.length > 0
    ? navigationStack.map((item) => ({ name: item.name, path: item.path }))
    : [{ name: workflowName }];

  // Track changes when editing a component
  useEffect(() => {
    if (isEditingComponent) {
      setHasUnsavedChanges(true);
    }
  }, [nodes, edges, isEditingComponent]);

  // Reset unsaved changes when navigating
  useEffect(() => {
    setHasUnsavedChanges(false);
  }, [navigationStack.length]);

  // Save component workflow
  const onSaveComponent = useCallback(async () => {
    if (!isEditingComponent || !currentComponentPath || isSaving) return;

    const currentItem = navigationStack[navigationStack.length - 1];
    if (!currentItem.path) return;

    setIsSaving(true);
    try {
      // Build nodes for saving (convert ReactFlow format to workflow format)
      const workflowNodes = nodes.map((n) => ({
        id: n.id,
        type: n.type || 'agent',
        position: n.position,
        data: stripExecutionState(n.data as Record<string, unknown>),
      }));

      // Build edges for saving (convert null to undefined for type compatibility)
      const workflowEdges = edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle ?? undefined,
        targetHandle: e.targetHandle ?? undefined,
      }));

      // Reconstruct interface from interface-input/output nodes
      const interfaceInputNode = nodes.find((n) => n.data.nodeType === 'interface-input');
      const interfaceOutputNode = nodes.find((n) => n.data.nodeType === 'interface-output');

      const componentInterface = {
        inputs: (interfaceInputNode?.data.outputs as Array<{name: string; type: string; required?: boolean; description?: string}>) || [],
        outputs: (interfaceOutputNode?.data.inputs as Array<{name: string; type: string; description?: string}>) || [],
      };

      await saveComponentWorkflow({
        path: currentItem.path,
        nodes: workflowNodes,
        edges: workflowEdges,
        metadata: {
          name: workflowName,
        },
        interface: componentInterface,
      });

      // Update the navigation stack with the new interface
      // Also update parent workflows' component nodes that reference this component
      setNavigationStack((stack) =>
        stack.map((item, index) => {
          if (index === stack.length - 1) {
            // Current item - update interface
            return { ...item, interface: componentInterface };
          } else if (currentItem.path) {
            // Parent workflows - update component nodes that reference this component
            const updatedNodes = item.nodes.map((node) => {
              if (
                node.data.nodeType === 'component' &&
                node.data.workflowPath === currentItem.path
              ) {
                // Update this component node's interface
                return {
                  ...node,
                  data: {
                    ...node.data,
                    label: workflowName,
                    inputs: componentInterface.inputs,
                    outputs: componentInterface.outputs,
                  },
                };
              }
              return node;
            });
            return { ...item, nodes: updatedNodes as Node<BaseNodeData>[] };
          }
          return item;
        })
      );

      setHasUnsavedChanges(false);
      console.log('Component saved successfully');
    } catch (err) {
      console.error('Failed to save component:', err);
    } finally {
      setIsSaving(false);
    }
  }, [isEditingComponent, currentComponentPath, isSaving, navigationStack, nodes, edges, workflowName]);

  const onMoveEnd = useCallback(() => {
    // Save viewport when user finishes panning/zooming
    saveToLocalStorage(nodes, edges, workflowName, rootDirectory, getViewport());
  }, [nodes, edges, workflowName, rootDirectory, getViewport]);

  const onUpdateNode = useCallback(
    (nodeId: string, data: Partial<BaseNodeData>) => {
      setNodes((nds) =>
        nds.map((node) => {
          if (node.id === nodeId) {
            const updatedNode = {
              ...node,
              data: { ...node.data, ...data },
            };
            setSelectedNode(updatedNode as Node<BaseNodeData>);
            return updatedNode;
          }
          return node;
        })
      );
    },
    [setNodes]
  );

  const onImport = useCallback(
    (importedNodes: Node<BaseNodeData>[], importedEdges: Edge[], name: string, _rootDir?: string) => {
      updateNodeIdCounter(importedNodes);
      setNodes(importedNodes);
      setEdges(importedEdges);
      setWorkflowName(name);
      // Always fetch project root from server on import
      // This ensures we use the discovered root, not any stale/relative value
      getConfig()
        .then((config) => setRootDirectory(config.projectRoot))
        .catch(() => {});
      setSelectedNode(null);
      // Clear edge execution data from previous workflow
      setEdgeExecutionData(new Map());
      // Fit view after import with a small delay to let React render
      setTimeout(() => fitView({ padding: 0.2 }), 50);
    },
    [setNodes, setEdges, fitView]
  );

  const onNewWorkflow = useCallback(() => {
    if (nodes.length > 0 && !confirm('Start a new workflow? Current changes will be lost.')) {
      return;
    }
    clearLocalStorage();
    setNodes([]);
    setEdges([]);
    setWorkflowName('Untitled Workflow');
    setRootDirectory('');
    setSelectedNode(null);
    setEdgeExecutionData(new Map());
    setCurrentWorkspace(null);
    setCurrentWorkflowPath(null);
    nodeId = 0;
  }, [nodes.length, setNodes, setEdges]);

  const updateNodeStatus = useCallback(
    (nodeId: string, status: ExecutionStatus, output?: string, error?: string) => {
      setNodes((nds) =>
        nds.map((node) =>
          node.id === nodeId
            ? {
                ...node,
                data: {
                  ...node.data,
                  executionStatus: status,
                  executionOutput: output,
                  executionError: error,
                },
              }
            : node
        )
      );
    },
    [setNodes]
  );

  const onExecute = useCallback(async () => {
    if (isExecuting || nodes.length === 0) return;

    setIsExecuting(true);

    // Set all nodes to pending and reset edge counts
    setNodes((nds) =>
      nds.map((node) => ({
        ...node,
        data: {
          ...node.data,
          executionStatus: 'pending' as ExecutionStatus,
          executionOutput: undefined,
          executionError: undefined,
        },
      }))
    );
    setEdgeExecutionData(new Map());

    // Prepare request
    const request = {
      nodes: nodes.map((n) => ({
        id: n.id,
        type: n.type || 'agent',
        position: n.position,
        data: n.data as Record<string, unknown>,
        // Include loop container properties
        parentId: n.parentId,
        extent: n.extent === 'parent' ? ('parent' as const) : undefined,
        style: n.style as { width?: number; height?: number },
      })),
      edges: edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle,
      })),
      rootDirectory: rootDirectory || undefined,
      // Include workspace/path for run history
      workspace: currentWorkspace || undefined,
      workflowPath: currentWorkflowPath || undefined,
    };

    // Use streaming execution for real-time updates
    executeWorkflowStream(request, {
      onNodeStart: (nodeId) => {
        setNodes((nds) =>
          nds.map((node) =>
            node.id === nodeId
              ? { ...node, data: { ...node.data, executionStatus: 'running' as ExecutionStatus } }
              : node
          )
        );
      },
      onNodeComplete: (nodeId, result) => {
        const status: ExecutionStatus =
          result.status === 'completed' ? 'completed' : 'failed';
        updateNodeStatus(nodeId, status, result.output, result.error);
      },
      onNodeOutput: (nodeId, chunk) => {
        // Append streaming output to node
        setNodes((nds) =>
          nds.map((node) =>
            node.id === nodeId
              ? {
                  ...node,
                  data: {
                    ...node.data,
                    executionOutput: (node.data.executionOutput || '') + chunk,
                  },
                }
              : node
          )
        );
      },
      onEdgeExecuted: (edgeId) => {
        // Increment edge count and trigger animation
        setEdgeExecutionData((prev) => {
          const next = new Map(prev);
          const current = next.get(edgeId) || { count: 0, animating: false };
          next.set(edgeId, { count: current.count + 1, animating: true });
          return next;
        });

        // Clear animation after duration
        setTimeout(() => {
          setEdgeExecutionData((prev) => {
            const next = new Map(prev);
            const current = next.get(edgeId);
            if (current) {
              next.set(edgeId, { ...current, animating: false });
            }
            return next;
          });
        }, 400);
      },
      onIterationStart: (loopId, iteration) => {
        setNodes((nds) =>
          nds.map((node) =>
            node.id === loopId
              ? {
                  ...node,
                  data: {
                    ...node.data,
                    currentIteration: iteration,
                    iterationStatus: 'running',
                  },
                }
              : node
          )
        );
      },
      onIterationComplete: (loopId, iteration, _success) => {
        setNodes((nds) =>
          nds.map((node) =>
            node.id === loopId
              ? {
                  ...node,
                  data: {
                    ...node.data,
                    currentIteration: iteration,
                  },
                }
              : node
          )
        );
      },
      onComplete: (success, error) => {
        setIsExecuting(false);
        if (!success && error) {
          console.error('Workflow execution failed:', error);
          // Mark remaining pending nodes as failed
          setNodes((nds) =>
            nds.map((node) => ({
              ...node,
              data: {
                ...node.data,
                executionStatus:
                  node.data.executionStatus === 'pending'
                    ? ('failed' as ExecutionStatus)
                    : node.data.executionStatus,
                executionError:
                  node.data.executionStatus === 'pending' ? error : node.data.executionError,
                // Finalize loop states
                iterationStatus:
                  node.data.nodeType === 'loop' && node.data.iterationStatus === 'running'
                    ? 'failed'
                    : node.data.iterationStatus,
              },
            }))
          );
        } else {
          // Finalize loop states on success
          setNodes((nds) =>
            nds.map((node) => ({
              ...node,
              data: {
                ...node.data,
                iterationStatus:
                  node.data.nodeType === 'loop' && node.data.iterationStatus === 'running'
                    ? 'completed'
                    : node.data.iterationStatus,
                finalIteration:
                  node.data.nodeType === 'loop' && node.data.iterationStatus === 'running'
                    ? node.data.currentIteration
                    : node.data.finalIteration,
              },
            }))
          );
        }
      },
    });
  }, [isExecuting, nodes, edges, rootDirectory, setNodes, updateNodeStatus]);

  const onResetExecution = useCallback(() => {
    setNodes((nds) =>
      nds.map((node) => ({
        ...node,
        data: {
          ...node.data,
          executionStatus: 'idle' as ExecutionStatus,
          executionOutput: undefined,
          executionError: undefined,
        },
      }))
    );
    // Reset edge execution data
    setEdgeExecutionData(new Map());
  }, [setNodes]);

  // Compute nodes with drop target state for visual feedback
  const nodesWithDropState = useMemo(() => {
    if (!dragOverLoopId) return nodes;
    return nodes.map(node => {
      if (node.id === dragOverLoopId) {
        return {
          ...node,
          data: {
            ...node.data,
            isDropTarget: true,
          },
        };
      }
      return node;
    });
  }, [nodes, dragOverLoopId]);

  // Add execution data to edges for animation
  const edgesWithData = useMemo(() => {
    return edges.map((edge) => {
      const execData = edgeExecutionData.get(edge.id);
      return {
        ...edge,
        type: 'animated',
        data: {
          executionCount: execData?.count || 0,
          isAnimating: execData?.animating || false,
        } as AnimatedEdgeData,
      };
    });
  }, [edges, edgeExecutionData]);

  return (
    <div className="app">
      <Header
        rootDirectory={rootDirectory}
        workflowName={workflowName}
        breadcrumbItems={breadcrumbItems}
        onNavigateBreadcrumb={onNavigateBreadcrumb}
        isEditingComponent={isEditingComponent}
        onSaveComponent={isEditingComponent ? onSaveComponent : undefined}
        isSaving={isSaving}
        hasUnsavedChanges={hasUnsavedChanges}
        isFileBased={!!currentWorkspace && !!currentWorkflowPath}
        workspaceName={currentWorkspace || undefined}
        workflowPath={currentWorkflowPath || undefined}
        onWorkflowNameChange={setWorkflowName}
        onNewWorkflow={onNewWorkflow}
        nodes={nodes}
        edges={edges}
        isExecuting={isExecuting}
        onExecute={onExecute}
        onResetExecution={onResetExecution}
        yoloMode={yoloMode}
        onImport={onImport}
      />
      <div className="app-body">
        <Sidebar />
        <div className="canvas-container" ref={reactFlowWrapper}>
          <ReactFlow
          nodes={nodesWithDropState}
          edges={edgesWithData}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={handleEdgesChange}
          onConnect={onConnect}
          onDragOver={onDragOver}
          onDrop={onDrop}
          onNodeClick={onNodeClick}
          onNodeDoubleClick={onNodeDoubleClick}
          onNodeDragStop={onNodeDragStop}
          onPaneClick={onPaneClick}
          onMoveEnd={onMoveEnd}
          nodeTypes={nodeTypes}
          defaultEdgeOptions={{ type: 'step' }}
          fitView={!stored?.viewport}
          deleteKeyCode={['Backspace', 'Delete']}
          proOptions={{ hideAttribution: true }}
        >
          {/* Grid rendered via CSS for proper alignment */}
          <Controls />
        </ReactFlow>
        </div>
        <ConfigPanel
          node={selectedNode}
          rootDirectory={rootDirectory}
          onClose={() => setSelectedNode(null)}
          onUpdate={onUpdateNode}
        />
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ReactFlowProvider>
      <Flow />
    </ReactFlowProvider>
  );
}
