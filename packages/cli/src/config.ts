/**
 * Workspace Configuration
 *
 * Manages registered workspaces stored in ~/.robomesh/config.yaml
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import yaml from 'js-yaml';

export interface RobomeshConfig {
  workspaces: string[];
}

const CONFIG_DIR = path.join(os.homedir(), '.robomesh');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.yaml');

/**
 * Ensure the config directory exists
 */
async function ensureConfigDir(): Promise<void> {
  try {
    await fs.mkdir(CONFIG_DIR, { recursive: true });
  } catch (err) {
    // Ignore if already exists
  }
}

/**
 * Load the config file, returning defaults if it doesn't exist
 */
export async function loadConfig(): Promise<RobomeshConfig> {
  try {
    const content = await fs.readFile(CONFIG_FILE, 'utf-8');
    const config = yaml.load(content) as RobomeshConfig;
    return {
      workspaces: config?.workspaces || [],
    };
  } catch (err) {
    // File doesn't exist or is invalid, return defaults
    return { workspaces: [] };
  }
}

/**
 * Save the config file
 */
export async function saveConfig(config: RobomeshConfig): Promise<void> {
  await ensureConfigDir();
  const content = yaml.dump(config, { indent: 2 });
  await fs.writeFile(CONFIG_FILE, content, 'utf-8');
}

/**
 * Add a workspace to the config
 * Returns true if added, false if already registered
 */
export async function addWorkspace(workspacePath: string): Promise<boolean> {
  const absolutePath = path.resolve(workspacePath);
  const config = await loadConfig();

  // Check if already registered
  if (config.workspaces.includes(absolutePath)) {
    return false;
  }

  config.workspaces.push(absolutePath);
  await saveConfig(config);
  return true;
}

/**
 * Remove a workspace from the config
 * Returns true if removed, false if not found
 */
export async function removeWorkspace(workspacePath: string): Promise<boolean> {
  const absolutePath = path.resolve(workspacePath);
  const config = await loadConfig();

  const index = config.workspaces.indexOf(absolutePath);
  if (index === -1) {
    return false;
  }

  config.workspaces.splice(index, 1);
  await saveConfig(config);
  return true;
}

/**
 * Get all registered workspaces
 */
export async function listWorkspaces(): Promise<string[]> {
  const config = await loadConfig();
  return config.workspaces;
}

/**
 * Check if a path looks like a valid workspace
 * (has .robomesh/, workflows/, or .git directory)
 */
export async function isValidWorkspace(workspacePath: string): Promise<{ valid: boolean; reason?: string }> {
  const absolutePath = path.resolve(workspacePath);

  // Check if path exists
  try {
    const stat = await fs.stat(absolutePath);
    if (!stat.isDirectory()) {
      return { valid: false, reason: 'Path is not a directory' };
    }
  } catch {
    return { valid: false, reason: 'Path does not exist' };
  }

  // Check for workspace markers
  const markers = ['.robomesh', 'workflows', '.git'];
  for (const marker of markers) {
    try {
      await fs.stat(path.join(absolutePath, marker));
      return { valid: true };
    } catch {
      // Marker doesn't exist, try next
    }
  }

  return {
    valid: false,
    reason: 'No .robomesh/, workflows/, or .git directory found'
  };
}

/**
 * Initialize a workspace by creating .robomesh/ directory
 * Optionally creates workflows/ directory as well
 */
export async function initWorkspace(
  workspacePath: string,
  options: { createWorkflows?: boolean } = {}
): Promise<void> {
  const absolutePath = path.resolve(workspacePath);

  // Create .robomesh directory
  const robomeshDir = path.join(absolutePath, '.robomesh');
  await fs.mkdir(robomeshDir, { recursive: true });

  // Create a minimal config file
  const workspaceConfig = {
    name: path.basename(absolutePath),
    version: 1,
  };
  await fs.writeFile(
    path.join(robomeshDir, 'config.yaml'),
    yaml.dump(workspaceConfig, { indent: 2 }),
    'utf-8'
  );

  // Optionally create workflows directory
  if (options.createWorkflows) {
    const workflowsDir = path.join(absolutePath, 'workflows');
    await fs.mkdir(workflowsDir, { recursive: true });

    // Create a sample workflow
    const sampleWorkflow = {
      version: 1,
      metadata: {
        name: 'Hello World',
        description: 'A simple example workflow',
      },
      nodes: [
        {
          id: 'trigger-1',
          type: 'trigger',
          position: { x: 100, y: 100 },
          data: {
            label: 'Start',
            triggerType: 'manual',
          },
        },
        {
          id: 'shell-1',
          type: 'shell',
          position: { x: 100, y: 200 },
          data: {
            label: 'Echo',
            script: 'echo "Hello from Robomesh!"',
          },
        },
      ],
      edges: [
        {
          id: 'e1',
          source: 'trigger-1',
          target: 'shell-1',
        },
      ],
    };
    await fs.writeFile(
      path.join(workflowsDir, 'hello-world.yaml'),
      yaml.dump(sampleWorkflow, { indent: 2 }),
      'utf-8'
    );
  }
}
