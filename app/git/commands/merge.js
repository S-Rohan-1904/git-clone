const fs = require("fs");
const path = require("path");

const { GitError, fatal, usage } = require("../errors");
const { findGitDir, findRepositoryRoot, readObject, writeObject } = require("../repository");
const { readIndex, writeIndex, entryFromStat } = require("../index-file");
const { resolveHead, readHeadTarget, writeRef, currentBranch } = require("../refs");
const { resolveRevision, peel } = require("../revision");
const { parseCommit } = require("../commit");
const { flattenTree, MODE_SYMLINK, MODE_EXECUTABLE } = require("../tree");
const { buildTreeFromEntries } = require("../tree-builder");
const { mergeBase, mergeContents, ancestors } = require("../merge");
const { identity } = require("../identity");

const USAGE = "usage: git merge <commit>";
const FILE_MODE = 0o644;
const EXECUTABLE_MODE = 0o755;
const ABBREVIATED = 7;

function treeOf(commit, gitDir) {
  return parseCommit(readObject(commit, gitDir).body).tree;
}

function writeWorkingFile(root, name, mode, content) {
  const destination = path.join(root, name);
  fs.mkdirSync(path.dirname(destination), { recursive: true });

  if (mode === MODE_SYMLINK) {
    fs.rmSync(destination, { force: true });
    fs.symlinkSync(content.toString("utf8"), destination);
    return;
  }

  fs.writeFileSync(destination, content, {
    mode: mode === MODE_EXECUTABLE ? EXECUTABLE_MODE : FILE_MODE,
  });
}

class MergeCommand {
  constructor({ revision, message } = {}) {
    this.revision = revision;
    this.message = message;
  }

  execute() {
    if (!this.revision) {
      throw usage(USAGE);
    }

    const gitDir = findGitDir();
    const root = findRepositoryRoot();

    const ours = resolveHead(gitDir);
    if (!ours) {
      throw fatal("no commit on this branch yet");
    }

    const theirs = peel(resolveRevision(this.revision, gitDir), "commit", gitDir);

    if (ancestors(ours, gitDir).has(theirs)) {
      process.stdout.write("Already up to date.\n");
      return;
    }

    if (ancestors(theirs, gitDir).has(ours)) {
      this.fastForward(gitDir, root, ours, theirs);
      return;
    }

    const base = mergeBase(gitDir, ours, theirs);
    if (!base) {
      throw fatal("refusing to merge unrelated histories");
    }

    this.threeWay(gitDir, root, { base, ours, theirs });
  }

  checkout(gitDir, root, commit) {
    const files = flattenTree(treeOf(commit, gitDir), gitDir, readObject);
    const previous = readIndex(gitDir).entries;

    for (const entry of previous) {
      if (!files.has(entry.path)) {
        fs.rmSync(path.join(root, entry.path), { force: true });
      }
    }

    const entries = [];

    for (const [name, file] of files) {
      writeWorkingFile(root, name, file.mode, readObject(file.sha, gitDir).body);
      entries.push(
        entryFromStat(path.join(root, name), name, file.sha, Number.parseInt(file.mode, 8)),
      );
    }

    writeIndex(gitDir, entries);
  }

  fastForward(gitDir, root, ours, theirs) {
    this.checkout(gitDir, root, theirs);
    writeRef(gitDir, readHeadTarget(gitDir), theirs);
    process.stdout.write(
      `Updating ${ours.slice(0, ABBREVIATED)}..${theirs.slice(0, ABBREVIATED)}\nFast-forward\n`,
    );
  }

  threeWay(gitDir, root, { base, ours, theirs }) {
    const baseFiles = flattenTree(treeOf(base, gitDir), gitDir, readObject);
    const oursFiles = flattenTree(treeOf(ours, gitDir), gitDir, readObject);
    const theirsFiles = flattenTree(treeOf(theirs, gitDir), gitDir, readObject);

    const labels = { ours: "HEAD", theirs: this.revision };
    const names = [...new Set([...baseFiles.keys(), ...oursFiles.keys(), ...theirsFiles.keys()])].sort();

    const merged = new Map();
    const conflicts = [];

    for (const name of names) {
      const inBase = baseFiles.get(name);
      const inOurs = oursFiles.get(name);
      const inTheirs = theirsFiles.get(name);

      if (same(inOurs, inTheirs)) {
        if (inOurs) merged.set(name, inOurs);
        continue;
      }
      if (same(inBase, inOurs)) {
        if (inTheirs) merged.set(name, inTheirs);
        continue;
      }
      if (same(inBase, inTheirs)) {
        if (inOurs) merged.set(name, inOurs);
        continue;
      }

      if (!inOurs || !inTheirs) {
        conflicts.push(name);
        const surviving = inOurs || inTheirs;
        merged.set(name, surviving);
        continue;
      }

      const result = mergeContents(
        inBase ? readObject(inBase.sha, gitDir).body : null,
        readObject(inOurs.sha, gitDir).body,
        readObject(inTheirs.sha, gitDir).body,
        labels,
      );

      if (result.conflicted) {
        conflicts.push(name);
      }

      merged.set(name, {
        mode: inOurs.mode,
        sha: writeObject("blob", result.content, gitDir),
      });
    }

    for (const entry of readIndex(gitDir).entries) {
      if (!merged.has(entry.path)) {
        fs.rmSync(path.join(root, entry.path), { force: true });
      }
    }

    const entries = [];

    for (const [name, file] of merged) {
      writeWorkingFile(root, name, file.mode, readObject(file.sha, gitDir).body);
      entries.push(
        entryFromStat(path.join(root, name), name, file.sha, Number.parseInt(file.mode, 8)),
      );
    }

    writeIndex(gitDir, entries);

    if (conflicts.length > 0) {
      for (const name of conflicts) {
        process.stdout.write(`CONFLICT (content): Merge conflict in ${name}\n`);
      }
      throw new GitError("Automatic merge failed; fix conflicts and then commit the result.", 1);
    }

    const message = this.message || `Merge commit '${this.revision}'`;
    const tree = buildTreeFromEntries(entries, gitDir);

    const body = [
      `tree ${tree}`,
      `parent ${ours}`,
      `parent ${theirs}`,
      `author ${identity("AUTHOR")}`,
      `committer ${identity("COMMITTER")}`,
      "",
      `${message}\n`,
    ].join("\n");

    const sha = writeObject("commit", Buffer.from(body), gitDir);
    writeRef(gitDir, readHeadTarget(gitDir), sha);

    process.stdout.write(`Merge made by the 'three-way' strategy.\n`);
  }
}

function same(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.sha === b.sha && a.mode === b.mode;
}

module.exports = MergeCommand;
