---
name: "Cloudflare Unified Cron Platform"
description: "A warm, signal-led operator console for watching website Workers and their Cron."
colors:
  terracotta-action: "oklch(0.6171 0.1375 39.0427)"
  warm-ground: "oklch(0.9818 0.0054 95.0986)"
  brown-charcoal: "oklch(0.3438 0.0269 95.7226)"
  cream-plane: "oklch(0.9665 0.0067 97.3521)"
  plane-ink: "oklch(0.1908 0.002 106.5859)"
  white-popover: "oklch(1 0 0)"
  popover-ink: "oklch(0.2671 0.0196 98.939)"
  oat-secondary: "oklch(0.9245 0.0138 92.9892)"
  secondary-ink: "oklch(0.4334 0.0177 98.6048)"
  muted-oat: "oklch(0.9341 0.0153 90.239)"
  muted-taupe: "oklch(0.5341 0.0078 97.4503)"
  accent-ink: "oklch(0.2671 0.0196 98.939)"
  failure-red: "oklch(0.55 0.19 27)"
  hairline: "oklch(0.8847 0.0069 97.3627)"
  field-stroke: "oklch(0.7621 0.0156 98.3528)"
  quiet-sidebar: "oklch(0.9663 0.008 98.8792)"
  sidebar-ink: "oklch(0.359 0.0051 106.6524)"
  sidebar-muted: "oklch(0.54 0.008 97)"
  sidebar-line: "oklch(0.9401 0 0)"
  success-green: "oklch(0.52 0.115 154)"
  warning-amber: "oklch(0.66 0.145 64)"
  unknown-violet: "oklch(0.57 0.13 300)"
typography:
  display:
    fontFamily: "Outfit Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.85rem"
    fontWeight: 680
    lineHeight: 1
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "Outfit Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 650
    lineHeight: 1.15
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Outfit Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 650
    letterSpacing: "-0.012em"
  body:
    fontFamily: "Outfit Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "normal"
  label:
    fontFamily: "Outfit Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    letterSpacing: "normal"
  navigation:
    fontFamily: "Outfit Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 560
    lineHeight: 1.4
    letterSpacing: "normal"
  mono:
    fontFamily: "Geist Mono Variable, ui-monospace, SFMono-Regular, monospace"
    fontSize: "12px"
    fontWeight: 400
    letterSpacing: "normal"
rounded:
  brand: "9px"
  control: "10px"
  site-mark: "12px"
  panel: "14px"
  login: "16px"
  pill: "999px"
spacing:
  base: "4px"
  compact: "6px"
  xs: "8px"
  sm: "10px"
  md: "12px"
  panel-gap: "14px"
  panel: "16px"
  room: "18px"
  card: "20px"
  topbar: "22px"
  page: "24px"
  login: "26px"
  page-bottom: "48px"
components:
  button-primary:
    backgroundColor: "{colors.terracotta-action}"
    textColor: "{colors.white-popover}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "36px"
  button-primary-hover:
    backgroundColor: "color-mix(in srgb, oklch(0.6171 0.1375 39.0427) 88%, transparent)"
    textColor: "{colors.white-popover}"
    rounded: "{rounded.control}"
    height: "36px"
  button-outline:
    backgroundColor: "{colors.warm-ground}"
    textColor: "{colors.brown-charcoal}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "36px"
  button-danger:
    backgroundColor: "{colors.failure-red}"
    textColor: "{colors.white-popover}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "36px"
  input:
    backgroundColor: "{colors.warm-ground}"
    textColor: "{colors.brown-charcoal}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "40px"
    width: "100%"
  panel:
    backgroundColor: "{colors.cream-plane}"
    textColor: "{colors.plane-ink}"
    rounded: "{rounded.panel}"
    padding: "16px"
  status-badge:
    backgroundColor: "transparent"
    textColor: "{colors.muted-taupe}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
  navigation-active:
    backgroundColor: "color-mix(in oklch, oklch(0.6171 0.1375 39.0427) 12%, oklch(0.9663 0.008 98.8792))"
    textColor: "{colors.terracotta-action}"
    typography: "{typography.navigation}"
    rounded: "{rounded.control}"
    padding: "0 10px"
    height: "40px"
---

# Design System: Cloudflare Unified Cron Platform

## Overview

**Creative North Star: "The 24-Hour Run Signal"**

This is a private operations console, not a SaaS dashboard or marketing surface. Its visual center is a continuous 24-hour run signal in which real Execution points sit on the branches of each website Worker and its declared Cron tasks. A short business verdict precedes that field so an owner can decide within seconds whether to leave or investigate.

The visual world is the Claude+ warm control room: near-white ground, cream operational planes, brown-charcoal copy, fine observation lines, and terracotta reserved for action and active system motion. Standard control patterns remain compact and familiar. The signature comes from the authored website→Cron tree and signal trace, not from oversized promotional type, floating KPI cards, raster decoration, or scroll choreography.

**Key Characteristics:**

- One truthful business verdict leads the page.
- A single responsive 24-hour field connects website identity, Cron branches, recent outcomes, and next run.
- Outfit carries human-facing operations language; Geist Mono is reserved for machine evidence.
- Warm, flat planes and one-pixel rules provide structure with almost no ambient depth.
- Terracotta marks actions and active motion; green, amber, violet, and red retain separate operational meanings.
- Desktop prioritizes horizontal comparison; mobile becomes a focused vertical site corridor without discarding evidence.

## Colors

The Claude+ palette uses warm OKLCH neutrals as the working material, terracotta as the interaction accent, and four distinct state colors for operational truth.

### Primary

- **Terracotta Action** (`oklch(0.6171 0.1375 39.0427)`): Primary actions, active navigation, links, running Execution points, selection, and focus rings. It signals movement or intent rather than success.
- **White on Terracotta** (`oklch(1 0 0)`): Foreground for filled primary and destructive actions.

### Secondary

- **Oat Secondary** (`oklch(0.9245 0.0138 92.9892)`): Quiet hover fills, site identity wells, and secondary emphasis.
- **Secondary Ink** (`oklch(0.4334 0.0177 98.6048)`): Text and icons placed on Oat Secondary.

### Tertiary

- **Success Green** (`oklch(0.52 0.115 154)`): Confirmed success, healthy sites, compatible targets, and normal run traces.
- **Warning Amber** (`oklch(0.66 0.145 64)`): Stale heartbeat, paused schedules, retry wait, pending, and unsettled but understood states.
- **Unknown Violet** (`oklch(0.57 0.13 300)`): Unknown outcomes, unsynchronized registrations, and unavailable dispatch evidence.
- **Failure Red** (`oklch(0.55 0.19 27)`): Explicit failure, unreachable or incompatible targets, attention verdicts, and destructive actions.

### Neutral

- **Warm Ground** (`oklch(0.9818 0.0054 95.0986)`): The light-mode page and signal-track canvas.
- **Brown Charcoal** (`oklch(0.3438 0.0269 95.7226)`): Primary human-readable copy.
- **Cream Plane** (`oklch(0.9665 0.0067 97.3521)`): Panels blended toward Warm Ground for low-contrast operational grouping.
- **Plane Ink** (`oklch(0.1908 0.002 106.5859)`): High-emphasis panel titles and task names.
- **Muted Oat / Muted Taupe** (`oklch(0.9341 0.0153 90.239)` / `oklch(0.5341 0.0078 97.4503)`): Hover washes, helper copy, timestamps, counts, and quiet states.
- **Hairline / Field Stroke** (`oklch(0.8847 0.0069 97.3627)` / `oklch(0.7621 0.0156 98.3528)`): Panel divisions and the stronger boundary used by form controls.
- **Quiet Sidebar** (`oklch(0.9663 0.008 98.8792)`): The light navigation rail, visually adjacent to rather than detached from the page.
- **Sidebar Muted** (`oklch(0.54 0.008 97)`): Inactive navigation, the management label, and the infrastructure footnote.

Dark mode remaps the same semantic roles to Claude+ charcoal planes, warm near-white copy, a brighter terracotta primary, and higher-lightness state colors. Component assignments do not change between modes.

### Named Rules

**The Terracotta Means Motion Rule.** Use terracotta for actions, active navigation, links, and running work; never reuse it as a generic success color.

**The State Separation Rule.** Success, warning, unknown, and failure keep distinct colors plus visible text or icons. No percentage or green wash may hide unknown, skipped, blocked, or sample-limited evidence.

**The Warm Plane Rule.** Operational surfaces stay near-white, warm, and low-contrast. No glass, gradient, or saturated background competes with the run signal.

## Typography

**Display Font:** Outfit Variable (with UI system sans fallbacks)

**Body Font:** Outfit Variable (with UI system sans fallbacks)

**Label/Mono Font:** Geist Mono Variable (with UI monospace and SFMono fallbacks)

**Character:** Outfit is open and human without becoming promotional, which suits Chinese-first operational labels and compact page verdicts. Geist Mono makes Cron expressions, Worker IDs, revisions, exact times, and raw evidence visibly technical without turning the whole console into a terminal.

### Hierarchy

- **Display** (680, 1.85rem, 1 line-height, -0.03em tracking): The Overview's “业务总览” command title.
- **Headline** (650, 1.75rem, 1.15 line-height, -0.025em tracking): Standard page titles across the console.
- **Title** (650, 16px, -0.012em tracking): Signal, website, attention, and panel headings.
- **Body** (400, 15px, 1.55 line-height): Default human-facing copy; page descriptions are commonly 14px and capped near 65–68 characters.
- **Label** (600, 12px): Task rows, state legends, counts, timestamps, and compact evidence.
- **Navigation** (560, 14px): Primary and management routes in the 208px rail.
- **Mono** (400, 12px): Cron expressions, target IDs, revisions, execution IDs, and time-scale ticks; numeric evidence uses tabular figures.

### Named Rules

**The Human First Rule.** Lead with website and task language in Outfit; reveal platform vocabulary as supporting evidence rather than the first thing a user must decode.

**The Mono Is Evidence Rule.** Geist Mono is for exact machine values only. Do not apply it to headings, actions, business verdicts, or general navigation.

## Layout

The authenticated shell uses a fixed 208px sidebar and a 58px topbar. Main content occupies the remaining width, centers within a 1660px maximum, and uses 24px top and horizontal padding with 48px below. Primary business routes appear first; lower-frequency Cron, registration, and scheduler controls sit beneath a small “管理” divider.

The Overview is a compact vertical stack with a 14px rhythm. Its command row is at least 62px high and pairs the title and business verdict with website/task counts, the last refresh time, and a refresh control. The 24-hour signal plane is one bordered object. At wide widths each task uses three columns: a 220–270px website/Cron tree, a flexible signal track with a 430px minimum, and a 170px latest-result/next-run column. The board stays horizontally comparable at a 900px minimum and vertically bounded to the smaller of 58vh or 650px. Website groups are individually collapsible; with multiple websites the highest-priority group opens first, the others begin collapsed, and the operator's choices persist locally.

Below the signal, the workbench uses a 1.55/0.75 split for website rows and the attention queue, separated by 14px. The quality strip uses two 190px metrics followed by flexible platform evidence. At 1160px the workbench and website detail body become one column. At 900px the command row and site facts reflow. Below 900px the rail becomes an off-canvas drawer, the topbar becomes 54px, content padding becomes 18px 12px 38px, the time scale is hidden, and each task becomes a two-column mobile row with its signal trace on a full-width second line. At 520px the quality strip stacks to one column.

**The One Field Rule.** Website identity, Cron branches, run points, last state, and next time belong to one continuous observation field; do not split them into separate KPI cards.

**The Ten-Second Rule.** The first screen answers overall health, affected website/task, and next action without a narrative preamble or a visit to a second page.

## Elevation & Depth

The console is flat by design. Signal, website, attention, quality, and routine ledger planes explicitly remove shadows; one-pixel borders, nested hairlines, subtle OKLCH mixes, and tree geometry establish hierarchy. The login panel alone uses the theme's small structural shadow, while dialogs use a stronger modal shadow above a 45% black overlay. The topbar is opaque and has no backdrop blur.

### Shadow Vocabulary

- **Login Lift** (`0 1px 3px 0 hsl(0 0% 0% / 0.1), 0 1px 2px -1px hsl(0 0% 0% / 0.1)`): Only the centered authentication panel.
- **Dialog Lift** (`0 20px 55px rgba(0, 0, 0, 0.24)`): Alert and standard dialog content above the modal scrim.

### Named Rules

**The Flat Observation Rule.** Runtime surfaces stay shadowless; use border hierarchy and tonal planes unless content actually overlays the page.

## Shapes

The form language is softly technical: 9px for the small brand signal, 10px for buttons, fields, navigation rows, and icon controls, 12px for website identity wells, 14px for operational panels and dialogs, and 16px for the login panel. Circles and full pills are limited to run points, status dots, counts, badges, and progress-like evidence. Tree trunks and branches remain square one-pixel lines.

**The Rounded Plane Rule.** A complete operational group may use a 14px container, but its internal rows are divided by straight hairlines rather than nested rounded cards.

**The Node Geometry Rule.** Circles mean state or a point in time; lines mean relationship or continuity. Do not turn the website→Cron tree into ornamental blobs.

## Components

### Buttons

Buttons remain standard and compact so controls do not overpower evidence.

- **Shape:** 10px radius; 36px default, 32px small, 44px large, and 36px icon sizes.
- **Primary:** Terracotta Action with White on Terracotta, 12px horizontal padding, and semibold 14px type.
- **Hover / Focus:** Filled buttons move to 88% primary color; outline and ghost buttons gain Muted Oat. Keyboard focus uses a two-pixel terracotta ring with a two-pixel offset. Background, color, border, and ring transitions run for 150ms.
- **Danger / Disabled:** Danger uses Failure Red with white text. Disabled controls retain shape and label at 45% opacity and reject pointer events.

### Chips

Status badges are compact evidence labels, not decorative filters.

- **Style:** Transparent pill with a one-pixel Hairline, 8px horizontal and 2px vertical padding, 12px semibold text, and a 13px status icon.
- **State:** Text and icon inherit the semantic state color. The Chinese label always remains visible; color is supplementary.

### Cards / Containers

Operational containers read as flat planes, not floating cards.

- **Corner Style:** 14px panel radius.
- **Background:** Cream Plane mixed 82% toward Warm Ground.
- **Shadow Strategy:** None for runtime surfaces.
- **Border:** One-pixel Hairline around the group and between its internal regions.
- **Internal Padding:** Common heads use 14–18px; row content uses 8–16px depending on density.

### Inputs / Fields

Fields use the same warm materials with a deliberately stronger outline.

- **Style:** 40px height, Warm Ground fill, one-pixel Field Stroke, 10px radius, 12px horizontal padding, and 14px type. Textareas share the treatment with a 112px minimum height. Filter selects open a bounded 12px-radius popover aligned to the trigger instead of inheriting a full-width browser-native menu.
- **Focus:** The border becomes terracotta and gains a two-pixel 25%-opacity terracotta ring.
- **Error / Disabled:** Errors use Failure Red with 12px helper text; disabled fields retain content at 50% opacity.

### Navigation

The 208px Quiet Sidebar is a low-contrast continuation of the canvas. Routes are 40px high with 10px corners and 14px medium Outfit. Hover uses the sidebar accent plane; the active route mixes 12% Terracotta Action into the sidebar and turns its icon and label terracotta. Below 900px the rail becomes a focus-managed drawer up to 290px wide with an inert page and a 42% black scrim.

### Tables

Tables remain the dense fallback for complete histories and technical lists. Headers are 40px high with 12px semibold Muted Taupe; cells use 12px horizontal and vertical padding. Rows are divided by Hairline and gain only a 50% Muted Oat wash on hover. IDs and schedules use Geist Mono; counts use tabular figures.

### 24-Hour Run Signal

The signature field uses real Execution data only. Website headers are 48px high and expose keyboard-operable expand/collapse controls plus a direct link to the website's Cron list. Cron task rows are at least 52px. A one-pixel vertical trunk at 27px and 14px horizontal branches join 9px nodes to task names and Cron expressions. The responsive event rail is 32px high; success stays on the center line, failure rises, unknown/retry wait drops, and running sits slightly high. Fixed-size circular points use state fills plus a contrasting ground stroke, while an empty rail becomes a dashed Hairline. Discrete executions are never connected into a fabricated trend line.

### Attention Queue

Attention rows are at least 64px and use a three-column icon/content/arrow structure. Failure, unknown, retry wait, and stale heartbeat are presented before ordinary history, with website and task context in the title and exact time/state beneath. A clear state replaces the queue with a compact green confirmation—never a fabricated zero-value metric.

## Do's and Don'ts

### Do:

- **Do** lead the Overview with a truthful business verdict derived from live platform and Execution state.
- **Do** preserve the website → Cron → Execution → Attempt path in labels, links, and investigation order.
- **Do** keep every signal point, rate, count, and attention item backed by the real API.
- **Do** reserve terracotta for action and active motion while keeping semantic outcomes distinct.
- **Do** use Outfit for human operations language and Geist Mono for exact machine evidence.
- **Do** collapse the 24-hour field into the implemented mobile site corridor below 900px while retaining task, state, trace, and next-run evidence.
- **Do** keep routine controls familiar, compact, keyboard-visible, and Chinese-first.

### Don't:

- **Don't** reintroduce the discarded marketing hero, editorial split, oversized narrative sections, or GSAP scroll choreography.
- **Don't** build a SaaS KPI card wall or give every entity the same visual weight.
- **Don't** fabricate run points, business metrics, health percentages, or reassuring empty values.
- **Don't** replace the responsive signal/tree with a decorative chart or raster image.
- **Don't** use gradients, glass, backdrop blur, or ambient shadows on runtime surfaces.
- **Don't** add create-or-edit Cron UI; website Registration remains the source of declared tasks.
- **Don't** communicate status with color alone or merge failure and unknown into one generic error state.
