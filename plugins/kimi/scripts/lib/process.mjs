import { spawn, spawnSync } from "node:child_process";

export function runCommand(command, args, { cwd, timeoutMs = 30000, maxBuffer = 1024 * 1024 } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer,
    shell: process.platform === "win32",
  });
  return {
    status: result.status ?? (result.error ? 1 : 0),
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error ?? null,
  };
}

export function binaryAvailable(command, args = ["--version"]) {
  try {
    const result = runCommand(command, args, { timeoutMs: 10000 });
    const detail = (result.stdout || result.stderr).trim().split("\n")[0] ?? "";
    return { available: result.status === 0, detail };
  } catch (error) {
    return { available: false, detail: String(error?.message ?? error) };
  }
}

export function terminateProcessTree(pid) {
  if (!pid || pid <= 0) {
    return false;
  }
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
      return true;
    }
    // Children are spawned in their own process group; signal the group first.
    try {
      process.kill(-pid, "SIGTERM");
      return true;
    } catch {
      process.kill(pid, "SIGTERM");
      return true;
    }
  } catch {
    return false;
  }
}

export function spawnDetached(command, args, { cwd } = {}) {
  const child = spawn(command, args, {
    cwd,
    detached: true,
    stdio: "ignore",
    shell: false,
  });
  child.unref();
  return child.pid;
}

export function formatCommandFailure(command, args, result) {
  const lines = [`Command failed: ${command} ${args.join(" ")}`];
  if (result.stderr?.trim()) {
    lines.push(result.stderr.trim());
  }
  if (result.error) {
    lines.push(String(result.error.message ?? result.error));
  }
  return lines.join("\n");
}
