# Component Library

This document outlines the design for enhancing the component system with library management, browsing, and polish features.

**Status:** Not Started
**Depends On:** Input/Output System (completed)

---

## Current State

The core component system is complete:
- Components can be created via the "Create New Component" dialog
- Components are stored in `workflows/components/` directory
- Components can be dragged onto the canvas from the sidebar
- Double-click drills down into component internals
- Breadcrumb navigation allows navigating back
- Changes to components are saved back to files

### What's Missing
1. No way to browse/search components beyond the flat list in sidebar
2. No way to convert an existing workflow into a component
3. No component metadata beyond name/description (tags, version, author)
4. UI polish issues (JSON schema overflow)

---

## Goals

1. **Component Browser**: Search and filter components by name, tags, description
2. **Save As Component**: Convert existing workflow to a reusable component
3. **Component Metadata**: Rich metadata for organization and discovery
4. **UI Polish**: Fix remaining visual issues

---

## Phase 1: Component Browser

### Search & Filter UI

Add a search/filter interface to the Components section in the sidebar:

```
┌─────────────────────────────┐
│ COMPONENTS          [+ New] │
│ ┌─────────────────────────┐ │
│ │ 🔍 Search...            │ │
│ └─────────────────────────┘ │
│ ┌─────────────────────────┐ │
│ │ 📦 Text Transform       │ │
│ │ 📦 Code Reviewer        │ │
│ │ 📦 PR Analyzer          │ │
│ └─────────────────────────┘ │
└─────────────────────────────┘
```

**Features:**
- Text search across name, description
- Real-time filtering as you type
- Empty state when no matches

### Implementation Tasks

- [ ] Add search input to Components section in Sidebar
- [ ] Filter components based on search query
- [ ] Highlight matching text in results
- [ ] Show "No components found" empty state

---

## Phase 2: Save Workflow As Component

Allow converting an existing workflow into a reusable component.

### UI Flow

1. User opens a workflow in the designer
2. User clicks "Save As Component" (new menu option or button)
3. Dialog opens to configure the component interface:
   - Name (pre-filled from workflow name)
   - Description (pre-filled from workflow description)
   - Select which nodes' inputs become component inputs
   - Select which nodes' outputs become component outputs
4. System generates interface-input/output nodes and saves to components folder

### Dialog Design

```
┌─────────────────────────────────────────────────────────────┐
│ Save As Component                                       [×] │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ Name:  [Current Workflow Name____]                          │
│                                                             │
│ Description:  [________________________________]            │
│                                                             │
│ ─────────────────────────────────────────────────────────── │
│ EXPOSE AS COMPONENT INPUTS                                  │
│ Select node inputs to expose on the component interface:    │
│                                                             │
│ ☑ shell-1 / input     → rename: [text________]              │
│ ☐ shell-2 / input                                           │
│ ☑ agent-1 / context   → rename: [context_____]              │
│                                                             │
│ ─────────────────────────────────────────────────────────── │
│ EXPOSE AS COMPONENT OUTPUTS                                 │
│ Select node outputs to expose on the component interface:   │
│                                                             │
│ ☑ agent-1 / response  → rename: [result______]              │
│ ☐ shell-2 / stdout                                          │
│                                                             │
│ Save to: [workflows/components/] [my-component____].yaml    │
│                                                             │
│                              [Cancel]  [Save As Component]  │
└─────────────────────────────────────────────────────────────┘
```

### Implementation Tasks

- [ ] Add "Save As Component" button/menu option
- [ ] Create SaveAsComponentDialog component
- [ ] List all node inputs/outputs with checkboxes
- [ ] Generate interface-input node with mappings
- [ ] Generate interface-output node with mappings
- [ ] Save new component workflow file
- [ ] Refresh components list in sidebar

---

## Phase 3: Component Metadata

Enhance component metadata for better organization.

### Extended Metadata Schema

```yaml
version: 2
metadata:
  name: PR Reviewer
  description: Reviews pull requests and provides feedback
  author: team-name
  version: 1.0.0
  tags:
    - code-review
    - github
    - ai
  icon: 🔍  # Optional custom icon
  color: purple  # Optional custom color
```

### UI Updates

- Show tags as pills in component list
- Filter by tags in component browser
- Display version in component config panel
- Show author info on hover

### Implementation Tasks

- [ ] Extend workflow schema with optional metadata fields (author, version, tags, icon, color)
- [ ] Update component discovery to read extended metadata
- [ ] Display tags as pills in sidebar component list
- [ ] Add tag filter dropdown to component browser
- [ ] Show extended metadata in component config panel

---

## Phase 4: UI Polish

Fix remaining visual issues from the I/O system implementation.

### Known Issues

1. **JSON Schema Property Overflow**: In the visual JSON schema editor, property rows overflow the config panel width when inputs are too wide

### Tasks

- [ ] Fix JSON schema property row overflow
  - Constrain input widths with max-width
  - Use flex-shrink on text inputs
  - Consider collapsible property rows

- [ ] Extraction pattern builder for shell outputs
  - Visual regex builder with test input
  - JSON path selector with preview
  - Pattern validation feedback

---

## Future Considerations

### Component Versioning
- Track component versions
- Warn when using outdated component versions
- Migration path for breaking interface changes

### Component Sharing
- Export components as standalone files
- Import components from URL or file
- Component registry/marketplace

### Component Testing
- Test harness for components
- Mock inputs, verify outputs
- Regression testing for component changes

---

## Files to Create/Modify

### New Files
- `src/designer/src/components/SaveAsComponentDialog.tsx`
- `src/designer/src/components/ComponentSearch.tsx` (or inline in Sidebar)

### Modified Files
- `src/designer/src/components/Sidebar.tsx` - Add search, save-as-component
- `src/core/src/io-types.ts` - Extended metadata types
- `src/server/src/routes/components.ts` - Return extended metadata
- `src/designer/src/components/ConfigPanel.tsx` - Display extended metadata
