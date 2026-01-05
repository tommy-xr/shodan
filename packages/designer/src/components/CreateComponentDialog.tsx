import { useState } from 'react';
import type { PortDefinition, ValueType } from '@robomesh/core';

interface CreateComponentDialogProps {
  onClose: () => void;
  onCreate: (component: NewComponentData) => void;
}

export interface NewComponentData {
  name: string;
  description: string;
  inputs: PortDefinition[];
  outputs: PortDefinition[];
}

const VALUE_TYPES: ValueType[] = ['string', 'number', 'boolean', 'json', 'file', 'files', 'any'];

export function CreateComponentDialog({ onClose, onCreate }: CreateComponentDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [inputs, setInputs] = useState<PortDefinition[]>([
    { name: 'input', type: 'string', required: true, description: '' }
  ]);
  const [outputs, setOutputs] = useState<PortDefinition[]>([
    { name: 'output', type: 'string', description: '' }
  ]);

  const addInput = () => {
    setInputs([...inputs, { name: `input_${inputs.length + 1}`, type: 'string', required: false, description: '' }]);
  };

  const addOutput = () => {
    setOutputs([...outputs, { name: `output_${outputs.length + 1}`, type: 'string', description: '' }]);
  };

  const updateInput = (index: number, updates: Partial<PortDefinition>) => {
    setInputs(inputs.map((input, i) => i === index ? { ...input, ...updates } : input));
  };

  const updateOutput = (index: number, updates: Partial<PortDefinition>) => {
    setOutputs(outputs.map((output, i) => i === index ? { ...output, ...updates } : output));
  };

  const removeInput = (index: number) => {
    setInputs(inputs.filter((_, i) => i !== index));
  };

  const removeOutput = (index: number) => {
    setOutputs(outputs.filter((_, i) => i !== index));
  };

  const handleCreate = () => {
    if (!name.trim()) return;

    onCreate({
      name: name.trim(),
      description: description.trim(),
      inputs: inputs.filter(i => i.name.trim()),
      outputs: outputs.filter(o => o.name.trim()),
    });
  };

  const isValid = name.trim() && inputs.some(i => i.name.trim());

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog create-component-dialog" onClick={e => e.stopPropagation()}>
        <div className="dialog-header">
          <h2>Create New Component</h2>
          <button className="dialog-close" onClick={onClose}>×</button>
        </div>

        <div className="dialog-content">
          <div className="dialog-field">
            <label>Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g., Text Processor"
              autoFocus
            />
          </div>

          <div className="dialog-field">
            <label>Description</label>
            <input
              type="text"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="e.g., Processes and transforms text input"
            />
          </div>

          <div className="dialog-section">
            <div className="dialog-section-header">
              <h3>Inputs</h3>
              <button className="add-btn" onClick={addInput}>+ Add</button>
            </div>
            <div className="port-list-compact">
              {inputs.map((input, index) => (
                <div key={index} className="port-row">
                  <input
                    type="text"
                    value={input.name}
                    onChange={e => updateInput(index, { name: e.target.value })}
                    placeholder="name"
                    className="port-name-input"
                  />
                  <select
                    value={input.type}
                    onChange={e => updateInput(index, { type: e.target.value as ValueType })}
                    className="port-type-select"
                  >
                    {VALUE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <label className="port-required-label">
                    <input
                      type="checkbox"
                      checked={input.required || false}
                      onChange={e => updateInput(index, { required: e.target.checked })}
                    />
                    req
                  </label>
                  <input
                    type="text"
                    value={input.description || ''}
                    onChange={e => updateInput(index, { description: e.target.value })}
                    placeholder="description"
                    className="port-desc-input"
                  />
                  <button className="remove-btn" onClick={() => removeInput(index)}>×</button>
                </div>
              ))}
              {inputs.length === 0 && (
                <div className="empty-hint">No inputs defined</div>
              )}
            </div>
          </div>

          <div className="dialog-section">
            <div className="dialog-section-header">
              <h3>Outputs</h3>
              <button className="add-btn" onClick={addOutput}>+ Add</button>
            </div>
            <div className="port-list-compact">
              {outputs.map((output, index) => (
                <div key={index} className="port-row">
                  <input
                    type="text"
                    value={output.name}
                    onChange={e => updateOutput(index, { name: e.target.value })}
                    placeholder="name"
                    className="port-name-input"
                  />
                  <select
                    value={output.type}
                    onChange={e => updateOutput(index, { type: e.target.value as ValueType })}
                    className="port-type-select"
                  >
                    {VALUE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <input
                    type="text"
                    value={output.description || ''}
                    onChange={e => updateOutput(index, { description: e.target.value })}
                    placeholder="description"
                    className="port-desc-input"
                  />
                  <button className="remove-btn" onClick={() => removeOutput(index)}>×</button>
                </div>
              ))}
              {outputs.length === 0 && (
                <div className="empty-hint">No outputs defined</div>
              )}
            </div>
          </div>

        </div>

        <div className="dialog-footer">
          <button className="cancel-btn" onClick={onClose}>Cancel</button>
          <button
            className="create-btn"
            onClick={handleCreate}
            disabled={!isValid}
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
