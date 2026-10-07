# Dependencies

The app uses Node 24, TypeScript, Fastify, React, Vite and SQLite. Bootstrap provides
established controls, Radix owns accessible tabs, Lucide supplies icons and packaged
Noto Sans KR provides local Korean fonts. Sharp processes bounded frame data;
FFmpeg performs media acquisition. YAML and Zod own configuration parsing/validation.

Model authentication uses jose and the shared authenticated-encryption file adapter.
Provider calls use fetch. Playwright and axe are development-only browser checks.

Display-only YouTube streaming uses @grpc/grpc-js, @grpc/proto-loader and the
vendored official stream contract. CHZZK runs the documented Socket.IO 2 client
in a worker; engine.io-client and socket.io-parser overrides retain the compatible
protocol with patched transport/parser dependencies. SOOP uses the official browser
SDK and has no unofficial library or send adapter.

Socket.IO 2 retains a legacy parseuri advisory; received session URLs are bounded,
validated HTTPS URLs under the platform domain. Do not replace the transport with
Socket.IO 4 without verifying platform support. package-lock.json records exact
versions; use npm audit for current advisory status.
