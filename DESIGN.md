---
name: AI Stock
description: An instrument-grade control plane for versioned strategy validation and research operations.
colors:
  primary: "hsl(231 86% 61%)"
  primary-dark: "hsl(231 94% 70%)"
  canvas-light: "hsl(220 27% 97%)"
  canvas-dark: "hsl(225 31% 7%)"
  surface-light: "hsl(0 0% 100%)"
  surface-dark: "hsl(225 25% 10%)"
  ink-light: "hsl(225 32% 10%)"
  ink-dark: "hsl(218 25% 96%)"
  border-light: "hsl(220 18% 85%)"
  border-dark: "hsl(223 18% 20%)"
  success: "hsl(157 61% 36%)"
  warning: "hsl(35 91% 46%)"
  danger: "hsl(350 72% 51%)"
typography:
  headline:
    fontFamily: "Inter, SF Pro Display, Segoe UI, system-ui, sans-serif"
    fontSize: "2rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  body:
    fontFamily: "Inter, SF Pro Display, Segoe UI, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "-0.006em"
  label:
    fontFamily: "Inter, SF Pro Display, Segoe UI, system-ui, sans-serif"
    fontSize: "0.65rem"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.14em"
  data:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
    fontSize: "1.8rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.04em"
rounded:
  control: "10px"
  surface: "12px"
  overlay: "16px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "40px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface-light}"
    rounded: "{rounded.control}"
    padding: "10px 16px"
    height: "40px"
  button-secondary:
    backgroundColor: "{colors.surface-light}"
    textColor: "{colors.ink-light}"
    rounded: "{rounded.control}"
    padding: "10px 16px"
    height: "40px"
  workspace-surface:
    backgroundColor: "{colors.surface-light}"
    textColor: "{colors.ink-light}"
    rounded: "{rounded.surface}"
    padding: "20px"
---

# Design System: AI Stock

## Overview

**Creative North Star: "The Agent Decision Desk"**

AI Stock should feel like a precise institutional research instrument: calm enough for long sessions, dense enough for real decision work, and explicit about every state transition. The main Agent conversation owns the general-purpose canvas; individual-stock analysis, screening, trading, and expert review use focused task flows. Expert review separates one-on-one consultation from group deliberation, keeps shared evidence and independent Persona sessions visible, and never fills unavailable viewpoints with sample conclusions. Trading adds a restrained paper-runtime ledger beneath its strategy definition, keeping configuration, hard risk boundaries, runtime state, and unavailable backend evidence visibly distinct. Mounted capabilities, artifacts, snapshots, approvals, and runs form a clear operational layer around it without turning the product into a decorative financial dashboard.

The system rejects floating neon cards, decorative glass, diffuse colored glow, and oversized rounded containers. Brand expression comes from exact alignment, restrained cobalt signals, compact labels, tabular data, and a stable application header.

**Key Characteristics:**

- Continuous workspace rather than isolated floating canvases.
- Cool porcelain in light mode and carbon graphite in dark mode.
- Cobalt reserved for primary action, current location, focus, and selected state.
- Thin mineral rules and shallow structural elevation.
- Compact, familiar controls that disappear into the task.

## Colors

The palette is restrained and state-rich. Neutral surfaces carry almost the whole interface; cobalt identifies the current operation, while success, warning, and danger remain semantic.

### Primary

- **Control Cobalt:** Used for primary actions, selected navigation, focus, and active lifecycle nodes. It must not become decorative ambient color.

### Neutral

- **Cool Porcelain:** Light workspace canvas kept visually quiet so borders and data carry the structure.
- **Carbon Canvas:** Dark workspace canvas for low-light research sessions.
- **Instrument Surface:** Opaque panel surface; never decorative glass.
- **Mineral Rule:** Borders, dividers, and structure with low contrast but clear geometry.

### Named Rules

**The One Signal Rule.** Cobalt should identify what is active or actionable; inactive content remains neutral.

**The Semantic State Rule.** Green, amber, and red communicate real state only. They never decorate ordinary content.

## Typography

**Display Font:** Inter / SF Pro Display / Segoe UI with system fallback  
**Body Font:** The same workhorse UI stack  
**Label/Mono Font:** Native UI monospace only for identifiers, code, timestamps, and numeric measurements

**Character:** Compact and operational. Hierarchy comes from weight, size, and spacing rather than an ornamental display face.

### Hierarchy

- **Headline** (600, 2rem, 1.2): Page titles and major workspace headings.
- **Title** (600, 1rem–1.125rem): Section and object names.
- **Body** (400, 0.875rem, 1.5): Explanations and operational copy, normally limited to 65–75 characters per line.
- **Label** (700, 0.65rem, 0.14em tracking): A single contextual kicker or navigation group label.
- **Data** (600, tabular mono): Counts, versions, timestamps, identifiers, and measurements.

**The Mono Evidence Rule.** Monospace is evidence formatting, not a technology costume.

## Layout

### Workspace refinement

Expert discussion uses a full-height group-chat layout: a 256px desktop conversation history rail, compact member/mode controls at the top, independently scrolling speaker bubbles, and a persistent bottom composer. Mobile history moves to a drawer. Each round remains visible in the same parent-linked conversation; long messages expose a clearly labelled excerpt and full-text reader, while final reports appear as document cards. Explicit next-round configuration never rewrites previous rounds.

Expert roundtable is a primary destination immediately after the research assistant. Desktop retains stock research, strategy screening, trade simulation, and market radar after it; mobile exposes the research assistant, roundtable, stock research, strategy screening, and trade simulation, with market radar in the utility menu. The dedicated discussion page uses a history rail and a central conversation: compact expert/mode selectors, a topic composer, and directly visible chronological speaker outputs. Mode-specific host labels distinguish task synthesis, debate synthesis, and vote-based synthesis. The research assistant keeps intermediate collaboration outputs out of the conversation and shows the final report.

Desktop primary navigation follows market radar → research assistant → expert roundtable → stock research → strategy screening → trade simulation. Market radar is immediately left of the default research-assistant workspace; the remaining task flows continue to its right. Wide desktop utility links show text beside icons; compact desktop retains accessible icon links. The chat canvas is continuous with a neutral 256px history rail, without floating panel gaps. Report workspaces use a 248px sticky directory beneath the application header and an opaque reading surface with 16/24/32px responsive insets. The default launcher is a compact separate action surface; manual configuration remains opt-in. Shared headings use 24–30px type, supporting labels use 12px neutral text, and standard action buttons are at least 44px high. A keyboard skip link targets the single application main landmark.

Desktop uses a sticky application header and a continuous full-width content canvas. The header exposes six primary decision workspaces in this order—market radar, research assistant, expert roundtable, stock research, strategy screening, trade simulation—while scheduling, runs, and the capability center remain compact utility destinations. Conversation workspaces use one dominant Agent canvas plus an optional 304px context rail. Structured research and screening workspaces use a linear task form plus a 304px capability rail. Configuration pages are capped near 1540px and use 16px, 28px, and 40px responsive page gutters. Page headers sit directly on the canvas with a structural divider rather than inside a card. Dense information may use tables or divided ledgers; repeated equal cards are reserved for genuinely independent objects.

At widths below 1024px, the five decision workspaces move into a fixed bottom navigation with safe-area padding. A 56px mobile command bar shows the current workspace and opens a right-side utility drawer for market intelligence, scheduling, runs, capabilities, model usage, settings, theme, and language. Multi-column metrics collapse to a two-column ledger; task forms and task-progress rails stack without changing label hierarchy.

## Elevation & Depth

Depth is structural and shallow. Opaque surfaces separate tasks through tonal contrast and a 1px rule. Resting surfaces use a one-pixel key shadow plus a broad, low-opacity ambient shadow; stronger lift appears only for interactive hover or overlays.

**The Flat-By-Default Rule.** No glow and no zero-offset colored shadow. Elevation must imply a real layer or interaction state.

## Shapes

Controls use a compact 10px radius. Main surfaces use 12px, and overlays may use 16px. Pills are limited to compact statuses and tags. Large page sections must not become soft floating capsules.

## Components

### Buttons

- **Shape:** Compact rectangle with gently curved corners (10px).
- **Primary:** Solid control cobalt, 40px high, with a shallow downward shadow.
- **Hover / Focus:** Small tonal shift; focus uses a visible two-pixel cobalt outline with offset.
- **Secondary:** Opaque neutral surface with a mineral border; hover strengthens the border rather than moving the button.

### Chips

- **Style:** Small status-only pills using semantic tint, text, and border.
- **State:** Selection uses cobalt; health and lifecycle states use their semantic colors.

### Cards / Containers

- **Corner Style:** Restrained 12px surface radius.
- **Background:** Opaque instrument surface.
- **Shadow Strategy:** Structural low elevation at rest, slightly stronger only when interactive.
- **Border:** One-pixel mineral rule.
- **Internal Padding:** 16px for compact objects, 20–24px for workspace sections.

### Inputs / Fields

- **Style:** 40px standard height, 10px radius, neutral inset surface and explicit border.
- **Focus:** Cobalt border and low-opacity three-pixel focus ring.
- **Error / Disabled:** Semantic border and copy for errors; reduced opacity and unchanged geometry for disabled state.

### Navigation

The desktop application header is sticky, opaque, and task-first. Primary items are at least 44px high with a 10px radius; the active workspace uses cobalt icon/text and a quiet cobalt tint. The six desktop decision workspaces appear as labelled global tabs. Scheduled tasks, runs, and the capability center use labelled tooltips and compact utility buttons, while model usage, platform settings, theme, language, and logout live in the utility drawer. Capability configuration retains its own local tabs for overview, Skill, built-in tools, MCP services, data sources, and expert setup instead of repeating these routes in global navigation. Scheduled tasks and runs share a local task-center navigation. On mobile, exactly five primary destinations appear in the bottom navigation and all secondary destinations move to the utility drawer. Tool and MCP remain distinct: tools expose callable schemas and permissions, while MCP pages manage external servers that may provide tools, resources, or prompts. Each capability page separates platform presets from workspace-defined entries without pretending that frontend drafts are already executable. The trading surface must describe a local flow preview and future proposals rather than imply a background Run or order execution until runtime, risk, approval, and execution services are connected.

## Do's and Don'ts

### Do:

- **Do** use divided ledgers and lists for related task, capability, and artifact state.
- **Do** reserve cobalt for the one active or primary operation.
- **Do** keep published, validated, running, and trading states visually and semantically distinct.
- **Do** preserve both light and dark themes with equivalent hierarchy and contrast.

### Don't:

- **Don't** restore cyan-purple gradients, decorative glow, or glass surfaces.
- **Don't** wrap every section in a large rounded card.
- **Don't** use fake market metrics, performance data, or decorative charts.
- **Don't** use semantic colors where no semantic state exists.
