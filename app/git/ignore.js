const fs = require("fs");
const path = require("path");

const IGNORE_FILE = ".gitignore";
const EXCLUDE_FILE = path.join("info", "exclude");
const SPECIAL = /[.+^${}()|[\]\\]/g;

function compile(pattern) {
  let body = pattern;
  let negate = false;
  let dirOnly = false;

  if (body.startsWith("!")) {
    negate = true;
    body = body.slice(1);
  }
  if (body.endsWith("/")) {
    dirOnly = true;
    body = body.slice(0, -1);
  }

  const anchored = body.includes("/");
  if (body.startsWith("/")) {
    body = body.slice(1);
  }

  let source = "";
  for (let i = 0; i < body.length; i += 1) {
    const char = body[i];

    if (char === "*" && body[i + 1] === "*") {
      const before = body[i - 1];
      const after = body[i + 2];
      i += 1;
      if (after === "/") {
        i += 1;
        source += "(?:.*/)?";
      } else if (before === "/" || before === undefined) {
        source += ".*";
      } else {
        source += ".*";
      }
      continue;
    }
    if (char === "*") {
      source += "[^/]*";
      continue;
    }
    if (char === "?") {
      source += "[^/]";
      continue;
    }
    source += char.replace(SPECIAL, "\\$&");
  }

  const prefix = anchored ? "^" : "^(?:.*/)?";
  return { regex: new RegExp(`${prefix}${source}(?:/.*)?$`), negate, dirOnly };
}

function parse(contents) {
  const rules = [];

  for (const raw of contents.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (line.trim() === "" || line.startsWith("#")) {
      continue;
    }
    rules.push(compile(line.replace(/(?<!\\)\s+$/, "")));
  }

  return rules;
}

function collectSources(root, gitDir) {
  const sources = [];
  const exclude = path.join(gitDir, EXCLUDE_FILE);

  if (fs.existsSync(exclude)) {
    sources.push({ base: "", rules: parse(fs.readFileSync(exclude, "utf8")) });
  }

  const walk = (directory, base) => {
    const ignoreFile = path.join(directory, IGNORE_FILE);
    if (fs.existsSync(ignoreFile)) {
      sources.push({ base, rules: parse(fs.readFileSync(ignoreFile, "utf8")) });
    }

    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === ".git" || !entry.isDirectory()) {
        continue;
      }
      walk(path.join(directory, entry.name), base === "" ? entry.name : `${base}/${entry.name}`);
    }
  };

  walk(root, "");
  return sources.sort((a, b) => a.base.split("/").length - b.base.split("/").length);
}

function createMatcher(root, gitDir) {
  const sources = collectSources(root, gitDir);

  const matches = (relativePath, isDirectory) => {
    let ignored = false;

    for (const source of sources) {
      if (source.base !== "" && !relativePath.startsWith(`${source.base}/`)) {
        continue;
      }
      const candidate = source.base === "" ? relativePath : relativePath.slice(source.base.length + 1);

      for (const rule of source.rules) {
        if (rule.dirOnly && !isDirectory) {
          continue;
        }
        if (rule.regex.test(candidate)) {
          ignored = !rule.negate;
        }
      }
    }

    return ignored;
  };

  return {
    isIgnored(relativePath, isDirectory = false) {
      const parts = relativePath.split("/");

      for (let depth = 1; depth < parts.length; depth += 1) {
        if (matches(parts.slice(0, depth).join("/"), true)) {
          return true;
        }
      }

      return matches(relativePath, isDirectory);
    },
  };
}

module.exports = { createMatcher };
