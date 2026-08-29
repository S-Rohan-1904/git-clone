const fs = require("fs");
const path = require("path");

const { findGitDir, findRepositoryRoot, readObject, hashObject } = require("../repository");
const { readIndex } = require("../index-file");
const { createMatcher } = require("../ignore");
const { listFiles, contentsOf } = require("../worktree");
const { parseTree, MODE_DIRECTORY } = require("../tree");
const { resolveHead } = require("../refs");
const { resolveRevision, peel } = require("../revision");
const { parseCommit } = require("../commit");
const { formatPatch } = require("../diff");

function flattenTree(treeSha, gitDir) {
  const files = new Map();

  const walk = (sha, prefix) => {
    for (const entry of parseTree(readObject(sha, gitDir).body)) {
      const name = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.mode === MODE_DIRECTORY) {
        walk(entry.sha, name);
      } else {
        files.set(name, { mode: entry.mode.padStart(6, "0"), sha: entry.sha });
      }
    }
  };

  if (treeSha) {
    walk(treeSha, "");
  }

  return files;
}

function commitTree(revision, gitDir) {
  const commit = peel(resolveRevision(revision, gitDir), "commit", gitDir);
  return parseCommit(readObject(commit, gitDir).body).tree;
}

function headFiles(gitDir) {
  const head = resolveHead(gitDir);
  return head ? flattenTree(parseCommit(readObject(head, gitDir).body).tree, gitDir) : new Map();
}

function indexFiles(gitDir) {
  return new Map(
    readIndex(gitDir).entries.map((entry) => [
      entry.path,
      { mode: entry.mode.toString(8).padStart(6, "0"), sha: entry.sha },
    ]),
  );
}

function worktreeFiles(root, gitDir) {
  const matcher = createMatcher(root, gitDir);
  const tracked = new Set(readIndex(gitDir).entries.map((entry) => entry.path));
  const files = new Map();

  for (const file of listFiles(root, { matcher })) {
    if (!tracked.has(file.relative)) {
      continue;
    }
    const content = contentsOf(file.full, file.mode);
    files.set(file.relative, {
      mode: file.mode.toString(8).padStart(6, "0"),
      sha: hashObject("blob", content),
      content,
    });
  }

  return files;
}

function contentOf(side, gitDir) {
  if (!side) {
    return null;
  }
  return { ...side, content: side.content || readObject(side.sha, gitDir).body };
}

class DiffCommand {
  constructor({ cached = false, revisions = [] } = {}) {
    this.cached = cached;
    this.revisions = revisions;
  }

  execute() {
    const gitDir = findGitDir();
    const root = findRepositoryRoot();

    let before;
    let after;

    if (this.revisions.length >= 2) {
      before = flattenTree(commitTree(this.revisions[0], gitDir), gitDir);
      after = flattenTree(commitTree(this.revisions[1], gitDir), gitDir);
    } else if (this.revisions.length === 1) {
      before = flattenTree(commitTree(this.revisions[0], gitDir), gitDir);
      after = worktreeFiles(root, gitDir);
    } else if (this.cached) {
      before = headFiles(gitDir);
      after = indexFiles(gitDir);
    } else {
      before = indexFiles(gitDir);
      after = worktreeFiles(root, gitDir);
    }

    const names = [...new Set([...before.keys(), ...after.keys()])].sort((a, b) =>
      Buffer.compare(Buffer.from(a), Buffer.from(b)),
    );

    const patches = [];

    for (const name of names) {
      const source = before.get(name);
      const target = after.get(name);

      if (source && target && source.sha === target.sha && source.mode === target.mode) {
        continue;
      }

      patches.push(
        formatPatch({ path: name, before: contentOf(source, gitDir), after: contentOf(target, gitDir) }),
      );
    }

    if (patches.length > 0) {
      process.stdout.write(`${patches.join("\n")}\n`);
    }
  }
}

module.exports = DiffCommand;
