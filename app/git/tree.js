const { fatal } = require("./errors");

const SPACE = 0x20;
const NULL = 0x00;
const SHA_BYTES = 20;
const MODE_WIDTH = 6;

const MODE_DIRECTORY = "40000";
const MODE_FILE = "100644";
const MODE_EXECUTABLE = "100755";
const MODE_SYMLINK = "120000";
const MODE_SUBMODULE = "160000";

const MODE_TO_TYPE = {
  [MODE_DIRECTORY]: "tree",
  [MODE_FILE]: "blob",
  [MODE_EXECUTABLE]: "blob",
  [MODE_SYMLINK]: "blob",
  [MODE_SUBMODULE]: "commit",
};

function parseTree(body) {
  const entries = [];
  let offset = 0;

  while (offset < body.length) {
    const space = body.indexOf(SPACE, offset);
    if (space === -1) {
      throw fatal("invalid tree object");
    }

    const nul = body.indexOf(NULL, space);
    if (nul === -1 || nul + 1 + SHA_BYTES > body.length) {
      throw fatal("invalid tree object");
    }

    entries.push({
      mode: body.subarray(offset, space).toString("utf8"),
      name: body.subarray(space + 1, nul).toString("utf8"),
      sha: body.subarray(nul + 1, nul + 1 + SHA_BYTES).toString("hex"),
    });

    offset = nul + 1 + SHA_BYTES;
  }

  return entries;
}

function serializeTree(entries) {
  return Buffer.concat(
    entries.map((entry) =>
      Buffer.concat([
        Buffer.from(`${entry.mode} ${entry.name}\0`),
        Buffer.from(entry.sha, "hex"),
      ]),
    ),
  );
}

function typeForMode(mode) {
  const type = MODE_TO_TYPE[mode];
  if (!type) {
    throw fatal(`invalid mode ${mode}`);
  }
  return type;
}

function formatTreeEntry(entry) {
  const mode = entry.mode.padStart(MODE_WIDTH, "0");
  return `${mode} ${typeForMode(entry.mode)} ${entry.sha}\t${entry.name}`;
}

function formatTree(entries, { nameOnly = false } = {}) {
  if (entries.length === 0) {
    return "";
  }
  const lines = nameOnly
    ? entries.map((entry) => entry.name)
    : entries.map(formatTreeEntry);
  return `${lines.join("\n")}\n`;
}

function sortKey(entry) {
  return Buffer.from(entry.mode === MODE_DIRECTORY ? `${entry.name}/` : entry.name);
}

function sortTreeEntries(entries) {
  return [...entries].sort((a, b) => Buffer.compare(sortKey(a), sortKey(b)));
}

function flattenTree(treeSha, gitDir, readObject) {
  const files = new Map();

  const walk = (sha, prefix) => {
    for (const entry of parseTree(readObject(sha, gitDir).body)) {
      const name = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.mode === MODE_DIRECTORY) {
        walk(entry.sha, name);
      } else {
        files.set(name, { mode: entry.mode, sha: entry.sha });
      }
    }
  };

  if (treeSha) {
    walk(treeSha, "");
  }

  return files;
}

module.exports = {
  parseTree,
  flattenTree,
  serializeTree,
  typeForMode,
  formatTreeEntry,
  formatTree,
  sortTreeEntries,
  MODE_TO_TYPE,
  MODE_DIRECTORY,
  MODE_FILE,
  MODE_EXECUTABLE,
  MODE_SYMLINK,
  MODE_SUBMODULE,
};
