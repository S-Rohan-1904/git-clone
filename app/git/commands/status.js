const crypto = require("crypto");

const { findGitDir, findRepositoryRoot, readObject } = require("../repository");
const { readIndex } = require("../index-file");
const { createMatcher } = require("../ignore");
const { listFiles, contentsOf } = require("../worktree");
const { parseTree, MODE_DIRECTORY } = require("../tree");
const { resolveHead, currentBranch } = require("../refs");
const { parseCommit } = require("../commit");

const UNCHANGED = " ";
const UNTRACKED = "??";

function headTree(gitDir) {
  const files = new Map();
  const head = resolveHead(gitDir);

  if (!head) {
    return files;
  }

  const commit = parseCommit(readObject(head, gitDir).body);

  const walk = (sha, prefix) => {
    for (const entry of parseTree(readObject(sha, gitDir).body)) {
      const name = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.mode === MODE_DIRECTORY) {
        walk(entry.sha, name);
      } else {
        files.set(name, { mode: Number.parseInt(entry.mode, 8), sha: entry.sha });
      }
    }
  };

  walk(commit.tree, "");
  return files;
}

function blobSha(contents) {
  const stored = Buffer.concat([Buffer.from(`blob ${contents.length}\0`), contents]);
  return crypto.createHash("sha1").update(stored).digest("hex");
}

class StatusCommand {
  constructor({ porcelain = false } = {}) {
    this.porcelain = porcelain;
  }

  execute() {
    const gitDir = findGitDir();
    const root = findRepositoryRoot();
    const matcher = createMatcher(root, gitDir);

    const head = headTree(gitDir);
    const index = new Map(readIndex(gitDir).entries.map((entry) => [entry.path, entry]));
    const worktree = new Map(listFiles(root, { matcher }).map((file) => [file.relative, file]));

    const lines = [];
    const names = new Set([...head.keys(), ...index.keys(), ...worktree.keys()]);

    for (const name of [...names].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))) {
      const staged = index.get(name);
      const committed = head.get(name);
      const present = worktree.get(name);

      let x = UNCHANGED;
      let y = UNCHANGED;

      if (staged && !committed) {
        x = "A";
      } else if (!staged && committed) {
        x = "D";
      } else if (staged && committed && (staged.sha !== committed.sha || staged.mode !== committed.mode)) {
        x = "M";
      }

      if (staged && !present) {
        y = "D";
      } else if (staged && present) {
        const sha = blobSha(contentsOf(present.full, present.mode));
        if (sha !== staged.sha || present.mode !== staged.mode) {
          y = "M";
        }
      }

      if (x !== UNCHANGED || y !== UNCHANGED) {
        lines.push(`${x}${y} ${name}`);
      }
      if (!staged && present) {
        lines.push(`${UNTRACKED} ${name}`);
      }
    }

    if (this.porcelain) {
      if (lines.length > 0) {
        process.stdout.write(`${lines.join("\n")}\n`);
      }
      return;
    }

    this.report(gitDir, lines);
  }

  report(gitDir, lines) {
    const branch = currentBranch(gitDir);
    const output = [`On branch ${branch || "HEAD"}`];

    const staged = lines.filter((line) => line[0] !== " " && line[0] !== "?");
    const unstaged = lines.filter((line) => line[0] !== "?" && line[1] !== " ");
    const untracked = lines.filter((line) => line.startsWith(UNTRACKED));

    if (staged.length > 0) {
      output.push("", "Changes to be committed:");
      output.push(...staged.map((line) => `\t${describe(line[0])}   ${line.slice(3)}`));
    }
    if (unstaged.length > 0) {
      output.push("", "Changes not staged for commit:");
      output.push(...unstaged.map((line) => `\t${describe(line[1])}   ${line.slice(3)}`));
    }
    if (untracked.length > 0) {
      output.push("", "Untracked files:");
      output.push(...untracked.map((line) => `\t${line.slice(3)}`));
    }
    if (lines.length === 0) {
      output.push("", "nothing to commit, working tree clean");
    }

    process.stdout.write(`${output.join("\n")}\n`);
  }
}

function describe(code) {
  return { A: "new file:", M: "modified:", D: "deleted:" }[code] || code;
}

module.exports = StatusCommand;
