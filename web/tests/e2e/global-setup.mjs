import { runPreflight } from "./preflight.mjs";

export default async function globalSetup() {
  await runPreflight();
}
