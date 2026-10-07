---
version: 1
slug: "apps-web-src-main-tsx"
primary_target: "apps/web/src/main.tsx"
related_targets:
  [
    "apps/web/src/features/conversation/ConversationPage.tsx",
    "apps/web/src/features/workspace/workspace.css",
  ]
---

# Operator workspace and conversation surfaces

Mode: Operate. Scope: live administrator workspace, reader and OBS overlay.

## Direction contract

THESIS: Put broadcast conversation and immediate AI control first; keep media, model and output setup in Broadcast preparation.

OWN-WORLD: Category-standard Bootstrap controls, white/slate surfaces, blue actions,
semantic state labels, Noto Sans KR, Radix keyboard behavior and native confirmations.
Compact desktop density becomes a single work column on mobile.

STORY: Prepare sources and model; open reader/OBS links; monitor AI reactions to dedicated media; stop generation or end the broadcast.

FIRST VIEWPORT: Two task destinations: Live and Broadcast preparation. The live page has a conversation column, context/preview column,
source readiness and a persistent AI control bar. On mobile the navigation and stop
control remain reachable. Readiness links open and focus the relevant setup panel;
routine polling never moves focus. Unfinished forms survive live navigation.

FORM: Category-standard and code-led, using the implemented shared design system.
Use explicit localized actions and confirmation for destructive session/data actions
and irreversible AI-origin disclosure. Preserve current names when disclosing origins.

BOUNDARY: Interactive AI viewer tests run in a separate app on port 3211, outside live navigation. Reader/overlay use separate reader authorization; the
transparent OBS overlay combines AI conversation and display-only platform chat.
The producer excludes this overlay from the dedicated AI media feed.

Ownership: [dashboard contract](../../docs/specifications/dashboard.md),
[visual system](../../DESIGN.md) and [product context](../../PRODUCT.md).
