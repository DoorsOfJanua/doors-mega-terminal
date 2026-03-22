# spaceship-command-center CLAUDE.md

## Project Purpose
Terminal-style command center UI with workspace management, snake animation, live snake game, and customizable theming (light/dark). Inspired by retro terminal aesthetics with modern UX polish.

## Key Architecture
- **main.js**: Workspace CRUD, state management, snake logic (lines 130-240 workspace, 337-356 callbacks)
- **index.html**: Snake animation CSS, DOM structure, theme application
- **themes**: Light/dark variants (built-in), extensible for future themes
- **constraints**: Font size max (current cap TBD), workspace rename via double-click

## Current Session (2026-03-22 13:07-13:25)
Three UI features scoped for implementation:

1. **Workspace Deletion UI** (no longer right-click)
   - Add small X button next to workspace name
   - Clicking X triggers confirmation popup (prevent accidental deletion)
   - Workspace button itself still opens workspace (not tied to delete)
   - State: Scope locked, awaiting implementation

2. **Font Size Cap Increase**
   - Current maximum font size TBD (investigate main.js)
   - Increase cap to allow bigger text options
   - State: Scope TBD, awaiting investigation of current limits

3. **Classic Terminal Mode**
   - Full terminal-style aesthetic (fonts, colors, options)
   - Mirroring Mega Terminal design language
   - **PENDING DECISION**: Theme architecture
     - Option A: Two separate themes (Classic Light, Classic Dark) in theme picker
     - Option B: Single Classic theme with light/dark toggle
   - State: Design decision pending before implementation

## NEXT TASKS

- [ ] (Sonnet) Clarify classic mode theme architecture with user (separate themes vs toggle)
- [ ] (Sonnet) Investigate current font size max in main.js, propose new cap
- [ ] (Sonnet) Implement workspace X button delete UI + confirmation dialog
- [ ] (Sonnet) Build classic terminal mode CSS (fonts, colors, retro styling)
- [ ] (Sonnet) Add theme toggle or picker for classic light/dark variants
- [ ] (Sonnet) Test snake animation in classic mode across both variants

## Notes
- Session ended at clarification point - user asked for theme architecture confirmation
- Codebase well-structured, workspace/animation logic isolated
- Low risk feature set, existing patterns can be extended
- Classic mode is aesthetic enhancement, no protocol changes needed
