import { startAiServiceFixture } from "./ai-service-fixture.ts";
const service = await startAiServiceFixture();
process.env.AI_SERVICE_URL = service.url;
process.env.AI_SERVICE_TOKEN = service.token;
