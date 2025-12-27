import { Router } from 'express';
import fs from 'fs/promises';
import path from 'path';
import yaml from 'js-yaml';
import type { PortDefinition, WorkflowSchema } from '@shodan/core';

interface CreateComponentRequest {
  name: string;
  description?: string;
  filename: string;
  inputs: PortDefinition[];
  outputs: PortDefinition[];
}

export interface ComponentInfo {
  name: string;
  description?: string;
  path: string;  // Relative path from project root
  inputs: PortDefinition[];
  outputs: PortDefinition[];
}

export interface ComponentWorkflow {
  name: string;
  description?: string;
  path: string;
  nodes: WorkflowSchema['nodes'];
  edges: WorkflowSchema['edges'];
  interface?: WorkflowSchema['interface'];
}

export function createComponentsRouter(projectRoot: string): Router {
  const router = Router();

  // List available components from workflows/components/ directory
  router.get('/list', async (_req, res) => {
    try {
      const componentsDir = path.join(projectRoot, 'workflows', 'components');

      let entries: string[] = [];
      try {
        const dirContents = await fs.readdir(componentsDir);
        entries = dirContents.filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
      } catch (err) {
        // Directory doesn't exist, return empty list
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          return res.json({ components: [] });
        }
        throw err;
      }

      const components: ComponentInfo[] = [];

      for (const file of entries) {
        const filePath = path.join(componentsDir, file);
        const relativePath = path.join('workflows', 'components', file);

        try {
          const content = await fs.readFile(filePath, 'utf-8');
          const schema = yaml.load(content) as WorkflowSchema;

          // Only include workflows that have an interface defined
          if (schema.interface) {
            components.push({
              name: schema.metadata?.name || file.replace(/\.(yaml|yml)$/, ''),
              description: schema.metadata?.description,
              path: relativePath,
              inputs: schema.interface.inputs || [],
              outputs: schema.interface.outputs || [],
            });
          }
        } catch (parseErr) {
          // Skip files that can't be parsed
          console.warn(`Failed to parse component ${file}:`, parseErr);
        }
      }

      res.json({ components });
    } catch (error) {
      console.error('Error listing components:', error);
      res.status(500).json({ error: 'Failed to list components' });
    }
  });

  // Get details of a specific component
  router.get('/info', async (req, res) => {
    try {
      const componentPath = req.query.path as string;

      if (!componentPath) {
        return res.status(400).json({ error: 'path parameter is required' });
      }

      const fullPath = path.resolve(projectRoot, componentPath);

      // Security: ensure we're not escaping the project root
      if (!fullPath.startsWith(projectRoot)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const content = await fs.readFile(fullPath, 'utf-8');
      const schema = yaml.load(content) as WorkflowSchema;

      if (!schema.interface) {
        return res.status(400).json({ error: 'Workflow does not have an interface defined' });
      }

      const component: ComponentInfo = {
        name: schema.metadata?.name || path.basename(componentPath).replace(/\.(yaml|yml)$/, ''),
        description: schema.metadata?.description,
        path: componentPath,
        inputs: schema.interface.inputs || [],
        outputs: schema.interface.outputs || [],
      };

      res.json(component);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return res.status(404).json({ error: 'Component not found' });
      }
      console.error('Error getting component info:', error);
      res.status(500).json({ error: 'Failed to get component info' });
    }
  });

  // Load a component's full workflow for editing
  router.get('/workflow', async (req, res) => {
    try {
      const componentPath = req.query.path as string;

      if (!componentPath) {
        return res.status(400).json({ error: 'path parameter is required' });
      }

      const fullPath = path.resolve(projectRoot, componentPath);

      // Security: ensure we're not escaping the project root
      if (!fullPath.startsWith(projectRoot)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const content = await fs.readFile(fullPath, 'utf-8');
      const schema = yaml.load(content) as WorkflowSchema;

      const workflow: ComponentWorkflow = {
        name: schema.metadata?.name || path.basename(componentPath).replace(/\.(yaml|yml)$/, ''),
        description: schema.metadata?.description,
        path: componentPath,
        nodes: schema.nodes || [],
        edges: schema.edges || [],
        interface: schema.interface,
      };

      res.json(workflow);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return res.status(404).json({ error: 'Component not found' });
      }
      console.error('Error loading component workflow:', error);
      res.status(500).json({ error: 'Failed to load component workflow' });
    }
  });

  // Create a new component
  router.post('/create', async (req, res) => {
    try {
      const { name, description, filename, inputs, outputs } = req.body as CreateComponentRequest;

      if (!name || !filename) {
        return res.status(400).json({ error: 'name and filename are required' });
      }

      // Ensure components directory exists
      const componentsDir = path.join(projectRoot, 'workflows', 'components');
      await fs.mkdir(componentsDir, { recursive: true });

      const filePath = path.join(componentsDir, `${filename}.yaml`);
      const relativePath = path.join('workflows', 'components', `${filename}.yaml`);

      // Security: ensure we're not escaping the components directory
      if (!filePath.startsWith(componentsDir)) {
        return res.status(403).json({ error: 'Invalid filename' });
      }

      // Check if file already exists
      try {
        await fs.access(filePath);
        return res.status(409).json({ error: 'Component already exists' });
      } catch {
        // File doesn't exist, good to create
      }

      // Create the workflow schema with interface-input and interface-output nodes
      const workflow: WorkflowSchema = {
        version: 2,
        metadata: {
          name,
          description: description || undefined,
        },
        interface: {
          inputs: inputs || [],
          outputs: outputs || [],
        },
        nodes: [
          {
            id: 'input-proxy',
            type: 'interface-input',
            position: { x: 100, y: 200 },
            data: {
              nodeType: 'interface-input',
              label: 'Input',
              outputs: (inputs || []).map(input => ({
                name: input.name,
                type: input.type,
                description: input.description,
              })),
            },
          },
          {
            id: 'output-proxy',
            type: 'interface-output',
            position: { x: 500, y: 200 },
            data: {
              nodeType: 'interface-output',
              label: 'Output',
              inputs: (outputs || []).map(output => ({
                name: output.name,
                type: output.type,
                description: output.description,
              })),
            },
          },
        ],
        edges: [],
      };

      const content = yaml.dump(workflow, { lineWidth: -1, noRefs: true });
      await fs.writeFile(filePath, content, 'utf-8');

      const component: ComponentInfo = {
        name,
        description,
        path: relativePath,
        inputs: inputs || [],
        outputs: outputs || [],
      };

      res.status(201).json(component);
    } catch (error) {
      console.error('Error creating component:', error);
      res.status(500).json({ error: 'Failed to create component' });
    }
  });

  // Save/update a component workflow
  router.put('/workflow', async (req, res) => {
    try {
      const { path: componentPath, nodes, edges, metadata, interface: iface } = req.body;

      if (!componentPath) {
        return res.status(400).json({ error: 'path is required' });
      }

      const fullPath = path.resolve(projectRoot, componentPath);

      // Security: ensure we're not escaping the project root
      if (!fullPath.startsWith(projectRoot)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Build the workflow schema
      const workflow: WorkflowSchema = {
        version: 2,
        metadata: metadata || {},
        interface: iface,
        nodes: nodes || [],
        edges: edges || [],
      };

      const content = yaml.dump(workflow, { lineWidth: -1, noRefs: true });
      await fs.writeFile(fullPath, content, 'utf-8');

      res.json({ success: true, path: componentPath });
    } catch (error) {
      console.error('Error saving component:', error);
      res.status(500).json({ error: 'Failed to save component' });
    }
  });

  return router;
}
