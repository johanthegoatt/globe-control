import { config } from "./config.js";
import { createApp } from "./app.js";

export const app = createApp();

app.listen(config.port, () => {
  console.log(`globe-control backend running on http://127.0.0.1:${config.port}`);
  console.log(`allowed origins: ${config.corsOrigins.join(", ")}`);
  console.log(`policy version: ${config.policyVersion}`);
});
