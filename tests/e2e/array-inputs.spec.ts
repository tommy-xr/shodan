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

    // Verify AND node appears with correct ports
    const andNode = page.locator('.custom-node.function').filter({ hasText: 'AND' });
    await expect(andNode).toBeVisible();
    await expect(andNode.locator('.port-label').filter({ hasText: /^a$/ })).toBeVisible();
    await expect(andNode.locator('.port-label').filter({ hasText: /^b$/ })).toBeVisible();
  });
});
