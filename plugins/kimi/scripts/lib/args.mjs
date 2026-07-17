// Minimal argv parsing shared by all companion subcommands.
// Supports: --key value, --key=value, boolean flags (--flag, --flag=false),
// short aliases, and "--" passthrough. Unknown options become positionals.

export function parseArgs(argv, { valueOptions = [], booleanOptions = [], aliasMap = {} } = {}) {
  const valueSet = new Set(valueOptions);
  const boolSet = new Set(booleanOptions);
  const result = { positionals: [] };

  const setOption = (name, value) => {
    const key = aliasMap[name] ?? name;
    result[key] = value;
  };

  const args = [...argv];
  let passthrough = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (passthrough) {
      result.positionals.push(arg);
      continue;
    }
    if (arg === "--") {
      passthrough = true;
      continue;
    }
    if (!arg.startsWith("-") || arg === "-") {
      result.positionals.push(arg);
      continue;
    }
    const trimmed = arg.replace(/^-+/, "");
    const eqIndex = trimmed.indexOf("=");
    const name = eqIndex === -1 ? trimmed : trimmed.slice(0, eqIndex);
    const inlineValue = eqIndex === -1 ? undefined : trimmed.slice(eqIndex + 1);

    if (valueSet.has(name) || valueSet.has(aliasMap[name])) {
      const value = inlineValue ?? args[++i];
      if (value === undefined) {
        throw new Error(`Option --${name} requires a value.`);
      }
      setOption(name, value);
      continue;
    }
    if (boolSet.has(name) || boolSet.has(aliasMap[name])) {
      if (inlineValue === undefined) {
        setOption(name, true);
      } else {
        setOption(name, !["false", "0", "no"].includes(inlineValue.toLowerCase()));
      }
      continue;
    }
    // Unknown option: keep as positional so focus text with dashes still works.
    result.positionals.push(arg);
  }
  return result;
}

// Re-tokenize a single raw argument string, honoring quotes and backslash
// escapes. Used when Claude Code passes "$ARGUMENTS" through as one string.
// Unlike a real shell, a quote only opens quoting at the start of a token —
// mid-word apostrophes in free-form text (e.g. "it's") stay literal.
export function splitRawArgumentString(raw) {
  const tokens = [];
  let current = "";
  let quote = null;
  let escaped = false;
  let hasToken = false;

  for (const ch of String(raw)) {
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\" && quote !== "'") {
      escaped = true;
      hasToken = true;
      continue;
    }
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }
    if ((ch === "'" || ch === '"') && current.length === 0 && !hasToken) {
      quote = ch;
      hasToken = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current.length > 0 || hasToken) {
        tokens.push(current);
        current = "";
        hasToken = false;
      }
      continue;
    }
    current += ch;
  }
  if (escaped) {
    current += "\\";
  }
  if (current.length > 0 || hasToken) {
    tokens.push(current);
  }
  return tokens;
}

// Claude Code command markdown invokes the companion with "$ARGUMENTS" quoted
// as a single argv entry; expand that form back into real argv.
export function normalizeArgv(argv) {
  const args = [...argv];
  if (args.length === 1 && typeof args[0] === "string" && /\s/.test(args[0].trim())) {
    return splitRawArgumentString(args[0]);
  }
  return args;
}
