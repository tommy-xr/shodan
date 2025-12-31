# @robomesh/migrations

Schema migration scripts for Robomesh workflows.

## Why Migrations?

Robomesh workflows are defined in YAML files. As the schema evolves, existing workflows may become incompatible with newer versions of the executor or designer. Migration scripts provide a way to automatically update workflows to match the current schema.

## Running Migrations

```bash
# Preview changes (dry run)
pnpm run -F @robomesh/migrations migrate:dry-run

# Apply migrations
pnpm run -F @robomesh/migrations migrate
```

## Migration History

### 001-add-default-ports (2024-12-31)

**Problem:** Workflows were inconsistently defining input/output ports on nodes. Some workflows defined ports explicitly, others relied on implicit behavior. This caused:

1. **Validation failures** - The new schema validation requires nodes to explicitly define their standard ports
2. **Designer inconsistency** - Nodes created in the designer now get default ports, but imported workflows may not have them
3. **sessionId missing** - Agent nodes should have `sessionId` input/output for session persistence, but many workflows didn't define these

**Solution:** This migration adds the standard default ports (from `@robomesh/core/node-defaults`) to all nodes that are missing them:

- **trigger**: outputs `timestamp`, `type`, `text`, `params`
- **agent**: inputs `prompt`, `sessionId`; outputs `output`, `sessionId`, `exitCode`
- **shell**: inputs `input`; outputs `output`, `stdout`, `stderr`, `exitCode`
- **script**: inputs `input`; outputs `output`, `stdout`, `stderr`, `exitCode`
- **constant**: outputs `value`
- **workdir**: outputs `path`

**Backwards Compatibility:** This migration only adds missing ports. It does not remove or modify existing port definitions, so custom ports are preserved.
