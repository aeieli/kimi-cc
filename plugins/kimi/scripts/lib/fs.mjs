import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function readStdinIfPiped() {
  if (process.stdin.isTTY) {
    return "";
  }
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

export function isProbablyText(filePath) {
  try {
    const fd = fs.openSync(filePath, "r");
    const buffer = Buffer.alloc(4096);
    const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
    fs.closeSync(fd);
    return !buffer.subarray(0, bytesRead).includes(0);
  } catch {
    return false;
  }
}

export function ensureAbsolutePath(inputPath, cwd = process.cwd()) {
  const expanded = expandHome(inputPath);
  return path.isAbsolute(expanded) ? expanded : path.resolve(cwd, expanded);
}

export function expandHome(inputPath) {
  if (inputPath === "~") {
    return os.homedir();
  }
  if (inputPath.startsWith(`~${path.sep}`) || inputPath.startsWith("~/")) {
    return path.join(os.homedir(), inputPath.slice(2));
  }
  return inputPath;
}
