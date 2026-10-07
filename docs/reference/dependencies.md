# Dependency review

Recorded `npm audit --json` review from 2026-10-02. The counts below describe that
review, not a fresh audit of today's lockfile or registry. [package.json](../../package.json)
and [the lockfile](../../package-lock.json) own installed dependency versions.

The initial install exposed vulnerabilities in older static-file and image dependencies and the required legacy Socket.IO tree. Direct dependencies were updated to `@fastify/static@10.1.5` and `sharp@0.35.5`. Socket.IO client remains **2.0.3** to match the documented CHZZK range. npm overrides pin its compatible Engine.IO client to **3.5.6** and Socket.IO parser to **3.3.6**. A local Engine.IO/Socket.IO fixture verifies connection, SYSTEM/CHAT reception and absence of outbound CHAT events.

Recorded audit result: **0 critical, 0 high, 3 moderate**, comprising `parseuri` and the two packages depending on it (`engine.io-client`, `socket.io-client`). The available audit fix replaces Socket.IO with 4.x, outside CHZZK's documented range, so it was not applied. These are not claimed resolved.

Mitigations: CHZZK is disabled by default; session URLs come only from the authenticated official API; URLs are limited to 4096 characters, HTTPS and `.nchat.naver.com` hosts; the legacy client runs in a separate process with a restricted environment. Reconnection creates a fresh session. These measures reduce exposure but do not prove the dependency safe. Account approval, current official compatibility and dependency review remain release prerequisites for live use.

The unofficial SOOP dependency is separately opt-in and integrity-pinned. Its installed API was inspected; exact source commit equivalence and platform approval remain unverified. It is never substituted for the official path.

No FFmpeg executable is redistributed. Browser-test Chromium is a development download, not an application runtime dependency. Node's built-in SQLite removes a third-party SQLite compilation step; clean Windows installation still needs validation.

## Browser UI

Bootstrap supplies packaged CSS for standard buttons, forms and navigation.
Radix Tabs supplies keyboard navigation and tab semantics; persistent tab panels
retain connection/form ownership. Lucide React supplies the shared icon set.
Confirmation dialogs use the native `dialog` element to preserve the existing CSP
without runtime stylesheet injection. All UI assets are bundled locally; there is
no CDN dependency. `@axe-core/playwright` is a development-only browser audit tool.
