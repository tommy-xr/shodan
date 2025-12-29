import type { Node, Edge, Viewport } from '@xyflow/react';
import type { BaseNodeData } from '../nodes';

const STORAGE_KEY = 'shodan-workflow';

export interface StoredWorkflow {
  nodes: Node<BaseNodeData>[];
  edges: Edge[];
  workflowName: string;
  rootDirectory: string;
  viewport?: Viewport;
  savedAt: string;
}

export function saveToLocalStorage(
  nodes: Node<BaseNodeData>[],
  edges: Edge[],
  workflowName: string,
  rootDirectory: string,
  viewport?: Viewport
): void {
  const data: StoredWorkflow = {
    nodes,
    edges,
    workflowName,
    rootDirectory,
    viewport,
    savedAt: new Date().toISOString(),
  };

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (error) {
    console.warn('Failed to save to localStorage:', error);
  }
}

export function loadFromLocalStorage(): StoredWorkflow | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;

    const data = JSON.parse(stored) as StoredWorkflow;

    // Basic validation
    if (!Array.isArray(data.nodes) || !Array.isArray(data.edges)) {
      return null;
    }

    return data;
  } catch (error) {
    console.warn('Failed to load from localStorage:', error);
    return null;
  }
}

export function clearLocalStorage(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.warn('Failed to clear localStorage:', error);
  }
}

export function hasStoredWorkflow(): boolean {
  return localStorage.getItem(STORAGE_KEY) !== null;
}
