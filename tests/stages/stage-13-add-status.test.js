"use strict";

// Stage 13: Stage and unstage changes
//
// status is three comparisons, not one: HEAD against the index gives staged
// changes, the index against the working tree gives unstaged changes, and
// what appears in neither is untracked. `git status --porcelain` is stable
// output designed for exactly this kind of comparison.

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const { runMine, runGit, git } = require("../helpers/spawn");
const { mineRepo, materialize } = require("../helpers/fixtures");
const { assertExit, assertFatal, assertStdout, assertMatchesGit } = require("../helpers/assertions");

function bothStatus(repo) {
  assertMatchesGit(
    runMine(["status", "--porcelain"], { cwd: repo }),
    runGit(["status", "--porcelain"], { cwd: repo }),
  );
}

function committed(files) {
  const repo = mineRepo(files);
  git(["add", "-A"], { cwd: repo });
  git(["commit", "-q", "-m", "initial"], { cwd: repo });
  return repo;
}

test("add stages a new file", () => {
  const repo = mineRepo({ "a.txt": "a\n" });
  assertExit(runMine(["add", "a.txt"], { cwd: repo }), 0);
  assertStdout(runGit(["ls-files"], { cwd: repo }), "a.txt\n");
});

test("an index written by add is accepted by the real git binary", () => {
  const repo = mineRepo({ "a.txt": "a\n", "sub/b.txt": "b\n" });
  runMine(["add", "-A"], { cwd: repo });
  assertStdout(runGit(["status", "--porcelain"], { cwd: repo }), "A  a.txt\nA  sub/b.txt\n");
});

test("add -A stages everything in the working tree", () => {
  const repo = mineRepo({ "a.txt": "a\n", "nested/deep/c.txt": "c\n" });
  runMine(["add", "-A"], { cwd: repo });
  assertStdout(runGit(["ls-files"], { cwd: repo }), "a.txt\nnested/deep/c.txt\n");
});

test("add stages a whole directory", () => {
  const repo = mineRepo({ "top.txt": "t\n", "sub/a.txt": "a\n", "sub/b.txt": "b\n" });
  runMine(["add", "sub"], { cwd: repo });
  assertStdout(runGit(["ls-files"], { cwd: repo }), "sub/a.txt\nsub/b.txt\n");
});

test("add records the executable bit", () => {
  const repo = mineRepo({ "run.sh": "#!/bin/sh\n" });
  fs.chmodSync(path.join(repo, "run.sh"), 0o755);
  runMine(["add", "-A"], { cwd: repo });
  assert.match(runGit(["ls-files", "--stage"], { cwd: repo }).out, /^100755 /m);
});

test("add stores a symlink's target as its content", () => {
  const repo = mineRepo({ "target.txt": "t\n" });
  fs.symlinkSync("target.txt", path.join(repo, "link.txt"));
  runMine(["add", "-A"], { cwd: repo });
  assert.match(runGit(["ls-files", "--stage"], { cwd: repo }).out, /^120000 [0-9a-f]{40} 0\tlink\.txt$/m);
});

test("add skips ignored files", () => {
  const repo = mineRepo({ ".gitignore": "*.log\n", "keep.txt": "k\n", "debug.log": "d\n" });
  runMine(["add", "-A"], { cwd: repo });
  assertStdout(runGit(["ls-files"], { cwd: repo }), ".gitignore\nkeep.txt\n");
});

test("add updates an entry when the file changes", () => {
  const repo = mineRepo({ "a.txt": "before\n" });
  runMine(["add", "a.txt"], { cwd: repo });
  const before = runGit(["ls-files", "--stage"], { cwd: repo }).out;

  materialize(repo, { "a.txt": "after\n" });
  runMine(["add", "a.txt"], { cwd: repo });

  assert.notStrictEqual(runGit(["ls-files", "--stage"], { cwd: repo }).out, before);
  bothStatus(repo);
});

test("add stages a deletion when the file is gone", () => {
  const repo = committed({ "a.txt": "a\n", "b.txt": "b\n" });
  fs.rmSync(path.join(repo, "b.txt"));
  runMine(["add", "-A"], { cwd: repo });
  bothStatus(repo);
});

test("status reports a clean tree as empty", () => {
  const repo = committed({ "a.txt": "a\n" });
  const res = runMine(["status", "--porcelain"], { cwd: repo });
  assertExit(res, 0);
  assert.strictEqual(res.out, "");
});

test("status marks an untracked file", () => {
  const repo = committed({ "a.txt": "a\n" });
  materialize(repo, { "new.txt": "n\n" });
  bothStatus(repo);
});

test("status marks an unstaged modification", () => {
  const repo = committed({ "a.txt": "a\n" });
  materialize(repo, { "a.txt": "changed\n" });
  bothStatus(repo);
});

test("status marks an unstaged deletion", () => {
  const repo = committed({ "a.txt": "a\n", "b.txt": "b\n" });
  fs.rmSync(path.join(repo, "b.txt"));
  bothStatus(repo);
});

test("status marks a staged addition", () => {
  const repo = committed({ "a.txt": "a\n" });
  materialize(repo, { "new.txt": "n\n" });
  git(["add", "new.txt"], { cwd: repo });
  bothStatus(repo);
});

test("status marks a staged modification", () => {
  const repo = committed({ "a.txt": "a\n" });
  materialize(repo, { "a.txt": "changed\n" });
  git(["add", "a.txt"], { cwd: repo });
  bothStatus(repo);
});

test("status marks a staged deletion", () => {
  const repo = committed({ "a.txt": "a\n", "b.txt": "b\n" });
  git(["rm", "-q", "b.txt"], { cwd: repo });
  bothStatus(repo);
});

test("status distinguishes staged from unstaged changes on one file", () => {
  const repo = committed({ "a.txt": "a\n" });
  materialize(repo, { "a.txt": "staged\n" });
  git(["add", "a.txt"], { cwd: repo });
  materialize(repo, { "a.txt": "and then modified again\n" });
  bothStatus(repo);
});

test("status reports a mode change as a modification", () => {
  const repo = committed({ "run.sh": "#!/bin/sh\n" });
  fs.chmodSync(path.join(repo, "run.sh"), 0o755);
  bothStatus(repo);
});

test("status handles several files at once", () => {
  const repo = committed({ "a.txt": "a\n", "b.txt": "b\n", "sub/c.txt": "c\n" });
  materialize(repo, { "a.txt": "changed\n", "untracked.txt": "u\n", "sub/d.txt": "d\n" });
  fs.rmSync(path.join(repo, "b.txt"));
  git(["add", "sub/d.txt"], { cwd: repo });
  bothStatus(repo);
});

test("status sorts its output by path", () => {
  const repo = committed({ "a.txt": "a\n" });
  materialize(repo, { "z.txt": "z\n", "b.txt": "b\n", "m.txt": "m\n" });
  bothStatus(repo);
});

test("status works in a repository with no commits", () => {
  const repo = mineRepo({ "a.txt": "a\n" });
  bothStatus(repo);
  git(["add", "-A"], { cwd: repo });
  bothStatus(repo);
});

test("status default output names the branch and the changed files", () => {
  const repo = committed({ "a.txt": "a\n" });
  materialize(repo, { "a.txt": "changed\n", "new.txt": "n\n" });
  const res = runMine(["status"], { cwd: repo });
  assertExit(res, 0);
  assert.match(res.out, /On branch main/);
  assert.match(res.out, /a\.txt/);
  assert.match(res.out, /new\.txt/);
});

test("rm removes a file from the index and the working tree", () => {
  const repo = committed({ "a.txt": "a\n", "b.txt": "b\n" });
  assertExit(runMine(["rm", "b.txt"], { cwd: repo }), 0);
  assert.ok(!fs.existsSync(path.join(repo, "b.txt")), "expected the file to be deleted");
  assertStdout(runGit(["ls-files"], { cwd: repo }), "a.txt\n");
});

test("rm --cached leaves the file on disk", () => {
  const repo = committed({ "a.txt": "a\n", "b.txt": "b\n" });
  assertExit(runMine(["rm", "--cached", "b.txt"], { cwd: repo }), 0);
  assert.ok(fs.existsSync(path.join(repo, "b.txt")), "expected the file to remain on disk");
  assertStdout(runGit(["ls-files"], { cwd: repo }), "a.txt\n");
  bothStatus(repo);
});

test("rm fails for a path that is not tracked", () => {
  const repo = committed({ "a.txt": "a\n" });
  assertFatal(runMine(["rm", "missing.txt"], { cwd: repo }));
});

test("add fails when given no paths", () => {
  const repo = mineRepo({ "a.txt": "a\n" });
  const res = runMine(["add"], { cwd: repo });
  assert.notStrictEqual(res.code, 0);
});
