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
import { loadFromLocalStorage, saveToLocalStorage, clearLocalStorage } from './lib/storage';
import './App.css';

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

  // Auto-save to localStorage on changes (debounced)
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      saveToLocalStorage(nodes, edges, workflowName, rootDirectory, getViewport());
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [nodes, edges, workflowName, rootDirectory, getViewport]);

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) => addEdge(connection, eds));
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

      const newNode: Node<BaseNodeData> = {
        id: getNodeId(),
        type,
        position,
        data: {
          label: `New ${type.charAt(0).toUpperCase() + type.slice(1)}`,
          nodeType: type,
        },
      };

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
    (importedNodes: Node<BaseNodeData>[], importedEdges: Edge[], name: string, rootDir?: string) => {
      updateNodeIdCounter(importedNodes);
      setNodes(importedNodes);
      setEdges(importedEdges);
      setWorkflowName(name);
      setRootDirectory(rootDir || '');
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

  return (
    <div className="app">
      <Sidebar
        nodes={nodes}
        edges={edges}
        workflowName={workflowName}
        rootDirectory={rootDirectory}
        onImport={onImport}
        onNewWorkflow={onNewWorkflow}
        onWorkflowNameChange={setWorkflowName}
        onRootDirectoryChange={setRootDirectory}
      />
      <div className="canvas-container" ref={reactFlowWrapper}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onDragOver={onDragOver}
          onDrop={onDrop}
          onNodeClick={onNodeClick}
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
