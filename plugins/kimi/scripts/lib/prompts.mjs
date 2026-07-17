import fs from "node:fs";
import path from "node:path";

export function loadPromptTemplate(pluginRoot, name) {
  const filePath = path.join(pluginRoot, "prompts", `${name}.md`);
  return fs.readFileSync(filePath, "utf8");
}

export function interpolateTemplate(template, values) {
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (match, key) => {
    if (key in values) {
      return String(values[key]);
    }
    return match;
  });
}
