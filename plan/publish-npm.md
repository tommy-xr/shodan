# Publish robomesh to npm

## Goal
Publish the `robomesh` CLI as a standalone npm package so users can install it globally with `npm install -g robomesh`.

## Package Structure Decision

**Option A: Single `robomesh` package (recommended)**
- Bundle core + server + cli into one publishable package
- Simpler for users: `npm install -g robomesh`
- No need to manage multiple package versions

**Option B: Publish all packages separately**
- `@robomesh/core`, `@robomesh/server`, `@robomesh/cli`
- Requires npm org for scoped packages
- More complex versioning

Recommend **Option A** for initial release.

## Implementation Steps

### 1. Prepare package.json for publishing
Update `packages/cli/package.json`:
- [ ] Change name from `@robomesh/cli` to `robomesh`
- [ ] Add `"files": ["dist"]` to include only built output
- [ ] Add metadata fields:
  - `"repository": { "type": "git", "url": "https://github.com/tommy-xr/robomesh-ai" }`
  - `"license": "MIT"` (or appropriate license)
  - `"author": "..."`
  - `"keywords": ["ai", "workflow", "agent", "orchestration", "cli"]`
  - `"homepage": "https://github.com/tommy-xr/robomesh-ai"`
- [ ] Add `"description"` with a good npm summary

### 2. Bundle dependencies
The CLI currently uses `workspace:*` references. For publishing, we need to either:
- **Option A**: Bundle everything with esbuild/rollup into a single dist file
- **Option B**: Copy core/server source into cli package before publish

Recommend **bundling with esbuild** - creates a single `dist/index.js` with all dependencies.

Add to `packages/cli/package.json`:
```json
{
  "scripts": {
    "build": "esbuild index.ts --bundle --platform=node --target=node20 --outfile=dist/index.js --format=esm"
  },
  "devDependencies": {
    "esbuild": "^0.20.0"
  }
}
```

### 3. Add shebang for CLI
Ensure the built output has a shebang:
```javascript
#!/usr/bin/env node
```

esbuild can add this with `--banner:js='#!/usr/bin/env node'`

### 4. Create npm account / login
```bash
npm login
```

### 5. Test locally before publishing
```bash
cd packages/cli
pnpm run build
npm pack  # Creates robomesh-0.1.0.tgz
npm install -g ./robomesh-0.1.0.tgz  # Test install
robomesh --help  # Verify it works
```

### 6. Publish
```bash
cd packages/cli
npm publish
```

For first publish, no `--access` flag needed since `robomesh` is unscoped.

### 7. Verify
```bash
npm install -g robomesh
robomesh --help
```

## Future Considerations

- **Versioning**: Consider using `changesets` for version management
- **CI/CD**: Add GitHub Action for automated publishing on release tags
- **README**: Add a CLI-specific README in `packages/cli/` for npm page

## Open Questions

1. What license should be used? (MIT is common for CLI tools)
2. Should we publish a beta/alpha version first? (`npm publish --tag beta`)
3. Do we want to set up automated releases via GitHub Actions?
