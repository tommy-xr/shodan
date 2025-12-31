# Re-entrant Runner: Agent Session Persistence

## Summary

Enable agent nodes to maintain conversation context across loop iterations by adding session management to the runner system.

**Key insight:** Session ID flows through the graph as data via feedback docks - no hidden state needed.

## Architecture

### Session-Aware Agent Model

Resumable agents have a dedicated `sessionId` port:

```
┌──────────────────────────────┐
│     Coder Agent              │
│     (claude-code)            │
├──────────────────────────────┤
│ ● prompt       sessionId ●   │
│ ● sessionId    output    ●   │
└──────────────────────────────┘
```

**Inputs:**
- `prompt`: The task or feedback text (same port for both)
- `sessionId`: Optional - if connected, resume that session

**Outputs:**
- `sessionId`: The session ID (newly created or passed through)
- `output`: The agent's response

**Behavior:**
- `sessionId` not connected → create new session, return new ID
- `sessionId` connected → resume that session, pass ID through

### Loop Wiring

```
┌──────────────────────────────────────────────────────────────────┐
│  Loop Container                                                  │
│                                                                  │
│  ┌───────────────────┐     ┌─────────────┐     ┌─────────────┐  │
│  │ prompt ──────────►│     │             │────►│             │  │
│  │                   │─────│   Coder     │     │  Reviewer   │  │
│  │ sessionId ◄──────►│     │   Agent     │     │   Agent     │  │
│  │ (feedback dock)   │     │             │     │             │  │
│  └───────────────────┘     └──────┬──────┘     └──────┬──────┘  │
│                                   │                   │         │
│                             sessionId              feedback     │
│                                   │                   │         │
│  ┌─────────────┐                  │                   │         │
│  │ session     │◄─────────────────┘                   │         │
│  │ (feedback)  │                                      │         │
│  └──────┬──────┘                                      │         │
│         │                                             │         │
│         └──────► sessionId + feedback ◄───────────────┘         │
│                  (combined for next iteration)                  │
│                                                                 │
│  ┌─────────────┐                                                │
│  │ continue    │◄─────────────────── approved (boolean)         │
│  └─────────────┘                                                │
└─────────────────────────────────────────────────────────────────┘
```

**Iteration 1:**
1. Coder receives `prompt` (task), no `sessionId` → creates session "abc"
2. Coder outputs `sessionId: "abc"` and `output: "..."`
3. Reviewer evaluates, outputs `feedback` and `approved: false`
4. Session feedback dock stores `{ sessionId: "abc", feedback: "..." }`

**Iteration 2+:**
1. Coder receives `prompt` (feedback from reviewer) AND `sessionId: "abc"`
2. Coder resumes session "abc" with the feedback
3. Loop continues until approved

---

## Implementation Plan

### Phase 1: Agent Types & Runner Updates

**Files to modify:**
- `packages/server/src/engine/agents/types.ts`
- `packages/server/src/engine/agents/claude-code.ts`
- `packages/server/src/engine/agents/codex.ts`
- `packages/server/src/engine/agents/openai.ts`
- `packages/server/src/engine/agents/gemini-cli.ts`

#### 1.1 Extend AgentConfig

```typescript
// packages/server/src/engine/agents/types.ts
interface AgentConfig {
  runner: RunnerType;
  model?: string;
  prompt: string;
  cwd: string;
  inputValues?: Record<string, unknown>;

  // NEW: Session management
  sessionId?: string;       // Resume this session
  createSession?: boolean;  // Create new session, return ID
}
```

#### 1.2 Extend AgentResult

```typescript
interface AgentResult {
  success: boolean;
  output: string;
  structuredOutput?: unknown;
  error?: string;

  // NEW: Session info
  sessionId?: string;
}
```

#### 1.3 Update Claude Code Runner

```typescript
// packages/server/src/engine/agents/claude-code.ts
async function runClaudeCli(config: AgentConfig): Promise<AgentResult> {
  const args: string[] = ['--print', '--output-format', 'json'];

  let sessionId = config.sessionId;

  if (config.sessionId) {
    // Resume existing session
    args.push('--resume', config.sessionId);
  } else if (config.createSession) {
    // Create new session
    sessionId = crypto.randomUUID();
    args.push('--session-id', sessionId);
  }

  args.push('-p', config.prompt);

  if (config.model) {
    args.push('--model', config.model);
  }

  // ... existing spawn logic ...

  return {
    success: true,
    output: result,
    sessionId,  // Return session ID
  };
}
```

#### 1.4 Update Codex Runner

```typescript
// packages/server/src/engine/agents/codex.ts
async function runCodexCli(config: AgentConfig): Promise<AgentResult> {
  let args: string[];
  let sessionId = config.sessionId;

  if (config.sessionId) {
    // Resume - note: no --json support on resume
    args = ['exec', 'resume', config.sessionId, config.prompt];
  } else {
    // New session
    args = ['exec', config.prompt, '--json', '--skip-git-repo-check'];
  }

  // ... spawn logic ...

  // Extract thread_id from JSON output if new session
  if (!config.sessionId) {
    sessionId = extractThreadId(stdout);
  }

  return {
    success: true,
    output: result,
    sessionId,
  };
}

function extractThreadId(jsonlOutput: string): string | undefined {
  const firstLine = jsonlOutput.split('\n')[0];
  try {
    const parsed = JSON.parse(firstLine);
    if (parsed.type === 'thread.started') {
      return parsed.thread_id;
    }
  } catch {}
  return undefined;
}
```

#### 1.5 Update OpenAI Runner (Conversation History)

OpenAI Chat Completions API doesn't have server-side sessions, but we can achieve resumability by:
1. **Storing conversation history** in the session state
2. **Passing full history** on each call

```typescript
// packages/server/src/engine/agents/openai.ts

interface ConversationMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OpenAISession {
  messages: ConversationMessage[];
}

export const openaiRunner: AgentRunner = {
  name: 'openai',

  async execute(config: AgentConfig): Promise<AgentResult> {
    let messages: ConversationMessage[] = [];
    let sessionData: OpenAISession | undefined;

    // If resuming, parse the session to get conversation history
    if (config.sessionId && config.conversationHistory) {
      sessionData = config.conversationHistory as OpenAISession;
      messages = [...sessionData.messages];
    }

    // Add the new user message
    messages.push({ role: 'user', content: config.prompt });

    // Make API call with full history
    const response = await callOpenAI(config.model, messages);

    // Add assistant response to history
    messages.push({ role: 'assistant', content: response.content });

    // Generate session ID if new session
    const sessionId = config.sessionId || crypto.randomUUID();

    return {
      success: true,
      output: response.content,
      sessionId,
      // Return updated conversation history for next iteration
      conversationHistory: { messages },
    };
  },
};
```

**Key difference from CLI runners:** OpenAI session state includes the full `messages` array, not just an ID. The executor must pass this through the feedback dock.

#### 1.6 Update OpenAI Runner (Alternative: Assistants API)

OpenAI's Assistants API has native threads with server-side persistence:

```typescript
// Alternative: Use OpenAI Assistants API for true server-side sessions
async function executeWithAssistants(config: AgentConfig): Promise<AgentResult> {
  const openai = new OpenAI();

  let threadId = config.sessionId;

  if (!threadId) {
    // Create new thread
    const thread = await openai.beta.threads.create();
    threadId = thread.id;
  }

  // Add message to thread
  await openai.beta.threads.messages.create(threadId, {
    role: 'user',
    content: config.prompt,
  });

  // Run the assistant
  const run = await openai.beta.threads.runs.createAndPoll(threadId, {
    assistant_id: config.assistantId,  // Would need to configure this
  });

  // Get the response
  const messages = await openai.beta.threads.messages.list(threadId);
  const lastMessage = messages.data[0];

  return {
    success: true,
    output: lastMessage.content[0].text.value,
    sessionId: threadId,  // Thread ID persists on OpenAI servers
  };
}
```

**Trade-offs:**
- **Chat Completions + History:** Client-side state, works with any model, more control
- **Assistants API:** Server-side state, simpler session management, requires assistant setup

#### 1.7 Update Gemini CLI Runner

Need to check if Gemini CLI supports session persistence. If not, may need to use the Gemini API directly with conversation history (similar to OpenAI Chat Completions approach).

```bash
# Check gemini CLI for session flags
gemini --help | grep -i session
gemini --help | grep -i resume
gemini --help | grep -i thread
```

If no CLI support, implement conversation history approach like OpenAI.

---

### Phase 2: Executor Support for Session-Aware Agents

**Files to modify:**
- `packages/server/src/engine/executor.ts`
- `packages/core/src/workflow-types.ts` (if needed)

#### 2.1 Check for sessionId Input

```typescript
// In executeAgentNode or similar
function executeAgentNode(node: WorkflowNode, inputs: Record<string, unknown>) {
  const prompt = inputs['prompt'] as string | node.data.prompt;
  const sessionId = inputs['sessionId'] as string | undefined;

  // If sessionId is provided, resume; otherwise create new
  const createSession = !sessionId;

  return runAgent({
    ...node.data,
    prompt,
    sessionId,
    createSession,
  });
}
```

#### 2.2 Output Session ID Separately

Agent node outputs `sessionId` as its own port:

```typescript
// After agent execution
const result = await runAgent(config);

return {
  outputs: {
    sessionId: result.sessionId,  // Dedicated port
    output: result.output,        // Dedicated port
  }
};
```

This allows explicit wiring of `sessionId` between agents.

---

### Phase 3: Designer UI (Optional but Recommended)

**Files to modify:**
- `packages/designer/src/nodes/BaseNode.tsx`
- `packages/designer/src/components/ConfigPanel.tsx`

#### 3.1 Show Two Input Ports for Resumable Agents

When an agent node has `resumable: true` or defines both `taskPrompt` and `iteratePrompt` inputs:

```tsx
// In BaseNode.tsx port rendering
{node.data.inputs?.map(input => (
  <Handle
    type="target"
    position={Position.Left}
    id={`input:${input.name}`}
    // ... styling
  />
))}
```

#### 3.2 Config Panel Option

Add a checkbox or toggle in ConfigPanel:
- "Enable session persistence" → adds `taskPrompt`/`iteratePrompt` ports

---

### Phase 4: Test Workflow

Create a test workflow to validate the implementation:

```yaml
# workflows/test-resumable-agent.yaml
version: 2
metadata:
  name: Resumable Agent Test
  description: Test agent session persistence in a loop

nodes:
  - id: trigger
    type: trigger
    position: { x: 100, y: 200 }
    data:
      label: Start
      triggerType: manual

  - id: loop
    type: loop
    position: { x: 300, y: 100 }
    style: { width: 600, height: 400 }
    data:
      label: Review Loop
      maxIterations: 5
      dockSlots:
        - name: iteration
          type: iteration
        - name: session
          type: feedback
        - name: continue
          type: continue

  - id: coder
    type: agent
    parentId: loop
    position: { x: 50, y: 80 }
    data:
      label: Coder
      runner: claude-code
      model: sonnet
      inputs:
        - name: taskPrompt
          type: string
        - name: iteratePrompt
          type: json
      outputs:
        - name: result
          type: json

  - id: reviewer
    type: agent
    parentId: loop
    position: { x: 300, y: 80 }
    data:
      label: Reviewer
      runner: claude-code
      model: haiku
      prompt: |
        Review the coder's work. Output JSON:
        { "approved": boolean, "feedback": "..." }
      outputSchema: |
        { "type": "object", "properties": { "approved": { "type": "boolean" }, "feedback": { "type": "string" } } }

edges:
  - id: e1
    source: trigger
    target: loop
    targetHandle: input:task
  - id: e2
    source: loop
    target: coder
    sourceHandle: dock:iteration:output
    targetHandle: input:taskPrompt
  - id: e3
    source: loop
    target: coder
    sourceHandle: dock:session:prev
    targetHandle: input:iteratePrompt
  - id: e4
    source: coder
    target: loop
    sourceHandle: output:result
    targetHandle: dock:session:current
  - id: e5
    source: coder
    target: reviewer
    sourceHandle: output:result
  - id: e6
    source: reviewer
    target: loop
    sourceHandle: output:approved
    targetHandle: dock:continue:input
```

---

## Task Checklist

### Phase 1: Runner Updates
- [ ] Add `sessionId`, `createSession`, `conversationHistory` to `AgentConfig`
- [ ] Add `sessionId`, `conversationHistory` to `AgentResult`
- [ ] Update `claude-code.ts` with `--session-id` / `--resume` flags
- [ ] Update `codex.ts` with resume support and thread_id extraction
- [ ] Update `openai.ts` with conversation history support
- [ ] Check `gemini-cli` for session support, implement if available
- [ ] Add unit tests for session persistence

### Phase 2: Executor Updates
- [ ] Check for `sessionId` input port to determine resume vs create
- [ ] Pass `sessionId` / `createSession` / `conversationHistory` to runner
- [ ] Output `sessionId` as dedicated port (not bundled with output)
- [ ] Handle conversation history in feedback dock for OpenAI

### Phase 3: Designer UI
- [ ] Show multiple input ports on agent nodes
- [ ] Add "resumable" toggle to agent config panel
- [ ] Update port rendering for two-input agents

### Phase 4: Integration Tests
- [ ] Test workflow: `workflows/test-resumable-claude-code.yaml`
- [ ] Test workflow: `workflows/test-resumable-codex.yaml`
- [ ] Test workflow: `workflows/test-resumable-openai.yaml`
- [ ] Verify session persists across iterations for each runner
- [ ] Verify restart works (new session on loop restart)

---

## CLI Reference (Validated)

### Claude Code
```bash
# Start new session
claude --session-id "$UUID" -p "task..." --output-format json

# Resume session
claude --resume "$UUID" -p "feedback..." --output-format json
```

### Codex
```bash
# Start new session (thread_id in output)
codex exec "task..." --json --skip-git-repo-check

# Resume session (no --json support)
codex exec resume "$THREAD_ID" "feedback..."
```

**Note:** Codex resume doesn't support `--json`, so streaming only works on first iteration.

### OpenAI API
```typescript
// Option 1: Conversation History (client-side state)
// Store messages array in session, pass full history each call
const messages = [...previousMessages, { role: 'user', content: prompt }];
const response = await openai.chat.completions.create({ model, messages });

// Option 2: Assistants API (server-side state)
// Thread ID persists on OpenAI servers
const thread = await openai.beta.threads.create();
await openai.beta.threads.messages.create(thread.id, { role: 'user', content: prompt });
const run = await openai.beta.threads.runs.createAndPoll(thread.id, { assistant_id });
```

**Recommendation:** Start with conversation history approach - simpler, no assistant setup required.

---

## Advanced Patterns

### Pattern A: Shared Session Across Sequential Loops

For multi-stage validation (review → test → de-dup), wire `sessionId` between loops:

```
┌─ Review Loop ─────────────────────────┐
│  Coder ──► Reviewer ──► approved?     │
│    ▲           │                      │
│    └─ feedback ┘                      │
└──────────┬────────────────────────────┘
           │
     sessionId ──────────────────┐
           │                     │
           ▼                     ▼
┌─ Test Loop ───────────────────────────┐
│  Coder ◄── sessionId                  │
│    ▲   ◄── "run tests and fix"        │
│    │           │                      │
│    └─ Tester ──┴──► passed?           │
└───────────────────────────────────────┘
           │
           ▼
        Done!
```

**Wiring:**
- Loop 1 Coder: no `sessionId` input → creates new session "abc"
- Loop 1 Coder outputs: `sessionId: "abc"`, `output: "..."`
- Loop 2 Coder: receives `sessionId: "abc"` → resumes session
- Session history maintained across all validation phases
- Each loop is self-contained, no nesting required

### Pattern B: Retry Gate Primitive (Future)

See [retry-gate.md](./retry-gate.md) for detailed design.

A gate node for flat multi-stage validation pipelines that can re-trigger upstream nodes on failure. Enables patterns like `Coder → Review → Test → Gate → done` with automatic retry.

---

## Test Workflows

Created test workflows for each runner type:

| Runner | Workflow | Notes |
|--------|----------|-------|
| claude-code | `workflows/test-resumable-claude-code.yaml` | Uses `--session-id` / `--resume` |
| codex | `workflows/test-resumable-codex.yaml` | Uses `thread_id` from output |
| openai | `workflows/test-resumable-openai.yaml` | Uses conversation history |
