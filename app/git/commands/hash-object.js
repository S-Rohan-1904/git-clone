const fs = require("fs");
const path = require("path");

const { fatal, usage } = require("../errors");
const { findGitDir, writeObject } = require("../repository");

const USAGE = "usage: git hash-object [-t <type>] [-w] <file>";
const OBJECT_TYPES = new Set(["blob", "tree", "commit", "tag"]);

class HashObjectCommand {
  constructor({ type = "blob", write = false, filePath } = {}) {
    this.type = type;
    this.write = write;
    this.filePath = filePath;
  }

  execute() {
    const { type, write, filePath } = this;

    if (!filePath) {
      throw usage(USAGE);
    }
    if (!OBJECT_TYPES.has(type)) {
      throw fatal(`invalid object type "${type}"`);
    }

    const resolved = path.resolve(filePath);

    let stats;
    try {
      stats = fs.statSync(resolved);
    } catch {
      throw fatal(
        `could not open '${filePath}' for reading: No such file or directory`,
      );
    }

    if (stats.isDirectory()) {
      throw fatal(`Unable to hash ${filePath}`);
    }

    const content = fs.readFileSync(resolved);

    const gitDir = write ? findGitDir() : null;

    process.stdout.write(`${writeObject(type, content, gitDir)}\n`);
  }
}

module.exports = HashObjectCommand;
