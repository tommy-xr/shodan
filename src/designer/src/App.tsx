import { useCallback, useState, useRef, useEffect } from 'react';
import type { DragEvent } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  addEdge,
  useNodesState,
  useEdgesState,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react';
import type { Connection, Node, Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { nodeTypes } from './nodes';
import type { BaseNodeData, NodeType } from './nodes';
import { Sidebar } from './components/Sidebar';
import { ConfigPanel } from './components/ConfigPanel';
import { Breadcrumb } from './components/Breadcrumb';
import { loadFromLocalStorage, saveToLocalStorage, clearLocalStorage } from './lib/storage';
import { executeWorkflow, getConfig, getComponentWorkflow } from './lib/api';
import type { ExecutionStatus } from './nodes';
import './App.css';

// Navigation stack item for component drill-down
interface NavigationItem {
  name: string;
  path?: string;  // undefined for root workflow
  nodes: Node<BaseNodeData>[];
  edges: Edge[];
  viewport?: { x: number; y: number; zoom: number };
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

function Flow() {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [selectedNode, setSelectedNode] = useState<Node<BaseNodeData> | null>(null);
  const [workflowName, setWorkflowName] = useState(stored?.workflowName || 'Untitled Workflow');
  const [rootDirectory, setRootDirectory] = useState(stored?.rootDirectory || '');
  const [isExecuting, setIsExecuting] = useState(false);
  const [navigationStack, setNavigationStack] = useState<NavigationItem[]>([]);
  const { screenToFlowPosition, fitView, getViewport, setViewport } = useReactFlow();

  // Initialize node ID counter and restore viewport from loaded state
  useEffect(() => {
    if (initialNodes.length > 0) {
      updateNodeIdCounter(initialNodes);
    }
    if (stored?.viewport) {
      setViewport(stored.viewport);
    }
  }, [setViewport]);

  // Fetch project root from server and set as default if not already set or if relative
  useEffect(() => {
    const needsProjectRoot = !rootDirectory || rootDirectory === '.' || !rootDirectory.startsWith('/');
    if (needsProjectRoot) {
      getConfig()
        .then((config) => {
          if (config.projectRoot) {
            setRootDirectory(config.projectRoot);
          }
        })
        .catch((err) => {
          console.warn('Failed to fetch project config:', err);
        });
    }
  }, []);

  // Auto-save to localStorage on changes (debounced)
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      saveToLocalStorage(nodes, edges, workflowName, rootDirectory, getViewport());
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [nodes, edges, workflowName, rootDirectory, getViewport]);

  const onConnect = useCallback(
    (connection: Connection) => {
      // Validate connection: only one edge per input port
      if (connection.targetHandle) {
        setEdges((eds) => {
          // Check if there's already an edge connected to this input
          const existingEdge = eds.find(
            (edge) =>
              edge.target === connection.target &&
              edge.targetHandle === connection.targetHandle
          );

          if (existingEdge) {
            // Remove the existing edge and add the new one
            return addEdge(connection, eds.filter((e) => e.id !== existingEdge.id));
          }

          return addEdge(connection, eds);
        });
      } else {
        setEdges((eds) => addEdge(connection, eds));
      }
    },
    [setEdges]
  );

  const onDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();

      const type = event.dataTransfer.getData('application/reactflow') as NodeType;
      if (!type) return;

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      // Check if this is a component being dropped
      const componentDataStr = event.dataTransfer.getData('application/component');

      let newNode: Node<BaseNodeData>;

      if (type === 'component' && componentDataStr) {
        // Parse component data and create a component node with its interface
        const componentData = JSON.parse(componentDataStr);
        newNode = {
          id: getNodeId(),
          type,
          position,
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
        };
      } else {
        newNode = {
          id: getNodeId(),
          type,
          position,
          data: {
            label: `New ${type.charAt(0).toUpperCase() + type.slice(1)}`,
            nodeType: type,
          },
        };
      }

      setNodes((nds) => [...nds, newNode]);
    },
    [screenToFlowPosition, setNodes]
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
    (index: number) => {
      if (index >= navigationStack.length - 1) return;

      const targetItem = navigationStack[index];

      // Restore state
      updateNodeIdCounter(targetItem.nodes);
      setNodes(targetItem.nodes);
      setEdges(targetItem.edges);
      setWorkflowName(targetItem.name);
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

    // Set all nodes to pending
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

    try {
      // Prepare request
      const request = {
        nodes: nodes.map((n) => ({
          id: n.id,
          type: n.type || 'agent',
          data: n.data,
        })),
        edges: edges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: e.sourceHandle,
          targetHandle: e.targetHandle,
        })),
        rootDirectory: rootDirectory || undefined,
      };

      const response = await executeWorkflow(request);

      // Update node statuses based on results
      for (const result of response.results) {
        const status: ExecutionStatus =
          result.status === 'pending' ? 'pending' :
          result.status === 'running' ? 'running' :
          result.status === 'completed' ? 'completed' : 'failed';

        updateNodeStatus(
          result.nodeId,
          status,
          result.output,
          result.error
        );
      }
    } catch (err) {
      console.error('Execution failed:', err);
      // Mark all pending nodes as failed
      setNodes((nds) =>
        nds.map((node) => ({
          ...node,
          data: {
            ...node.data,
            executionStatus:
              node.data.executionStatus === 'pending' ? 'failed' : node.data.executionStatus,
            executionError:
              node.data.executionStatus === 'pending'
                ? (err instanceof Error ? err.message : 'Execution failed')
                : node.data.executionError,
          },
        }))
      );
    } finally {
      setIsExecuting(false);
    }
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
  }, [setNodes]);

  return (
    <div className="app">
      <Sidebar
        nodes={nodes}
        edges={edges}
        workflowName={workflowName}
        isExecuting={isExecuting}
        onImport={onImport}
        onNewWorkflow={onNewWorkflow}
        onWorkflowNameChange={setWorkflowName}
        onExecute={onExecute}
        onResetExecution={onResetExecution}
      />
      <div className="canvas-container" ref={reactFlowWrapper}>
        <Breadcrumb items={breadcrumbItems} onNavigate={onNavigateBreadcrumb} />
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onDragOver={onDragOver}
          onDrop={onDrop}
          onNodeClick={onNodeClick}
          onNodeDoubleClick={onNodeDoubleClick}
          onPaneClick={onPaneClick}
          onMoveEnd={onMoveEnd}
          nodeTypes={nodeTypes}
          fitView={!stored?.viewport}
          deleteKeyCode={['Backspace', 'Delete']}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#2d1b4e" gap={24} />
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
  );
}

export default function App() {
  return (
    <ReactFlowProvider>
      <Flow />
    </ReactFlowProvider>
  );
}
