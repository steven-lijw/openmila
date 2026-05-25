# Milanote Local Canvas Requirements

## 1. Product Goal

Build a `local-first`, `Chromium-only`, `single-page` canvas application that reproduces Milanote as closely as possible in:

- visual design
- interaction model
- core feature set

This is **not** intended to be a generic whiteboard, and **not** a simple Obsidian Canvas clone with a different skin.

The target is:

- Milanote-like UI
- Milanote-like interactions
- Milanote-like core workflows
- all data stored locally as normal files

## 2. What the User Ultimately Wants

The final desired product is:

`A Milanote-equivalent local canvas app that runs on the user's machine, stores all data in local files, and behaves as closely as possible to Milanote.`

Key constraints:

- no login
- no cloud sync
- no remote control
- no collaboration
- no account system
- local runtime only

## 3. Platform and Runtime

The app should:

- run locally in a Chromium browser
- be compatible with Chrome / Edge first
- be implemented as a local web app
- use local filesystem access as the primary storage mechanism

The default technical direction already established is:

- `React`
- `TypeScript`
- `Vite`

## 4. Storage Requirements

All data must stay in the user's local vault folder.

Storage rules:

- card body content should primarily use `.md`
- board layout, node metadata, edges, viewport and structure should use `JSON`
- images and other binary assets should be stored as local files
- data should remain human-readable and manually editable where practical

### 4.1 Vault structure

Top-level vault structure:

- `workspace.json`
- `boards/`
- `assets/`

### 4.2 Workspace structure

`workspace.json` should contain:

- schema version
- root board id
- recent board id
- board index list

Expected shape:

```json
{
  "version": 1,
  "rootBoardId": "board_xxx",
  "recentBoardId": "board_xxx",
  "boards": []
}
```

### 4.3 Board structure

Each board should live under:

```text
boards/<board-slug>/
```

Inside each board folder:

- `board.json`
- `cards/`

### 4.4 Card persistence rules

For `Note`, `To-do`, and markdown-heavy cards:

- metadata in `board.json`
- markdown body in `cards/<card-id>.md`

For `Image`, `Link`, `Column`, and `Board` cards:

- metadata in `board.json`
- no separate markdown file unless later explicitly needed

For images:

- source file stored under `assets/`

## 5. Core UX Direction

The product should feel like Milanote, not like a document editor and not like a generic dashboard.

The desired experience is:

- light
- airy
- spatial
- tactile
- visual-first
- card-based

The app should prioritize:

- drag-and-drop organization
- free spatial arrangement
- nested boards
- columns for structured organization
- clear visual hierarchy

## 6. UI Parity Requirements

The user wants the interface to match Milanote as closely as possible.

This includes:

- left toolbar layout
- top bar layout
- canvas background style
- card proportions
- shadows
- spacing
- radius
- typography feel
- hover states
- selection states
- drop states
- board card appearance
- column appearance

### 6.1 Visual style requirements

The UI should follow Milanote-like visual language:

- light theme first
- warm gray / off-white surfaces
- dotted or lightly textured canvas background
- soft rounded cards
- subtle shadows
- restrained color usage
- compact but elegant chrome
- visually quiet interface with emphasis on card content

### 6.2 Toolbar expectations

The left toolbar should behave and look like Milanote's tool rail.

Requirements:

- tools listed vertically
- each tool clearly styled as a draggable component source
- each component should include a small descriptive subtitle beneath the main label
- overall spacing and block treatment should feel close to Milanote

The user explicitly requested:

- components on the left must be draggable into the canvas
- each component must have a small explanatory line below the main title

### 6.3 Top bar expectations

The top area should be lightweight and Milanote-like.

Expected elements:

- board title
- navigation/back behavior
- lightweight workspace status
- reload / open vault / undo / redo controls if retained

This area should not feel like a developer utility bar.

## 7. Interaction Parity Requirements

The user wants interaction behavior to align with Milanote, not merely visual resemblance.

### 7.1 Card creation

Cards should be created by dragging tools from the left toolbar into:

- the main canvas
- a board card
- a column

Important:

- creation should happen by drag-and-drop
- not by click-to-create
- not by opening a modal first

This requirement has been explicitly repeated several times by the user.

### 7.2 Canvas behavior

The canvas should support:

- free positioning
- panning
- zooming
- selection
- multi-selection
- drag move
- drop targets
- nested card organization

### 7.3 Board behavior

`Board` is not just a visual card. It is a nested canvas container.

Requirements:

- board cards represent child boards
- items should be draggable into boards
- entering a board should open its child canvas
- returning to parent board should be supported
- nested boards should persist properly

The user specifically clarified:

- components should be dragged into boards rather than only being created by click

### 7.4 Column behavior

`Column` should behave as a Milanote-like vertical grouping container.

Requirements:

- drag cards into a column
- re-order items within a column
- maintain child ordering
- visually indicate insertion position
- persist child relationships in local data

### 7.5 Line / connection behavior

The app should support basic connections between nodes.

Current target:

- create edges between cards
- simple connection flow
- no need for complex auto-routing in the first implementation

### 7.6 Editing behavior

Editing should be lightweight and direct.

Requirements:

- direct in-card editing
- focused editing mode when selected
- markdown-driven content for note-like cards
- avoid heavy rich text editor complexity in first version

## 8. Required Card Types

The user has already specified these core card types:

- `Note`
- `Link`
- `To-do`
- `Image`
- `Column`
- `Board`

### 8.1 Note

Requirements:

- title
- markdown body
- basic text/list support
- preview when not active
- editable content persisted as `.md`

### 8.2 Link

Requirements:

- URL
- title
- basic description
- local metadata only
- no remote scraping required for first version

### 8.3 To-do

Requirements:

- checklist items
- checkbox state persistence
- markdown-backed persistence
- basic sorting/reordering behavior

### 8.4 Image

Requirements:

- import local image file
- show thumbnail in card
- store referenced asset locally

### 8.5 Column

Requirements:

- visual grouping card
- accept dropped child cards
- show internal ordering
- persist child order

### 8.6 Board

Requirements:

- nested canvas entry point
- display board preview styling
- accept dropped cards
- persist child board relationship

## 9. Local Filesystem Behavior

The first-run and vault flow should support:

- choosing a local vault folder
- initializing missing structure automatically
- reopening a previously used vault
- handling permission loss gracefully
- clearly showing filesystem-related errors

The current development also introduced a path-based local mode for convenience, but the intended product direction remains:

- local vault-based workflow
- local files as the source of truth

## 10. Save Behavior

Expected persistence behavior:

- autosave after edits
- board changes saved to JSON
- markdown content saved to `.md`
- image references saved to local assets
- page unload warning when there are unsaved changes

## 11. Functional Scope

The target is not every Milanote feature immediately, but the user explicitly wants progress toward:

- full Milanote basic functionality
- not just a simplified demo

This means we should keep closing gaps toward Milanote's core behaviors instead of stopping at visual similarity.

## 12. Explicit Non-Goals

The user explicitly does **not** need these in the current product:

- login
- cloud account system
- remote control
- team collaboration
- comments
- notifications
- sharing
- online sync
- remote preview fetching

Also not required right now:

- full mobile adaptation
- full browser compatibility outside Chromium
- complex rich text editor parity

## 13. Current Working Priorities

The user most recently set the immediate order of work as:

1. Fix the regression where left toolbar components cannot be dropped into the canvas
2. Continue refining the UI to match Milanote more closely

Important workflow preference from the user:

- the assistant should focus on understanding instructions and changing code
- browser-side validation will be handled by the user
- the assistant should not keep opening the browser for validation unless explicitly asked

## 14. Success Criteria

The product is considered aligned with the user's stated goal when it satisfies the following:

- users can run it locally
- all meaningful data lives in local files
- cards can be dragged from the left toolbar into canvas / boards / columns
- nested boards work
- columns work
- markdown-backed cards persist correctly
- the visual style closely matches Milanote
- the interaction model closely matches Milanote
- there is no dependency on login, cloud, or collaboration features

## 15. One-Sentence Project Definition

This project is:

`a Milanote-style local canvas application with Milanote-like UI and interactions, running locally in Chromium, with all user data stored in local JSON, Markdown, and asset files.`
