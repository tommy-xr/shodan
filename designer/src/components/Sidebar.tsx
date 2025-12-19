import { useState } from 'react';
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

interface PaletteItem {
  type: NodeType;
  label: string;
  icon: string;
}

const paletteItems: PaletteItem[] = [
  { type: 'agent', label: 'Agent', icon: '🤖' },
  { type: 'shell', label: 'Shell', icon: '⌘' },
  { type: 'trigger', label: 'Trigger', icon: '⚡' },
  { type: 'workdir', label: 'Working Dir', icon: '📁' },
];

interface SidebarProps {
  nodes: Node<BaseNodeData>[];
  edges: Edge[];
  workflowName: string;
  rootDirectory: string;
  onImport: (nodes: Node<BaseNodeData>[], edges: Edge[], name: string, rootDir?: string) => void;
  onWorkflowNameChange: (name: string) => void;
  onRootDirectoryChange: (dir: string) => void;
}

export function Sidebar({
  nodes,
  edges,
  workflowName,
  rootDirectory,
  onImport,
  onWorkflowNameChange,
  onRootDirectoryChange,
}: SidebarProps) {
  const [exportFormat, setExportFormat] = useState<'yaml' | 'json'>('yaml');
  const [error, setError] = useState<string | null>(null);

  const onDragStart = (event: DragEvent, nodeType: NodeType) => {
    event.dataTransfer.setData('application/reactflow', nodeType);
    event.dataTransfer.effectAllowed = 'move';
  };

  const handleExport = () => {
    setError(null);
    try {
      const metadata = { name: workflowName, rootDirectory };
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
        <h2>Workflow</h2>
        <div className="workflow-field">
          <label>Name</label>
          <input
            type="text"
            value={workflowName}
            onChange={(e) => onWorkflowNameChange(e.target.value)}
            placeholder="Workflow name..."
          />
        </div>
        <div className="workflow-field">
          <label>Root Directory</label>
          <input
            type="text"
            value={rootDirectory}
            onChange={(e) => onRootDirectoryChange(e.target.value)}
            placeholder="e.g., /path/to/project"
            className="monospace"
          />
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
    </aside>
  );
}
