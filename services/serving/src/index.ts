import "dotenv/config";
import { createApp } from "./app.js";
import { config } from "./config.js";

createApp().listen(config.port, () => {
  console.log(`serving listening on :${config.port}`);
});
