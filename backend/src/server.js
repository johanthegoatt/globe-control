import { checkStartupConfig, config } from "./config.js";
import { createApp } from "./app.js";

const problems = checkStartupConfig();
if (problems.length) {
  for (const problem of problems) console.error(problem);
  process.exit(1);
}

export const app = createApp();

app.listen(config.port, () => {
  console.log(`globe-control backend running on http://127.0.0.1:${config.port}`);
  console.log(`allowed origins: ${config.corsOrigins.join(", ")}`);
  console.log(`policy version: ${config.policyVersion}`);
});
