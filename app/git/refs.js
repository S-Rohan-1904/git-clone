const fs = require("fs");
const path = require("path");

const { fatal } = require("./errors");

const HEAD = "HEAD";
const PACKED_REFS = "packed-refs";
const SYMBOLIC = /^ref:\s*(.+)$/;
const PACKED_LINE = /^([0-9a-f]{40})\s+(.+)$/;
const REF_ROOT = "refs";

function refPath(gitDir, name) {
  return path.join(gitDir, ...name.split("/"));
}

function readLooseRefs(gitDir) {
  const refs = new Map();
  const root = path.join(gitDir, REF_ROOT);

  const walk = (directory, prefix) => {
    if (!fs.existsSync(directory)) {
      return;
    }
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const name = `${prefix}/${entry.name}`;
      const full = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        walk(full, name);
      } else {
        refs.set(name, fs.readFileSync(full, "utf8").trim());
      }
    }
  };

  walk(root, REF_ROOT);
  return refs;
}

function readPackedRefs(gitDir) {
  const refs = new Map();
  const file = path.join(gitDir, PACKED_REFS);

  if (!fs.existsSync(file)) {
    return refs;
  }

  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (line.startsWith("#") || line.startsWith("^") || line.trim() === "") {
      continue;
    }
    const match = PACKED_LINE.exec(line);
    if (match) {
      refs.set(match[2].trim(), match[1]);
    }
  }

  return refs;
}

function listRefs(gitDir) {
  const refs = readPackedRefs(gitDir);

  for (const [name, sha] of readLooseRefs(gitDir)) {
    refs.set(name, sha);
  }

  return [...refs.entries()]
    .map(([name, sha]) => ({ name, sha }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

function readRef(gitDir, name) {
  const loose = refPath(gitDir, name);

  if (fs.existsSync(loose) && fs.statSync(loose).isFile()) {
    const contents = fs.readFileSync(loose, "utf8").trim();
    const symbolic = SYMBOLIC.exec(contents);
    return symbolic ? readRef(gitDir, symbolic[1]) : contents;
  }

  return readPackedRefs(gitDir).get(name) || null;
}

function refExists(gitDir, name) {
  return readRef(gitDir, name) !== null;
}

function writeRef(gitDir, name, sha) {
  const destination = refPath(gitDir, name);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, `${sha}\n`);
}

function deleteRef(gitDir, name) {
  fs.rmSync(refPath(gitDir, name), { force: true });

  const packed = readPackedRefs(gitDir);
  if (packed.delete(name)) {
    const lines = [...packed.entries()].map(([ref, sha]) => `${sha} ${ref}`);
    fs.writeFileSync(
      path.join(gitDir, PACKED_REFS),
      lines.length ? `${lines.join("\n")}\n` : "",
    );
  }
}

function readHeadTarget(gitDir) {
  const contents = fs.readFileSync(path.join(gitDir, HEAD), "utf8").trim();
  const symbolic = SYMBOLIC.exec(contents);

  return symbolic ? symbolic[1] : null;
}

function resolveHead(gitDir) {
  const target = readHeadTarget(gitDir);

  if (target === null) {
    return fs.readFileSync(path.join(gitDir, HEAD), "utf8").trim();
  }

  return readRef(gitDir, target);
}

function setHead(gitDir, target) {
  fs.writeFileSync(path.join(gitDir, HEAD), `ref: ${target}\n`);
}

function currentBranch(gitDir) {
  const target = readHeadTarget(gitDir);
  return target && target.startsWith("refs/heads/") ? target.slice("refs/heads/".length) : null;
}

module.exports = {
  listRefs,
  readLooseRefs,
  readPackedRefs,
  readRef,
  refExists,
  writeRef,
  deleteRef,
  readHeadTarget,
  resolveHead,
  setHead,
  currentBranch,
  HEAD,
};
