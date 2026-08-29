"use strict";

// Stage 14: Commit from the index
//
// The tree comes from the index rather than the working directory, which
// means rebuilding nested trees from flat sorted paths. Every commit here is
// verified by handing the repository to real git afterwards.

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const { runMine, runGit, git } = require("../helpers/spawn");
const { mineRepo, materialize } = require("../helpers/fixtures");
const { assertExit, assertFatal, assertStdout } = require("../helpers/assertions");

function staged(files) {
  const repo = mineRepo(files);
  runMine(["add", "-A"], { cwd: repo });
  return repo;
}

test("commit reports the branch and abbreviated SHA", () => {
  const repo = staged({ "a.txt": "a\n" });
  const res = runMine(["commit", "-m", "first commit"], { cwd: repo });
  assertExit(res, 0);
  assert.match(res.out, /^\[main \(root-commit\) [0-9a-f]{7}\] first commit\n$/);
});

test("a commit we write is readable by the real git binary", () => {
  const repo = staged({ "a.txt": "a\n" });
  runMine(["commit", "-m", "readable"], { cwd: repo });
  assertStdout(runGit(["log", "--format=%s"], { cwd: repo }), "readable\n");
});

test("the repository is clean after committing", () => {
  const repo = staged({ "a.txt": "a\n", "sub/b.txt": "b\n" });
  runMine(["commit", "-m", "clean"], { cwd: repo });
  assertStdout(runGit(["status", "--porcelain"], { cwd: repo }), "");
});

test("git fsck accepts a repository we committed into", () => {
  const repo = staged({ "a.txt": "a\n", "sub/deep/c.txt": "c\n" });
  runMine(["commit", "-m", "fsck me"], { cwd: repo });
  assertExit(runGit(["fsck"], { cwd: repo }), 0);
});

test("commit rebuilds nested trees from flat index paths", () => {
  const repo = staged({ "a.txt": "a\n", "sub/b.txt": "b\n", "sub/deep/c.txt": "c\n", "other/d.txt": "d\n" });
  runMine(["commit", "-m", "nested"], { cwd: repo });
  assertStdout(
    runGit(["ls-tree", "-r", "--name-only", "HEAD"], { cwd: repo }),
    "a.txt\nother/d.txt\nsub/b.txt\nsub/deep/c.txt\n",
  );
});

test("the tree we build matches the one git builds for the same index", () => {
  const files = { "a.txt": "a\n", "sub/b.txt": "b\n", "hello.c": "c\n", "hello/inner.txt": "i\n" };
  const mine = staged(files);
  runMine(["commit", "-m", "compare"], { cwd: mine });

  const theirs = mineRepo(files);
  git(["add", "-A"], { cwd: theirs });
  git(["commit", "-q", "-m", "compare"], { cwd: theirs });

  assert.strictEqual(
    runGit(["rev-parse", "HEAD^{tree}"], { cwd: mine }).out,
    git(["rev-parse", "HEAD^{tree}"], { cwd: theirs }).out,
  );
});

test("the first commit has no parent", () => {
  const repo = staged({ "a.txt": "a\n" });
  runMine(["commit", "-m", "root"], { cwd: repo });
  const body = runGit(["cat-file", "-p", "HEAD"], { cwd: repo });
  assert.ok(!/^parent /m.test(body.out), `a root commit must not have a parent:\n${body.out}`);
});

test("a later commit records the previous one as its parent", () => {
  const repo = staged({ "a.txt": "a\n" });
  runMine(["commit", "-m", "first"], { cwd: repo });
  const first = runGit(["rev-parse", "HEAD"], { cwd: repo }).out.trim();

  materialize(repo, { "b.txt": "b\n" });
  runMine(["add", "-A"], { cwd: repo });
  const res = runMine(["commit", "-m", "second"], { cwd: repo });
  assertExit(res, 0);

  assertStdout(runGit(["rev-parse", "HEAD^"], { cwd: repo }), `${first}\n`);
  assert.match(res.out, /^\[main [0-9a-f]{7}\] second\n$/);
});

test("commit advances the branch ref that HEAD points at", () => {
  const repo = staged({ "a.txt": "a\n" });
  runMine(["commit", "-m", "first"], { cwd: repo });
  git(["checkout", "-q", "-b", "feature"], { cwd: repo });

  materialize(repo, { "b.txt": "b\n" });
  runMine(["add", "-A"], { cwd: repo });
  runMine(["commit", "-m", "on feature"], { cwd: repo });

  assertStdout(runGit(["log", "--format=%s", "-n", "1", "feature"], { cwd: repo }), "on feature\n");
  assertStdout(runGit(["log", "--format=%s", "-n", "1", "main"], { cwd: repo }), "first\n");
});

test("commit preserves the executable bit and symlinks", () => {
  const repo = mineRepo({ "run.sh": "#!/bin/sh\n", "target.txt": "t\n" });
  fs.chmodSync(path.join(repo, "run.sh"), 0o755);
  fs.symlinkSync("target.txt", path.join(repo, "link.txt"));
  runMine(["add", "-A"], { cwd: repo });
  runMine(["commit", "-m", "modes"], { cwd: repo });

  const listing = runGit(["ls-tree", "HEAD"], { cwd: repo }).out;
  assert.match(listing, /^100755 blob [0-9a-f]{40}\trun\.sh$/m);
  assert.match(listing, /^120000 blob [0-9a-f]{40}\tlink\.txt$/m);
});

test("our own log can read a history we committed", () => {
  const repo = staged({ "a.txt": "a\n" });
  runMine(["commit", "-m", "first"], { cwd: repo });
  materialize(repo, { "a.txt": "changed\n" });
  runMine(["add", "-A"], { cwd: repo });
  runMine(["commit", "-m", "second"], { cwd: repo });

  assertStdout(runMine(["log", "--format=%s"], { cwd: repo }), "second\nfirst\n");
});

test("committing a deletion drops the path from the tree", () => {
  const repo = staged({ "a.txt": "a\n", "b.txt": "b\n" });
  runMine(["commit", "-m", "first"], { cwd: repo });

  fs.rmSync(path.join(repo, "b.txt"));
  runMine(["add", "-A"], { cwd: repo });
  runMine(["commit", "-m", "removed"], { cwd: repo });

  assertStdout(runGit(["ls-tree", "-r", "--name-only", "HEAD"], { cwd: repo }), "a.txt\n");
});

test("commit fails when the index is empty", () => {
  const repo = mineRepo();
  assertFatal(runMine(["commit", "-m", "nothing"], { cwd: repo }));
});

test("commit fails without a message", () => {
  const repo = staged({ "a.txt": "a\n" });
  const res = runMine(["commit"], { cwd: repo });
  assert.notStrictEqual(res.code, 0);
});
