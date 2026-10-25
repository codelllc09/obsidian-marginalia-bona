import type MarginaliaPlugin from "../main";
import type { AnnotationStore } from "../storage/annotation-store";

const POLL_MS = 4000;

/** Poll the annotations directory for changes made outside Obsidian
 *  (agents, git, sync) and ingest them incrementally. Design notes:
 *
 *  - one `adapter.list` per tick on a small folder, then reads only for
 *    files whose mtime changed; everything is async, nothing blocks the
 *    UI thread;
 *  - a re-entrancy guard collapses overlapping ticks;
 *  - our own writes also bump mtimes, but ingesting identical content is
 *    a no-op in the store, so they cost one cheap read each. */
export function registerExternalIngest(
  plugin: MarginaliaPlugin,
  store: AnnotationStore,
  directory: string
): void {
  const seen = new Map<string, number>();
  let ticking = false;

  const collect = async (
    dir: string,
    files: Map<string, number>
  ): Promise<void> => {
    const listing = await plugin.app.vault.adapter.list(dir);
    for (const path of listing.files) {
      if (!path.endsWith(".md")) continue;
      // adapter.list carries no mtimes (string[] only): stat each file.
      const stat = await plugin.app.vault.adapter.stat(path);
      if (!stat) continue; // deleted between list and stat
      files.set(path, stat.mtime);
    }
    for (const folder of listing.folders) await collect(folder, files);
  };

  const tick = async (): Promise<void> => {
    if (ticking) return;
    ticking = true;
    try {
      const files = new Map<string, number>();
      await collect(directory, files);
      let touched = false;
      for (const [path, mtime] of files) {
        if (seen.get(path) === mtime) continue;
        seen.set(path, mtime);
        const content = await plugin.app.vault.adapter.read(path);
        const result = await store.ingestExternal(path, content);
        if (result === "added" || result === "changed") touched = true;
      }
      for (const path of [...seen.keys()]) {
        if (files.has(path)) continue;
        seen.delete(path);
        if (await store.forgetExternal(path)) touched = true;
      }
      if (touched) plugin.refresh();
    } catch (error) {
      console.warn("Marginalia external ingest failed", error);
    } finally {
      ticking = false;
    }
  };

  plugin.registerInterval(window.setInterval(() => void tick(), POLL_MS));
  void tick();
}
