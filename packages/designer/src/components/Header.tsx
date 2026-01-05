import { useState, useRef, useEffect } from 'react';
import type { Node, Edge } from '@xyflow/react';
import type { BaseNodeData } from '../nodes';
import {
  exportToJSON,
  exportToYAML,
  importWorkflow,
  downloadFile,
  openFilePicker,
} from '../lib/workflow';

interface BreadcrumbItem {
  name: string;
  path?: string;
}

interface HeaderProps {
  // Breadcrumb props
  rootDirectory: string;
  workflowName: string;
  breadcrumbItems: BreadcrumbItem[];
  onNavigateBreadcrumb: (index: number) => void;
  isEditingComponent: boolean;
  onSaveComponent?: () => void;
  isSaving?: boolean;
  hasUnsavedChanges?: boolean;
  isFileBased?: boolean; // True when editing a file-based workflow
  workspaceName?: string; // For file-based workflows
  workflowPath?: string; // For file-based workflows (e.g. ".robomesh/workflows/test.yaml")
  // Workflow props
  onWorkflowNameChange: (name: string) => void;
  onNewWorkflow: () => void;
  // Execution props
  nodes: Node<BaseNodeData>[];
  edges: Edge[];
  isExecuting: boolean;
  onExecute: () => void;
  onResetExecution: () => void;
  yoloMode?: boolean; // True when server started with --yolo
  // Import/Export props
  onImport: (nodes: Node<BaseNodeData>[], edges: Edge[], name: string, rootDir?: string) => void;
}

export function Header({
  rootDirectory,
  workflowName,
  breadcrumbItems,
  onNavigateBreadcrumb,
  isEditingComponent,
  onSaveComponent,
  isSaving,
  hasUnsavedChanges,
  isFileBased,
  workspaceName,
  workflowPath,
  onWorkflowNameChange,
  onNewWorkflow,
  nodes,
  edges,
  isExecuting,
  onExecute,
  onResetExecution,
  yoloMode,
  onImport,
}: HeaderProps) {
  const [error, setError] = useState<string | null>(null);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editingNameValue, setEditingNameValue] = useState(workflowName);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [exportSubmenuOpen, setExportSubmenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Sync editing value when workflowName changes externally
  useEffect(() => {
    if (!isEditingName) {
      setEditingNameValue(workflowName);
    }
  }, [workflowName, isEditingName]);

  // Focus input when editing starts
  useEffect(() => {
    if (isEditingName && nameInputRef.current) {
      nameInputRef.current.focus();
      nameInputRef.current.select();
    }
  }, [isEditingName]);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as globalThis.Node)) {
        setIsMenuOpen(false);
        setExportSubmenuOpen(false);
      }
    };

    if (isMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isMenuOpen]);

  const handleExport = (format: 'yaml' | 'json') => {
    setError(null);
    try {
      const metadata = { name: workflowName };
      if (format === 'json') {
        const content = exportToJSON(nodes, edges, metadata);
        downloadFile(content, `${workflowName || 'workflow'}.json`, 'application/json');
      } else {
        const content = exportToYAML(nodes, edges, metadata);
        downloadFile(content, `${workflowName || 'workflow'}.yaml`, 'text/yaml');
      }
      setIsMenuOpen(false);
      setExportSubmenuOpen(false);
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
      setIsMenuOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    }
  };

  const handleNewWorkflow = () => {
    onNewWorkflow();
    setIsMenuOpen(false);
  };

  const handleNameSubmit = () => {
    onWorkflowNameChange(editingNameValue);
    setIsEditingName(false);
  };

  const handleNameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleNameSubmit();
    } else if (e.key === 'Escape') {
      setEditingNameValue(workflowName);
      setIsEditingName(false);
    }
  };

  // Build the full breadcrumb display
  // For file-based workflows: Workspaces > workspace > path/segments > filename
  // For in-memory workflows: rootDirectory / workflowName [/ component path...]
  const renderBreadcrumb = () => {
    const parts: React.ReactNode[] = [];

    // File-based workflow: show Workspaces > workspace > path
    if (isFileBased && workspaceName && workflowPath) {
      // "Workspaces" link to dashboard
      parts.push(
        <a key="workspaces" href="/" className="header-breadcrumb-link">
          Workspaces
        </a>
      );
      parts.push(
        <span key="sep-ws" className="header-breadcrumb-separator">›</span>
      );

      // Workspace name
      parts.push(
        <span key="workspace" className="header-breadcrumb-item workspace">
          {workspaceName}
        </span>
      );

      // Path segments (e.g., .robomesh/workflows/test.yaml becomes: .robomesh > workflows > test.yaml)
      const pathParts = workflowPath.split('/');
      pathParts.forEach((part, index) => {
        parts.push(
          <span key={`sep-path-${index}`} className="header-breadcrumb-separator">›</span>
        );

        const isFile = index === pathParts.length - 1;
        parts.push(
          <span
            key={`path-${index}`}
            className={`header-breadcrumb-item ${isFile ? 'current file' : 'folder'}`}
          >
            {isFile && <span className="header-breadcrumb-icon">📄</span>}
            {part}
          </span>
        );
      });

      // If editing nested components, add those
      if (breadcrumbItems.length > 1) {
        breadcrumbItems.slice(1).forEach((item, index) => {
          parts.push(
            <span key={`sep-comp-${index}`} className="header-breadcrumb-separator">›</span>
          );
          const isLast = index === breadcrumbItems.length - 2;
          const isComponent = item.path !== undefined;

          if (isLast) {
            parts.push(
              <span key={`comp-${index}`} className={`header-breadcrumb-item current ${isComponent ? 'component' : ''}`}>
                {isComponent && <span className="header-breadcrumb-icon">📦</span>}
                {item.name}
              </span>
            );
          } else {
            parts.push(
              <button
                key={`comp-${index}`}
                className={`header-breadcrumb-link ${isComponent ? 'component' : ''}`}
                onClick={() => onNavigateBreadcrumb(index + 1)}
              >
                {isComponent && <span className="header-breadcrumb-icon">📦</span>}
                {item.name}
              </button>
            );
          }
        });
      }

      return parts;
    }

    // Non-file-based workflow (in-memory): rootDirectory / workflowName
    const displayDir = rootDirectory
      ? rootDirectory.length > 30
        ? '...' + rootDirectory.slice(-27)
        : rootDirectory
      : '(no directory)';

    parts.push(
      <span key="root" className="header-breadcrumb-item root" title={rootDirectory}>
        <span className="header-breadcrumb-icon">📁</span>
        {displayDir}
      </span>
    );

    parts.push(
      <span key="sep-root" className="header-breadcrumb-separator">/</span>
    );

    // If we have navigation stack (editing components)
    if (breadcrumbItems.length > 1) {
      breadcrumbItems.forEach((item, index) => {
        if (index > 0) {
          parts.push(
            <span key={`sep-${index}`} className="header-breadcrumb-separator">/</span>
          );
        }

        const isLast = index === breadcrumbItems.length - 1;
        const isComponent = item.path !== undefined;
        const isRoot = index === 0;

        if (isLast) {
          parts.push(
            <span key={`item-${index}`} className={`header-breadcrumb-item current ${isComponent ? 'component' : ''}`}>
              {isComponent && <span className="header-breadcrumb-icon">📦</span>}
              {item.name}
            </span>
          );
        } else if (isRoot && !isComponent) {
          if (isEditingName) {
            parts.push(
              <input
                key="workflow-input"
                ref={nameInputRef}
                type="text"
                className="header-breadcrumb-input"
                value={editingNameValue}
                onChange={(e) => setEditingNameValue(e.target.value)}
                onBlur={handleNameSubmit}
                onKeyDown={handleNameKeyDown}
                placeholder="Workflow name..."
              />
            );
          } else {
            parts.push(
              <button
                key={`item-${index}`}
                className="header-breadcrumb-link editable"
                onClick={() => onNavigateBreadcrumb(index)}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  setIsEditingName(true);
                }}
                title="Click to navigate, double-click to rename"
              >
                <span className="header-breadcrumb-icon">📄</span>
                {item.name}
              </button>
            );
          }
        } else {
          parts.push(
            <button
              key={`item-${index}`}
              className={`header-breadcrumb-link ${isComponent ? 'component' : ''}`}
              onClick={() => onNavigateBreadcrumb(index)}
            >
              {isComponent && <span className="header-breadcrumb-icon">📦</span>}
              {item.name}
            </button>
          );
        }
      });
    } else {
      // Just the workflow name when at root level - make it editable
      if (isEditingName) {
        parts.push(
          <input
            key="workflow-input"
            ref={nameInputRef}
            type="text"
            className="header-breadcrumb-input"
            value={editingNameValue}
            onChange={(e) => setEditingNameValue(e.target.value)}
            onBlur={handleNameSubmit}
            onKeyDown={handleNameKeyDown}
            placeholder="Workflow name..."
          />
        );
      } else {
        parts.push(
          <button
            key="workflow"
            className="header-breadcrumb-item current workflow editable"
            onClick={() => setIsEditingName(true)}
            title="Click to rename"
          >
            <span className="header-breadcrumb-icon">📄</span>
            {workflowName || 'Untitled Workflow'}
            <span className="header-breadcrumb-edit">✎</span>
          </button>
        );
      }
    }

    return parts;
  };

  return (
    <header className="header">
      <div className="header-left">
        <div className="header-brand">
          <h1>Robomesh</h1>
        </div>

        <div className="header-menu-container" ref={menuRef}>
          <button
            className={`header-menu-btn ${isMenuOpen ? 'open' : ''}`}
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            title="File menu"
          >
            File
            <span className="header-menu-arrow">{isMenuOpen ? '▴' : '▾'}</span>
          </button>

          {isMenuOpen && (
            <div className="header-flyout">
              <button className="flyout-item" onClick={handleNewWorkflow}>
                <span className="flyout-icon">+</span>
                New Workflow
              </button>
              <div className="flyout-divider" />
              <button className="flyout-item" onClick={handleImport}>
                <span className="flyout-icon">↑</span>
                Import...
              </button>
              <div
                className={`flyout-item has-submenu ${exportSubmenuOpen ? 'open' : ''}`}
                onMouseEnter={() => setExportSubmenuOpen(true)}
                onMouseLeave={() => setExportSubmenuOpen(false)}
              >
                <span className="flyout-icon">↓</span>
                Export
                <span className="flyout-submenu-arrow">▸</span>
                {exportSubmenuOpen && (
                  <div className="flyout-submenu">
                    <button className="flyout-item" onClick={() => handleExport('yaml')}>
                      YAML
                      <span className="flyout-hint">Default</span>
                    </button>
                    <button className="flyout-item" onClick={() => handleExport('json')}>
                      JSON
                    </button>
                  </div>
                )}
              </div>
              {error && <div className="flyout-error">{error}</div>}
            </div>
          )}
        </div>

        <div className="header-breadcrumb">
          {renderBreadcrumb()}
        </div>
        {isEditingComponent && onSaveComponent && (
          <button
            className={`header-save-btn ${hasUnsavedChanges ? 'has-changes' : ''}`}
            onClick={onSaveComponent}
            disabled={isSaving}
            title={hasUnsavedChanges ? 'Save changes' : 'No changes to save'}
          >
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        )}
        {isFileBased && !isEditingComponent && (
          <span className={`header-save-status ${isSaving ? 'saving' : hasUnsavedChanges ? 'unsaved' : 'saved'}`}>
            {isSaving ? '⏳ Saving...' : hasUnsavedChanges ? '● Unsaved' : '✓ Saved'}
          </span>
        )}
      </div>

      <div className="header-right">
        {yoloMode && (
          <div className="header-yolo-badge" title="Server started with --yolo. Agents run with full permissions.">
            ⚠️ YOLO
          </div>
        )}
        <div className="header-execution">
          <button
            className={`header-btn run ${isExecuting ? 'running' : ''} ${yoloMode ? 'yolo' : ''}`}
            onClick={onExecute}
            disabled={isExecuting || nodes.length === 0}
            title={yoloMode ? 'Run with full permissions (YOLO mode)' : 'Run workflow'}
          >
            {isExecuting ? '⏳ Running...' : '▶ Run'}
          </button>
          <button
            className="header-btn reset"
            onClick={onResetExecution}
            disabled={isExecuting}
          >
            ↺ Reset
          </button>
        </div>
      </div>
    </header>
  );
}
