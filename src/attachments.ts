import { normalizePath } from "obsidian";

/** Unique attachment path inside the attachments folder:
 *  pasted-<timestamp>.<ext>, suffixed -2/-3/… on collision. */
export function attachmentPath(
  folder: string,
  ext: string,
  now: Date,
  exists: (path: string) => boolean
): string {
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const safeExt = (ext || "png").toLowerCase();
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
