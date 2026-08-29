"use strict";

// Stage 5: Write a tree object
//
// `write-tree` snapshots the working directory into a tree object. There is no
// index at this stage, so the working directory is the source of truth. The
// oracle is a parallel repository where the real git binary stages the same
// files and writes the tree itself; matching SHAs means the encoding, the
// entry ordering and the mode bits are all correct.

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const { runMine, runGit, git } = require("../helpers/spawn");
const { mineRepo, oracleRepo, materialize, readObject, objectExists } = require("../helpers/fixtures");
const { assertExit, assertStdout } = require("../helpers/assertions");

// Writes the same files into our repository and a git-managed one, then
// returns our write-tree result alongside git's.
function compareTrees(files, mutate) {
  const mine = mineRepo(files);
  const oracle = oracleRepo(files);
  if (mutate) {
    mutate(mine);
    mutate(oracle);
  }
  git(["add", "-A"], { cwd: oracle });
  return {
    mine,
    oracle,
    ours: runMine(["write-tree"], { cwd: mine }),
    theirs: git(["write-tree"], { cwd: oracle }),
  };
}

test("write-tree prints a 40 character SHA", () => {
  const repo = mineRepo({ "a.txt": "a\n" });
  const res = runMine(["write-tree"], { cwd: repo });
  assertExit(res, 0);
  assert.match(res.out, /^[0-9a-f]{40}\n$/, "expected a single 40 character SHA followed by a newline");
});

test("write-tree of a flat directory matches the real git binary", () => {
  const { ours, theirs } = compareTrees({ "a.txt": "a\n", "b.txt": "b\n", "c.txt": "c\n" });
  assertExit(ours, 0);
  assert.strictEqual(ours.out, theirs.out, "tree SHA differs from the one git computed");
});

test("write-tree of nested directories matches the real git binary", () => {
  const { ours, theirs } = compareTrees({
    "root.txt": "r\n",
    "sub/one.txt": "1\n",
    "sub/two.txt": "2\n",
    "sub/deeper/three.txt": "3\n",
    "other/four.txt": "4\n",
  });
  assertExit(ours, 0);
  assert.strictEqual(ours.out, theirs.out, "tree SHA differs from the one git computed");
});

test("write-tree sorts entries the way git does, treating trees as name + slash", () => {
  // "hello.c" sorts before "hello/" because '.' (0x2e) precedes '/' (0x2f),
  // so a naive sort on the bare names produces the wrong tree.
  const { ours, theirs } = compareTrees({ "hello.c": "c\n", "hello/inner.txt": "i\n", "hello-world.txt": "w\n" });
  assertExit(ours, 0);
  assert.strictEqual(ours.out, theirs.out, "entries are not ordered the way git orders them");
});

test("write-tree records executable files with mode 100755", () => {
  const { ours, theirs } = compareTrees({ "script.sh": "#!/bin/sh\n", "plain.txt": "p\n" }, (repo) => {
    fs.chmodSync(path.join(repo, "script.sh"), 0o755);
  });
  assertExit(ours, 0);
  assert.strictEqual(ours.out, theirs.out, "executable bit is not reflected in the tree entry mode");
});

test("write-tree ignores the .git directory", () => {
  const { mine, ours, theirs } = compareTrees({ "tracked.txt": "t\n" });
  assertExit(ours, 0);
  assert.strictEqual(ours.out, theirs.out, ".git appears to have been included in the tree");
  const listing = runGit(["ls-tree", "-r", "--name-only", ours.out.trim()], { cwd: mine });
  assert.ok(!/\.git/.test(listing.out), `tree contains .git entries:\n${listing.out}`);
});

test("write-tree skips empty directories, which git cannot represent", () => {
  const repo = mineRepo({ "kept.txt": "k\n" });
  fs.mkdirSync(path.join(repo, "empty"), { recursive: true });
  const withEmpty = runMine(["write-tree"], { cwd: repo });
  assertExit(withEmpty, 0);

  const oracle = oracleRepo({ "kept.txt": "k\n" });
  fs.mkdirSync(path.join(oracle, "empty"), { recursive: true });
  git(["add", "-A"], { cwd: oracle });
  assert.strictEqual(withEmpty.out, git(["write-tree"], { cwd: oracle }).out);
});

test("write-tree stores entry SHAs as 20 raw bytes, not as hex text", () => {
  const repo = mineRepo({ "a.txt": "a\n" });
  const sha = runMine(["write-tree"], { cwd: repo }).out.trim();
  const tree = readObject(repo, sha);
  assert.strictEqual(tree.type, "tree");
  const nul = tree.body.indexOf(0);
  const entry = tree.body.subarray(0, nul).toString("utf8");
  assert.strictEqual(entry, "100644 a.txt", `unexpected first entry header ${JSON.stringify(entry)}`);
  assert.strictEqual(
    tree.body.length - nul - 1,
    20,
    "expected exactly 20 bytes of SHA after the entry name, so the SHA is stored in binary form",
  );
});

test("write-tree records directory entries with mode 40000, without a leading zero", () => {
  const repo = mineRepo({ "sub/inner.txt": "i\n" });
  const sha = runMine(["write-tree"], { cwd: repo }).out.trim();
  const tree = readObject(repo, sha);
  const header = tree.body.subarray(0, tree.body.indexOf(0)).toString("utf8");
  assert.strictEqual(header, "40000 sub", `unexpected entry header ${JSON.stringify(header)}`);
});

test("write-tree writes every blob and subtree into .git/objects", () => {
  const repo = mineRepo({ "root.txt": "r\n", "sub/inner.txt": "i\n" });
  const sha = runMine(["write-tree"], { cwd: repo }).out.trim();
  const listing = runGit(["ls-tree", "-r", "-t", sha], { cwd: repo });
  assertExit(listing, 0);
  const shas = listing.out.trim().split("\n").map((line) => line.split(/\s+/)[2]);
  assert.ok(shas.length >= 3, `expected at least a subtree and two blobs, got ${shas.length} objects`);
  for (const objectSha of shas) {
    assert.ok(objectExists(repo, objectSha), `object ${objectSha} referenced by the tree was never written`);
  }
});

test("the tree we write is readable by the real git binary", () => {
  const repo = mineRepo({ "root.txt": "r\n", "sub/inner.txt": "i\n" });
  const sha = runMine(["write-tree"], { cwd: repo }).out.trim();
  const res = runGit(["ls-tree", "-r", "--name-only", sha], { cwd: repo });
  assertExit(res, 0);
  assert.strictEqual(res.out, "root.txt\nsub/inner.txt\n");
});

test("our own ls-tree can read the tree we wrote", () => {
  const repo = mineRepo({ "a.txt": "a\n", "sub/b.txt": "b\n" });
  const sha = runMine(["write-tree"], { cwd: repo }).out.trim();
  assertStdout(runMine(["ls-tree", "--name-only", sha], { cwd: repo }), "a.txt\nsub\n");
});

test("write-tree of an empty repository matches git's empty tree", () => {
  const repo = mineRepo();
  const res = runMine(["write-tree"], { cwd: repo });
  assertStdout(res, "4b825dc642cb6eb9a060e54bf8d69288fbee4904\n");
});

test("write-tree handles filenames containing spaces", () => {
  const { ours, theirs } = compareTrees({ "with space.txt": "s\n", "another one.txt": "a\n" });
  assertExit(ours, 0);
  assert.strictEqual(ours.out, theirs.out);
});

test("write-tree handles binary file contents", () => {
  const payload = Buffer.from([0, 1, 2, 255, 254, 0, 10, 13, 128]);
  const { ours, theirs } = compareTrees({ "data.bin": payload });
  assertExit(ours, 0);
  assert.strictEqual(ours.out, theirs.out);
});

test("write-tree is deterministic across repeated runs", () => {
  const repo = mineRepo({ "a.txt": "a\n", "sub/b.txt": "b\n" });
  const first = runMine(["write-tree"], { cwd: repo });
  const second = runMine(["write-tree"], { cwd: repo });
  assertExit(first, 0);
  assert.strictEqual(first.out, second.out, "two runs over an unchanged working tree produced different SHAs");
});

test("write-tree runs from a subdirectory and still snapshots the repository root", () => {
  const repo = mineRepo({ "root.txt": "r\n", "sub/inner.txt": "i\n" });
  const fromRoot = runMine(["write-tree"], { cwd: repo });
  const fromSub = runMine(["write-tree"], { cwd: path.join(repo, "sub") });
  assertExit(fromSub, 0);
  assert.strictEqual(fromSub.out, fromRoot.out, "write-tree should always snapshot the repository root");
});

test("write-tree reflects a change to a file", () => {
  const repo = mineRepo({ "a.txt": "before\n" });
  const before = runMine(["write-tree"], { cwd: repo }).out.trim();
  materialize(repo, { "a.txt": "after\n" });
  const after = runMine(["write-tree"], { cwd: repo }).out.trim();
  assert.notStrictEqual(before, after, "the tree SHA did not change after the file changed");
});
