"use strict";

// Stage 20: Merge
//
// Find the merge base -- the lowest common ancestor -- then compare base,
// ours and theirs three ways. Non-overlapping edits to the same file combine;
// overlapping ones produce conflict markers and a non-zero exit.

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const { runMine, runGit, git } = require("../helpers/spawn");
const { mineRepo, materialize } = require("../helpers/fixtures");
const { assertExit, assertFatal, assertStdout } = require("../helpers/assertions");

function numbered(count, replacements = {}) {
  return `${Array.from({ length: count }, (_, i) => replacements[i + 1] || String(i + 1)).join("\n")}\n`;
}

function commit(repo, files, message) {
  materialize(repo, files);
  git(["add", "-A"], { cwd: repo });
  git(["commit", "-q", "-m", message], { cwd: repo });
}

// A repository whose main and side branches have both moved on from a shared
// base commit.
function diverged({ base, ours, theirs }) {
  const repo = mineRepo();
  commit(repo, base, "base commit");
  git(["checkout", "-q", "-b", "side"], { cwd: repo });
  commit(repo, theirs, "side commit");
  git(["checkout", "-q", "main"], { cwd: repo });
  commit(repo, ours, "main commit");
  return repo;
}

function read(repo, name) {
  return fs.readFileSync(path.join(repo, name), "utf8");
}

test("merge reports when the branch is already an ancestor", () => {
  const repo = mineRepo();
  commit(repo, { "a.txt": "a\n" }, "first");
  git(["branch", "behind"], { cwd: repo });
  commit(repo, { "a.txt": "b\n" }, "second");

  const res = runMine(["merge", "behind"], { cwd: repo });
  assertExit(res, 0);
  assert.match(res.out, /Already up to date/);
});

test("merge fast-forwards when our branch has not moved", () => {
  const repo = mineRepo();
  commit(repo, { "a.txt": "a\n" }, "first");
  git(["checkout", "-q", "-b", "ahead"], { cwd: repo });
  commit(repo, { "a.txt": "b\n", "added.txt": "new\n" }, "second");
  git(["checkout", "-q", "main"], { cwd: repo });

  const res = runMine(["merge", "ahead"], { cwd: repo });
  assertExit(res, 0);
  assert.match(res.out, /Fast-forward/);
  assertStdout(runGit(["rev-parse", "main"], { cwd: repo }), runGit(["rev-parse", "ahead"], { cwd: repo }).out);
});

test("a fast-forward updates the working tree", () => {
  const repo = mineRepo();
  commit(repo, { "a.txt": "a\n" }, "first");
  git(["checkout", "-q", "-b", "ahead"], { cwd: repo });
  commit(repo, { "a.txt": "changed\n", "added.txt": "new\n" }, "second");
  git(["checkout", "-q", "main"], { cwd: repo });

  runMine(["merge", "ahead"], { cwd: repo });

  assert.strictEqual(read(repo, "a.txt"), "changed\n");
  assert.ok(fs.existsSync(path.join(repo, "added.txt")), "expected the new file to appear");
  assertStdout(runGit(["status", "--porcelain"], { cwd: repo }), "");
});

test("merge combines changes to different files", () => {
  const repo = diverged({
    base: { "a.txt": "a\n", "b.txt": "b\n" },
    ours: { "a.txt": "ours\n" },
    theirs: { "b.txt": "theirs\n" },
  });

  assertExit(runMine(["merge", "side"], { cwd: repo }), 0);
  assert.strictEqual(read(repo, "a.txt"), "ours\n");
  assert.strictEqual(read(repo, "b.txt"), "theirs\n");
});

test("merge combines non-overlapping changes within one file", () => {
  const repo = diverged({
    base: { "a.txt": numbered(20) },
    ours: { "a.txt": numbered(20, { 2: "OURS" }) },
    theirs: { "a.txt": numbered(20, { 18: "THEIRS" }) },
  });

  assertExit(runMine(["merge", "side"], { cwd: repo }), 0);
  assert.strictEqual(read(repo, "a.txt"), numbered(20, { 2: "OURS", 18: "THEIRS" }));
});

test("the merge commit has both branches as parents", () => {
  const repo = diverged({
    base: { "a.txt": "a\n", "b.txt": "b\n" },
    ours: { "a.txt": "ours\n" },
    theirs: { "b.txt": "theirs\n" },
  });
  const ours = runGit(["rev-parse", "main"], { cwd: repo }).out.trim();
  const theirs = runGit(["rev-parse", "side"], { cwd: repo }).out.trim();

  runMine(["merge", "side"], { cwd: repo });

  assertStdout(runGit(["rev-parse", "HEAD^1"], { cwd: repo }), `${ours}\n`);
  assertStdout(runGit(["rev-parse", "HEAD^2"], { cwd: repo }), `${theirs}\n`);
});

test("the repository is clean and healthy after a merge", () => {
  const repo = diverged({
    base: { "a.txt": "a\n", "b.txt": "b\n" },
    ours: { "a.txt": "ours\n" },
    theirs: { "b.txt": "theirs\n" },
  });

  runMine(["merge", "side"], { cwd: repo });

  assertStdout(runGit(["status", "--porcelain"], { cwd: repo }), "");
  assertExit(runGit(["fsck"], { cwd: repo }), 0);
});

test("merge brings across a file added only on the other branch", () => {
  const repo = diverged({
    base: { "a.txt": "a\n" },
    ours: { "ours-only.txt": "o\n" },
    theirs: { "theirs-only.txt": "t\n" },
  });

  assertExit(runMine(["merge", "side"], { cwd: repo }), 0);
  assert.ok(fs.existsSync(path.join(repo, "ours-only.txt")));
  assert.ok(fs.existsSync(path.join(repo, "theirs-only.txt")));
});

test("merge applies a deletion made on the other branch", () => {
  const repo = mineRepo();
  commit(repo, { "a.txt": "a\n", "doomed.txt": "d\n" }, "base commit");
  git(["checkout", "-q", "-b", "side"], { cwd: repo });
  fs.rmSync(path.join(repo, "doomed.txt"));
  git(["add", "-A"], { cwd: repo });
  git(["commit", "-q", "-m", "delete on side"], { cwd: repo });
  git(["checkout", "-q", "main"], { cwd: repo });
  commit(repo, { "a.txt": "changed\n" }, "main commit");

  assertExit(runMine(["merge", "side"], { cwd: repo }), 0);
  assert.ok(!fs.existsSync(path.join(repo, "doomed.txt")), "expected the deletion to carry over");
});

test("merge accepts identical changes made on both branches", () => {
  const repo = diverged({
    base: { "a.txt": "a\n", "b.txt": "b\n" },
    ours: { "a.txt": "same change\n" },
    theirs: { "a.txt": "same change\n", "b.txt": "theirs\n" },
  });

  assertExit(runMine(["merge", "side"], { cwd: repo }), 0);
  assert.strictEqual(read(repo, "a.txt"), "same change\n");
});

test("overlapping edits conflict and exit non-zero", () => {
  const repo = diverged({
    base: { "a.txt": numbered(10) },
    ours: { "a.txt": numbered(10, { 5: "OURS" }) },
    theirs: { "a.txt": numbered(10, { 5: "THEIRS" }) },
  });

  const res = runMine(["merge", "side"], { cwd: repo });
  assert.strictEqual(res.code, 1);
  assert.match(res.out, /CONFLICT \(content\): Merge conflict in a\.txt/);
});

test("a conflicted file carries conflict markers", () => {
  const repo = diverged({
    base: { "a.txt": numbered(10) },
    ours: { "a.txt": numbered(10, { 5: "OURS" }) },
    theirs: { "a.txt": numbered(10, { 5: "THEIRS" }) },
  });

  runMine(["merge", "side"], { cwd: repo });

  const content = read(repo, "a.txt");
  assert.match(content, /^<<<<<<< HEAD$/m);
  assert.match(content, /^OURS$/m);
  assert.match(content, /^=======$/m);
  assert.match(content, /^THEIRS$/m);
  assert.match(content, /^>>>>>>> side$/m);
});

test("a conflict leaves the unconflicted parts of the file intact", () => {
  const repo = diverged({
    base: { "a.txt": numbered(10) },
    ours: { "a.txt": numbered(10, { 5: "OURS" }) },
    theirs: { "a.txt": numbered(10, { 5: "THEIRS" }) },
  });

  runMine(["merge", "side"], { cwd: repo });

  const content = read(repo, "a.txt");
  assert.match(content, /^1$/m);
  assert.match(content, /^10$/m);
});

test("a conflict does not create a merge commit", () => {
  const repo = diverged({
    base: { "a.txt": numbered(10) },
    ours: { "a.txt": numbered(10, { 5: "OURS" }) },
    theirs: { "a.txt": numbered(10, { 5: "THEIRS" }) },
  });
  const before = runGit(["rev-parse", "HEAD"], { cwd: repo }).out;

  runMine(["merge", "side"], { cwd: repo });

  assert.strictEqual(runGit(["rev-parse", "HEAD"], { cwd: repo }).out, before);
});

test("one conflicting file does not block the others from merging", () => {
  const repo = diverged({
    base: { "clash.txt": numbered(6), "clean.txt": "base\n" },
    ours: { "clash.txt": numbered(6, { 3: "OURS" }) },
    theirs: { "clash.txt": numbered(6, { 3: "THEIRS" }), "clean.txt": "theirs\n" },
  });

  runMine(["merge", "side"], { cwd: repo });

  assert.strictEqual(read(repo, "clean.txt"), "theirs\n");
  assert.match(read(repo, "clash.txt"), /<<<<<<< HEAD/);
});

test("merge finds the base across several commits on each branch", () => {
  const repo = mineRepo();
  commit(repo, { "a.txt": numbered(30), "b.txt": "b\n" }, "base commit");
  git(["checkout", "-q", "-b", "side"], { cwd: repo });
  commit(repo, { "b.txt": "side one\n" }, "side one");
  commit(repo, { "b.txt": "side two\n" }, "side two");
  git(["checkout", "-q", "main"], { cwd: repo });
  commit(repo, { "a.txt": numbered(30, { 1: "MAIN" }) }, "main one");
  commit(repo, { "a.txt": numbered(30, { 1: "MAIN", 2: "AGAIN" }) }, "main two");

  assertExit(runMine(["merge", "side"], { cwd: repo }), 0);
  assert.strictEqual(read(repo, "b.txt"), "side two\n");
  assert.strictEqual(read(repo, "a.txt"), numbered(30, { 1: "MAIN", 2: "AGAIN" }));
});

test("merge accepts a revision expression rather than a branch name", () => {
  const repo = diverged({
    base: { "a.txt": "a\n", "b.txt": "b\n" },
    ours: { "a.txt": "ours\n" },
    theirs: { "b.txt": "theirs\n" },
  });

  assertExit(runMine(["merge", "side^0"], { cwd: repo }), 0);
});

test("merge refuses unrelated histories", () => {
  const repo = mineRepo();
  commit(repo, { "a.txt": "a\n" }, "first");
  const orphan = git(["commit-tree", `${runGit(["rev-parse", "HEAD^{tree}"], { cwd: repo }).out.trim()}`, "-m", "orphan"], {
    cwd: repo,
  }).out.trim();
  runMine(["update-ref", "refs/heads/unrelated", orphan], { cwd: repo });
  commit(repo, { "a.txt": "changed\n" }, "second");

  assertFatal(runMine(["merge", "unrelated"], { cwd: repo }));
});

test("merge fails without a revision", () => {
  const repo = mineRepo();
  commit(repo, { "a.txt": "a\n" }, "first");
  const res = runMine(["merge"], { cwd: repo });
  assert.notStrictEqual(res.code, 0);
});

test("git can read a history we merged", () => {
  const repo = diverged({
    base: { "a.txt": "a\n", "b.txt": "b\n" },
    ours: { "a.txt": "ours\n" },
    theirs: { "b.txt": "theirs\n" },
  });

  runMine(["merge", "side"], { cwd: repo });

  const log = runGit(["log", "--format=%s"], { cwd: repo });
  assertExit(log, 0);
  assert.match(log.out, /Merge commit/);
  assert.match(log.out, /side commit/);
  assert.match(log.out, /main commit/);
});
