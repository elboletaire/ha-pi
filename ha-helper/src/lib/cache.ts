import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

interface CacheEntry {
  value: unknown;
  expires_at: number;
  updated_at: string;
}

interface CacheFile {
  entries: Record<string, CacheEntry>;
}

export class FileCache {
  private readonly path: string;
  private loaded = false;
  private file: CacheFile = { entries: {} };

  constructor(path: string) {
    this.path = path;
  }

  public async get<T>(key: string): Promise<T | null> {
    await this.ensureLoaded();

    const entry = this.file.entries[key];
    if (!entry) {
      return null;
    }

    if (Date.now() > entry.expires_at) {
      delete this.file.entries[key];
      await this.persist();
      return null;
    }

    return entry.value as T;
  }

  public async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    await this.ensureLoaded();

    this.file.entries[key] = {
      value,
      expires_at: Date.now() + ttlMs,
      updated_at: new Date().toISOString(),
    };

    await this.persist();
  }

  public async delete(key: string): Promise<void> {
    await this.ensureLoaded();

    if (this.file.entries[key]) {
      delete this.file.entries[key];
      await this.persist();
    }
  }

  public async clear(prefix?: string): Promise<number> {
    await this.ensureLoaded();

    const keys = Object.keys(this.file.entries);
    const toDelete = prefix
      ? keys.filter((key) => key.startsWith(prefix))
      : keys;

    toDelete.forEach((key) => {
      delete this.file.entries[key];
    });

    if (toDelete.length > 0) {
      await this.persist();
    }

    return toDelete.length;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) {
      return;
    }

    this.loaded = true;

    try {
      const raw = await readFile(this.path, "utf8");
      const parsed = JSON.parse(raw) as CacheFile;
      if (parsed && typeof parsed === "object" && parsed.entries && typeof parsed.entries === "object") {
        this.file = parsed;
      }
    } catch {
      this.file = { entries: {} };
    }
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, JSON.stringify(this.file, null, 2), "utf8");
  }
}
