import { resolve, relative, isAbsolute } from "path";

export function isInsideWorkspace(filePath: string, workspace: string): boolean {
  const resolved = resolve(filePath);
  const resolvedWorkspace = resolve(workspace);
  const rel = relative(resolvedWorkspace, resolved);
  return !rel.startsWith("..") && !isAbsolute(rel);
}
