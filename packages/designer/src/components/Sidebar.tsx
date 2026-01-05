import { useState, useEffect } from 'react';
import type { DragEvent } from 'react';
import type { ValueType } from '@robomesh/core';
import type { NodeType } from '../nodes';
import { listComponents, createComponent, type ComponentInfo } from '../lib/api';
import { CreateComponentDialog, type NewComponentData } from './CreateComponentDialog';

interface PaletteItem {
  type: NodeType;
  label: string;
  icon: string;
  preset?: string;  // Optional preset name for pre-configured nodes
}

const paletteItems: PaletteItem[] = [
  { type: 'agent', label: 'Agent', icon: '🤖' },
  { type: 'shell', label: 'Shell', icon: '⌘' },
  { type: 'trigger', label: 'Trigger', icon: '⚡' },
  { type: 'workdir', label: 'Working Dir', icon: '📁' },
  { type: 'loop', label: 'Loop', icon: '🔁' },
];

const logicItems: PaletteItem[] = [
  { type: 'constant', label: 'Constant', icon: '◆' },
  { type: 'function', label: 'Function', icon: 'ƒ' },
  // Pre-configured logic operators
  { type: 'function', label: 'NOT', icon: '¬', preset: 'not' },
  { type: 'function', label: 'AND', icon: '∧', preset: 'and' },
  { type: 'function', label: 'OR', icon: '∨', preset: 'or' },
  // String operators
  { type: 'function', label: 'CONCAT', icon: '+', preset: 'concat' },
];

const layoutItems: PaletteItem[] = [
  { type: 'wire', label: 'Wire', icon: '□' },
];

/**
 * Operator presets - pre-configured function nodes for common logic operations
 */
export interface OperatorPreset {
  label: string;
  code: string;
  inputs: Array<{ name: string; type: ValueType; array?: boolean }>;
  outputs: Array<{ name: string; type: ValueType }>;
}

export const operatorPresets: Record<string, OperatorPreset> = {
  not: {
    label: 'NOT',
    code: 'return { result: !inputs.value }',
    inputs: [{ name: 'value', type: 'boolean' }],
    outputs: [{ name: 'result', type: 'boolean' }],
  },
  and: {
    label: 'AND',
    code: 'return { result: inputs.values.every(Boolean) }',
    inputs: [{ name: 'values', type: 'boolean', array: true }],
    outputs: [{ name: 'result', type: 'boolean' }],
  },
  or: {
    label: 'OR',
    code: 'return { result: inputs.values.some(Boolean) }',
    inputs: [{ name: 'values', type: 'boolean', array: true }],
    outputs: [{ name: 'result', type: 'boolean' }],
  },
  concat: {
    label: 'CONCAT',
    code: 'return { result: inputs.values.join(inputs.separator || "") }',
    inputs: [
      { name: 'values', type: 'string', array: true },
      { name: 'separator', type: 'string' },
    ],
    outputs: [{ name: 'result', type: 'string' }],
  },
};

interface AccordionSectionProps {
  title: string;
  isOpen: boolean;
  onToggle: () => void;
  count?: number;
  action?: React.ReactNode;
  children: React.ReactNode;
}

function AccordionSection({ title, isOpen, onToggle, count, action, children }: AccordionSectionProps) {
  return (
    <div className={`accordion-section ${isOpen ? 'open' : ''}`}>
      <button className="accordion-header" onClick={onToggle}>
        <span className="accordion-arrow">{isOpen ? '▾' : '▸'}</span>
        <span className="accordion-title">{title}</span>
        {count !== undefined && <span className="accordion-count">{count}</span>}
        {action && (
          <span className="accordion-action" onClick={(e) => e.stopPropagation()}>
            {action}
          </span>
        )}
      </button>
      <div className="accordion-content">
        {isOpen && children}
      </div>
    </div>
  );
}

export function Sidebar() {
  const [components, setComponents] = useState<ComponentInfo[]>([]);
  const [componentsError, setComponentsError] = useState<string | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  // Accordion state - all open by default
  const [openSections, setOpenSections] = useState({
    nodes: true,
    logic: true,
    layout: true,
    components: true,
  });

  const toggleSection = (section: keyof typeof openSections) => {
    setOpenSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

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

  const onDragStart = (event: DragEvent, nodeType: NodeType, preset?: string) => {
    event.dataTransfer.setData('application/reactflow', nodeType);
    if (preset) {
      event.dataTransfer.setData('application/preset', preset);
    }
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
      <AccordionSection
        title="Nodes"
        isOpen={openSections.nodes}
        onToggle={() => toggleSection('nodes')}
        count={paletteItems.length}
      >
        <div className="palette-items">
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
      </AccordionSection>

      <AccordionSection
        title="Logic"
        isOpen={openSections.logic}
        onToggle={() => toggleSection('logic')}
        count={logicItems.length}
      >
        <div className="palette-items">
          {logicItems.map((item) => (
            <div
              key={item.preset || item.type}
              className="palette-item"
              draggable
              onDragStart={(e) => onDragStart(e, item.type, item.preset)}
            >
              <div className={`palette-icon ${item.type}`}>{item.icon}</div>
              <span className="palette-label">{item.label}</span>
            </div>
          ))}
        </div>
      </AccordionSection>

      <AccordionSection
        title="Layout"
        isOpen={openSections.layout}
        onToggle={() => toggleSection('layout')}
        count={layoutItems.length}
      >
        <div className="palette-items">
          {layoutItems.map((item) => (
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
      </AccordionSection>

      <AccordionSection
        title="Components"
        isOpen={openSections.components}
        onToggle={() => toggleSection('components')}
        count={components.length}
        action={
          <button
            className="accordion-add-btn"
            onClick={() => setShowCreateDialog(true)}
            title="New Component"
          >
            +
          </button>
        }
      >
        <div className="palette-items">
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
      </AccordionSection>

      {showCreateDialog && (
        <CreateComponentDialog
          onClose={() => setShowCreateDialog(false)}
          onCreate={handleCreateComponent}
        />
      )}
    </aside>
  );
}
