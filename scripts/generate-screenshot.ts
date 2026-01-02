#!/usr/bin/env npx tsx
/**
 * Generate README screenshots using Playwright
 *
 * Prerequisites:
 * - Server running (pnpm run -F server dev)
 * - Designer running (pnpm run -F designer dev)
 *
 * Usage:
 *   npx tsx scripts/generate-screenshot.ts
 *
 * Or via pnpm:
 *   pnpm run generate:screenshot
 */

import { chromium } from 'playwright';
import { resolve } from 'path';

const BASE_URL = process.env.DESIGNER_URL || 'http://localhost:5173';
const WORKFLOW_PATH = resolve(process.cwd(), 'workflows/test-session-persistence.yaml');
const DASHBOARD_SCREENSHOT = resolve(process.cwd(), 'docs/dashboard.png');
const DESIGNER_SCREENSHOT = resolve(process.cwd(), 'docs/screenshot.png');

async function main() {
  console.log('Launching browser...');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Set viewport size for consistent screenshots
  await page.setViewportSize({ width: 1400, height: 800 });

  // === Dashboard Screenshot ===
  console.log(`Navigating to dashboard at ${BASE_URL}...`);
  await page.goto(BASE_URL);
  await page.waitForLoadState('networkidle');

  // Wait for workflows to load
  await page.waitForTimeout(1000);

  console.log(`Taking dashboard screenshot: ${DASHBOARD_SCREENSHOT}`);
  await page.screenshot({ path: DASHBOARD_SCREENSHOT, type: 'png' });

  // === Designer Screenshot ===
  console.log(`Navigating to designer at ${BASE_URL}/designer...`);
  await page.goto(`${BASE_URL}/designer`);
  await page.waitForLoadState('networkidle');

  console.log('Opening File menu...');
  await page.getByRole('button', { name: /File/ }).click();

  console.log('Clicking Import...');
  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Import/ }).click();

  console.log(`Uploading workflow: ${WORKFLOW_PATH}`);
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(WORKFLOW_PATH);

  // Wait for workflow to load
  await page.waitForTimeout(500);

  console.log('Fitting view...');
  await page.getByRole('button', { name: 'Fit View' }).click();
  await page.waitForTimeout(300);

  console.log('Selecting first agent node...');
  await page.getByTestId('rf__node-first_call').click();
  await page.waitForTimeout(200);

  console.log(`Taking designer screenshot: ${DESIGNER_SCREENSHOT}`);
  await page.screenshot({ path: DESIGNER_SCREENSHOT, type: 'png' });

  await browser.close();
  console.log('Done!');
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
