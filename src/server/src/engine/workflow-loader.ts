/**
 * Workflow loading and validation utilities
 * Shared between CLI and executor for loading component workflows
 */

import { readFile } from 'fs/promises';
import { resolve, dirname } from 'path';
import yaml from 'js-yaml';
import type { WorkflowSchema } from '@shodan/core';

/**
 * Load a workflow from a file path
 * @param filePath Path to workflow file (yaml or json)
 * @param basePath Base directory for resolving relative paths
 * @returns Parsed and validated workflow schema
 */
export async function loadWorkflow(
  filePath: string,
  basePath: string = process.cwd()
): Promise<WorkflowSchema> {
  const absolutePath = resolve(basePath, filePath);
  const content = await readFile(absolutePath, 'utf-8');

  let schema: WorkflowSchema;
  if (filePath.endsWith('.json')) {
    schema = JSON.parse(content);
  } else {
    schema = yaml.load(content) as WorkflowSchema;
  }

  // Validate basic structure
  if (typeof schema.version !== 'number') {
    throw new Error(`Invalid workflow ${filePath}: missing version field`);
  }
  if (!schema.metadata?.name) {
    throw new Error(`Invalid workflow ${filePath}: missing metadata.name`);
  }
  if (!Array.isArray(schema.nodes)) {
    throw new Error(`Invalid workflow ${filePath}: nodes must be an array`);
  }
  if (!Array.isArray(schema.edges)) {
    throw new Error(`Invalid workflow ${filePath}: edges must be an array`);
  }

  return schema;
}

/**
 * Get the directory containing a workflow file
 * Used for resolving relative paths in nested components
 */
export function getWorkflowDirectory(filePath: string, basePath: string = process.cwd()): string {
  return dirname(resolve(basePath, filePath));
}
