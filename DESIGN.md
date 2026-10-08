---
name: AI Stock
description: A calm research workspace for market evidence, expert collaboration and paper simulation.
colors:
  primary: "hsl(5.4 64.6% 47.6%)"
  primary-dark: "hsl(7.1 81.9% 67.5%)"
  primary-ink-light: "hsl(0 0% 100%)"
  primary-ink-dark: "hsl(42.9 15.6% 8.8%)"
  canvas-light: "hsl(40.0 34.9% 91.6%)"
  canvas-dark: "hsl(60.0 7.7% 7.6%)"
  surface-light: "hsl(43.6 40.7% 94.7%)"
  surface-dark: "hsl(60.0 9.4% 10.4%)"
  elevated-light: "hsl(42.9 53.8% 97.5%)"
  elevated-dark: "hsl(51.4 10.8% 12.7%)"
  ink-light: "hsl(42.9 15.6% 8.8%)"
  ink-dark: "hsl(40.0 38.5% 92.4%)"
  secondary-ink-light: "hsl(40.0 11.4% 31.0%)"
  secondary-ink-dark: "hsl(38.2 14.3% 69.8%)"
  muted-ink-light: "hsl(42.0 10.3% 38.0%)"
  muted-ink-dark: "hsl(38.2 11.6% 62.7%)"
  border-light: "hsl(42.0 20.4% 80.8%)"
  border-dark: "hsl(48.0 10.0% 19.6%)"
  success: "hsl(144.8 51.3% 30.6%)"
  success-dark: "hsl(142.9 38.5% 57.3%)"
  warning: "hsl(37.6 100.0% 30.0%)"
  warning-dark: "hsl(38.8 71.4% 64.3%)"
  danger: "hsl(4.3 61.4% 44.7%)"
  danger-dark: "hsl(7.1 81.9% 67.5%)"
typography:
  headline:
    fontFamily: "Inter, SF Pro Display, Segoe UI, system-ui, -apple-system, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.025em"
  body:
    fontFamily: "Inter, SF Pro Display, Segoe UI, system-ui, -apple-system, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "-0.006em"
  label:
    fontFamily: "Inter, SF Pro Display, Segoe UI, system-ui, -apple-system, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.04em"
  report:
    fontFamily: "Inter, SF Pro Display, Segoe UI, system-ui, -apple-system, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.65
rounded:
  compact: "8px"
  control: "10px"
  surface: "12px"
  overlay: "16px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-ink-light}"
    rounded: "{rounded.surface}"
    padding: "0 16px"
    height: "40px"
  button-secondary:
    backgroundColor: "{colors.surface-light}"
    textColor: "{colors.ink-light}"
    rounded: "{rounded.surface}"
    padding: "0 16px"
    height: "40px"
  workspace-surface:
    backgroundColor: "{colors.surface-light}"
    textColor: "{colors.ink-light}"
    rounded: "{rounded.surface}"
    padding: "20px"
  module-link:
    textColor: "{colors.secondary-ink-light}"
    rounded: "{rounded.compact}"
    padding: "8px 12px"
    height: "44px"
---

# Design System: AI Stock

## Overview

**Creative North Star: "The Agent Decision Desk"**

AI Stock is an operational research desk: calm enough for long reading sessions, compact enough for market evidence and account records, and explicit about every state transition. The visual reference is NOFX's current warm-paper interface. Vermilion marks the current location and primary action; charcoal text, tonal surfaces and thin rules organize the work. The research assistant owns a clear conversation canvas, while stock research, screening and simulation retain their task-specific forms and results.

The seven-module header establishes location before the user enters a page. Conversation history, report history and session capabilities appear when requested, leaving the main task room to breathe. This replaces the former persistent global and page sidebars without changing routes, capability bindings or account semantics. Public product education shares the palette while keeping its approved homepage composition and explicit example labels.

**Key Characteristics:**

- Warm paper in light mode and warm charcoal in dark mode.
- A horizontal module header, local page navigation and one main task canvas.
- Vermilion for actions, location, focus and selection; semantic colors for real state.
- Readable sans-serif prose, tabular data and restrained corners.
- Opaque structural surfaces and context revealed on demand.

## Colors

Warm neutrals carry the interface. The primary accent is deeper in light mode for readable text and lighter in dark mode, where primary buttons use dark ink. The frontmatter records the actual `index.css` HSL tokens; Tailwind and compatibility aliases resolve to the same theme roles.

### Primary

- **Control Vermilion:** Primary actions, selected module links, local-page underlines and focus. Use the theme-specific primary foreground on solid buttons.

### Neutral

- **Warm Paper:** Light canvas, with a slightly lighter panel surface and an elevated surface for menus and dialogs.
- **Warm Charcoal:** Dark canvas and panel layers, paired with warm light text.
- **Research Ink:** Main labels and prose. Secondary and muted ink retain readable hierarchy for explanations, timestamps and placeholders.
- **Paper Rule:** Borders and dividers identify regions without surrounding every fragment with another card.

### Semantic

- **Evidence Green:** Success, healthy connections and completed positive states.
- **Review Amber:** Warnings, incomplete results and actions requiring attention.
- **Risk Red:** Errors, destructive actions and adverse states; its role remains distinct from the brand accent even where their hues are close.

**The One Signal Rule.** Vermilion identifies active or actionable content; ordinary content stays neutral.

**The Semantic State Rule.** Success, warning and danger colors communicate recorded state, never invented performance or decorative market sentiment.

## Typography

**Display and Body Font:** The existing Inter / SF Pro Display / Segoe UI stack with native system and Chinese fallbacks.
**Data Font:** Native UI monospace for identifiers, code and selected numeric evidence; use tabular numerals for aligned measurements.

The type is compact and readable. Chinese prose remains sans-serif; hierarchy comes from size, weight and spacing rather than a terminal font applied to every element.

- **Headline:** PageHeader titles use the frontmatter headline style and increase to 1.75rem at the medium breakpoint. Conversation workspaces use compact 1rem titles in their own toolbar.
- **Title:** Section and object names typically use 1rem–1.125rem semibold type.
- **Body:** Operational copy and controls use the body role. Page descriptions have a six-unit line height and a maximum width of 65ch.
- **Report:** The shared report reader uses the report role, with prose blocks limited to 72ch. Structured charts keep their own scale.
- **Label:** A contextual kicker uses the label role. Module links use 0.8125rem type; labels remain readable rather than imitating NOFX's smallest terminal captions.

**The Mono Evidence Rule.** Monospace formats evidence; it does not replace the reading font.

## Layout

### Workspace shell

Desktop has a sticky 64px command bar: brand, seven module links, theme, language and the full workspace menu. The modules are market radar, research, strategy screening, trade simulation, assets, tasks and workspace settings. Research groups the assistant, expert roundtable and stock research; assets groups holdings, ledger and alerts; workspace settings groups capabilities, model usage and account/platform settings. Task pages retain their existing task-center navigation.

Modules with multiple destinations use a sticky 44px horizontal page strip below the command bar. Trade simulation always exposes overview, strategy management, source research and historical research proposals. Switching page links closes an unsubmitted configuration form without saving or running it; explicitly starting a new configuration retains the existing reset behavior. Capability pages retain their more specific capability navigation. Local labels describe the current scope; nested routes and trading query views remain selected correctly. Member settings remain “My account”.

Ordinary page containers are capped at 1440px, with 16px mobile gutters and 24px gutters from 768px. Page headings sit on the canvas with a divider and wrapping task actions. Ledgers and related records use divided lists or locally scrolling tables. Wide tables scroll inside their region instead of forcing the whole page sideways.

Below 1024px, the command bar is 56px and the module list moves into the complete menu. Five primary workspaces remain in a fixed bottom navigation: assistant, roundtable, stock research, screening and simulation. The bottom region includes safe-area padding; all other destinations remain accessible from the menu. The horizontal local-page strip scrolls when its labels exceed the available width.

### Conversations and reports

Assistant and roundtable occupy the viewport remaining after the shell header and mobile navigation. Each keeps its own scrolling message region and persistent composer. History opens in the shared left drawer at every screen size. Session capabilities open in a right drawer; their selection grid responds to the panel's own width and becomes two columns from 40rem.

The assistant centers conversation content and its composer within a 64rem maximum width. Session settings, Skills and expert collaboration start as compact disclosures above the input. Expanded controls scroll within a bounded region, and the textarea height is limited on short screens so the input remains reachable. Closing context does not submit a task or clear the draft, session, selections or frozen run configuration. The roundtable exposes member and collaboration choices for a new discussion or explicit next-round editing; a saved round presents a compact member summary. Next-round changes never rewrite previous rounds. Long messages can open a full-text reader and final reports remain document cards.

Stock research and screening use full-width report workspaces. Report history opens from the toolbar; selecting an entry closes the drawer and keeps the report/run URL. New task configuration expands explicitly and closes after a task is accepted. Running, failed, empty and completed results retain distinct status and retry controls; report provenance remains inspectable.

### Public homepage

The approved composition C remains: a left-aligned proposition and actions, introduction and market coverage on the right, then a full-width five-module demonstration, research journey, access options and FAQ. `.home-page` scopes the shared paper, ink and vermilion palette to a fixed light surface, regardless of the workspace theme. Its maximum content width is 1280px; the hero scales from 36px to 56px. Columns stack below 720px and demonstration tabs scroll horizontally. Example curves, tables and outcomes remain explicitly fictional product education.

## Elevation & Depth

Depth comes first from tonal surfaces and one-pixel rules. Existing workspace surfaces retain soft structural shadows; light-mode shadows are shallow and dark-mode shadows are broader. They separate a genuine panel or overlay from its canvas. Drawers use an opaque panel and a dimmed backdrop; the backdrop does not make the panel a translucent material.

**The Structural Layer Rule.** Use depth to distinguish a real layer or interaction state. New surfaces should not add decorative glass, neon glow or a colored ambient halo.

Short color, border and shadow transitions provide control feedback. Shared card and CSS action-button transitions respect reduced-motion overrides; the existing drawer entrance animation remains. New motion must honor reduced-motion preferences. Focus remains visible independently of hover.

## Shapes

The shape language uses modest rectangles: compact navigation and toolbar controls have 8px corners; shared input fields and CSS action buttons have 10px corners; default shared Button and workspace surfaces use the 12px radius. Overlays can use 16px corners. Status tags use pills only where the compact silhouette supports a real state label. Main page regions retain straight dividers rather than becoming floating capsules.

## Components

### Buttons

Primary controls are solid vermilion with theme-specific foreground. The shared Button defaults to 40px height and 16px horizontal padding; size variants support compact and 44px/48px actions. CSS action buttons and header controls have a 44px minimum height. Secondary actions use neutral surfaces and an explicit border; ghost actions remain quiet. Loading disables repeated submission and retains an accessible busy state.

Hover changes tone or border. The shared focus treatment is a two-pixel theme-ring outline with offset; disabled controls preserve geometry and visibly reduce emphasis.

### Chips and records

Small badges pair semantic text, tint and border. Selection uses the primary role; lifecycle and health use their semantic roles. Tables and record lists prioritize aligned labels, actual values and tabular numbers. Unavailable evidence must remain unavailable rather than becoming a sample KPI.

### Cards and containers

The shared workspace surface uses a thin rule, panel background, surface radius and the existing structural shadow. Shared Card padding is 16px, 20px or 24px by density. Reading surfaces can use larger padding at wider breakpoints. Prefer one coherent container for a task, dataset or report; use dividers within it.

### Inputs and fields

Standard Input is 40px high with an inset neutral background and visible border. Textareas grow within their workspace constraints. Focus changes the border and adds a quiet ring. Placeholder ink is readable in both themes, including disabled fields; labels remain separate from placeholders. Errors retain semantic text and accessible associations. ChoiceList keeps its existing keyboard and selection behavior.

### Navigation and disclosures

Selected module links have a quiet primary tint; selected local-page links use an underline. Both show current location semantically. The complete menu groups existing routes by the seven modules and retains logout confirmation and chat completion indicators. Platform settings categories use horizontal scrolling controls rather than a permanent inner sidebar.

Disclosures identify what will open, display the current selection where useful, and keep `aria-expanded` aligned with state. They reveal optional configuration without changing business state. Tools and MCP remain separate destinations; task/run records and model usage remain separate concepts.

### Drawers and dialogs

Use the shared portal and focus management. Drawers contain focus, support Escape, restore focus to the trigger and coordinate nested confirmation dialogs. Headers do not shrink; the body alone scrolls with a zero minimum height and responsive 16px/24px padding. Close controls stay visible. Destructive confirmations name the affected object and retain explicit confirm/cancel actions.

## Do's and Don'ts

### Do:

- **Do** orient the user with module, local page and task context before presenting optional configuration.
- **Do** keep conversation and report history accessible through explicit controls without permanently narrowing the main canvas.
- **Do** use divided ledgers and lists for related task, capability and artifact state.
- **Do** preserve light and dark hierarchy, keyboard focus, safe-area spacing and localized labels.
- **Do** keep published, running, incomplete, simulated and unavailable states visibly distinct.

### Don't:

- **Don't** reintroduce stacked permanent global, history and capability sidebars in conversation workspaces.
- **Don't** use fake market metrics, account performance, consensus or decorative charts as product evidence.
- **Don't** wrap each field or paragraph in another large rounded card.
- **Don't** add decorative glass, neon glow or cyan-purple gradients to new workspace surfaces.
- **Don't** imply broker execution or approval from a research proposal or paper simulation result.
