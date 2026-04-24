import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface CapabilitySnapshot {
  instance_id: string;
  ha_version?: string;
  fetched_at: string;
  capabilities: Record<string, unknown>;
}

interface CapabilitySnapshotFile {
  snapshots: Record<string, CapabilitySnapshot>;
}

export class CapabilitySnapshotStore {
  private readonly path: string;
  private readonly instanceId: string;
  private loaded = false;
  private file: CapabilitySnapshotFile = { snapshots: {} };

  constructor(path: string, instanceSeed: string) {
    this.path = path;
    this.instanceId = hashInstanceSeed(instanceSeed);
  }

  public getInstanceId(): string {
    return this.instanceId;
  }

  public async get(): Promise<CapabilitySnapshot | null> {
    await this.ensureLoaded();
    return this.file.snapshots[this.instanceId] ?? null;
  }

  public async set(snapshot: Omit<CapabilitySnapshot, "instance_id" | "fetched_at">): Promise<void> {
    await this.ensureLoaded();

    this.file.snapshots[this.instanceId] = {
      instance_id: this.instanceId,
      fetched_at: new Date().toISOString(),
      ...snapshot,
    };

    await this.persist();
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) {
      return;
    }

    this.loaded = true;

    try {
      const raw = await readFile(this.path, "utf8");
      const parsed = JSON.parse(raw) as CapabilitySnapshotFile;
      if (
        parsed &&
        typeof parsed === "object" &&
        parsed.snapshots &&
        typeof parsed.snapshots === "object"
      ) {
        this.file = parsed;
      }
    } catch {
      this.file = { snapshots: {} };
    }
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, JSON.stringify(this.file, null, 2), "utf8");
  }
}

const hashInstanceSeed = (seed: string): string =>
  createHash("sha256").update(seed).digest("hex").slice(0, 16);
