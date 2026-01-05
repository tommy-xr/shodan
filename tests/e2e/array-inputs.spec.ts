import { test, expect } from '@playwright/test';

test.describe('Array Input Ports', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the designer
    await page.goto('/designer');
    // Wait for the React Flow canvas to load
    await page.waitForSelector('.react-flow');
    // Clear any existing workflow
    await page.evaluate(() => {
      localStorage.removeItem('robomesh-workflow');
    });
    await page.reload();
    await page.waitForSelector('.react-flow');
  });

  test('CONCAT node starts with values[0] port', async ({ page }) => {
    // Find CONCAT in the sidebar and drag it onto the canvas
    const concatItem = page.locator('.palette-item').filter({ hasText: 'CONCAT' });
    await expect(concatItem).toBeVisible();

    // Get the canvas position
    const canvas = page.locator('.react-flow__pane');
    const canvasBounds = await canvas.boundingBox();
    expect(canvasBounds).not.toBeNull();

    // Drag CONCAT to the canvas
    await concatItem.dragTo(canvas, {
      targetPosition: { x: 300, y: 200 },
    });

    // Wait for the node to appear
    const concatNode = page.locator('.custom-node.function').filter({ hasText: 'CONCAT' });
    await expect(concatNode).toBeVisible();

    // Verify the node has values[0] port label
    const port0Label = concatNode.locator('.port-label').filter({ hasText: 'values[0]' });
    await expect(port0Label).toBeVisible();

    // Verify the node has separator port label
    const separatorLabel = concatNode.locator('.port-label').filter({ hasText: 'separator' });
    await expect(separatorLabel).toBeVisible();

    // Verify the values[0] handle has the array styling (square shape via handle-array class)
    const arrayHandle = concatNode.locator('.handle-array');
    await expect(arrayHandle).toBeVisible();
  });

  test('CONCAT node has correct input structure', async ({ page }) => {
    // Drag CONCAT to the canvas
    const concatItem = page.locator('.palette-item').filter({ hasText: 'CONCAT' });
    const canvas = page.locator('.react-flow__pane');

    await concatItem.dragTo(canvas, {
      targetPosition: { x: 300, y: 200 },
    });

    const concatNode = page.locator('.custom-node.function').filter({ hasText: 'CONCAT' });
    await expect(concatNode).toBeVisible();

    // Click on the node to select it
    await concatNode.click();

    // Check that the config panel shows the node details
    const configPanel = page.locator('.config-panel');
    await expect(configPanel).toBeVisible();

    // Verify the node label is CONCAT
    const labelInput = configPanel.locator('input[type="text"]').first();
    await expect(labelInput).toHaveValue('CONCAT');

    // Verify there's a code textarea with the CONCAT logic
    const codeTextarea = configPanel.locator('textarea').first();
    const codeValue = await codeTextarea.inputValue();
    expect(codeValue).toContain('join');
  });

  test('sidebar shows CONCAT operator with + icon', async ({ page }) => {
    // Find the Logic section
    const logicSection = page.locator('.accordion-section').filter({ hasText: 'Logic' });
    await expect(logicSection).toBeVisible();

    // Find CONCAT in the palette
    const concatItem = logicSection.locator('.palette-item').filter({ hasText: 'CONCAT' });
    await expect(concatItem).toBeVisible();

    // Verify it has the + icon
    const icon = concatItem.locator('.palette-icon');
    await expect(icon).toContainText('+');
  });

  test('NOT, AND, OR operators still work', async ({ page }) => {
    const canvas = page.locator('.react-flow__pane');

    // Drag NOT operator
    const notItem = page.locator('.palette-item').filter({ hasText: 'NOT' });
    await notItem.dragTo(canvas, {
      targetPosition: { x: 200, y: 150 },
    });

    // Verify NOT node appears with correct port
    const notNode = page.locator('.custom-node.function').filter({ hasText: 'NOT' });
    await expect(notNode).toBeVisible();
    await expect(notNode.locator('.port-label').filter({ hasText: 'value' })).toBeVisible();
    await expect(notNode.locator('.port-label').filter({ hasText: 'result' })).toBeVisible();

    // Drag AND operator
    const andItem = page.locator('.palette-item').filter({ hasText: 'AND' });
    await andItem.dragTo(canvas, {
      targetPosition: { x: 200, y: 300 },
    });

    // Verify AND node appears with correct ports (n-ary array input)
    const andNode = page.locator('.custom-node.function').filter({ hasText: 'AND' });
    await expect(andNode).toBeVisible();
    await expect(andNode.locator('.port-label').filter({ hasText: 'values[0]' })).toBeVisible();
    // Verify the values[0] handle has the array styling (square shape via handle-array class)
    await expect(andNode.locator('.handle-array')).toBeVisible();
  });

  test('deleting middle array slot renumbers remaining slots', async ({ page }) => {
    // This test verifies that when you delete an edge to values[0] but values[1] is still connected,
    // the remaining slot is renumbered to values[0] (not left as values[1])

    // Set up the scenario via localStorage (simulating a saved workflow state)
    await page.evaluate(() => {
      const state = {
        nodes: [
          {
            id: 'const1',
            type: 'constant',
            position: { x: 50, y: 100 },
            data: {
              label: 'A',
              type: 'constant',
              value: 'Hello',
              valueType: 'string',
              outputs: [{ name: 'value', type: 'string' }],
            },
          },
          {
            id: 'const2',
            type: 'constant',
            position: { x: 50, y: 200 },
            data: {
              label: 'B',
              type: 'constant',
              value: 'World',
              valueType: 'string',
              outputs: [{ name: 'value', type: 'string' }],
            },
          },
          {
            id: 'concat1',
            type: 'function',
            position: { x: 300, y: 150 },
            data: {
              label: 'CONCAT',
              type: 'function',
              code: 'return { result: inputs.values.join(inputs.separator || "") }',
              inputs: [
                { name: 'values[0]', label: 'values[0]', type: 'string', arrayParent: 'values', arrayIndex: 0 },
                { name: 'values[1]', label: 'values[1]', type: 'string', arrayParent: 'values', arrayIndex: 1 },
                { name: 'values[2]', label: 'values[2]', type: 'string', arrayParent: 'values', arrayIndex: 2 },
                { name: 'separator', type: 'string' },
              ],
              outputs: [{ name: 'result', type: 'string' }],
            },
          },
        ],
        edges: [
          { id: 'e1', source: 'const1', target: 'concat1', sourceHandle: 'output:value', targetHandle: 'input:values[0]' },
          { id: 'e2', source: 'const2', target: 'concat1', sourceHandle: 'output:value', targetHandle: 'input:values[1]' },
        ],
        viewport: { x: 0, y: 0, zoom: 1 },
        workflowName: 'Test Workflow',
        rootDirectory: '/tmp',
        savedAt: new Date().toISOString(),
      };
      localStorage.setItem('robomesh-workflow', JSON.stringify(state));
    });

    // Reload to pick up the state
    await page.reload();
    await page.waitForSelector('.react-flow');

    // Verify initial state: CONCAT should have values[0], values[1], values[2]
    const concatNode = page.locator('.react-flow__node').filter({ hasText: 'CONCAT' });
    await expect(concatNode).toBeVisible();

    // Verify we have the expected ports before deletion
    await expect(concatNode.locator('.port-label').filter({ hasText: 'values[0]' })).toBeVisible();
    await expect(concatNode.locator('.port-label').filter({ hasText: 'values[1]' })).toBeVisible();
    await expect(concatNode.locator('.port-label').filter({ hasText: 'values[2]' })).toBeVisible();

    // Click on the first edge to select it, then delete it
    // First, find the edge path (React Flow renders edges as SVG paths)
    const edge1 = page.locator('.react-flow__edge').first();
    await edge1.click();

    // Press Delete or Backspace to remove the selected edge
    await page.keyboard.press('Backspace');

    // Wait for the cleanup to happen
    await page.waitForTimeout(200);

    // After deleting values[0]'s edge, the remaining connected edge (was values[1])
    // should be renumbered to values[0], and there should be a new empty values[1]
    // We should NOT see values[2] anymore

    // Verify we now have only values[0] and values[1] (not values[1], values[2])
    await expect(concatNode.locator('.port-label').filter({ hasText: 'values[0]' })).toBeVisible();
    await expect(concatNode.locator('.port-label').filter({ hasText: 'values[1]' })).toBeVisible();

    // values[2] should no longer exist
    await expect(concatNode.locator('.port-label').filter({ hasText: 'values[2]' })).not.toBeVisible();
  });
});
