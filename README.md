# Prompt Flow Designer

Single Page Application built with React + `@xyflow/react` for visually designing prompt graphs and generating structured prompt output.

## Changelog

### 2026-02-25
- Initialized SPA with React + Vite and integrated `@xyflow/react`.
- Added drag-and-drop node creation and edge connections for prompt flow modeling.
- Added node configuration (role/label/content) and structured prompt generation panel.
- Added export of generated prompt to text, then replaced with:
  - `Copy Prompt` action.
  - `Download Prompt (.md)` action.
- Added copy feedback notification after clipboard action.
- Added node-level numbered list editing, then upgraded to in-node editing.
- Improved numbered-list button styling and UX.
- Implemented 3-level hierarchical list support in nodes with indent/outdent controls.
- Added AI Flow Generator popup:
  - API key input.
  - Prompt-to-JSON generation.
  - JSON preview and draw-to-canvas.
- Added Import Prompt popup with support for:
  - Free-text prompt parsing.
  - Outline format (`Section`, `1.1 ...`).
  - Parent/child format (`[1] SYSTEM`, `1.1 ...`).
  - JSON graph format (`nodes` + `edges`).
  - Markdown file upload (`.md`) parsing.
- Added confirmation before importing and drawing flow.
- Added reset-all-nodes with confirmation.
- Added localStorage persistence for nodes/edges/selection across reloads.
- Added node auto-layout options:
  - Vertical flow.
  - Horizontal flow.
  - Grid.
- Added collapsible left and right side panels with canvas toggle controls.
- Set Generated Prompt and Structured JSON panels to scroll with max height `400px`.
- Added `.gitignore` with `node_modules/`.
