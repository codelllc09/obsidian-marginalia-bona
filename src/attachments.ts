import { normalizePath } from "obsidian";

/**
 * Resolve the attachments folder. Priority: explicit plugin override, then
 * Obsidian's own convention (Settings → Files & links):
 *   "/"            → vault root
 *   "folder/…"     → that folder in the vault
 *   "./…"          → a subfolder next to the annotated note (sourceDir)
 * Empty string means vault root.
 */
export function attachmentsFolderFor(
  override: string,
  convention: string,
  sourceDir: string
): string {
  const trimmed = override.trim();
  if (trimmed) return normalizePath(trimmed);
  const config = convention || "/";
  if (config === "/") return "";
  if (config.startsWith("./")) {
    const sub = config.slice(2);
    return normalizePath(sourceDir ? `${sourceDir}/${sub}` : sub);
  }
  return normalizePath(config);
}

/** Unique attachment path inside the attachments folder:
 *  pasted-<timestamp>.<ext>, suffixed -2/-3/… on collision. */
export function attachmentPath(
  folder: string,
  ext: string,
  now: Date,
  exists: (path: string) => boolean
): string {
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  // Extensions come from paste/upload events; strip anything that could
  // escape the folder (slashes, dots, separators) before joining.
  const cleaned = (ext || "png").toLowerCase().replace(/[^a-z0-9]/g, "");
  const safeExt = cleaned || "png";
  let candidate = normalizePath(`${folder}/pasted-${stamp}.${safeExt}`);
  let attempt = 2;
  while (exists(candidate)) {
    candidate = normalizePath(
      `${folder}/pasted-${stamp}-${attempt}.${safeExt}`
    );
    attempt += 1;
  }
  return candidate;
}
