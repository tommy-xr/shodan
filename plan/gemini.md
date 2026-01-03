# Gemini CLI Runner

## Overview

Implement a Gemini CLI runner to support Google's Gemini CLI as an agent runner.

## CLI Reference

```bash
gemini [query..] [options]
```

Key options:
- `-m, --model` - Model to use
- `-o, --output-format` - Output format: `text`, `json`, `stream-json`
- `-y, --yolo` - Automatically accept all actions
- `--approval-mode` - Set approval mode: `default`, `auto_edit`, `yolo`
- `-r, --resume` - Resume a previous session
- `-s, --sandbox` - Run in sandbox mode

## Implementation Tasks

### 1. Create Runner File

Create `packages/server/src/engine/agents/gemini-cli.ts`:

- Spawn `gemini` CLI with appropriate arguments
- Use `--output-format json` or `stream-json` for structured output
- Parse JSON/JSONL output to extract results

### 2. Permission Handling

For `dangerouslySkipPermissions`:
- Use `--yolo` flag OR `--approval-mode yolo`
- Both achieve the same result (auto-approve all tools)

### 3. Session Management

- Use `-r, --resume` with session ID for resuming sessions
- Need to capture session ID from initial run output

### 4. Streaming Support

- Use `--output-format stream-json` with `onOutput` callback
- Parse JSONL events and extract text content

## Notes

- The `gemini-cli` runner type is already defined in `types.ts`
- Needs to be registered in `packages/server/src/engine/agents/index.ts`
