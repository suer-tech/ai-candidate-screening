import { DISCOVERY_INTERVAL_MS, STABILITY_INTERVAL_MS, type CandidateDiscoveryCoordinator, type CandidateFolder } from "./discovery.ts";
import type { GoogleMyDrivePipelineAdapter } from "./providers.ts";
import { filterDiscoverableCandidateFolders, type VacancyRecord } from "../../app/product-model.ts";

export type TimerApi = {
  setInterval(callback: () => void, milliseconds: number): unknown;
  clearInterval(handle: unknown): void;
};

export class DriveDiscoveryWorker {
  private readonly folders = new Map<string, CandidateFolder>();
  private stopped = false;
  private discoveryRunning = false;
  private stabilityRunning = false;

  constructor(private readonly adapter: Pick<GoogleMyDrivePipelineAdapter, "listCandidateFolders" | "listChildren">, private readonly coordinator: CandidateDiscoveryCoordinator, private readonly clock: () => Date = () => new Date(), private readonly durableRegistrar?: { register(folders: readonly CandidateFolder[], nowUtc: string): Promise<unknown>; listVacancies?(): Promise<VacancyRecord[]> }, private readonly observer?: { discovery?(result: unknown): Promise<void> | void; stability?(result: unknown): Promise<void> | void; error?(stage: "discovery" | "stability", error: unknown): Promise<void> | void }) {}

  async discoveryTick() {
    if (this.stopped) return [];
    const discoveredFolders = await this.adapter.listCandidateFolders();
    const folders = this.durableRegistrar?.listVacancies
      ? filterDiscoverableCandidateFolders(discoveredFolders, await this.durableRegistrar.listVacancies())
      : discoveredFolders;
    const nowUtc = this.clock().toISOString();
    if (this.durableRegistrar) await this.durableRegistrar.register(folders, nowUtc);
    const events = this.coordinator.discover(folders, nowUtc);
    for (const folder of folders) this.folders.set(folder.folderId, folder);
    return events;
  }

  async stabilityTick() {
    if (this.stopped) return [];
    const outcomes = [];
    for (const folder of this.folders.values()) {
      try { outcomes.push({ folderId: folder.folderId, outcome: this.coordinator.observe(folder.folderId, await this.adapter.listChildren(folder.folderId), this.clock().toISOString()) }); }
      catch (error) {
        if (error instanceof Error && error.message === "CANDIDATE_FOLDER_NOT_REGISTERED") throw error;
        outcomes.push({ folderId: folder.folderId, outcome: this.coordinator.observe(folder.folderId, null, this.clock().toISOString()) });
      }
    }
    return outcomes;
  }

  start(timers: TimerApi = { setInterval: (callback, milliseconds) => setInterval(callback, milliseconds), clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>) }) {
    this.stopped = false;
    const runDiscovery = async () => {
      if (this.stopped || this.discoveryRunning) return;
      this.discoveryRunning = true;
      try { await this.observer?.discovery?.(await this.discoveryTick()); }
      catch (error) { await this.observer?.error?.("discovery", error); }
      finally { this.discoveryRunning = false; }
    };
    const runStability = async () => {
      if (this.stopped || this.stabilityRunning) return;
      this.stabilityRunning = true;
      try { await this.observer?.stability?.(await this.stabilityTick()); }
      catch (error) { await this.observer?.error?.("stability", error); }
      finally { this.stabilityRunning = false; }
    };
    const discovery = timers.setInterval(() => { void runDiscovery(); }, DISCOVERY_INTERVAL_MS);
    const stability = timers.setInterval(() => { void runStability(); }, STABILITY_INTERVAL_MS);
    void runDiscovery().then(() => runStability());
    return () => { this.stopped = true; timers.clearInterval(discovery); timers.clearInterval(stability); };
  }
}
