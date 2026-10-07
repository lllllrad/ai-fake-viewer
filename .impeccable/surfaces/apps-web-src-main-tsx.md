---
version: 1
slug: "apps-web-src-main-tsx"
primary_target: "apps/web/src/main.tsx"
related_targets: ["apps/web/src/features/conversation/ConversationPage.tsx"]
---

# Operator workspace and conversation surfaces

Mode: Operate. Scope: administrator workspace, reader and OBS overlay.

The broadcaster prepares connections, monitors permitted conversation, controls AI,
manages participation and follows up on records. Preserve data/API contracts,
authentication, notice delivery, component lifetimes and cancellation guards.

## Direction contract

THESIS: A task-first broadcast workspace. Replace the long status/settings stack
with live conversation beside context and separate preparation and follow-up work.

OWN-WORLD: Category-standard Bootstrap controls, neutral white/slate surfaces,
blue action/selection color, semantic state colors, Noto Sans KR, Radix tab
keyboard behavior and native confirmation dialogs. Compact desktop density and full-width mobile work areas.

STORY: Prepare sources and model; open reader/OBS; monitor conversation and AI;
resolve participation issues; close the session and handle external follow-ups.

FIRST VIEWPORT: Left task navigation; page title and broadcast state; compact AI
control bar with stop and end actions; concise source status; conversation occupies
the main column and preview/context the secondary column. On mobile, navigation
and stop stay reachable, then one work column. Signature interaction: a blocked
readiness item opens its exact setup panel, with focus at the relevant control area.

FORM: Category standard explicitly selected by the user, overriding assigned index
3 from seed 47753c25. Code-led; no comp or aesthetic selection round. Conventional
broadcast workspaces and Bootstrap defaults are the craft benchmark.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
