import { useState } from 'react';

interface JSONSchemaProperty {
  name: string;
  type: 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array';
  description?: string;
  required?: boolean;
}

interface JSONSchema {
  type: 'object';
  properties: Record<string, { type: string; description?: string }>;
  required?: string[];
}

interface JSONSchemaEditorProps {
  schema: object | undefined;
  onChange: (schema: object | undefined) => void;
}

const PROPERTY_TYPES = [
  { value: 'string', label: 'String' },
  { value: 'number', label: 'Number' },
  { value: 'integer', label: 'Integer' },
  { value: 'boolean', label: 'Boolean' },
  { value: 'object', label: 'Object' },
  { value: 'array', label: 'Array' },
];

function parseSchemaToProperties(schema: object | undefined): JSONSchemaProperty[] {
  if (!schema || typeof schema !== 'object') return [];

  const s = schema as JSONSchema;
  if (s.type !== 'object' || !s.properties) return [];

  const requiredSet = new Set(s.required || []);

  return Object.entries(s.properties).map(([name, prop]) => ({
    name,
    type: prop.type as JSONSchemaProperty['type'],
    description: prop.description,
    required: requiredSet.has(name),
  }));
}

function propertiesToSchema(properties: JSONSchemaProperty[]): JSONSchema | undefined {
  if (properties.length === 0) return undefined;

  const schema: JSONSchema = {
    type: 'object',
    properties: {},
  };

  const required: string[] = [];

  for (const prop of properties) {
    schema.properties[prop.name] = {
      type: prop.type,
      ...(prop.description ? { description: prop.description } : {}),
    };
    if (prop.required) {
      required.push(prop.name);
    }
  }

  if (required.length > 0) {
    schema.required = required;
  }

  return schema;
}

export function JSONSchemaEditor({ schema, onChange }: JSONSchemaEditorProps) {
  const [properties, setProperties] = useState<JSONSchemaProperty[]>(() =>
    parseSchemaToProperties(schema)
  );
  const [showRawEditor, setShowRawEditor] = useState(false);
  const [rawSchemaText, setRawSchemaText] = useState(() =>
    schema ? JSON.stringify(schema, null, 2) : ''
  );
  const [rawError, setRawError] = useState<string | null>(null);

  const updateProperties = (newProperties: JSONSchemaProperty[]) => {
    setProperties(newProperties);
    const newSchema = propertiesToSchema(newProperties);
    onChange(newSchema);
    setRawSchemaText(newSchema ? JSON.stringify(newSchema, null, 2) : '');
  };

  const addProperty = () => {
    const newProp: JSONSchemaProperty = {
      name: `property_${properties.length + 1}`,
      type: 'string',
      required: false,
    };
    updateProperties([...properties, newProp]);
  };

  const removeProperty = (index: number) => {
    updateProperties(properties.filter((_, i) => i !== index));
  };

  const updateProperty = (index: number, updates: Partial<JSONSchemaProperty>) => {
    const newProperties = [...properties];
    newProperties[index] = { ...newProperties[index], ...updates };
    updateProperties(newProperties);
  };

  const handleRawSchemaChange = (text: string) => {
    setRawSchemaText(text);
    setRawError(null);

    if (!text.trim()) {
      setProperties([]);
      onChange(undefined);
      return;
    }

    try {
      const parsed = JSON.parse(text);
      const parsedProps = parseSchemaToProperties(parsed);
      setProperties(parsedProps);
      onChange(parsed);
    } catch (e) {
      setRawError((e as Error).message);
    }
  };

  return (
    <div className="json-schema-editor">
      <div className="json-schema-header">
        <span className="json-schema-title">JSON Schema</span>
        <button
          className="json-schema-toggle-btn"
          onClick={() => setShowRawEditor(!showRawEditor)}
        >
          {showRawEditor ? 'Visual' : 'Raw JSON'}
        </button>
      </div>

      {showRawEditor ? (
        <div className="json-schema-raw">
          <textarea
            value={rawSchemaText}
            onChange={(e) => handleRawSchemaChange(e.target.value)}
            placeholder='{"type": "object", "properties": {...}}'
            className="code-input"
            rows={8}
          />
          {rawError && (
            <div className="json-schema-error">
              Invalid JSON: {rawError}
            </div>
          )}
        </div>
      ) : (
        <div className="json-schema-visual">
          <div className="json-schema-properties">
            {properties.length === 0 && (
              <div className="json-schema-empty">
                No properties defined. Click "+ Add Property" to create one.
              </div>
            )}
            {properties.map((prop, index) => (
              <div key={index} className="json-schema-property">
                <div className="json-schema-property-row">
                  <input
                    type="text"
                    value={prop.name}
                    onChange={(e) => updateProperty(index, { name: e.target.value })}
                    placeholder="Property name"
                    className="json-schema-property-name"
                  />
                  <select
                    value={prop.type}
                    onChange={(e) => updateProperty(index, {
                      type: e.target.value as JSONSchemaProperty['type']
                    })}
                    className="json-schema-property-type"
                  >
                    {PROPERTY_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                  <label className="json-schema-property-required">
                    <input
                      type="checkbox"
                      checked={prop.required || false}
                      onChange={(e) => updateProperty(index, { required: e.target.checked })}
                    />
                    Req
                  </label>
                  <button
                    className="json-schema-property-delete"
                    onClick={() => removeProperty(index)}
                    title="Delete property"
                  >
                    ×
                  </button>
                </div>
                <input
                  type="text"
                  value={prop.description || ''}
                  onChange={(e) => updateProperty(index, {
                    description: e.target.value || undefined
                  })}
                  placeholder="Description (optional)"
                  className="json-schema-property-description"
                />
              </div>
            ))}
          </div>
          <button className="json-schema-add-btn" onClick={addProperty}>
            + Add Property
          </button>
        </div>
      )}
    </div>
  );
}
