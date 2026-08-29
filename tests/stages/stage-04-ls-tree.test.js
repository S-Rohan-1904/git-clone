"use strict";

// Stage 4: Read a tree object
//
// A tree object is a sequence of `<mode> <name>\0<20 raw SHA bytes>` records.
// The trees under test are produced by the real git binary, so the parser has
// to cope with genuine encoding rather than a convenient approximation.

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const { runMine, runGit, git } = require("../helpers/spawn");
const { mineRepo, materialize } = require("../helpers/fixtures");
const { assertExit, assertFatal, assertStdout, assertMatchesGit } = require("../helpers/assertions");

// Builds a tree in `repo` from its working directory using the real git
// binary, and returns the tree SHA.
function seedTree(repo, files) {
  materialize(repo, files);
  git(["add", "-A"], { cwd: repo });
  return git(["write-tree"], { cwd: repo }).out.trim();
}

test("ls-tree --name-only prints one entry name per line", () => {
  const repo = mineRepo();
  const tree = seedTree(repo, { "banana.txt": "b\n", "apple.txt": "a\n", "cherry.txt": "c\n" });
  assertStdout(runMine(["ls-tree", "--name-only", tree], { cwd: repo }), "apple.txt\nbanana.txt\ncherry.txt\n");
});

test("ls-tree --name-only lists directories without recursing into them", () => {
  const repo = mineRepo();
  const tree = seedTree(repo, { "root.txt": "r\n", "sub/nested.txt": "n\n", "sub/deep/deeper.txt": "d\n" });
  assertStdout(runMine(["ls-tree", "--name-only", tree], { cwd: repo }), "root.txt\nsub\n");
});

test("ls-tree --name-only matches the real git binary", () => {
  const repo = mineRepo();
  const tree = seedTree(repo, {
    "a.txt": "a\n",
    "hello.c": "c\n",
    "hello/inner.txt": "i\n",
    "zzz/last.txt": "z\n",
  });
  assertMatchesGit(
    runMine(["ls-tree", "--name-only", tree], { cwd: repo }),
    runGit(["ls-tree", "--name-only", tree], { cwd: repo }),
  );
});

test("ls-tree without --name-only prints mode, type, SHA and name", () => {
  const repo = mineRepo();
  const tree = seedTree(repo, { "file.txt": "f\n", "dir/inner.txt": "i\n" });
  assertMatchesGit(runMine(["ls-tree", tree], { cwd: repo }), runGit(["ls-tree", tree], { cwd: repo }));
});

test("ls-tree separates the name from the SHA with a tab", () => {
  const repo = mineRepo();
  const tree = seedTree(repo, { "tabbed.txt": "t\n" });
  const res = runMine(["ls-tree", tree], { cwd: repo });
  assertExit(res, 0);
  assert.match(res.out, /^100644 blob [0-9a-f]{40}\ttabbed\.txt\n$/);
});

test("ls-tree reports directories with mode 040000 and type tree", () => {
  const repo = mineRepo();
  const tree = seedTree(repo, { "dir/inner.txt": "i\n" });
  const res = runMine(["ls-tree", tree], { cwd: repo });
  assertExit(res, 0);
  assert.match(res.out, /^040000 tree [0-9a-f]{40}\tdir\n$/);
});

test("ls-tree reports an executable file with mode 100755", () => {
  const repo = mineRepo();
  materialize(repo, { "script.sh": "#!/bin/sh\n" });
  fs.chmodSync(path.join(repo, "script.sh"), 0o755);
  git(["add", "-A"], { cwd: repo });
  const tree = git(["write-tree"], { cwd: repo }).out.trim();
  const res = runMine(["ls-tree", tree], { cwd: repo });
  assertExit(res, 0);
  assert.match(res.out, /^100755 blob [0-9a-f]{40}\tscript\.sh\n$/);
});

test("ls-tree reports a symlink with mode 120000", () => {
  const repo = mineRepo();
  materialize(repo, { "target.txt": "t\n" });
  fs.symlinkSync("target.txt", path.join(repo, "link.txt"));
  git(["add", "-A"], { cwd: repo });
  const tree = git(["write-tree"], { cwd: repo }).out.trim();
  const res = runMine(["ls-tree", tree], { cwd: repo });
  assertExit(res, 0);
  assert.match(res.out, /^120000 blob [0-9a-f]{40}\tlink\.txt$/m);
});

test("ls-tree handles a tree with a single entry", () => {
  const repo = mineRepo();
  const tree = seedTree(repo, { "only.txt": "o\n" });
  assertStdout(runMine(["ls-tree", "--name-only", tree], { cwd: repo }), "only.txt\n");
});

test("ls-tree handles filenames containing spaces", () => {
  const repo = mineRepo();
  const tree = seedTree(repo, { "with space.txt": "s\n" });
  assertStdout(runMine(["ls-tree", "--name-only", tree], { cwd: repo }), "with space.txt\n");
});

test("cat-file -t reports a tree object as a tree", () => {
  const repo = mineRepo();
  const tree = seedTree(repo, { "typed.txt": "t\n" });
  assertStdout(runMine(["cat-file", "-t", tree], { cwd: repo }), "tree\n");
});

test("cat-file -p on a tree prints the same listing as ls-tree", () => {
  const repo = mineRepo();
  const tree = seedTree(repo, { "one.txt": "1\n", "dir/two.txt": "2\n" });
  assertMatchesGit(runMine(["cat-file", "-p", tree], { cwd: repo }), runGit(["cat-file", "-p", tree], { cwd: repo }));
});

test("ls-tree accepts an abbreviated tree name", () => {
  const repo = mineRepo();
  const tree = seedTree(repo, { "abbrev.txt": "a\n" });
  assertStdout(runMine(["ls-tree", "--name-only", tree.slice(0, 6)], { cwd: repo }), "abbrev.txt\n");
});

test("ls-tree works from a subdirectory of the repository", () => {
  const repo = mineRepo();
  const tree = seedTree(repo, { "root.txt": "r\n", "sub/inner.txt": "i\n" });
  assertStdout(runMine(["ls-tree", "--name-only", tree], { cwd: path.join(repo, "sub") }), "root.txt\nsub\n");
});

test("ls-tree fails with exit code 128 for a missing object", () => {
  const repo = mineRepo();
  assertFatal(runMine(["ls-tree", "--name-only", "0".repeat(40)], { cwd: repo }));
});

test("ls-tree fails with exit code 128 when given a blob", () => {
  const repo = mineRepo({ "blob.txt": "not a tree\n" });
  const blob = git(["hash-object", "-w", "blob.txt"], { cwd: repo }).out.trim();
  assertFatal(runMine(["ls-tree", "--name-only", blob], { cwd: repo }), /not a tree/i);
});
