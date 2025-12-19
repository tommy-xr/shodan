import { useState } from 'react';

interface ListEditorProps {
  items: string[];
  onChange: (items: string[]) => void;
  placeholder?: string;
  addButtonText?: string;
  emptyText?: string;
  inputType?: 'text' | 'file';
}

export function ListEditor({
  items,
  onChange,
  placeholder = 'Enter value...',
  addButtonText = 'Add',
  emptyText = 'No items added',
  inputType = 'text',
}: ListEditorProps) {
  const [newItem, setNewItem] = useState('');

  const handleAdd = () => {
    if (newItem.trim()) {
      onChange([...items, newItem.trim()]);
      setNewItem('');
    }
  };

  const handleRemove = (index: number) => {
    onChange(items.filter((_, i) => i !== index));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAdd();
    }
  };

  const handleUpdate = (index: number, value: string) => {
    const updated = [...items];
    updated[index] = value;
    onChange(updated);
  };

  return (
    <div className="list-editor">
      <div className="list-items">
        {items.length === 0 ? (
          <div className="list-empty">{emptyText}</div>
        ) : (
          items.map((item, index) => (
            <div key={index} className="list-item">
              <input
                type="text"
                value={item}
                onChange={(e) => handleUpdate(index, e.target.value)}
                className={inputType === 'file' ? 'file-input' : ''}
              />
              <button
                className="list-item-remove"
                onClick={() => handleRemove(index)}
                title="Remove"
              >
                ×
              </button>
            </div>
          ))
        )}
      </div>
      <div className="list-add">
        <input
          type="text"
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className={inputType === 'file' ? 'file-input' : ''}
        />
        <button onClick={handleAdd} disabled={!newItem.trim()}>
          {addButtonText}
        </button>
      </div>
    </div>
  );
}
