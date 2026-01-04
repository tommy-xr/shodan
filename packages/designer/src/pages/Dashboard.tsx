/**
 * Dashboard Page
 *
 * Overview of all workflows across registered workspaces.
 * Shows status, trigger info, and allows starting/stopping workflows.
 */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import './Dashboard.css';

interface TriggerInfo {
  nodeId: string;
  label: string;
  type: string;
  cron?: string;
}

interface WorkflowInfo {
  path: string;
  absolutePath: string;
  name: string;
  description?: string;
  triggers: TriggerInfo[];
  nodeCount: number;
  lastModified: string;
  workspace: string;
}

interface WorkspaceSummary {
  name: string;
  path: string;
  workflowCount: number;
}

interface ExecutionStatus {
  isRunning: boolean;
  workflowPath?: string;
  workspace?: string;
  startedAt?: string;
  currentNode?: string;
  progress?: {
    completed: number;
    total: number;
  };
}

interface NodeResult {
  nodeId: string;
  status: string;
  output?: string;
  error?: string;
}

type ExecutionSource = 'cli' | 'ui' | 'cron' | 'idle';

interface ExecutionHistoryEntry {
  id: string;
  workspace: string;
  workflowPath: string;
  startedAt: string;
  completedAt: string;
  status: 'completed' | 'failed' | 'cancelled';
  duration: number;
  nodeCount: number;
  source?: ExecutionSource;
  error?: string;
  results?: NodeResult[];
}

interface RegisteredTrigger {
  id: string;
  workspace: string;
  workflowPath: string;
  nodeId: string;
  label: string;
  config: {
    type: string;
    cron?: string;
  };
  enabled: boolean;
  nextRun?: string;
  lastRun?: string;
}

const TRIGGER_ICONS: Record<string, string> = {
  manual: '\u{1F590}', // Hand
  cron: '\u{23F0}',    // Alarm clock
  idle: '\u{1F4A4}',   // Zzz
};

const SOURCE_LABELS: Record<ExecutionSource, { icon: string; label: string }> = {
  ui: { icon: '\u{1F5B1}', label: 'UI' },      // Mouse
  cli: { icon: '\u{2328}', label: 'CLI' },     // Keyboard
  cron: { icon: '\u{23F0}', label: 'Cron' },   // Alarm clock
  idle: { icon: '\u{1F4A4}', label: 'Idle' },  // Zzz
};

export function Dashboard() {
  const navigate = useNavigate();
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [executionStatus, setExecutionStatus] = useState<ExecutionStatus>({ isRunning: false });
  const [expandedWorkspaces, setExpandedWorkspaces] = useState<Set<string>>(new Set());
  const [lastRuns, setLastRuns] = useState<Record<string, ExecutionHistoryEntry>>({});
  const [selectedHistory, setSelectedHistory] = useState<ExecutionHistoryEntry | null>(null);
  const [triggers, setTriggers] = useState<RegisteredTrigger[]>([]);
  const [newWorkflowModal, setNewWorkflowModal] = useState<{ workspace: string } | null>(null);
  const [newWorkflowName, setNewWorkflowName] = useState('');
  const [dangerouslySkipPermissions, setDangerouslySkipPermissions] = useState(false);

  // Fetch workflows from API
  const fetchWorkflows = useCallback(async () => {
    try {
      const res = await fetch('/api/workflows');
      if (!res.ok) throw new Error('Failed to fetch workflows');

      const data = await res.json();
      setWorkspaces(data.workspaces || []);
      setWorkflows(data.workflows || []);

      // Expand all workspaces by default
      setExpandedWorkspaces(new Set(data.workspaces?.map((w: WorkspaceSummary) => w.name) || []));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch execution status
  const fetchExecutionStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/execution/status');
      if (res.ok) {
        const data = await res.json();
        setExecutionStatus(data);
      }
    } catch {
      // Ignore errors for status polling
    }
  }, []);

  // Fetch last runs for all workflows
  const fetchLastRuns = useCallback(async () => {
    try {
      const res = await fetch('/api/execution/last-runs');
      if (res.ok) {
        const data = await res.json();
        setLastRuns(data.lastRuns || {});
      }
    } catch {
      // Ignore errors
    }
  }, []);

  // Fetch registered triggers
  const fetchTriggers = useCallback(async () => {
    try {
      const res = await fetch('/api/triggers');
      if (res.ok) {
        const data = await res.json();
        setTriggers(data.triggers || []);
      }
    } catch {
      // Ignore errors
    }
  }, []);

  // Fetch server config (for permission bypass warning)
  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/config');
      if (res.ok) {
        const data = await res.json();
        setDangerouslySkipPermissions(data.dangerouslySkipPermissions || false);
      }
    } catch {
      // Ignore errors
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchWorkflows();
    fetchExecutionStatus();
    fetchLastRuns();
    fetchTriggers();
    fetchConfig();

    // Poll for status updates (also refresh last runs when status changes)
    const interval = setInterval(() => {
      fetchExecutionStatus();
      fetchLastRuns();
      fetchTriggers();
    }, 2000);
    return () => clearInterval(interval);
  }, [fetchWorkflows, fetchExecutionStatus, fetchLastRuns, fetchTriggers, fetchConfig]);

  // Start a workflow
  const handleStart = async (workflow: WorkflowInfo) => {
    try {
      const res = await fetch('/api/execution/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace: workflow.workspace,
          workflowPath: workflow.path,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to start workflow');
      }

      // Refresh status
      fetchExecutionStatus();
    } catch (err) {
      alert((err as Error).message);
    }
  };

  // Stop running workflow
  const handleStop = async () => {
    try {
      const res = await fetch('/api/execution/cancel', {
        method: 'POST',
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to stop workflow');
      }

      fetchExecutionStatus();
    } catch (err) {
      alert((err as Error).message);
    }
  };

  // Open workflow in designer
  const handleOpen = (workflow: WorkflowInfo) => {
    navigate(`/workflow/${workflow.workspace}/${encodeURIComponent(workflow.path)}`);
  };

  // Create new workflow
  const handleCreateWorkflow = async () => {
    if (!newWorkflowModal || !newWorkflowName.trim()) return;

    try {
      const res = await fetch('/api/workflows/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace: newWorkflowModal.workspace,
          name: newWorkflowName.trim(),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to create workflow');
      }

      const data = await res.json();

      // Close modal and reset
      setNewWorkflowModal(null);
      setNewWorkflowName('');

      // Navigate to the new workflow
      navigate(`/workflow/${data.workspace}/${encodeURIComponent(data.path)}`);
    } catch (err) {
      alert((err as Error).message);
    }
  };

  // Toggle workspace expansion
  const toggleWorkspace = (name: string) => {
    setExpandedWorkspaces(prev => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  };

  // Get trigger display
  const getTriggerDisplay = (triggers: TriggerInfo[]) => {
    if (triggers.length === 0) {
      return <span className="trigger-badge manual">{TRIGGER_ICONS.manual} Manual</span>;
    }

    return triggers.map((trigger, i) => (
      <span key={i} className={`trigger-badge ${trigger.type}`}>
        {TRIGGER_ICONS[trigger.type] || ''} {trigger.type}
        {trigger.cron && <span className="cron">{trigger.cron}</span>}
      </span>
    ));
  };

  // Check if workflow is currently running
  const isWorkflowRunning = (workflow: WorkflowInfo) => {
    return (
      executionStatus.isRunning &&
      executionStatus.workspace === workflow.workspace &&
      executionStatus.workflowPath === workflow.path
    );
  };

  // Get last run for a workflow
  const getLastRun = (workflow: WorkflowInfo): ExecutionHistoryEntry | undefined => {
    const key = `${workflow.workspace}:${workflow.path}`;
    return lastRuns[key];
  };

  // Format relative time
  const formatRelativeTime = (dateString: string): string => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  // Format duration
  const formatDuration = (ms: number): string => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  };

  // Get next run time for a workflow
  const getNextRun = (workflow: WorkflowInfo): RegisteredTrigger | undefined => {
    return triggers.find(
      t => t.workspace === workflow.workspace && t.workflowPath === workflow.path && t.nextRun
    );
  };

  // Format next run time
  const formatNextRun = (nextRun: string): string => {
    const date = new Date(nextRun);
    const now = new Date();
    const diffMs = date.getTime() - now.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);

    if (diffMins <= 0) return 'due';
    if (diffMins < 60) return `in ${diffMins}m`;
    if (diffHours < 24) return `in ${diffHours}h`;
    return date.toLocaleDateString();
  };

  // View run details (fetch full results from API if needed)
  const handleViewRun = async (entry: ExecutionHistoryEntry) => {
    // If results are missing, fetch from API
    if (!entry.results) {
      try {
        const res = await fetch(`/api/execution/run/${entry.id}`);
        if (res.ok) {
          const fullRun = await res.json();
          setSelectedHistory(fullRun);
          return;
        }
      } catch (err) {
        console.error('Failed to fetch run details:', err);
      }
    }
    setSelectedHistory(entry);
  };

  if (loading) {
    return (
      <div className="dashboard">
        <div className="dashboard-loading">Loading workflows...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="dashboard">
        <div className="dashboard-error">
          Error: {error}
          <button onClick={fetchWorkflows}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard">
      {dangerouslySkipPermissions && (
        <div className="permission-warning-banner">
          <span className="warning-icon">⚠️</span>
          <span className="warning-text">
            <strong>YOLO Mode:</strong> Agents are running with full permissions without prompting.
            Only use this in sandboxed/isolated environments.
          </span>
        </div>
      )}

      <header className="dashboard-header">
        <h1>Robomesh</h1>
        <div className="dashboard-actions">
          <button onClick={fetchWorkflows} className="refresh-btn">
            Refresh
          </button>
        </div>
      </header>

      <div className="dashboard-content">
        <div className="workflows-panel">
          <h2>Workflows</h2>

          {workspaces.length === 0 ? (
            <div className="empty-state">
              <p>No workspaces registered.</p>
              <p>Run <code>robomesh add /path/to/project</code> to add one.</p>
            </div>
          ) : (
            <div className="workspace-list">
              {workspaces.map(workspace => (
                <div key={workspace.name} className="workspace-group">
                  <div className="workspace-header">
                    <div
                      className="workspace-header-toggle"
                      onClick={() => toggleWorkspace(workspace.name)}
                    >
                      <span className="expand-icon">
                        {expandedWorkspaces.has(workspace.name) ? '\u25BC' : '\u25B6'}
                      </span>
                      <span className="workspace-name">{workspace.name}</span>
                      <span className="workflow-count">{workspace.workflowCount}</span>
                    </div>
                    <button
                      className="new-workflow-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        setNewWorkflowModal({ workspace: workspace.name });
                        setNewWorkflowName('');
                      }}
                      title="Create new workflow"
                    >
                      + New
                    </button>
                  </div>

                  {expandedWorkspaces.has(workspace.name) && (
                    <div className="workflow-list">
                      {workflows
                        .filter(w => w.workspace === workspace.name)
                        .map(workflow => {
                          const lastRun = getLastRun(workflow);
                          const nextRunTrigger = getNextRun(workflow);
                          return (
                            <div
                              key={`${workflow.workspace}/${workflow.path}`}
                              className={`workflow-item ${isWorkflowRunning(workflow) ? 'running' : ''}`}
                            >
                              <div className="workflow-info">
                                <div className="workflow-name">{workflow.name}</div>
                                <div className="workflow-path">{workflow.path}</div>
                                <div className="workflow-meta">
                                  <span className="workflow-triggers">
                                    {getTriggerDisplay(workflow.triggers)}
                                  </span>
                                  {nextRunTrigger?.nextRun && (
                                    <span
                                      className="next-run"
                                      title={`Next run: ${new Date(nextRunTrigger.nextRun).toLocaleString()}`}
                                    >
                                      {'\u23F1'} {formatNextRun(nextRunTrigger.nextRun)}
                                    </span>
                                  )}
                                  {lastRun && (
                                    <span
                                      className={`last-run ${lastRun.status}`}
                                      onClick={() => handleViewRun(lastRun)}
                                      title={`Click to view run details\nSource: ${lastRun.source || 'ui'}\nDuration: ${formatDuration(lastRun.duration)}`}
                                    >
                                      {lastRun.status === 'completed' ? '\u2714' : lastRun.status === 'failed' ? '\u2718' : '\u23F9'}
                                      {lastRun.source && SOURCE_LABELS[lastRun.source] && (
                                        <span className="run-source" title={SOURCE_LABELS[lastRun.source].label}>
                                          {SOURCE_LABELS[lastRun.source].icon}
                                        </span>
                                      )}
                                      {' '}{formatRelativeTime(lastRun.completedAt)}
                                    </span>
                                  )}
                                </div>
                              </div>

                              <div className="workflow-actions">
                                {isWorkflowRunning(workflow) ? (
                                  <button
                                    className="stop-btn"
                                    onClick={() => handleStop()}
                                  >
                                    Stop
                                  </button>
                                ) : (
                                  <button
                                    className="start-btn"
                                    onClick={() => handleStart(workflow)}
                                    disabled={executionStatus.isRunning}
                                  >
                                    Start
                                  </button>
                                )}
                                <button
                                  className="open-btn"
                                  onClick={() => handleOpen(workflow)}
                                >
                                  Open
                                </button>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="status-panel">
          <h2>Status</h2>

          {executionStatus.isRunning ? (
            <div className="execution-status running">
              <div className="status-indicator"></div>
              <div className="status-info">
                <div className="status-workflow">{executionStatus.workflowPath}</div>
                <div className="status-workspace">{executionStatus.workspace}</div>
                {executionStatus.currentNode && (
                  <div className="status-node">Node: {executionStatus.currentNode}</div>
                )}
                {executionStatus.progress && (
                  <div className="status-progress">
                    {executionStatus.progress.completed} / {executionStatus.progress.total} nodes
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="execution-status idle">
              <div className="status-indicator"></div>
              <div className="status-info">Idle</div>
            </div>
          )}
        </div>
      </div>

      {/* Run Details Modal */}
      {selectedHistory && (
        <div className="run-modal-overlay" onClick={() => setSelectedHistory(null)}>
          <div className="run-modal" onClick={e => e.stopPropagation()}>
            <div className="run-modal-header">
              <h3>Run Details</h3>
              <button className="close-btn" onClick={() => setSelectedHistory(null)}>&times;</button>
            </div>
            <div className="run-modal-meta">
              <div className="run-meta-item">
                <span className="label">Workflow:</span>
                <span className="value">{selectedHistory.workflowPath}</span>
              </div>
              <div className="run-meta-item">
                <span className="label">Status:</span>
                <span className={`value status-${selectedHistory.status}`}>
                  {selectedHistory.status}
                </span>
              </div>
              <div className="run-meta-item">
                <span className="label">Source:</span>
                <span className="value">
                  {selectedHistory.source && SOURCE_LABELS[selectedHistory.source] ? (
                    <>
                      {SOURCE_LABELS[selectedHistory.source].icon} {SOURCE_LABELS[selectedHistory.source].label}
                    </>
                  ) : (
                    <>🖱 UI</>
                  )}
                </span>
              </div>
              <div className="run-meta-item">
                <span className="label">Started:</span>
                <span className="value">{new Date(selectedHistory.startedAt).toLocaleString()}</span>
              </div>
              <div className="run-meta-item">
                <span className="label">Duration:</span>
                <span className="value">{formatDuration(selectedHistory.duration)}</span>
              </div>
              <div className="run-meta-item">
                <span className="label">Nodes:</span>
                <span className="value">{selectedHistory.nodeCount}</span>
              </div>
              {selectedHistory.error && (
                <div className="run-meta-item error">
                  <span className="label">Error:</span>
                  <span className="value">{selectedHistory.error}</span>
                </div>
              )}
            </div>
            <div className="run-modal-results">
              <h4>Node Results</h4>
              {selectedHistory.results && selectedHistory.results.length > 0 ? (
                <div className="results-list">
                  {selectedHistory.results.map((result, i) => (
                    <div key={i} className={`result-item ${result.status}`}>
                      <div className="result-header">
                        <span className="result-node">{result.nodeId}</span>
                        <span className={`result-status ${result.status}`}>{result.status}</span>
                      </div>
                      {result.output && (
                        <pre className="result-output">{result.output}</pre>
                      )}
                      {result.error && (
                        <pre className="result-error">{result.error}</pre>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="no-results">No results available</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* New Workflow Modal */}
      {newWorkflowModal && (
        <div className="run-modal-overlay" onClick={() => setNewWorkflowModal(null)}>
          <div className="new-workflow-modal" onClick={e => e.stopPropagation()}>
            <div className="run-modal-header">
              <h3>New Workflow</h3>
              <button className="close-btn" onClick={() => setNewWorkflowModal(null)}>&times;</button>
            </div>
            <div className="new-workflow-form">
              <div className="form-field">
                <label>Workspace</label>
                <span className="workspace-value">{newWorkflowModal.workspace}</span>
              </div>
              <div className="form-field">
                <label htmlFor="workflow-name">Name</label>
                <input
                  id="workflow-name"
                  type="text"
                  value={newWorkflowName}
                  onChange={e => setNewWorkflowName(e.target.value)}
                  placeholder="My Workflow"
                  autoFocus
                  onKeyDown={e => {
                    if (e.key === 'Enter' && newWorkflowName.trim()) {
                      handleCreateWorkflow();
                    }
                  }}
                />
              </div>
              <div className="form-actions">
                <button
                  className="cancel-btn"
                  onClick={() => setNewWorkflowModal(null)}
                >
                  Cancel
                </button>
                <button
                  className="create-btn"
                  onClick={handleCreateWorkflow}
                  disabled={!newWorkflowName.trim()}
                >
                  Create
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
