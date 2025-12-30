# Re-entrant Runner: Agent Loop Persistence

## Problem Statement

When running agent-reviewer loops, we need a way to:
1. Pipe reviewer feedback into an ongoing agent conversation
2. Maintain conversation context across iterations
3. Support multiple CLI runners (Claude Code, Codex)
4. Enable visualization/streaming of agent output
5. Optionally restart agents with fresh context

## Phase 0: Prototype CLI Commands

Validate that session persistence works as expected with each CLI.

### Claude Code

```bash
# Test 1: Start session with known ID
SESSION_ID=$(uuidgen)
claude --session-id "$SESSION_ID" -p "remember the number 42"

# Test 2: Resume with new prompt
claude --resume "$SESSION_ID" -p "what number did I ask you to remember?"
# Expected: Agent recalls "42"

# Test 3: Streaming output
claude --resume "$SESSION_ID" -p "count to 10 slowly" --output-format stream-json
# Observe: JSONL output format

# Test 4: Restart (new session)
NEW_SESSION=$(uuidgen)
claude --session-id "$NEW_SESSION" -p "what number did I ask you to remember?"
# Expected: Agent has no memory of previous session
```

### Codex

```bash
# Test 1: Start session (ID assigned automatically)
codex exec "remember the number 42" --json
# Note: Need to capture session ID from output

# Test 2: Resume with session ID
codex resume <SESSION_ID> "what number did I ask you to remember?"
# Expected: Agent recalls "42"

# Test 3: JSONL streaming
codex exec "count to 10" --json
# Observe: JSONL output format
```

**Key difference:** Claude Code allows setting session ID upfront (`--session-id`), Codex assigns it and you capture from output.

### Phase 0 Results (Validated 2024-12-29)

All tests passed. Key findings:

#### Claude Code

| Test | Command | Result |
|------|---------|--------|
| Start with ID | `claude --session-id "$UUID" -p "remember 42"` | ✅ Works |
| Resume + prompt | `claude --resume "$UUID" -p "what number?"` | ✅ Recalled "42" |
| Streaming | `--output-format stream-json --verbose` | ✅ JSONL output |
| Restart | New UUID = fresh context | ✅ No memory |

**Note:** `--output-format stream-json` requires `--verbose` flag.

**JSONL Schema (Claude Code):**
```json
{"type":"system","subtype":"init","session_id":"...","tools":[...],"model":"..."}
{"type":"assistant","message":{"id":"...","content":[{"type":"text","text":"..."}],"usage":{...}}}
{"type":"result","subtype":"success","duration_ms":...,"result":"...","total_cost_usd":...}
```

#### Codex

| Test | Command | Result |
|------|---------|--------|
| Start + capture ID | `codex exec "remember 73" --json` | ✅ Works, `thread_id` in output |
| Resume + prompt | `codex exec resume "$THREAD_ID" "what number?"` | ✅ Recalled "73" |
| Resume + JSON | `codex exec resume ... --json` | ❌ Not supported |

**Note:** Codex requires git repo or `--skip-git-repo-check`. Resume doesn't support `--json` flag.

**JSONL Schema (Codex):**
```json
{"type":"thread.started","thread_id":"019b6dbb-041d-7463-964f-a43fb7f8fbcd"}
{"type":"turn.started"}
{"type":"item.completed","item":{"id":"item_0","type":"reasoning","text":"..."}}
{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"..."}}
{"type":"turn.completed","usage":{"input_tokens":...,"output_tokens":...}}
```

#### Key Differences Summary

| Feature | Claude Code | Codex |
|---------|-------------|-------|
| Set session ID upfront | ✅ `--session-id` | ❌ Auto-assigned |
| Session ID field | `session_id` | `thread_id` |
| Resume syntax | `--resume <id> -p "..."` | `exec resume <id> "..."` |
| Streaming on start | ✅ `--output-format stream-json --verbose` | ✅ `--json` |
| Streaming on resume | ✅ Same flags work | ❌ No `--json` on resume |
| Git repo required | No | Yes (or `--skip-git-repo-check`) |

---

## Design Decision: Agent Awareness Model

### Option A: Implicit Resume (Agent Unaware)

The agent doesn't know it's in a loop. Orchestrator just resumes with feedback.

```
Orchestrator                          Agent
    |                                   |
    |--- start session (task) --------->|
    |<-- result ------------------------|
    |                                   |
    |--- resume (feedback) ------------>|  # Agent sees this as continuation
    |<-- result ------------------------|
    |                                   |
```

**Pros:**
- Simple - no special agent behavior needed
- Works with any agent/system prompt
- Natural conversation flow

**Cons:**
- Agent can't distinguish "initial task" from "iteration feedback"
- May behave inconsistently (e.g., re-explain context unnecessarily)
- No explicit "done" signal from agent

### Option B: Explicit Ports (initialPrompt / iteratePrompt)

Two separate entry points with different semantics.

```typescript
interface ReentrantRunner {
  // Start new task, returns session ID
  initialPrompt(task: string): Promise<{ sessionId: string, result: AgentResult }>

  // Continue with feedback on existing session
  iteratePrompt(sessionId: string, feedback: string): Promise<AgentResult>
}
```

Agent receives different framing:
- `initialPrompt`: "You are starting a new task: {task}"
- `iteratePrompt`: "Reviewer feedback on your previous work: {feedback}"

**Pros:**
- Agent knows context (first attempt vs. iteration)
- Can behave differently (e.g., be more concise on iterations)
- Explicit API for orchestrator

**Cons:**
- Requires system prompt or message framing changes
- More complex implementation
- May feel artificial to agent

### Option C: Hybrid - Implicit Resume + Framing Convention

Use implicit resume, but establish a message framing convention.

**Cons:**
- Relies on agent following convention (may drift)
- Less type-safe than explicit ports

### Option D: Explicit Two-Port Model (Recommended)

Each resumable agent exposes two input ports:

```
                          ┌─────────────────────────┐
                          │      Coder Agent        │
                          │                         │
      task ──────────────►│ taskPrompt              │
                          │         (creates new    │
                          │          session)       │
                          │                         │
                          │                         │──────► result
                          │                         │
      feedback ──────────►│ iteratePrompt           │
                          │         (resumes        │
                          │          session)       │
                          └─────────────────────────┘
```

#### Port Definitions

**Coder Agent:**
```typescript
interface CoderAgent {
  // Inputs
  taskPrompt: InputPort<string>      // Creates new session, starts work
  iteratePrompt: InputPort<string>   // Resumes session with feedback

  // Outputs
  result: OutputPort<{
    sessionId: string
    output: string
    artifacts: Artifact[]  // files changed, etc.
  }>
}
```

**Reviewer Agent:**
```typescript
interface ReviewerAgent {
  // Inputs
  submission: InputPort<{
    sessionId: string
    output: string
    artifacts: Artifact[]
  }>

  // Outputs
  feedback: OutputPort<string>    // Critique to send back
  approved: OutputPort<boolean>   // Breaks the loop when true
}
```

#### Full Loop Wiring

```
                    ┌─────────────────┐
     task ─────────►│ taskPrompt      │
                    │                 │
                    │   Coder Agent   │─────► result ─────┐
                    │                 │                   │
          ┌────────►│ iteratePrompt   │                   │
          │         └─────────────────┘                   │
          │                                               │
          │                                               ▼
          │                                     ┌─────────────────┐
          │                                     │   submission    │
          │                                     │                 │
          │         feedback ◄──────────────────│ Reviewer Agent  │
          │                                     │                 │
          │                                     │    approved ────┼────► done
          │                                     └─────────────────┘
          │                                               │
          │                                               │
          └───────────── (if not approved) ◄──────────────┘
```

#### How It Maps to CLI

```bash
# When taskPrompt receives data:
SESSION_ID=$(uuidgen)
claude --session-id "$SESSION_ID" -p "$task" --output-format stream-json --verbose

# When iteratePrompt receives data:
# (sessionId comes from previous result)
claude --resume "$SESSION_ID" -p "$feedback" --output-format stream-json --verbose
```

#### Why Two Ports?

1. **Visual clarity**: In a graph editor, you see exactly where task vs feedback connects
2. **Type safety**: Different input types can have different schemas
3. **Session lifecycle**: `taskPrompt` creates session, `iteratePrompt` requires existing session
4. **Loop detection**: Graph can validate that loops go through `iteratePrompt`, not `taskPrompt`

#### State Management

The `sessionId` flows through the graph as data:

```
taskPrompt ──► Coder ──► { sessionId, result } ──► Reviewer ──► { sessionId, feedback }
                                                                        │
                                                                        ▼
                                                              iteratePrompt (with sessionId)
```

The orchestrator doesn't need to track session state - it flows through the edges.

#### Alternative: Single Port with Tagged Union

```typescript
interface CoderAgent {
  // Single input port
  input: InputPort<
    | { type: 'task', task: string }
    | { type: 'iterate', sessionId: string, feedback: string }
  >

  result: OutputPort<{ sessionId: string, output: string }>
}
```

**Pros:** Simpler port model
**Cons:** Less visual clarity, harder to wire in graph editor

---

## Recommendation

Use **Option D (Explicit Two-Port Model)** for the graph/flow architecture.

```typescript
// Each resumable agent node exposes:
interface ResumableAgentNode {
  // Input ports
  taskPrompt: InputPort<string>                           // Creates session
  iteratePrompt: InputPort<{ sessionId: string, feedback: string }>  // Resumes

  // Output port
  result: OutputPort<{
    sessionId: string
    output: string
    artifacts?: Artifact[]
  }>
}
```

This gives:
- **Visual clarity**: Clear wiring in graph editor
- **Session flows as data**: No hidden state in orchestrator
- **Type safety**: Ports have distinct schemas
- **Natural loop semantics**: `taskPrompt` starts, `iteratePrompt` continues

---

## Phase 1: Runner Abstraction

Define a common interface that works across CLI backends.

```typescript
interface AgentResult {
  sessionId: string
  output: string
  // For streaming
  stream?: AsyncIterable<StreamChunk>
}

interface StreamChunk {
  type: 'token' | 'tool_call' | 'tool_result' | 'turn_complete'
  content: string
}

interface RunnerConfig {
  runner: 'claude-code' | 'codex'
  model?: string
  workingDirectory?: string
  systemPrompt?: string
}

interface ReentrantRunner {
  start(task: string): Promise<AgentResult>
  iterate(sessionId: string, feedback: string): Promise<AgentResult>
  restart(): string  // returns new session ID
}

function createRunner(config: RunnerConfig): ReentrantRunner
```

---

## Phase 2: CLI-Specific Implementations

### Claude Code Runner

```typescript
class ClaudeCodeRunner implements ReentrantRunner {
  async start(task: string): Promise<AgentResult> {
    const sessionId = uuidv4()
    const result = await this.exec([
      '--session-id', sessionId,
      '-p', `TASK: ${task}`,
      '--output-format', 'stream-json',
      '--verbose'  // Required for stream-json
    ])
    return { sessionId, ...result }
  }

  async iterate(sessionId: string, feedback: string): Promise<AgentResult> {
    const result = await this.exec([
      '--resume', sessionId,
      '-p', `REVIEWER FEEDBACK: ${feedback}`,
      '--output-format', 'stream-json',
      '--verbose'  // Required for stream-json
    ])
    return { sessionId, ...result }
  }

  restart(): string {
    return uuidv4()
  }
}
```

### Codex Runner

```typescript
class CodexRunner implements ReentrantRunner {
  async start(task: string): Promise<AgentResult> {
    const result = await this.exec([
      'exec',
      `TASK: ${task}`,
      '--json',
      '--skip-git-repo-check'  // Required outside git repos
    ])
    // Parse thread_id from first JSONL line: {"type":"thread.started","thread_id":"..."}
    const sessionId = this.extractThreadId(result.rawOutput)
    return { sessionId, ...result }
  }

  async iterate(sessionId: string, feedback: string): Promise<AgentResult> {
    // NOTE: --json not supported on resume, output is plain text
    const result = await this.exec([
      'exec', 'resume', sessionId,
      `REVIEWER FEEDBACK: ${feedback}`
    ])
    return { sessionId, ...result }
  }

  private extractThreadId(jsonlOutput: string): string {
    const firstLine = jsonlOutput.split('\n')[0]
    const parsed = JSON.parse(firstLine)
    if (parsed.type === 'thread.started') {
      return parsed.thread_id
    }
    throw new Error('Could not find thread_id in Codex output')
  }
}
```

**Limitation:** Codex `resume` doesn't support `--json`, so streaming visualization only works on first iteration.

---

## Phase 3: Streaming & Visualization

Parse the JSONL output for real-time visualization.

### Claude Code stream-json format

```json
{"type":"assistant","message":{"content":"I'll help..."}}
{"type":"tool_use","name":"Read","input":{...}}
{"type":"tool_result","content":"..."}
{"type":"result","subtype":"success","message":"..."}
```

### Codex --json format

```json
{"type":"message","content":"..."}
// TBD - need to capture actual format
```

### Visualization Interface

```typescript
interface SessionVisualizer {
  // Full history
  getHistory(sessionId: string): Turn[]

  // Live streaming
  onChunk(sessionId: string, callback: (chunk: StreamChunk) => void): Unsubscribe

  // Iteration tracking
  getIterationCount(sessionId: string): number
}
```

---

## Phase 4: Orchestrator Integration

The loop becomes:

```typescript
const runner = createRunner({ runner: 'claude-code' })
const visualizer = createVisualizer()

let { sessionId, result } = await runner.start(task)
visualizer.attach(sessionId)

while (!done) {
  const feedback = await reviewer.evaluate(result)

  if (feedback.shouldRestart) {
    sessionId = runner.restart()
    result = await runner.start(task)  // or modified task
  } else if (feedback.approved) {
    done = true
  } else {
    result = await runner.iterate(sessionId, feedback.comments)
  }
}
```

---

## Open Questions

1. ~~**Codex session ID extraction:** How to reliably get session ID from `codex exec` output?~~
   **RESOLVED:** Parse `thread_id` from first JSONL line: `{"type":"thread.started","thread_id":"..."}`

2. ~~**Codex resume + JSON:** Does `codex resume` support `--json` flag for streaming?~~
   **RESOLVED:** No, `--json` not supported on resume. Codex resume output is plain text only.

3. **Stream-json input:** Claude Code has `--input-format stream-json` - could enable true long-running process model. Worth exploring?

4. **System prompt injection:** Should we inject loop-awareness into system prompt, or rely purely on message framing?

5. **Error handling:** What happens if resume fails (session expired, corrupted)?

6. **Codex streaming on resume:** Since `--json` doesn't work with resume, how do we stream Codex output on iterations? Options:
   - Accept plain text output on resume (parse manually)
   - Request feature from Codex team
   - Use different approach for Codex (long-running process?)

---

## Next Steps

- [x] Phase 0: Run prototype commands, validate assumptions
- [x] Document actual JSONL schemas from both CLIs
- [ ] Decide on Option A/B/C for agent awareness
- [ ] Implement Phase 1 runner abstraction
- [ ] Build minimal orchestrator for testing
