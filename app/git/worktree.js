const fs = require("fs");
const path = require("path");

const { MODE_FILE, MODE_EXECUTABLE, MODE_SYMLINK } = require("./tree");

const EXECUTABLE_BITS = 0o111;

function modeFor(fullPath, dirent) {
  if (dirent.isSymbolicLink()) {
    return Number.parseInt(MODE_SYMLINK, 8);
  }
  const executable = (fs.statSync(fullPath).mode & EXECUTABLE_BITS) !== 0;
  return Number.parseInt(executable ? MODE_EXECUTABLE : MODE_FILE, 8);
}

function contentsOf(fullPath, mode) {
  return mode === Number.parseInt(MODE_SYMLINK, 8)
    ? Buffer.from(fs.readlinkSync(fullPath))
    : fs.readFileSync(fullPath);
}

function listFiles(root, { matcher = null, includeIgnored = false } = {}) {
  const files = [];

  const walk = (directory, base) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === ".git") {
        continue;
      }

      const relative = base === "" ? entry.name : `${base}/${entry.name}`;
      const full = path.join(directory, entry.name);
      const isDirectory = entry.isDirectory() && !entry.isSymbolicLink();

      if (!includeIgnored && matcher && matcher.isIgnored(relative, isDirectory)) {
        continue;
      }

      if (isDirectory) {
        walk(full, relative);
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        files.push({ relative, full, mode: modeFor(full, entry) });
      }
    }
  };

  walk(root, "");
  return files.sort((a, b) => Buffer.compare(Buffer.from(a.relative), Buffer.from(b.relative)));
}

module.exports = { listFiles, modeFor, contentsOf };
