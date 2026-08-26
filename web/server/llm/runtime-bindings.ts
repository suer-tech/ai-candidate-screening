import { serverContainer } from "../configuration/container.ts";
import { PostgresBlobStore } from "../storage/blob-store.ts";
import { PostgresProtectedTracePersistence } from "./postgres-persistence.ts";
import { AdminOnlyProtectedTraceStore } from "./protected-store.ts";
import { loadRuntimeConfiguration } from "./runtime-loader.ts";
import type { LogicalLlmCapability } from "./configuration.ts";

export async function protectedTraceStore() { const container = await serverContainer(); return new AdminOnlyProtectedTraceStore(new PostgresProtectedTracePersistence(new PostgresBlobStore(container.sql))); }
export async function llmRuntimeConfiguration(requiredCapabilities: readonly LogicalLlmCapability[]) { const container = await serverContainer(); return loadRuntimeConfiguration(container.environment, requiredCapabilities); }
