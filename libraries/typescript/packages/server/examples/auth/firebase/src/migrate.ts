import { createFirebaseAuth } from "./auth/index.js";
import { openConfiguration } from "./config.js";

const config = await openConfiguration();
try {
  const integration = await createFirebaseAuth(config.auth);
  await (await integration.getMigrations()).runMigrations();
  console.log("Firebase authentication schema is ready.");
} finally {
  await config.close();
}
