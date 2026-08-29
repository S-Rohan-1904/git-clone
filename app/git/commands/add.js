const fs = require("fs");
const path = require("path");

const { fatal, usage } = require("../errors");
const { findGitDir, findRepositoryRoot, writeObject } = require("../repository");
const { readIndex, writeIndex, entryFromStat } = require("../index-file");
const { createMatcher } = require("../ignore");
const { listFiles, modeFor, contentsOf } = require("../worktree");

const USAGE = "usage: git add [-A] <pathspec>...";

class AddCommand {
  constructor({ paths = [], all = false } = {}) {
    this.paths = paths;
    this.all = all;
  }

  execute() {
    if (this.paths.length === 0 && !this.all) {
      throw usage(USAGE);
    }

    const gitDir = findGitDir();
    const root = findRepositoryRoot();
    const matcher = createMatcher(root, gitDir);
    const entries = new Map(readIndex(gitDir).entries.map((entry) => [entry.path, entry]));

    const scopes = this.all && this.paths.length === 0 ? [""] : this.paths.map((given) => relativize(root, given));

    for (const scope of scopes) {
      const absolute = scope === "" ? root : path.join(root, scope);

      if (!fs.existsSync(absolute)) {
        removeUnder(entries, scope);
        continue;
      }

      const found = fs.statSync(absolute).isDirectory()
        ? listFiles(absolute, { matcher: scopedMatcher(matcher, scope) }).map((file) => ({
            relative: scope === "" ? file.relative : `${scope}/${file.relative}`,
            full: file.full,
            mode: file.mode,
          }))
        : [{ relative: scope, full: absolute, mode: modeFor(absolute, fs.lstatSync(absolute)) }];

      const present = new Set(found.map((file) => file.relative));
      removeUnder(entries, scope, present);

      for (const file of found) {
        const sha = writeObject("blob", contentsOf(file.full, file.mode), gitDir);
        entries.set(file.relative, entryFromStat(file.full, file.relative, sha, file.mode));
      }
    }

    writeIndex(gitDir, [...entries.values()]);
  }
}

function scopedMatcher(matcher, scope) {
  return {
    isIgnored(relative, isDirectory) {
      return matcher.isIgnored(scope === "" ? relative : `${scope}/${relative}`, isDirectory);
    },
  };
}

function relativize(root, given) {
  const relative = path.relative(root, path.resolve(given)).split(path.sep).join("/");

  if (relative.startsWith("..")) {
    throw fatal(`'${given}' is outside repository`);
  }

  return relative === "." ? "" : relative;
}

function removeUnder(entries, scope, keep = new Set()) {
  for (const key of [...entries.keys()]) {
    const inScope = scope === "" || key === scope || key.startsWith(`${scope}/`);
    if (inScope && !keep.has(key)) {
      entries.delete(key);
    }
  }
}

module.exports = AddCommand;
