import { setupExperiments } from "./settings.ts";
try {
  setupExperiments();
  console.log(
    "Test environment ready. Credentials: .local/experiments/.env; settings: .local/experiments/config.json. Existing files were preserved.",
  );
} catch {
  console.error(
    "Test setup failed. Check local configuration and file access; no credentials are printed.",
  );
  process.exitCode = 1;
}
