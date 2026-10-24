/**
 * In-memory DataAdapter used by store/index tests. `list()` mimics the
 * Obsidian adapter: one directory level, vault-relative full paths.
 */
export class MemoryAdapter {
  files = new Map<string, string>();
  directories = new Set<string>();

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.directories.has(path);
  }

  async mkdir(path: string): Promise<void> {
    this.directories.add(path);
  }

  async list(path: string): Promise<{ files: string[]; folders: string[] }> {
    const prefix = path.endsWith("/") ? path : `${path}/`;
    const files: string[] = [];
    const folders = new Set<string>();
    for (const key of this.files.keys()) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      const slash = rest.indexOf("/");
      if (slash < 0) files.push(key);
      else folders.add(prefix + rest.slice(0, slash));
    }
    for (const dir of this.directories) {
      if (!dir.startsWith(prefix)) continue;
      const rest = dir.slice(prefix.length);
      if (!rest) continue;
      const slash = rest.indexOf("/");
      folders.add(prefix + (slash < 0 ? rest : rest.slice(0, slash)));
    }
    return { files, folders: [...folders] };
  }

  async read(path: string): Promise<string> {
    const value = this.files.get(path);
    if (value === undefined) throw new Error("Missing file");
    return value;
  }

  async write(path: string, value: string): Promise<void> {
    this.files.set(path, value);
  }

  async remove(path: string): Promise<void> {
    this.files.delete(path);
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    const value = await this.read(oldPath);
    this.files.set(newPath, value);
    this.files.delete(oldPath);
  }

  async rmdir(path: string, _recursive: boolean): Promise<void> {
    for (const key of this.files.keys()) {
      if (key.startsWith(`${path}/`)) {
        throw new Error("Directory not empty");
      }
    }
    this.directories.delete(path);
  }
}
