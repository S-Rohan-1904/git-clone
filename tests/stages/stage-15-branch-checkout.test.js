"use strict";

// Stage 15: Branches and checkout
//
// checkout moves HEAD, rewrites the index and updates the working tree --
// adding what the target has, deleting what it does not. The refusal to run
// over uncommitted work is the part that matters; silently discarding a
// user's changes is the difference between a tool and a hazard.

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const { runMine, runGit, git } = require("../helpers/spawn");
const { mineRepo, materialize } = require("../helpers/fixtures");
const { linearRepo } = require("../helpers/history");
const { assertExit, assertFatal, assertStdout, assertMatchesGit } = require("../helpers/assertions");

test("branch lists the current branch with a marker", () => {
  const { repo } = linearRepo(2);
  assertMatchesGit(runMine(["branch"], { cwd: repo }), runGit(["branch"], { cwd: repo }));
});

test("branch lists several branches sorted by name", () => {
  const { repo, shas } = linearRepo(3);
  git(["branch", "zeta", shas[0]], { cwd: repo });
  git(["branch", "alpha", shas[1]], { cwd: repo });
  assertMatchesGit(runMine(["branch"], { cwd: repo }), runGit(["branch"], { cwd: repo }));
});

test("branch creates a branch at HEAD", () => {
  const { repo } = linearRepo(2);
  assertExit(runMine(["branch", "feature"], { cwd: repo }), 0);
  assertMatchesGit(runGit(["rev-parse", "feature"], { cwd: repo }), runGit(["rev-parse", "HEAD"], { cwd: repo }));
});

test("branch creates a branch at a given revision", () => {
  const { repo, shas } = linearRepo(3);
  runMine(["branch", "feature", "HEAD~1"], { cwd: repo });
  assertStdout(runGit(["rev-parse", "feature"], { cwd: repo }), `${shas[1]}\n`);
});

test("branch -d deletes a branch", () => {
  const { repo } = linearRepo(2);
  git(["branch", "doomed"], { cwd: repo });
  assertExit(runMine(["branch", "-d", "doomed"], { cwd: repo }), 0);
  assert.ok(!/doomed/.test(runGit(["branch"], { cwd: repo }).out));
});

test("branch refuses to create a branch that exists", () => {
  const { repo } = linearRepo(2);
  git(["branch", "feature"], { cwd: repo });
  assertFatal(runMine(["branch", "feature"], { cwd: repo }));
});

test("branch refuses to delete the checked out branch", () => {
  const { repo } = linearRepo(2);
  assertFatal(runMine(["branch", "-d", "main"], { cwd: repo }));
});

test("checkout -b creates a branch and switches to it", () => {
  const { repo } = linearRepo(2);
  assertExit(runMine(["checkout", "-b", "feature"], { cwd: repo }), 0);
  assertStdout(runGit(["symbolic-ref", "HEAD"], { cwd: repo }), "refs/heads/feature\n");
});

test("checkout switches HEAD to an existing branch", () => {
  const { repo } = linearRepo(2);
  git(["branch", "feature"], { cwd: repo });
  assertExit(runMine(["checkout", "feature"], { cwd: repo }), 0);
  assertStdout(runGit(["symbolic-ref", "HEAD"], { cwd: repo }), "refs/heads/feature\n");
});

test("checkout restores the working tree of the target branch", () => {
  const repo = mineRepo({ "shared.txt": "shared\n", "only-main.txt": "main\n" });
  git(["add", "-A"], { cwd: repo });
  git(["commit", "-q", "-m", "main commit"], { cwd: repo });

  git(["checkout", "-q", "-b", "feature"], { cwd: repo });
  fs.rmSync(path.join(repo, "only-main.txt"));
  materialize(repo, { "only-feature.txt": "feature\n", "shared.txt": "changed\n" });
  git(["add", "-A"], { cwd: repo });
  git(["commit", "-q", "-m", "feature commit"], { cwd: repo });

  assertExit(runMine(["checkout", "main"], { cwd: repo }), 0);

  assert.ok(fs.existsSync(path.join(repo, "only-main.txt")), "expected the main-only file to come back");
  assert.ok(!fs.existsSync(path.join(repo, "only-feature.txt")), "expected the feature-only file to be removed");
  assert.strictEqual(fs.readFileSync(path.join(repo, "shared.txt"), "utf8"), "shared\n");
});

test("the working tree is clean after checkout", () => {
  const repo = mineRepo({ "a.txt": "a\n", "sub/b.txt": "b\n" });
  git(["add", "-A"], { cwd: repo });
  git(["commit", "-q", "-m", "first"], { cwd: repo });
  git(["checkout", "-q", "-b", "feature"], { cwd: repo });
  materialize(repo, { "sub/c.txt": "c\n" });
  git(["add", "-A"], { cwd: repo });
  git(["commit", "-q", "-m", "second"], { cwd: repo });

  runMine(["checkout", "main"], { cwd: repo });
  assertStdout(runGit(["status", "--porcelain"], { cwd: repo }), "");
});

test("checkout removes directories left empty by the switch", () => {
  const repo = mineRepo({ "a.txt": "a\n" });
  git(["add", "-A"], { cwd: repo });
  git(["commit", "-q", "-m", "first"], { cwd: repo });
  git(["checkout", "-q", "-b", "feature"], { cwd: repo });
  materialize(repo, { "gone/deep/file.txt": "f\n" });
  git(["add", "-A"], { cwd: repo });
  git(["commit", "-q", "-m", "second"], { cwd: repo });

  runMine(["checkout", "main"], { cwd: repo });
  assert.ok(!fs.existsSync(path.join(repo, "gone")), "expected the emptied directory to be removed");
});

test("checkout restores the executable bit", () => {
  const repo = mineRepo({ "run.sh": "#!/bin/sh\n" });
  fs.chmodSync(path.join(repo, "run.sh"), 0o755);
  git(["add", "-A"], { cwd: repo });
  git(["commit", "-q", "-m", "first"], { cwd: repo });
  git(["checkout", "-q", "-b", "feature"], { cwd: repo });
  materialize(repo, { "other.txt": "o\n" });
  git(["add", "-A"], { cwd: repo });
  git(["commit", "-q", "-m", "second"], { cwd: repo });

  runMine(["checkout", "main"], { cwd: repo });
  assert.ok(fs.statSync(path.join(repo, "run.sh")).mode & 0o111, "expected run.sh to stay executable");
});

test("checkout refuses to discard an uncommitted modification", () => {
  const repo = mineRepo({ "a.txt": "a\n" });
  git(["add", "-A"], { cwd: repo });
  git(["commit", "-q", "-m", "first"], { cwd: repo });
  git(["branch", "feature"], { cwd: repo });
  materialize(repo, { "a.txt": "uncommitted work\n" });

  assertFatal(runMine(["checkout", "feature"], { cwd: repo }));
  assert.strictEqual(fs.readFileSync(path.join(repo, "a.txt"), "utf8"), "uncommitted work\n");
});

test("checkout detaches HEAD at a commit that is not a branch", () => {
  const { repo, shas } = linearRepo(3);
  assertExit(runMine(["checkout", shas[0]], { cwd: repo }), 0);
  assertStdout(runGit(["rev-parse", "HEAD"], { cwd: repo }), `${shas[0]}\n`);
});

test("checkout accepts a revision expression", () => {
  const { repo, shas } = linearRepo(3);
  assertExit(runMine(["checkout", "HEAD~2"], { cwd: repo }), 0);
  assertStdout(runGit(["rev-parse", "HEAD"], { cwd: repo }), `${shas[0]}\n`);
});

test("checkout fails for an unknown branch", () => {
  const { repo } = linearRepo(2);
  assertFatal(runMine(["checkout", "no-such-branch"], { cwd: repo }));
});

test("a commit lands on the branch we checked out", () => {
  const repo = mineRepo({ "a.txt": "a\n" });
  runMine(["add", "-A"], { cwd: repo });
  runMine(["commit", "-m", "first"], { cwd: repo });
  runMine(["checkout", "-b", "feature"], { cwd: repo });

  materialize(repo, { "b.txt": "b\n" });
  runMine(["add", "-A"], { cwd: repo });
  runMine(["commit", "-m", "on feature"], { cwd: repo });

  assertStdout(runGit(["log", "--format=%s", "-n", "1", "feature"], { cwd: repo }), "on feature\n");
  assertStdout(runGit(["log", "--format=%s", "-n", "1", "main"], { cwd: repo }), "first\n");
});
