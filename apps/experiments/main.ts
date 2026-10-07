import { createExperimentApp } from "./app.ts";
import { experimentDirectory, loadExperimentEnvironment } from "./settings.ts";
try {
  const { settings, adminToken, encryptionKey } = loadExperimentEnvironment();
  const { app } = await createExperimentApp(settings, {
    directory: experimentDirectory,
    adminToken,
    encryptionKey,
  });
  try {
    await app.listen({ host: "127.0.0.1", port: settings.port });
  } catch (error) {
    await app.close();
    throw error;
  }
  console.log(
    `AI viewer tests: http://127.0.0.1:${settings.port}/admin\nUse EXPERIMENT_ADMIN_TOKEN from .local/experiments/.env.`,
  );
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    try {
      await app.close();
      process.exitCode = 0;
    } catch {
      process.exitCode = 1;
    }
  };
  process.on("SIGINT", () => void stop());
  process.on("SIGTERM", () => void stop());
} catch {
  console.error(
    "Test server startup failed. Run npm run experiments:setup, build, then check .local/experiments settings and port availability.",
  );
  process.exitCode = 1;
}
