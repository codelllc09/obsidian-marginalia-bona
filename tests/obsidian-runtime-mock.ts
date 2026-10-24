export function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replaceAll(/\/+/g, "/");
}

export class TFile {
  path = "";
  extension = "";
  stat = { mtime: 0 };
}
