"use strict";

// Builds commit history in a repository initialized by the implementation
// under test, using the real git binary so the objects are known-good and the
// tests are judging traversal rather than object construction.

const { git } = require("./spawn");
const { mineRepo, materialize } = require("./fixtures");

// Each commit advances the timestamp so ordering is deterministic and
// distinguishable, rather than every commit sharing one second.
function at(index) {
  return `${1700000000 + index * 3600} +0000`;
}

function commit(repo, message, index) {
  git(["add", "-A"], { cwd: repo });
  git(["commit", "-q", "--allow-empty", "-m", message], {
    cwd: repo,
    env: { GIT_AUTHOR_DATE: at(index), GIT_COMMITTER_DATE: at(index) },
  });
  return git(["rev-parse", "HEAD"], { cwd: repo }).out.trim();
}

// A linear history of `count` commits on main, oldest first in the returned
// array.
function linearRepo(count = 3) {
  const repo = mineRepo();
  const shas = [];

  for (let index = 0; index < count; index += 1) {
    materialize(repo, { "file.txt": `revision ${index}\n` });
    shas.push(commit(repo, `commit ${index}`, index));
  }

  return { repo, shas };
}

// main and a side branch that diverge and are then merged, so traversal has
// to cope with two parents and with a commit reachable by two paths.
function mergedRepo() {
  const repo = mineRepo();

  materialize(repo, { "base.txt": "base\n" });
  const base = commit(repo, "base commit", 0);

  git(["checkout", "-q", "-b", "side"], { cwd: repo });
  materialize(repo, { "side.txt": "side\n" });
  const side = commit(repo, "side commit", 1);

  git(["checkout", "-q", "main"], { cwd: repo });
  materialize(repo, { "main.txt": "main\n" });
  const mainline = commit(repo, "main commit", 2);

  git(["merge", "-q", "--no-ff", "side", "-m", "merge commit"], {
    cwd: repo,
    env: { GIT_AUTHOR_DATE: at(3), GIT_COMMITTER_DATE: at(3) },
  });
  const merge = git(["rev-parse", "HEAD"], { cwd: repo }).out.trim();

  return { repo, base, side, mainline, merge };
}

module.exports = { linearRepo, mergedRepo, commit, at };
