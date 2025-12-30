import { useState, useEffect } from 'react';
import type { DragEvent } from 'react';
import type { Node, Edge } from '@xyflow/react';
import type { NodeType, BaseNodeData } from '../nodes';
import {
  exportToJSON,
  exportToYAML,
  importWorkflow,
  downloadFile,
  openFilePicker,
} from '../lib/workflow';
import { listComponents, createComponent, type ComponentInfo } from '../lib/api';
import { CreateComponentDialog, type NewComponentData } from './CreateComponentDialog';

interface PaletteItem {
  type: NodeType;
  label: string;
  icon: string;
}

const paletteItems: PaletteItem[] = [
  { type: 'agent', label: 'Agent', icon: '🤖' },
  { type: 'shell', label: 'Shell', icon: '⌘' },
  { type: 'script', label: 'Script', icon: '📜' },
  { type: 'trigger', label: 'Trigger', icon: '⚡' },
  { type: 'workdir', label: 'Working Dir', icon: '📁' },
  { type: 'loop', label: 'Loop', icon: '🔁' },
];

const logicItems: PaletteItem[] = [
  { type: 'constant', label: 'Constant', icon: '◆' },
];

interface SidebarProps {
  nodes: Node<BaseNodeData>[];
  edges: Edge[];
  workflowName: string;
  isExecuting: boolean;
  onImport: (nodes: Node<BaseNodeData>[], edges: Edge[], name: string, rootDir?: string) => void;
  onNewWorkflow: () => void;
  onWorkflowNameChange: (name: string) => void;
  onExecute: () => void;
  onResetExecution: () => void;
}

export function Sidebar({
  nodes,
  edges,
  workflowName,
  isExecuting,
  onImport,
  onNewWorkflow,
  onWorkflowNameChange,
  onExecute,
  onResetExecution,
}: SidebarProps) {
  const [exportFormat, setExportFormat] = useState<'yaml' | 'json'>('yaml');
  const [error, setError] = useState<string | null>(null);
  const [components, setComponents] = useState<ComponentInfo[]>([]);
  const [componentsError, setComponentsError] = useState<string | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  // Load available components
  const loadComponents = () => {
    listComponents()
      .then((response) => {
        setComponents(response.components);
        setComponentsError(null);
      })
      .catch((err) => {
        console.warn('Failed to load components:', err);
        setComponentsError(err.message);
      });
  };

  // Load available components on mount
  useEffect(() => {
    loadComponents();
  }, []);

  const handleCreateComponent = async (data: NewComponentData) => {
    try {
      await createComponent({
        name: data.name,
        description: data.description,
        filename: data.filename,
        inputs: data.inputs,
        outputs: data.outputs,
      });
      setShowCreateDialog(false);
      // Refresh components list
      loadComponents();
    } catch (err) {
      console.error('Failed to create component:', err);
      setComponentsError(err instanceof Error ? err.message : 'Failed to create component');
    }
  };

  const onDragStart = (event: DragEvent, nodeType: NodeType) => {
    event.dataTransfer.setData('application/reactflow', nodeType);
    event.dataTransfer.effectAllowed = 'move';
  };

  const onComponentDragStart = (event: DragEvent, component: ComponentInfo) => {
    // Pass component data as JSON for the drop handler
    event.dataTransfer.setData('application/reactflow', 'component');
    event.dataTransfer.setData('application/component', JSON.stringify(component));
    event.dataTransfer.effectAllowed = 'move';
  };

  const handleExport = () => {
    setError(null);
    try {
      // Don't include rootDirectory - it's determined by project root discovery
      const metadata = { name: workflowName };
      if (exportFormat === 'json') {
        const content = exportToJSON(nodes, edges, metadata);
        downloadFile(content, `${workflowName || 'workflow'}.json`, 'application/json');
      } else {
        const content = exportToYAML(nodes, edges, metadata);
        downloadFile(content, `${workflowName || 'workflow'}.yaml`, 'text/yaml');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    }
  };

  const handleImport = async () => {
    setError(null);
    try {
      const content = await openFilePicker('.json,.yaml,.yml');
      const { nodes: importedNodes, edges: importedEdges, metadata } = importWorkflow(content);
      onImport(importedNodes, importedEdges, metadata.name, metadata.rootDirectory);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    }
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h1>Shodan</h1>
        <p>Workflow Designer</p>
      </div>

      <div className="sidebar-section">
        <div className="section-header">
          <h2>Workflow</h2>
          <button className="new-workflow-btn" onClick={onNewWorkflow} title="New Workflow">
            + New
          </button>
        </div>
        <div className="workflow-field">
          <label>Name</label>
          <input
            type="text"
            value={workflowName}
            onChange={(e) => onWorkflowNameChange(e.target.value)}
            placeholder="Workflow name..."
          />
        </div>
      </div>

      <div className="sidebar-section execution">
        <h2>Execution</h2>
        <div className="execution-buttons">
          <button
            className={`action-btn run ${isExecuting ? 'running' : ''}`}
            onClick={onExecute}
            disabled={isExecuting || nodes.length === 0}
          >
            {isExecuting ? 'Running...' : 'Run Workflow'}
          </button>
          <button
            className="action-btn reset"
            onClick={onResetExecution}
            disabled={isExecuting}
          >
            Reset
          </button>
        </div>
      </div>

      <div className="palette">
        <h2>Nodes</h2>
        {paletteItems.map((item) => (
          <div
            key={item.type}
            className="palette-item"
            draggable
            onDragStart={(e) => onDragStart(e, item.type)}
          >
            <div className={`palette-icon ${item.type}`}>{item.icon}</div>
            <span className="palette-label">{item.label}</span>
          </div>
        ))}
      </div>

      <div className="palette">
        <h2>Logic</h2>
        {logicItems.map((item) => (
          <div
            key={item.type}
            className="palette-item"
            draggable
            onDragStart={(e) => onDragStart(e, item.type)}
          >
            <div className={`palette-icon ${item.type}`}>{item.icon}</div>
            <span className="palette-label">{item.label}</span>
          </div>
        ))}
      </div>

      <div className="palette components-palette">
        <div className="section-header">
          <h2>Components</h2>
          <button className="new-workflow-btn" onClick={() => setShowCreateDialog(true)} title="New Component">
            + New
          </button>
        </div>
        {componentsError && (
          <div className="palette-error">{componentsError}</div>
        )}
        {components.length === 0 && !componentsError && (
          <div className="palette-empty">No components found</div>
        )}
        {components.map((component) => (
          <div
            key={component.path}
            className="palette-item component"
            draggable
            onDragStart={(e) => onComponentDragStart(e, component)}
            title={component.description || component.name}
          >
            <div className="palette-icon component">📦</div>
            <span className="palette-label">{component.name}</span>
          </div>
        ))}
      </div>

      <div className="sidebar-section import-export">
        <h2>Import / Export</h2>

        <div className="format-toggle">
          <button
            className={exportFormat === 'yaml' ? 'active' : ''}
            onClick={() => setExportFormat('yaml')}
          >
            YAML
          </button>
          <button
            className={exportFormat === 'json' ? 'active' : ''}
            onClick={() => setExportFormat('json')}
          >
            JSON
          </button>
        </div>

        <div className="action-buttons">
          <button className="action-btn export" onClick={handleExport}>
            Export
          </button>
          <button className="action-btn import" onClick={handleImport}>
            Import
          </button>
        </div>

        {error && <div className="error-message">{error}</div>}
      </div>

      {showCreateDialog && (
        <CreateComponentDialog
          onClose={() => setShowCreateDialog(false)}
          onCreate={handleCreateComponent}
        />
      )}
    </aside>
  );
}
