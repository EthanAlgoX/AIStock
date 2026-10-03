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

Expert roundtable follows the research assistant within the research navigation group. Market radar is the first research destination, followed by the assistant, roundtable, and stock research; mobile exposes the research assistant, roundtable, stock research, strategy screening, and trade simulation, with market radar in the utility menu. The dedicated discussion page uses a history rail and a central conversation: compact expert/mode selectors, a topic composer, and directly visible chronological speaker outputs. Mode-specific host labels distinguish task synthesis, debate synthesis, and vote-based synthesis. The research assistant keeps intermediate collaboration outputs out of the conversation and shows the final report.

Desktop uses a 212px persistent left navigation grouped by the user's work: Research & discovery (market radar, assistant, expert roundtable, stock research), Strategies & portfolio (screening, trade simulation, holdings, alerts), and Tasks & settings (runs, schedules, capabilities, usage, account/platform settings). The compact 64px opaque header identifies the current workspace and retains theme, language, and the complete navigation drawer. Nested routes keep their parent destination selected; members see “My account” rather than platform administration.

The research assistant uses a continuous canvas with a neutral 224px conversation-history rail. Its optional 272px session-context rail appears only at widths of at least 1680px so ordinary laptops retain reading space. Capabilities and mobile history use the shared keyboard-accessible drawer. Context describes real selections and history, without placeholder technical artifact statuses. Report workspaces retain their sticky directory and opaque reading surface. The default launcher is a secondary, expandable shortcut; the explicit new-research action opens the full task configuration without repeating that shortcut.

Shared page containers are capped at 1440px with 16px mobile and 24px wider gutters. Headings use 24–28px type with concise, task-oriented descriptions and a clear main action. Page headers sit directly on the canvas with a structural divider. Dense operational information uses divided ledgers or locally scrolling tables rather than repeated metric cards. Loading, an empty result, a failed read, and a successful read with zero entries remain distinct states. Saving cannot submit an unread configuration or repeat while a request is in flight. Destructive actions identify the affected object in a confirmation dialog.

Below 1024px, the five decision workspaces remain in a fixed bottom navigation with safe-area padding. A 56px command bar keeps theme and language reachable and opens the complete grouped navigation. Every secondary destination remains accessible from that drawer. Primary actions wrap onto a full-width row on small screens; optional task and schedule configuration expands on demand. Multi-column ledgers stack without removing labels or changing data semantics. A keyboard skip link targets the application's single main landmark; drawers contain focus, support Escape, and restore focus to their trigger.

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

The desktop application header is sticky, opaque, and task-first. Global navigation uses the grouped left rail described above; selected destinations use cobalt text/icon and a quiet cobalt tint. Capability configuration retains its local navigation for overview, Skill, tools, MCP, data sources, and experts, while schedules and runs retain task-center navigation. Tool and MCP remain distinct: tools expose callable schemas and permissions, while MCP pages manage external servers. Configuration separates platform presets from workspace entries and displays actual loading, read errors, and save feedback. Trade simulation configures and runs persisted simulated accounts, with previewed symbol universes and frozen settings; proposal research remains a separate historical workspace and does not create fills. Neither surface implies broker execution or available real-order approval.

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

### Public homepage

The public homepage extends the existing AI Stock identity with the approved composition C: a left-aligned proposition and actions, an introduction and market coverage on the right, then a full-width five-module demonstration. Research, validation, and tracking lead into invitation-code / own-API access options and an expandable FAQ. Its contract is “Make research-to-validation inspectable”; this is a public product tour, not a replacement for the workspace design system.

`HomePage.css` scopes a fixed light palette to `.home-page`: porcelain `hsl(220 27% 97%)`, charcoal `hsl(225 32% 10%)`, white surfaces, mineral rules `hsl(220 18% 85%)`, and cobalt `hsl(231 86% 52%)` for actions, selection, focus, and demonstration marks. Workspace light/dark tokens remain unchanged. The inherited UI font, 36–56px desktop hero, 1280px maximum content width, thin dividers, 8px action corners, and 12px demonstration surface keep the presentation precise and restrained. Below 720px, columns stack and the module tabs scroll horizontally.

Module tabs support arrow keys, Home, and End, keep the selected tab visible, and label their panel; links and controls retain visible focus and reduced-motion support. Every example table, curve, signal, and outcome is explicitly fictional product education, never evidence of live market data, returns, or executed orders. Preserve the example labels and limitations wherever these demonstrations appear.
