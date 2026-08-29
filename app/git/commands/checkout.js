const fs = require("fs");
const path = require("path");

const { fatal, usage } = require("../errors");
const { findGitDir, findRepositoryRoot, readObject } = require("../repository");
const { readIndex, writeIndex, entryFromStat } = require("../index-file");
const { resolveRevision, peel } = require("../revision");
const { parseCommit } = require("../commit");
const { parseTree, MODE_DIRECTORY, MODE_SYMLINK, MODE_EXECUTABLE } = require("../tree");
const { refExists, writeRef, setHead, currentBranch } = require("../refs");
const { createMatcher } = require("../ignore");
const { listFiles, contentsOf } = require("../worktree");
const { hashObject } = require("../repository");

const PREFIX = "refs/heads/";
const FILE_MODE = 0o644;
const EXECUTABLE_MODE = 0o755;

function flatten(treeSha, gitDir) {
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

  walk(treeSha, "");
  return files;
}

function assertClean(gitDir, root) {
  const index = new Map(readIndex(gitDir).entries.map((entry) => [entry.path, entry]));
  const matcher = createMatcher(root, gitDir);
  const present = new Map(listFiles(root, { matcher }).map((file) => [file.relative, file]));

  for (const [name, entry] of index) {
    const file = present.get(name);
    if (!file) {
      throw fatal(`Your local changes would be overwritten by checkout: ${name}`);
    }
    if (hashObject("blob", contentsOf(file.full, file.mode)) !== entry.sha) {
      throw fatal(`Your local changes would be overwritten by checkout: ${name}`);
    }
  }
}

class CheckoutCommand {
  constructor({ target, create = false } = {}) {
    this.target = target;
    this.create = create;
  }

  execute() {
    if (!this.target) {
      throw usage("usage: git checkout [-b] <branch>");
    }

    const gitDir = findGitDir();
    const root = findRepositoryRoot();
    const branchRef = `${PREFIX}${this.target}`;

    if (this.create) {
      if (refExists(gitDir, branchRef)) {
        throw fatal(`a branch named '${this.target}' already exists`);
      }
      writeRef(gitDir, branchRef, resolveRevision("HEAD", gitDir));
      setHead(gitDir, branchRef);
      process.stderr.write(`Switched to a new branch '${this.target}'\n`);
      return;
    }

    const commit = peel(resolveRevision(this.target, gitDir), "commit", gitDir);

    assertClean(gitDir, root);

    const current = new Map(readIndex(gitDir).entries.map((entry) => [entry.path, entry]));
    const wanted = flatten(parseCommit(readObject(commit, gitDir).body).tree, gitDir);

    for (const name of current.keys()) {
      if (!wanted.has(name)) {
        fs.rmSync(path.join(root, name), { force: true });
      }
    }

    const entries = [];

    for (const [name, file] of wanted) {
      const destination = path.join(root, name);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      const blob = readObject(file.sha, gitDir);

      if (file.mode === MODE_SYMLINK) {
        fs.rmSync(destination, { force: true });
        fs.symlinkSync(blob.body.toString("utf8"), destination);
      } else {
        fs.writeFileSync(destination, blob.body, {
          mode: file.mode === MODE_EXECUTABLE ? EXECUTABLE_MODE : FILE_MODE,
        });
      }

      entries.push(entryFromStat(destination, name, file.sha, Number.parseInt(file.mode, 8)));
    }

    writeIndex(gitDir, entries);
    pruneEmpty(root);

    if (refExists(gitDir, branchRef)) {
      setHead(gitDir, branchRef);
      process.stderr.write(`Switched to branch '${this.target}'\n`);
    } else {
      fs.writeFileSync(path.join(gitDir, "HEAD"), `${commit}\n`);
      process.stderr.write(`HEAD is now at ${commit.slice(0, 7)}\n`);
    }
  }
}

function pruneEmpty(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === ".git") {
      continue;
    }
    const full = path.join(directory, entry.name);
    pruneEmpty(full);
    if (fs.readdirSync(full).length === 0) {
      fs.rmdirSync(full);
    }
  }
}

module.exports = CheckoutCommand;
