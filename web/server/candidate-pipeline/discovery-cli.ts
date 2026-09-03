import { startProductionDriveDiscoveryWorker } from "./production-discovery.ts";

const discovery = await startProductionDriveDiscoveryWorker();
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => discovery.stop());
await new Promise<void>(() => undefined);
