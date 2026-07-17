import assert from "node:assert/strict";
import test from "node:test";
import { normalizeArgv, parseArgs, splitRawArgumentString } from "../plugins/kimi/scripts/lib/args.mjs";

test("parseArgs handles value options, flags, aliases, and positionals", () => {
  const parsed = parseArgs(["--base", "main", "--wait", "-C", "/tmp/repo", "focus", "text"], {
    valueOptions: ["base", "cwd"],
    booleanOptions: ["wait"],
    aliasMap: { C: "cwd" },
  });
  assert.equal(parsed.base, "main");
  assert.equal(parsed.wait, true);
  assert.equal(parsed.cwd, "/tmp/repo");
  assert.deepEqual(parsed.positionals, ["focus", "text"]);
});

test("parseArgs supports --key=value and --flag=false", () => {
  const parsed = parseArgs(["--model=kimi-code/k3", "--json=false"], {
    valueOptions: ["model"],
    booleanOptions: ["json"],
  });
  assert.equal(parsed.model, "kimi-code/k3");
  assert.equal(parsed.json, false);
});

test("parseArgs keeps unknown dash args as positionals", () => {
  const parsed = parseArgs(["look", "at", "--weird-thing"], {
    valueOptions: [],
    booleanOptions: [],
  });
  assert.deepEqual(parsed.positionals, ["look", "at", "--weird-thing"]);
});

test("splitRawArgumentString honors quotes and escapes", () => {
  assert.deepEqual(splitRawArgumentString(`--base main "two words" it's`), [
    "--base",
    "main",
    "two words",
    "it's",
  ]);
  assert.deepEqual(splitRawArgumentString("'a b' c"), ["a b", "c"]);
  assert.deepEqual(splitRawArgumentString(String.raw`it\'s "x"`), ["it's", "x"]);
});

test("normalizeArgv expands a single raw string", () => {
  assert.deepEqual(normalizeArgv(['--base main "focus text"']), ["--base", "main", "focus text"]);
  assert.deepEqual(normalizeArgv(["--base", "main"]), ["--base", "main"]);
  assert.deepEqual(normalizeArgv([]), []);
});
