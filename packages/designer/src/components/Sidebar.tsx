import { useState, useEffect } from 'react';
import type { DragEvent } from 'react';
import type { NodeType } from '../nodes';
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

export function Sidebar() {
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

  return (
    <aside className="sidebar">
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

      {showCreateDialog && (
        <CreateComponentDialog
          onClose={() => setShowCreateDialog(false)}
          onCreate={handleCreateComponent}
        />
      )}
    </aside>
  );
}
