---
name: Mixed Chat Studio
description: A familiar broadcast workspace with clear status and immediate operator control.
colors:
  accent: "#175cd3"
  accent-soft: "#eaf1ff"
  accent-hover: "#124baa"
  link-hover: "#10469f"
  canvas: "#f4f6f9"
  surface: "#ffffff"
  surface-subtle: "#f0f3f7"
  ink: "#202a39"
  muted: "#596579"
  line: "#dce2ea"
  success: "#176044"
  success-soft: "#e9f6ef"
  warning: "#805400"
  warning-soft: "#fff6df"
  danger: "#ad2735"
  danger-soft: "#fff0f1"
  overlay-surface: "#162133ed"
  overlay-ink: "#f7f9fc"
  overlay-muted: "#c6cfdb"
typography:
  headline:
    fontFamily: '"Noto Sans KR Variable", system-ui, -apple-system, "Segoe UI", sans-serif'
    fontSize: "24px"
    fontWeight: 650
    lineHeight: 1.4
  test-headline:
    fontFamily: '"Noto Sans KR Variable", system-ui, -apple-system, "Segoe UI", sans-serif'
    fontSize: "28px"
    fontWeight: 650
    lineHeight: 1.4
  title:
    fontFamily: '"Noto Sans KR Variable", system-ui, -apple-system, "Segoe UI", sans-serif'
    fontSize: "17px"
    fontWeight: 650
    lineHeight: 1.4
  subtitle:
    fontFamily: '"Noto Sans KR Variable", system-ui, -apple-system, "Segoe UI", sans-serif'
    fontSize: "15px"
    fontWeight: 650
    lineHeight: 1.4
  body:
    fontFamily: '"Noto Sans KR Variable", system-ui, -apple-system, "Segoe UI", sans-serif'
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: '"Noto Sans KR Variable", system-ui, -apple-system, "Segoe UI", sans-serif'
    fontSize: "14px"
    fontWeight: 550
    lineHeight: 1.6
  caption:
    fontFamily: '"Noto Sans KR Variable", system-ui, -apple-system, "Segoe UI", sans-serif'
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.6
  badge:
    fontFamily: '"Noto Sans KR Variable", system-ui, -apple-system, "Segoe UI", sans-serif'
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.6
  reader-message:
    fontFamily: '"Noto Sans KR Variable", system-ui, -apple-system, "Segoe UI", sans-serif'
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.7
  overlay-message:
    fontFamily: '"Noto Sans KR Variable", system-ui, -apple-system, "Segoe UI", sans-serif'
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.55
rounded:
  badge: "5px"
  control: "6px"
  surface: "8px"
  dialog: "12px"
spacing:
  "4": "4px"
  "6": "6px"
  "8": "8px"
  "12": "12px"
  "16": "16px"
  "20": "20px"
  "24": "24px"
  "28": "28px"
  "32": "32px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.surface}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "6px 12px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "6px 12px"
  button-danger:
    textColor: "{colors.danger}"
    rounded: "{rounded.control}"
    padding: "6px 12px"
  field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "6px 12px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.surface}"
    padding: "20px"
  status-success:
    backgroundColor: "{colors.success-soft}"
    textColor: "{colors.success}"
    typography: "{typography.badge}"
    rounded: "{rounded.badge}"
    padding: "3px 8px"
  navigation-active:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent}"
    rounded: "{rounded.control}"
    padding: "10px 14px"
  overlay-message:
    backgroundColor: "{colors.overlay-surface}"
    textColor: "{colors.overlay-ink}"
    typography: "{typography.overlay-message}"
    rounded: "{rounded.surface}"
    padding: "12px 14px"
---

# Design System: Mixed Chat Studio

## Overview

**Creative North Star: "The Broadcast Desk"**

The broadcast desk is a compact, familiar operating environment. White work surfaces sit on a cool slate canvas; blue identifies actions and selection, while concise labels and restrained status colors keep attention on the conversation and immediate controls.

The system uses packaged Bootstrap CSS, Radix Tabs, Lucide icons and locally packaged Noto Sans KR. Native modal dialogs provide confirmation behavior compatible with the application CSP. The reader shares the light workspace language; the OBS overlay uses translucent dark message surfaces over a transparent page.

**Key Characteristics:**

- Task-oriented navigation with compact desktop density.
- Korean-readable typography and explicit action labels.
- Flat bordered surfaces with restrained semantic color.
- Persistent mobile navigation and emergency AI stop.

The implemented sources are [global styles](apps/web/src/style.css),
[workspace styles](apps/web/src/features/workspace/workspace.css),
[conversation styles](apps/web/src/features/conversation/conversation.css),
[test shell](apps/experiments/web/shell.css),
[test conversation styles](apps/experiments/web/features/experiments.css) and
[shared controls](apps/web/src/components/ui.tsx). Product intent lives in
[PRODUCT.md](PRODUCT.md); behavior remains owned by the
[dashboard specification](docs/specifications/dashboard.md).

## Colors

The palette combines clear action blue with cool neutral surfaces and muted semantic tints. Frontmatter values are normative; names below describe their use.

### Primary

- **Action Blue** (`accent`): primary buttons, links, selected navigation, focus outlines and input carets. `accent-hover` belongs to primary button hover; `link-hover` belongs to link hover.
- **Selection Blue** (`accent-soft`): active task navigation, tab hover, participant guidance and reader identity accents.

### Neutral

- **Cool Canvas** (`canvas`): workspace and reader page background.
- **White Work Surface** (`surface`): cards, fields, navigation and dialogs.
- **Slate Inset** (`surface-subtle`): neutral badges, empty states and explanatory blocks.
- **Slate Ink** (`ink`), **Supporting Slate** (`muted`) and **Divider Slate** (`line`): primary text, secondary text and structural separation.
- **Overlay Slate** (`overlay-surface`): translucent message and guidance containers; `overlay-ink` and `overlay-muted` preserve contrast over broadcast imagery.

### Semantic states

Success green, warning amber and danger red each pair text with a pale background. Reserve danger for failures and destructive or stop actions, warning for readiness problems, and success for positive state. These are status roles, not additional brand accents.

**The State Has Words Rule.** Every operating state carries a readable label; semantic color reinforces it.

Bootstrap links require both the color and RGB custom properties to remain aligned. A custom primary color alone does not replace every Bootstrap component state; shared component overrides remain part of the implementation.

## Typography

**Body and heading font:** Noto Sans KR Variable, with system fallbacks as recorded in the frontmatter. There is no separate decorative display face. Lucide supplies interface icons; icons accompany visible labels unless an accessible name is provided.

The hierarchy is compact: headline for page titles, title for sections, subtitle for subsections, body for controls and operational text, caption for supporting information, and badge for concise state labels. Headline tracking is slightly tightened (`-0.025em`); mobile workspace headings use `22px`. Headings use the variable font's intermediate weight rather than simulated bold.

Reader and overlay messages use their own body roles for comfortable scanning. Preserve message line breaks, wrap unbroken content and use tabular numerals for timestamps. Explanatory participation text has a maximum measure of approximately `70–75ch` where implemented.

## Layout

Desktop uses a sticky full-height task sidebar (`208px`) beside a fluid main area capped at `1680px`. Main padding is `28px 32px 16px`. Live conversation takes the flexible column; contextual tools occupy a `290–340px` column, expanding to `390px` at `1600px` and above. Main gaps use the documented spacing scale.

At `1150px` and below, the sidebar narrows to `178px`, main padding becomes `24px` and connection cards stack. At `900px` and below, live conversation stacks above context. At `767px` and below, the sidebar becomes a sticky top header with four task destinations, each with an icon above its label, emergency AI stop and sign-out; the main area uses `20px 16px` padding and the context panels stack. Buttons and primary form targets reach a `44px` minimum height. Narrow participation grids collapse at `680px`; reader spacing adapts at `520px`.

The reader is centered at a maximum `820px`; its bottom toolbar stays reachable. The overlay fills the viewport, keeps the page transparent and aligns bounded message rows toward the bottom. It clips overflow for OBS output. Long labels wrap rather than expanding the workspace horizontally.

The independent test workspace shares controls and tokens but has its own shell,
with a `1600px` maximum width and `clamp(16px, 3vw, 40px)` padding. Its heading uses
`test-headline`. The conversation/persona columns stack at `1000px`; the header and
account actions stack at `600px`. It has no live sidebar or broadcast controls.
See [test server ownership](docs/development/experiments.md#independent-server).

## Elevation & Depth

Depth comes from a cool page background, white surfaces, pale inset blocks and thin borders. Ordinary cards have no decorative shadow. Confirmation dialogs use `0 20px 60px #10182833` over a dimmed `#18233499` backdrop. The sticky mobile navigation and reader toolbar maintain access without adding ornamental elevation.

**The Flat Workspace Rule.** Routine surfaces use borders and tonal separation; the modal confirmation owns the large shadow.

## Shapes

Controls use gently rounded corners, cards use the surface radius and dialogs use the larger dialog radius. Badges remain compact rounded rectangles rather than pills. Conversation avatars are circles; the AI switch track is a small capsule. Borders are generally one pixel. Checkboxes are visibly sized (`18px` square), with a larger mobile label target.

## Components

### Buttons

Primary actions are solid blue; secondary actions are white with a slate outline; stop and destructive actions use a red outline that fills on hover. Shared buttons use a minimum height of `40px`, increasing to `44px` on mobile, with an inline icon gap of `7px`. Disabled states retain Bootstrap's opacity treatment and a not-allowed cursor. Use explicit action labels and pending labels where available.

### Inputs / Fields

Bootstrap form controls and selects use white surfaces, slate outlines and a minimum height of `42px`, increasing to `44px` on mobile. Labels sit above fields with a small gap. Checkboxes use the shared checkbox treatment. Keyboard focus uses a blue outline (`3px`) offset by `3px`; preserve Bootstrap field focus behavior alongside this visible keyboard cue.

### Navigation

The two live task destinations are Live and Broadcast preparation, rendered in Korean. Active navigation uses a pale blue surface and stronger blue text. Shared Radix section tabs use automatic keyboard activation and a blue underline for selection; `SectionTabs` keeps its panels mounted to preserve component lifetimes. The test workspace uses separate conversation, AI-state and call-detail tabs; its microphone controls stay mounted outside these tabs. Tab-driven navigation retains tab focus. Readiness deep links open the relevant setup area and move focus to it. Routine status updates do not move focus.

### Status badges and alerts

Badges carry short text on neutral or semantic tinted backgrounds, with compact padding. Errors use a danger-tinted block with wrapped text. Empty states use supporting text and a quiet inset surface; they explain the current limitation or next action without fabricated sample content.

### Cards / Containers

White cards use the surface radius, a thin divider border and `20px` internal padding, reduced to `16px` on mobile. Participation sections use `24px` desktop padding. Joined context tabs and panels share their adjoining border and corner treatment. Conversation rows use dividers rather than a separate card around every operator message.

### Confirmation dialogs

Use the shared native modal dialog with a maximum width of `480px`, bounded viewport height and scrollable content. The cancel action receives initial focus. The browser supplies modal focus containment, Escape dismissal and focus restoration; the dialog exposes its title and description to assistive technology. Keep the native implementation compatible with the current CSP.

### Conversation surfaces

Reader rows pair a circular initial avatar with author, timestamp and text; origin labels appear when the product contract allows them. The overlay adapts this structure to translucent dark rows with larger message type. Maintain readable disclosure and guidance without turning the transparent page into a full-screen opaque panel.

The test conversation separates input/transcription and AI chat into independently
scrollable histories, side by side on desktop and stacked on narrow screens. Incoming
entries, sends, polling and tab changes preserve each scroll position; no automatic
following is allowed. Each recent-entry button moves only its own log once. Updates
must not move the page, steal focus or interrupt microphone recording. Ended sessions
show the resume action without an additional-call-limit field.

Bootstrap supplies short control transitions. Reduced-motion preferences remove transitions from buttons, form controls, selects and tab links. Do not add motion to routine status updates.

## Do's and Don'ts

### Do:

- **Do** reuse the shared Bootstrap-backed controls, Radix Tabs and Lucide icons.
- **Do** pair status color with explicit text and preserve visible keyboard focus.
- **Do** keep emergency AI stop reachable in the mobile sticky header.
- **Do** retain Korean UI labels, local font assets and the transparent OBS page.
- **Do** preserve mounted tab content and distinguish tab activation from setup deep links when moving focus.

### Don't:

- **Don't** turn routine cards into elevated promotional surfaces.
- **Don't** use color or an icon alone to explain an operating state.
- **Don't** move focus during routine status refreshes.
- **Don't** apply the light canvas background to the OBS overlay.
- **Don't** treat generated palette ramps in the sidecar as implemented CSS tokens.
