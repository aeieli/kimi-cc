import path from "node:path";
import { runCommand } from "./process.mjs";

// The workspace root anchors per-repo state. Prefer the git toplevel so jobs
// started from subdirectories share one state directory.
export function resolveWorkspaceRoot(cwd = process.cwd()) {
  const result = runCommand("git", ["rev-parse", "--show-toplevel"], { cwd });
  if (result.status === 0 && result.stdout.trim()) {
    return path.resolve(result.stdout.trim());
  }
  return path.resolve(cwd);
}
