import { useState } from 'react';
import type { PortDefinition, ValueType } from '@shodan/core';
import { JSONSchemaEditor } from './JSONSchemaEditor';

interface PortEditorProps {
  ports: PortDefinition[];
  direction: 'input' | 'output';
  onChange: (ports: PortDefinition[]) => void;
}

const VALUE_TYPES: { value: ValueType; label: string }[] = [
  { value: 'string', label: 'String' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Boolean' },
  { value: 'json', label: 'JSON' },
  { value: 'file', label: 'File' },
  { value: 'files', label: 'Files' },
  { value: 'any', label: 'Any' },
];

export function PortEditor({ ports, direction, onChange }: PortEditorProps) {
  const [expandedPorts, setExpandedPorts] = useState<Set<number>>(new Set());

  const addPort = () => {
    const newPort: PortDefinition = {
      name: `${direction}_${ports.length + 1}`,
      type: 'string',
      required: direction === 'input' ? false : undefined,
    };
    onChange([...ports, newPort]);
    setExpandedPorts(new Set([...expandedPorts, ports.length]));
  };

  const removePort = (index: number) => {
    onChange(ports.filter((_, i) => i !== index));
    const newExpanded = new Set(expandedPorts);
    newExpanded.delete(index);
    setExpandedPorts(newExpanded);
  };

  const updatePort = (index: number, updates: Partial<PortDefinition>) => {
    const newPorts = [...ports];
    newPorts[index] = { ...newPorts[index], ...updates };
    onChange(newPorts);
  };

  const toggleExpanded = (index: number) => {
    const newExpanded = new Set(expandedPorts);
    if (newExpanded.has(index)) {
      newExpanded.delete(index);
    } else {
      newExpanded.add(index);
    }
    setExpandedPorts(newExpanded);
  };

  const movePort = (index: number, direction: 'up' | 'down') => {
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === ports.length - 1) return;

    const newPorts = [...ports];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    [newPorts[index], newPorts[targetIndex]] = [newPorts[targetIndex], newPorts[index]];
    onChange(newPorts);
  };

  return (
    <div className="port-editor">
      <div className="port-editor-header">
        <h3>{direction === 'input' ? 'Inputs' : 'Outputs'}</h3>
        <button className="add-port-btn" onClick={addPort}>
          + Add
        </button>
      </div>
      <div className="port-list">
        {ports.length === 0 && (
          <div className="port-empty">
            No {direction}s defined. Click "+ Add" to create one.
          </div>
        )}
        {ports.map((port, index) => {
          const isExpanded = expandedPorts.has(index);
          return (
            <div key={index} className={`port-item ${isExpanded ? 'expanded' : ''}`}>
              <div className="port-item-header" onClick={() => toggleExpanded(index)}>
                <div className="port-item-title">
                  <span className="port-expand-icon">
                    {isExpanded ? '▼' : '▶'}
                  </span>
                  <span className="port-name">{port.name}</span>
                  <span className="port-type-badge">{port.type}</span>
                </div>
                <div className="port-item-actions" onClick={(e) => e.stopPropagation()}>
                  <button
                    className="port-action-btn"
                    onClick={() => movePort(index, 'up')}
                    disabled={index === 0}
                    title="Move up"
                  >
                    ↑
                  </button>
                  <button
                    className="port-action-btn"
                    onClick={() => movePort(index, 'down')}
                    disabled={index === ports.length - 1}
                    title="Move down"
                  >
                    ↓
                  </button>
                  <button
                    className="port-action-btn delete"
                    onClick={() => removePort(index)}
                    title="Delete"
                  >
                    ×
                  </button>
                </div>
              </div>
              {isExpanded && (
                <div className="port-item-details">
                  <div className="port-field">
                    <label>Name</label>
                    <input
                      type="text"
                      value={port.name}
                      onChange={(e) => updatePort(index, { name: e.target.value })}
                      placeholder="Port name"
                    />
                  </div>
                  <div className="port-field">
                    <label>Label</label>
                    <input
                      type="text"
                      value={port.label || ''}
                      onChange={(e) => updatePort(index, { label: e.target.value || undefined })}
                      placeholder="Optional display label"
                    />
                  </div>
                  <div className="port-field">
                    <label>Type</label>
                    <select
                      value={port.type}
                      onChange={(e) => updatePort(index, { type: e.target.value as ValueType })}
                    >
                      {VALUE_TYPES.map((type) => (
                        <option key={type.value} value={type.value}>
                          {type.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  {direction === 'input' && (
                    <>
                      <div className="port-field port-checkbox">
                        <label>
                          <input
                            type="checkbox"
                            checked={port.required || false}
                            onChange={(e) => updatePort(index, { required: e.target.checked })}
                          />
                          Required
                        </label>
                      </div>
                      <div className="port-field">
                        <label>Default Value</label>
                        <input
                          type="text"
                          value={port.default as string || ''}
                          onChange={(e) => updatePort(index, {
                            default: e.target.value || undefined
                          })}
                          placeholder="Optional default"
                          disabled={port.required}
                        />
                      </div>
                    </>
                  )}
                  <div className="port-field">
                    <label>Description</label>
                    <textarea
                      value={port.description || ''}
                      onChange={(e) => updatePort(index, {
                        description: e.target.value || undefined
                      })}
                      placeholder="Optional help text"
                      rows={2}
                    />
                  </div>
                  {port.type === 'json' && (
                    <JSONSchemaEditor
                      schema={port.schema}
                      onChange={(schema) => updatePort(index, { schema })}
                    />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
