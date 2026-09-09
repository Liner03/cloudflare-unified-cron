---
name: "Cloudflare Unified Cron Platform"
description: "An editorial dispatch ledger for truthful, bounded Worker scheduling."
colors:
  signal-orange: "#b94720"
  signal-orange-focus: "#9d3815"
  signal-orange-dark: "#eb794a"
  warm-paper: "#f4f1e9"
  paper-card: "#faf8f2"
  paper-popover: "#fffdf7"
  dark-ink: "#20251f"
  muted-ink: "#656c62"
  warm-secondary: "#e8e3d8"
  warm-secondary-ink: "#2e342d"
  ledger-line: "#d7d1c4"
  field-line: "#c9c2b5"
  deep-rail: "#1d231f"
  rail-paper: "#eef0e9"
  rail-muted: "#9ea89e"
  action-on-orange: "#fffaf5"
  success: "#2f7651"
  warning: "#a76117"
  destructive: "#b83d38"
  unknown: "#8055a6"
  night-paper: "#151915"
  night-card: "#1b201c"
  night-ink: "#e8e8df"
  night-line: "#363d36"
typography:
  display:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(3rem, 4vw, 4.5rem)"
    fontWeight: 680
    lineHeight: 0.98
    letterSpacing: "-0.038em"
  headline:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(2.3rem, 4.5vw, 4.8rem)"
    fontWeight: 670
    lineHeight: 1.02
    letterSpacing: "-0.038em"
  title:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(1.55rem, 2vw, 2rem)"
    fontWeight: 690
    lineHeight: 1.15
    letterSpacing: "-0.025em"
  body:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "normal"
  label:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0.06em"
  mono:
    fontFamily: "SFMono-Regular, Consolas, Liberation Mono, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "normal"
rounded:
  mark: "8px"
  control: "10px"
  inset: "12px"
  card: "14px"
  feature: "18px"
  pill: "999px"
spacing:
  hairline: "1px"
  xs: "4px"
  sm: "8px"
  control-gap: "10px"
  md: "12px"
  ledger: "16px"
  field: "18px"
  card: "20px"
  page: "24px"
  section: "28px"
  spacious: "34px"
  feature: "46px"
  hero: "64px"
  mobile-section: "96px"
components:
  button-primary:
    backgroundColor: "{colors.signal-orange}"
    textColor: "{colors.action-on-orange}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "36px"
  button-primary-hover:
    backgroundColor: "color-mix(in srgb, #b94720 88%, transparent)"
    textColor: "{colors.action-on-orange}"
    rounded: "{rounded.control}"
    height: "36px"
  button-outline:
    backgroundColor: "{colors.warm-paper}"
    textColor: "{colors.dark-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "36px"
  button-danger:
    backgroundColor: "{colors.destructive}"
    textColor: "#ffffff"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "36px"
  input:
    backgroundColor: "{colors.warm-paper}"
    textColor: "{colors.dark-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "40px"
    width: "100%"
  card:
    backgroundColor: "{colors.paper-card}"
    textColor: "{colors.dark-ink}"
    rounded: "{rounded.card}"
    padding: "20px"
  status-badge:
    backgroundColor: "transparent"
    textColor: "{colors.muted-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
  execution-stack-card:
    backgroundColor: "{colors.paper-card}"
    textColor: "{colors.dark-ink}"
    rounded: "{rounded.feature}"
    padding: "clamp(26px, 4vw, 54px)"
---

# Design System: Cloudflare Unified Cron Platform

## Overview

**Creative North Star: "The Dispatch Ledger"**

The interface is an operational ledger given an editorial split: warm paper carries the working record, a fixed dark-ink rail anchors navigation, and signal orange marks the few actions that change intent. Its visual authority comes from restraint, precise borders, truthful state language, and large typographic statements—not from a generic metric-card wall.

The system is quiet but not timid. Dense tables, controls, and timelines handle routine operations; the Overview opens into a more spacious narrative with a split signal image, a gapless bento, risk slices, and a GSAP pin/stack sequence. Every expressive move still serves operational truth: `failed`, `unknown`, `retry_wait`, and platform health remain distinct, and state never relies on color alone.

**Key Characteristics:**

- Warm paper surfaces against dark ink, with signal orange reserved for primary intent.
- Geist throughout, shifting from compact operational labels to tightly tracked editorial display type.
- Thin ledger lines and tonal fills create most structure; depth is exceptional.
- Gapless bento and table divisions read as one dispatch surface, not a pile of floating cards.
- Status always combines text or iconography with hue.
- Desktop scroll storytelling collapses into a direct linear flow on mobile and reduced-motion systems.

## Colors

The palette pairs low-chroma warm neutrals with a single rust-orange action signal; green, amber, red, and violet communicate mutually distinct operational outcomes.

### Primary

- **Signal Orange:** The scarce action color for primary buttons, capacity marks, the brand pulse, and faint editorial washes.
- **Signal Orange Focus:** The stronger orange used for keyboard focus and selection authority.
- **Signal Orange Dark:** The brighter dark-mode remap that preserves action contrast on night surfaces.

### Secondary

- **Warm Secondary:** A slightly deeper paper tone for quiet icon wells and secondary controls.
- **Warm Secondary Ink:** Its dark, low-chroma foreground.

### Tertiary

- **Success Green:** Confirmed success, compatible targets, and healthy dispatch signals.
- **Warning Amber:** Running, pending, retry-wait, and other unsettled but understood states.
- **Destructive Red:** Explicit failure, incompatibility, unreachable targets, and destructive actions.
- **Unknown Violet:** Results whose external side effects cannot yet be confirmed.

### Neutral

- **Warm Paper:** The primary light-mode canvas.
- **Paper Card:** The slightly lifted paper used by cards, bento cells, and execution panels.
- **Paper Popover:** The cleanest paper reserved for dialogs and overlays.
- **Dark Ink:** Primary light-mode text and the basis of the dark navigation rail.
- **Muted Ink:** Supporting copy, metadata, timestamps, and secondary labels.
- **Ledger Line:** Dividers, card outlines, table rules, and section boundaries.
- **Field Line:** The stronger boundary used by form controls.
- **Deep Rail:** The fixed desktop navigation and dark editorial action surface.
- **Rail Paper / Rail Muted:** High- and low-emphasis text on Deep Rail.
- **Night Paper / Night Card / Night Ink / Night Line:** The explicit dark-mode surface, text, and boundary remap.

### Named Rules

**The Signal Is Scarce Rule.** Signal orange identifies primary intent and small system pulses; it does not flood large surfaces or compete with status colors.

**The Operational Truth Rule.** Never collapse unknown, failure, warning, and success into a binary red/green system; retain their text labels, icons, and separate hues.

**The Warm Neutral Rule.** Default surfaces stay warm and low-chroma. Pure white appears only as a small interaction lift, never as the page canvas.

## Typography

**Display Font:** Geist Variable (with UI system sans fallbacks)  
**Body Font:** Geist Variable (with UI system sans fallbacks)  
**Label/Mono Font:** SFMono-Regular (with Consolas and Liberation Mono fallbacks)

**Character:** Geist gives Chinese and English operations copy a single disciplined voice. Tight tracking and high weight turn the Overview into an editorial dispatch statement, while normal-sized body text and tabular figures keep the working surfaces fast to scan.

### Hierarchy

- **Display** (680, fluid 3rem–4.5rem, 0.98 line-height): The two-line Overview proposition; it balances across the editorial split.
- **Headline** (670, fluid 2.3rem–4.8rem, 1.02 line-height): Major Overview chapter statements and the dark closing action.
- **Title** (690, fluid 1.55rem–2rem, 1.15 line-height): Operational page titles outside the narrative Overview.
- **Body** (400, 14px, 1.55 line-height): Controls, table content, descriptions, and routine working copy; descriptive lines generally stop near 62–68 characters.
- **Label** (700, 11px, 0.06em tracking, uppercase where semantic): Heartbeat labels and compact system annotations.
- **Mono** (400, 12px, 1.55 line-height): IDs, raw snapshots, the scheduler caption, timestamps, and machine vocabulary; numeric tables use tabular figures.

### Named Rules

**The One Family Rule.** Geist owns both the editorial and operational voices; hierarchy comes from scale, weight, tracking, and line-height rather than decorative font pairing.

**The Machine Truth Rule.** Use mono only when the value behaves like machine evidence—IDs, payloads, code, schedules, and exact timestamps—not as general visual decoration.

## Layout

The desktop shell is a 240px fixed Deep Rail beside a fluid workspace. A sticky 64px topbar holds page context and theme control; content is centered within a 1540px maximum and uses 24px horizontal page padding. Routine screens favor bordered ledger sections, two-column detail grids, and horizontally scrollable tables rather than dashboard tiles.

The Overview deliberately changes cadence. Its first viewport is a 1.35/0.65 editorial split with copy beside a grayscale signal field, contained by an 18px feature radius. Subsequent chapters use 112px–190px vertical breathing room. The operations summary is a twelve-column, gapless bento: a 1px ledger-colored grid separates contiguous paper cells. Risk items share a horizontal accordion, and the execution story pairs a pinned 0.7-width title with a 1.3-width stack.

At 1100px the hero becomes a vertical split. At 980px routine ledger and detail grids become one column. At 860px the section headings, bento, risk accordion, and execution story linearize; pinned positioning is removed. At 767px the rail becomes an off-canvas drawer, page padding drops to 16px, and forms become one column. At 540px the hero type and padding tighten, and at 480px heartbeat cells and toolbars become fully stacked.

**The Ledger Before Cards Rule.** Related facts share one bordered surface with 1px divisions; do not wrap every fact in its own floating container.

**The Editorial Split Rule.** Use the asymmetric split for narrative orientation and operational explanation, not as a default template for every working page.

## Elevation & Depth

The system is flat by default. Tonal paper shifts, hairline borders, dark/light contrast, and image washes provide structure without ambient card shadows. The two deliberate exceptions are the scroll-stacked execution cards, which need a soft low shadow to separate overlapping planes, and alert dialogs, which need a stronger structural shadow above a 45% black overlay. Signal dots use colored outline glows as status emphasis, not surface elevation.

### Shadow Vocabulary

- **Stack Separation** (`0 18px 45px rgb(18 24 19 / 8%)`): Only for execution cards that overlap during the pinned scroll story.
- **Dialog Lift** (`0 20px 55px rgba(0, 0, 0, 0.24)`): Only for modal confirmation content above its scrim.
- **Signal Halo** (`0 0 0 8px` with a 14% status-color mix): Healthy and stale signal markers in the bento.

### Named Rules

**The Flat-by-Default Rule.** Borders and tonal adjacency establish hierarchy; shadows appear only when overlap or modal separation makes depth operationally useful.

## Shapes

Rounded geometry is controlled and hierarchical: 8px for the brand mark, 10px for controls and navigation rows, 12px for inset informational groups, 14px for routine cards and dialogs, and 18px for feature-scale narrative structures. Pills are reserved for status badges, bar tracks, signal dots, and the inline title image. Hairline borders remain visible and warm; the bento achieves a gapless ledger by letting a 1px background show between cells.

**The Radius Has Rank Rule.** A larger radius indicates a larger compositional unit; never give a small field the same 18px silhouette as a hero or narrative section.

**The Pill Has Meaning Rule.** Fully rounded forms belong to compact status, progress, signal, or inline-image elements—not ordinary cards or buttons.

## Components

### Buttons

Buttons are compact, confident controls rather than promotional capsules.

- **Shape:** Gently rounded controls (10px) with 36px default, 32px small, 44px large, and 36px icon sizes.
- **Primary:** Signal Orange with paper-white text, 12px horizontal padding, 14px semibold type; large Overview actions use 20px horizontal padding.
- **Hover / Focus:** Hover deepens or lightens the current fill; keyboard focus uses a two-pixel Signal Orange Focus ring with a two-pixel offset. Color, border, background, and shadow transition over 150ms. Disabled controls stay visible at 45% opacity and reject pointer events.
- **Outline / Ghost / Danger:** Outline uses the page background and a Ledger Line, ghost gains a Muted Paper fill on hover, and danger uses Destructive Red with white text.

### Chips

Status badges are semantic chips, not filters.

- **Style:** Transparent pill, 1px Ledger Line, 8px horizontal and 2px vertical padding, 12px semibold text, and a 13px status icon.
- **State:** Success Green, Warning Amber, Destructive Red, Unknown Violet, or Muted Ink is applied to both text and icon; the visible label always carries the meaning.

### Cards / Containers

Routine cards are quiet ledger sheets; feature cards become large narrative planes.

- **Corner Style:** Routine Card radius (14px); feature and execution-stack radius (18px).
- **Background:** Paper Card on Warm Paper, with radial Signal Orange washes used only on the Overview hero and execution stack.
- **Shadow Strategy:** None at rest, except Stack Separation for overlapping execution cards.
- **Border:** One-pixel Ledger Line.
- **Internal Padding:** 20px for routine cards; feature cells use a fluid 24px–46px range, and stack cards use 26px–54px.

### Inputs / Fields

Fields are restrained, explicit, and consistent with the ledger.

- **Style:** 40px height, Warm Paper fill, one-pixel Field Line, 10px radius, 12px horizontal padding, and 14px text. Textareas keep the same treatment with an 112px minimum height and vertical resize.
- **Focus:** Border shifts to Signal Orange Focus and gains a two-pixel 25%-opacity focus ring.
- **Error / Disabled:** Errors use Destructive Red text at 12px; disabled controls remain legible at 50% opacity.

### Navigation

The desktop rail is fixed, dark, and compact. Links are 40px high, 10px rounded, 14px semibold, and use Rail Muted until hover; the active destination uses a 10% white fill and Rail Paper. On screens below 768px the rail translates off-canvas, a 42% black scrim appears, and a 44px menu target opens or closes the drawer.

### Tables

Tables are the canonical dense ledger. Headers are 40px high with 12px semibold Muted Ink labels; cells use 12px horizontal and vertical padding. Rows divide with one-pixel Ledger Lines and gain only a 50% muted wash on hover. IDs and technical values switch to mono, while numeric columns use tabular figures.

### Dispatch Bento

The twelve-column Overview bento is one shared bordered object with 1px internal divisions. The primary execution-distribution cell spans seven columns and two rows; heartbeat and capacity cells occupy the remaining five-column slots. At 860px it becomes a vertical sequence with 260px minimum cells.

### Execution Stack

Execution cards are sticky at 118px and separated by 28px. GSAP pins the story title, scrubs cards from 90px down / 94% scale / 45% opacity to rest, then recedes the previous card to 96% scale and 38% opacity as the next arrives. Below 860px or under reduced motion, the stack becomes ordinary document flow with no pinning or scrub animation.

## Do's and Don'ts

### Do:

- **Do** lead operational pages with real state, explicit labels, and directly actionable controls.
- **Do** use Warm Paper, Paper Card, thin Ledger Lines, and the fixed Deep Rail as the primary material vocabulary.
- **Do** preserve the distinction between `failed`, `unknown`, `retry_wait`, success, and neutral states in text, icon, and hue.
- **Do** use gapless bento divisions and shared ledger containers when facts belong to one operational story.
- **Do** keep expressive motion to the Overview narrative and provide the implemented reduced-motion and mobile linearization paths.
- **Do** retain 44px touch targets for icon controls in the mobile shell.

### Don't:

- **Don't** replace the dispatch ledger with a generic wall of disconnected metric cards.
- **Don't** use Signal Orange as broad decoration or as a substitute for semantic status colors.
- **Don't** infer success from a missing error; unknown results must remain visibly unknown.
- **Don't** add decorative shadows to routine cards, tables, fields, or navigation.
- **Don't** turn every border or status element into a pill; radius communicates hierarchy.
- **Don't** keep desktop pinning, accordion expansion, or split layouts when the viewport collapses below their implemented breakpoints.
