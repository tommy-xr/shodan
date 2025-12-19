import type { DragEvent } from 'react';
import type { NodeType } from '../nodes';

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

export function Sidebar() {
  const onDragStart = (event: DragEvent, nodeType: NodeType) => {
    event.dataTransfer.setData('application/reactflow', nodeType);
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h1>Shodan</h1>
        <p>Workflow Designer</p>
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
    </aside>
  );
}
