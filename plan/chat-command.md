# Chat Command

Interactive CLI mode for running workflows with conversational input, similar to Claude Code or Codex.

## Overview

Add a `robomesh chat [workflow]` command that:
1. Prompts the user for input interactively
2. Pipes input to the workflow's manual trigger
3. Shows node execution progress with streaming output
4. Exits after workflow completes (single-shot, no REPL for now)

## Usage

```bash
# Explicit workflow file
robomesh chat ./workflows/assistant.yaml

# Shorthand: looks for plan.yaml in workflows/
robomesh chat plan

# Shorthand: looks for build.yaml in workflows/
robomesh chat build

# With options
robomesh chat plan --cwd /path/to/project
```

## Workflow Resolution

When given a shorthand name (no path separators, no .yaml extension):
1. Look for `workflows/{name}.yaml`
2. Look for `workflows/{name}.yml`
3. Look for `.robomesh/{name}.yaml`
4. Error if not found

This allows common workflows like `plan`, `build`, `review`, `test` to be invoked quickly.

## Implementation

### Phase 1: Basic Interactive Input

**File: `packages/cli/src/chat.ts`**

```typescript
import * as readline from 'readline';

export async function promptForInput(prompt: string = '> '): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}
```

**Changes to `packages/cli/index.ts`:**

```typescript
if (command === 'chat') {
  const workflowArg = args[1];
  const workflowPath = resolveWorkflowPath(workflowArg);

  // Prompt for input
  const userInput = await promptForInput('> ');

  // Run workflow with input
  await runWorkflow(workflowPath, {
    input: userInput,
    verbose: true,  // Always verbose in chat mode
    ...options,
  });
}
```

### Phase 2: Enhanced Output Formatting

Current output:
```
● NodeName running...
✓ NodeName
```

Enhanced chat output:
```
> What should I build?

┌─ trigger ─────────────────────────────────
│ Input received
└───────────────────────────────────────────

┌─ code-analyzer (agent) ───────────────────
│ Analyzing the codebase structure...
│ Found 3 main components:
│ - API server (packages/server)
│ - CLI tool (packages/cli)
│ - Web designer (packages/designer)
└───────────────────────────────────────────

┌─ run-tests (shell) ───────────────────────
│ $ npm test
│ ✓ 45 tests passing
│
│ Exit code: 0
└───────────────────────────────────────────

✓ Workflow completed in 12.3s
```

**Key formatting decisions:**
- Box drawing characters for node boundaries
- Node label + type in header
- Streaming output indented within the box
- Exit code shown for shell nodes
- Final summary with timing

**Implementation approach:**

Create a `ChatOutputFormatter` class that wraps the existing callbacks:

```typescript
class ChatOutputFormatter {
  private currentNodeId: string | null = null;
  private currentNodeLabel: string = '';
  private currentNodeType: string = '';
  private lineBuffer: string = '';

  onNodeStart(nodeId: string, node: WorkflowNode) {
    // Close previous node box if open
    if (this.currentNodeId) {
      this.closeNodeBox();
    }

    // Open new node box
    this.currentNodeId = nodeId;
    this.currentNodeLabel = node.data.label || nodeId;
    this.currentNodeType = node.data.nodeType || node.type;
    this.openNodeBox();
  }

  onNodeOutput(nodeId: string, chunk: string) {
    // Buffer and print complete lines with proper indentation
    this.lineBuffer += chunk;
    const lines = this.lineBuffer.split('\n');
    this.lineBuffer = lines.pop() || '';

    for (const line of lines) {
      console.log(`│ ${line}`);
    }
  }

  onNodeComplete(nodeId: string, result: NodeResult) {
    // Flush remaining buffer
    if (this.lineBuffer) {
      console.log(`│ ${this.lineBuffer}`);
      this.lineBuffer = '';
    }

    // Show exit code for shell nodes
    if (result.exitCode !== undefined) {
      console.log(`│`);
      console.log(`│ Exit code: ${result.exitCode}`);
    }

    this.closeNodeBox();
    this.currentNodeId = null;
  }

  private openNodeBox() {
    const header = `─ ${this.currentNodeLabel} (${this.currentNodeType}) `;
    const padding = '─'.repeat(Math.max(0, 40 - header.length));
    console.log(`┌${header}${padding}`);
  }

  private closeNodeBox() {
    console.log(`└${'─'.repeat(43)}`);
    console.log('');
  }
}
```

### Phase 3: Workflow Resolution Helper

```typescript
async function resolveWorkflowPath(arg: string | undefined, cwd: string): Promise<string> {
  if (!arg) {
    throw new Error('Please specify a workflow: robomesh chat <workflow>');
  }

  // If it looks like a path, use as-is
  if (arg.includes('/') || arg.includes('\\') || arg.endsWith('.yaml') || arg.endsWith('.yml')) {
    return arg;
  }

  // Shorthand: look for workflow by name
  const candidates = [
    `workflows/${arg}.yaml`,
    `workflows/${arg}.yml`,
    `.robomesh/${arg}.yaml`,
    `.robomesh/${arg}.yml`,
  ];

  for (const candidate of candidates) {
    const fullPath = path.resolve(cwd, candidate);
    try {
      await fs.access(fullPath);
      return fullPath;
    } catch {
      // Continue to next candidate
    }
  }

  throw new Error(`Workflow not found: ${arg}\nLooked in: ${candidates.join(', ')}`);
}
```

## Testing Strategy

### Existing Test Workflows

We already have test workflows that cover the key scenarios:

| Scenario | Workflow | Description |
|----------|----------|-------------|
| Basic | `hello-world.yaml` | Simple trigger → shell |
| Parallel | `test-progressive-slow-parallel.yaml` | 3 parallel branches (0.5s, 1.5s, 3s) then merge |
| Sequential | `test-progressive-slow-linear.yaml` | 3 chained steps (2s, 1s, 1.5s) |
| Streaming | `test-progressive-shell-stream.yaml` | 5 lines with 0.5s delays |
| Error | `test-failure-stops-workflow.yaml` | Success → Failure → Should-not-run |

### Manual Testing Script

```bash
#!/bin/bash
# test-chat.sh - Manual testing script for chat command

echo "=== Test 1: Basic (hello-world) ==="
echo "hello world" | pnpm run robomesh -- chat hello-world

echo ""
echo "=== Test 2: Parallel execution ==="
echo "start" | pnpm run robomesh -- chat test-progressive-slow-parallel

echo ""
echo "=== Test 3: Streaming output ==="
echo "go" | pnpm run robomesh -- chat test-progressive-shell-stream

echo ""
echo "=== Test 4: Sequential ==="
echo "begin" | pnpm run robomesh -- chat test-progressive-slow-linear

echo ""
echo "=== Test 5: Error handling ==="
echo "trigger" | pnpm run robomesh -- chat test-failure-stops-workflow
```

### CLI Test Suite (`test:cli`)

Create a new test suite for CLI-specific functionality, separate from workflow execution tests:

**File structure:**
```
packages/cli/src/
├── __tests__/
│   ├── chat.test.ts      # Chat command tests
│   ├── resolve.test.ts   # Workflow resolution tests
│   └── config.test.ts    # Workspace config tests (existing)
└── test-cli.ts           # Test runner entry point
```

**Test runner** (`packages/cli/src/test-cli.ts`):
```typescript
#!/usr/bin/env npx tsx
/**
 * CLI test suite - tests CLI-specific functionality
 * Usage: pnpm run -F @robomesh/cli test
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { spawn } from 'child_process';
import path from 'path';

// Import unit test modules
import './chat/resolve.test.js';

// E2E tests for chat command
describe('Chat Command E2E', () => {
  const cliPath = path.resolve(import.meta.dirname, '../index.ts');

  test('chat command with piped input executes workflow', async () => {
    const result = await runCli(['chat', 'hello-world'], 'test input');
    assert.strictEqual(result.exitCode, 0, 'Should exit successfully');
    assert.ok(result.stdout.includes('Hello'), 'Should show workflow output');
  });

  test('chat command with invalid workflow shows error', async () => {
    const result = await runCli(['chat', 'nonexistent']);
    assert.notStrictEqual(result.exitCode, 0, 'Should fail');
    assert.ok(result.stderr.includes('not found'), 'Should show error');
  });
});

// Helper to run CLI and capture output
function runCli(args: string[], stdin?: string): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
}> {
  return new Promise((resolve) => {
    const proc = spawn('npx', ['tsx', cliPath, ...args], {
      cwd: path.resolve(import.meta.dirname, '../../..'),
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d) => stdout += d);
    proc.stderr.on('data', (d) => stderr += d);

    if (stdin) {
      proc.stdin.write(stdin);
      proc.stdin.end();
    }

    proc.on('close', (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });
  });
}
```

**Unit tests** (`packages/cli/src/chat/resolve.test.ts`):
```typescript
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { resolveWorkflowPath } from './index.js';

describe('resolveWorkflowPath', () => {
  test('returns path as-is when it contains a slash', async () => {
    const result = await resolveWorkflowPath('./my/workflow.yaml', '/tmp');
    assert.strictEqual(result, './my/workflow.yaml');
  });

  test('resolves shorthand to workflows directory', async () => {
    const result = await resolveWorkflowPath('hello-world', process.cwd());
    assert.ok(result.endsWith('workflows/hello-world.yaml'));
  });

  test('throws for non-existent workflow', async () => {
    await assert.rejects(
      () => resolveWorkflowPath('nonexistent', process.cwd()),
      /Workflow not found/
    );
  });
});
```

**Package.json** (`packages/cli/package.json`):
```json
{
  "scripts": {
    "test": "tsx --test src/test-cli.ts"
  }
}
```

**Root package.json:**
```json
{
  "scripts": {
    "test:cli": "pnpm run -F @robomesh/cli test"
  }
}
```

**CI integration** (`.github/workflows/ci.yml`):
```yaml
- name: Test CLI
  run: pnpm run test:cli
```

This creates a clean separation:
- `test:workflows` - Workflow execution logic (server package)
- `test:cli` - CLI interface, commands, resolution (cli package)
- `test:serve` - API endpoints (server package)

## Edge Cases

1. **Empty input** - Should we allow running with empty input? Probably yes, some workflows might not need it.

2. **Ctrl+C during input** - Should exit cleanly

3. **Ctrl+C during execution** - Should attempt graceful shutdown of running nodes

4. **Very long lines** - May need to wrap at terminal width

5. **Non-TTY input** - Support piping input: `echo "hello" | robomesh chat plan`

6. **Parallel node output interleaving** - When multiple nodes run in parallel, use a focus-based UI:

   **Compact view** (default when multiple nodes running):
   ```
   ┌─ Running 3 nodes ─────────────────────────
   │ [1] code-analyzer   ● Analyzing src/...
   │ [2] lint-check      ● Running eslint...
   │ [3] type-check      ● Checking types...
   └─ Press Ctrl+1/2/3 to expand ──────────────
   ```

   **Expanded view** (after pressing Ctrl+N):
   ```
   ┌─ lint-check (shell) ──────────────────────
   │ $ eslint src/
   │ src/api.ts:45 - warning: unused variable
   │ ...streaming output...
   │
   │ [1] code-analyzer ●  [3] type-check ●
   └─ Press Ctrl+1/3 to switch, Esc to collapse
   ```

   **Implementation requirements:**
   - Raw terminal mode to capture Ctrl+N without Enter
   - ANSI cursor control to update status lines in place
   - Focus state tracking (which node is expanded)
   - Preview text extraction (first N chars of last output line)

   **Library choice: `ink`**

   We'll use `ink` (React for CLI) which provides:
   - React component model - familiar patterns, easy to compose
   - Built-in raw mode - captures Ctrl+N keypresses without Enter
   - Flexbox layout - for positioning status bars and output areas
   - `useInput` hook - clean key handling
   - `useStdin` - for the initial text input
   - Automatic rerendering - state changes update the terminal

   Used by: Gatsby CLI, Yarn, Jest, Prisma, and many others.

   ```bash
   pnpm -F cli add ink react
   pnpm -F cli add -D @types/react
   ```

   **Component sketch:**

   ```tsx
   // packages/cli/src/chat/ChatApp.tsx
   import React, { useState } from 'react';
   import { Box, Text, useInput } from 'ink';

   interface RunningNode {
     id: string;
     label: string;
     type: string;
     preview: string;  // Last line of output, truncated
     output: string[]; // Full output lines
   }

   function ChatApp({ workflow, input }: Props) {
     const [nodes, setNodes] = useState<RunningNode[]>([]);
     const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
     const [completed, setCompleted] = useState<NodeResult[]>([]);

     useInput((input, key) => {
       // Ctrl+1 through Ctrl+9 to focus nodes
       if (key.ctrl && input >= '1' && input <= '9') {
         const idx = parseInt(input) - 1;
         if (idx < nodes.length) {
           setFocusedIndex(focusedIndex === idx ? null : idx);
         }
       }
       if (key.escape) {
         setFocusedIndex(null);
       }
     });

     // When only one node running, show full output
     // When multiple running, show compact unless focused
     if (nodes.length === 1 || focusedIndex !== null) {
       return <ExpandedNodeView node={nodes[focusedIndex ?? 0]} others={nodes} />;
     }

     return <CompactMultiNodeView nodes={nodes} />;
   }
   ```

   **Fallback for non-TTY:** When piping input (`echo "x" | robomesh chat`), fall back to simple prefixed output since hotkeys won't work.

## Future Enhancements (Out of Scope)

- **REPL mode** - Multi-turn conversation with session persistence
- **Agent session targeting** - Re-trigger from a specific agent node
- **Default workflow in config** - `~/.robomesh/config.yaml` defaultWorkflow field
- **History** - Arrow-up to recall previous inputs
- **Tab completion** - Complete workflow names

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| **Chat Command** | | |
| `packages/cli/src/chat/index.ts` | Create | Entry point, workflow resolution, executor integration |
| `packages/cli/src/chat/ChatApp.tsx` | Create | Main ink component with state management |
| `packages/cli/src/chat/CompactNodeView.tsx` | Create | Multi-node status display with previews |
| `packages/cli/src/chat/ExpandedNodeView.tsx` | Create | Single node with full streaming output |
| `packages/cli/src/chat/InputPrompt.tsx` | Create | Initial text input component |
| `packages/cli/index.ts` | Modify | Add `chat` command handler |
| **Testing** | | |
| `packages/cli/src/test-cli.ts` | Create | CLI test suite entry point |
| `packages/cli/src/chat/resolve.test.ts` | Create | Workflow resolution unit tests |
| `packages/cli/package.json` | Modify | Add `test` script |
| `package.json` | Modify | Add `test:cli` script |
| `.github/workflows/ci.yml` | Modify | Add CLI test step |
| `test-chat.sh` | Create | Manual testing script |

## Implementation Order

1. **Setup** - Add ink + react dependencies to CLI package
2. **Basic chat command** - Wire up command, resolve workflow path, prompt for input
3. **Simple ink app** - Single-node output display (no parallel handling yet)
4. **Parallel support** - CompactNodeView with Ctrl+N switching
5. **Polish** - Box drawing, spinners, exit handling
6. **Testing** - Manual tests with existing workflows
7. **Non-TTY fallback** - Detect piped input, use simple output mode
