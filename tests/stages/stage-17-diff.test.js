"use strict";

// Stage 17: Diff
//
// The first real algorithm in the project: Myers' shortest edit script, then
// grouping that script into hunks with three lines of context. Output is
// compared to `git diff` byte for byte, so hunk headers, context bounds and
// the no-trailing-newline marker all have to be exactly right.

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const { runMine, runGit, git } = require("../helpers/spawn");
const { mineRepo, materialize, binaryBlob } = require("../helpers/fixtures");
const { assertExit, assertMatchesGit } = require("../helpers/assertions");

function committed(files) {
  const repo = mineRepo(files);
  git(["add", "-A"], { cwd: repo });
  git(["commit", "-q", "-m", "initial"], { cwd: repo });
  return repo;
}

function bothDiff(repo, args = []) {
  assertMatchesGit(runMine(["diff", ...args], { cwd: repo }), runGit(["diff", ...args], { cwd: repo }));
}

function numbered(count, replacements = {}) {
  return `${Array.from({ length: count }, (_, i) => replacements[i + 1] || String(i + 1)).join("\n")}\n`;
}

test("diff prints nothing for a clean tree", () => {
  const repo = committed({ "a.txt": "a\n" });
  const res = runMine(["diff"], { cwd: repo });
  assertExit(res, 0);
  assert.strictEqual(res.out, "");
});

test("diff reports a single changed line", () => {
  const repo = committed({ "a.txt": "one\ntwo\nthree\n" });
  materialize(repo, { "a.txt": "one\nCHANGED\nthree\n" });
  bothDiff(repo);
});

test("diff includes three lines of context", () => {
  const repo = committed({ "a.txt": numbered(20) });
  materialize(repo, { "a.txt": numbered(20, { 10: "CHANGED" }) });
  bothDiff(repo);
});

test("diff emits separate hunks for distant changes", () => {
  const repo = committed({ "a.txt": numbered(40) });
  materialize(repo, { "a.txt": numbered(40, { 5: "FIRST", 30: "SECOND" }) });
  bothDiff(repo);
});

test("diff merges changes that are closer than twice the context", () => {
  const repo = committed({ "a.txt": numbered(20) });
  materialize(repo, { "a.txt": numbered(20, { 8: "NEAR", 11: "ALSO NEAR" }) });
  bothDiff(repo);
});

test("diff handles a pure insertion", () => {
  const repo = committed({ "a.txt": "one\ntwo\nthree\n" });
  materialize(repo, { "a.txt": "one\ntwo\ninserted\nthree\n" });
  bothDiff(repo);
});

test("diff handles a pure deletion", () => {
  const repo = committed({ "a.txt": "one\ntwo\nthree\nfour\n" });
  materialize(repo, { "a.txt": "one\nfour\n" });
  bothDiff(repo);
});

test("diff handles appending to the end of a file", () => {
  const repo = committed({ "a.txt": numbered(10) });
  materialize(repo, { "a.txt": `${numbered(10)}appended\n` });
  bothDiff(repo);
});

test("diff handles a file becoming empty", () => {
  const repo = committed({ "a.txt": "one\ntwo\n" });
  materialize(repo, { "a.txt": "" });
  bothDiff(repo);
});

test("diff reports a deleted file", () => {
  const repo = committed({ "a.txt": "a\n", "gone.txt": "gone\n" });
  fs.rmSync(path.join(repo, "gone.txt"));
  bothDiff(repo);
});

test("diff reports a staged new file with --cached", () => {
  const repo = committed({ "a.txt": "a\n" });
  materialize(repo, { "new.txt": "brand new\n" });
  git(["add", "new.txt"], { cwd: repo });
  bothDiff(repo, ["--cached"]);
});

test("diff --cached compares the index against HEAD", () => {
  const repo = committed({ "a.txt": "one\ntwo\n" });
  materialize(repo, { "a.txt": "one\nstaged\n" });
  git(["add", "a.txt"], { cwd: repo });
  materialize(repo, { "a.txt": "one\nstaged then changed again\n" });
  bothDiff(repo, ["--cached"]);
  bothDiff(repo);
});

test("diff against a revision compares the working tree to that commit", () => {
  const repo = committed({ "a.txt": "one\ntwo\n" });
  materialize(repo, { "a.txt": "one\nchanged\n" });
  git(["add", "-A"], { cwd: repo });
  bothDiff(repo, ["HEAD"]);
});

test("diff between two commits", () => {
  const repo = committed({ "a.txt": numbered(12) });
  materialize(repo, { "a.txt": numbered(12, { 4: "CHANGED" }), "added.txt": "new\n" });
  git(["add", "-A"], { cwd: repo });
  git(["commit", "-q", "-m", "second"], { cwd: repo });
  bothDiff(repo, ["HEAD~1", "HEAD"]);
});

test("diff marks a missing trailing newline", () => {
  const repo = committed({ "a.txt": "no trailing newline" });
  materialize(repo, { "a.txt": "no trailing newline at all" });
  bothDiff(repo);
});

test("diff marks a file that gains a trailing newline", () => {
  const repo = committed({ "a.txt": "line" });
  materialize(repo, { "a.txt": "line\n" });
  bothDiff(repo);
});

test("diff reports a mode change", () => {
  const repo = committed({ "run.sh": "#!/bin/sh\n" });
  fs.chmodSync(path.join(repo, "run.sh"), 0o755);
  bothDiff(repo);
});

test("diff reports binary files without a patch body", () => {
  const repo = committed({ "data.bin": binaryBlob(3, 512) });
  materialize(repo, { "data.bin": binaryBlob(9, 512) });
  bothDiff(repo);
});

test("diff covers several files, sorted by path", () => {
  const repo = committed({ "z.txt": "z\n", "a.txt": "a\n", "sub/m.txt": "m\n" });
  materialize(repo, { "z.txt": "changed z\n", "a.txt": "changed a\n", "sub/m.txt": "changed m\n" });
  bothDiff(repo);
});

test("diff ignores untracked files", () => {
  const repo = committed({ "a.txt": "a\n" });
  materialize(repo, { "untracked.txt": "u\n" });
  const res = runMine(["diff"], { cwd: repo });
  assertExit(res, 0);
  assert.strictEqual(res.out, "");
});

test("diff handles a file whose lines were entirely replaced", () => {
  const repo = committed({ "a.txt": "alpha\nbeta\ngamma\n" });
  materialize(repo, { "a.txt": "one\ntwo\nthree\n" });
  bothDiff(repo);
});

test("diff finds the minimal edit script for a reordering", () => {
  const repo = committed({ "a.txt": "a\nb\nc\nd\ne\nf\n" });
  materialize(repo, { "a.txt": "a\nc\nb\nd\nf\ne\n" });
  bothDiff(repo);
});
