# Dependencies

The app uses Node 24, TypeScript, Fastify, React, Vite and SQLite. Bootstrap provides
established controls, Radix owns accessible tabs, Lucide supplies icons and packaged
Noto Sans KR provides local Korean fonts. Sharp processes bounded frame data;
FFmpeg performs media acquisition. YAML and Zod own configuration parsing/validation.

Model authentication uses jose and the shared authenticated-encryption file adapter.
Provider calls use fetch. Playwright and axe are development-only browser checks.

Platform-specific gRPC, Socket.IO 2, SOOP libraries, workers and vendored platform
contracts are removed. No legacy dependency overrides remain. package-lock.json is
the reproducible dependency record. Installation/audit status is temporal; use a
current npm audit when evaluating dependency advisories, rather than an old report.
