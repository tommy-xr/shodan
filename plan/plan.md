# Shodan Roadmap

## Completed

### Script Node (JS/TS/Bash)
- [x] Added unified "Script" node type that executes file-based scripts
- [x] Supports `.ts` (via tsx), `.js` (via node), `.sh` (via bash)
- [x] File picker integration for script selection
- [x] Arguments field for passing parameters
- [x] Template variable support in paths and arguments

### Project Root Discovery
- [x] `.shodan/` folder marks project root
- [x] Auto-discovery walks up directory tree (`.shodan` > `.git` > `package.json`)
- [x] CLI and UI both use discovered root for relative paths
- [x] Removed manual Root Directory field from UI
- [x] Workflows no longer store `rootDirectory` - it's inferred

### Shell Node Simplification
- [x] Removed "Script Files" from Shell node (now handled by Script node)
- [x] Shell node is now purely for inline scripts

## Pending

- Fix agent models - we might want to make an API request and query each tool respectively?
- Coercing agent output to JSON to fit output requirements - can we rely on the agents to do that, or does it require a GPT call to coalesce?
- Add clearly defined input/output for the agent blocks - the inputs can be used as template variables, and the output can be added to the prompt we send the agent. We can then wire the output directly elsewhere
- Add a container component (a "microchip") that has input and outputs, but an interior workflow. Double-clicking on the container component allows for editing internals. Can be recursive and copy-pasted or created as a template
- How to use / re-use session id?
