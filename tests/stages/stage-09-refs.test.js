"use strict";

// Stage 9: References
//
// Refs live in two places. Loose refs are files under .git/refs; packed refs
// are lines in .git/packed-refs, which is where a repository cloned by real
// git keeps almost all of them. Reading only the first place means seeing an
// empty branch list on most real repositories.

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const { runMine, runGit, git } = require("../helpers/spawn");
const { linearRepo } = require("../helpers/history");
const { assertExit, assertFatal, assertStdout, assertMatchesGit } = require("../helpers/assertions");

test("show-ref lists a branch", () => {
  const { repo } = linearRepo(2);
  assertMatchesGit(runMine(["show-ref"], { cwd: repo }), runGit(["show-ref"], { cwd: repo }));
});

test("show-ref lists branches and tags together, sorted by name", () => {
  const { repo, shas } = linearRepo(3);
  git(["branch", "feature", shas[0]], { cwd: repo });
  git(["branch", "another", shas[1]], { cwd: repo });
  git(["tag", "v1", shas[1]], { cwd: repo });

  assertMatchesGit(runMine(["show-ref"], { cwd: repo }), runGit(["show-ref"], { cwd: repo }));
});

test("show-ref reads refs out of .git/packed-refs", () => {
  const { repo, shas } = linearRepo(3);
  git(["branch", "feature", shas[0]], { cwd: repo });
  git(["tag", "v1", shas[1]], { cwd: repo });
  git(["pack-refs", "--all"], { cwd: repo });

  assert.ok(fs.existsSync(path.join(repo, ".git", "packed-refs")), "expected git to have packed the refs");
  assertMatchesGit(runMine(["show-ref"], { cwd: repo }), runGit(["show-ref"], { cwd: repo }));
});

test("a loose ref shadows a packed ref of the same name", () => {
  const { repo, shas } = linearRepo(3);
  git(["pack-refs", "--all"], { cwd: repo });
  fs.mkdirSync(path.join(repo, ".git", "refs", "heads"), { recursive: true });
  fs.writeFileSync(path.join(repo, ".git", "refs", "heads", "main"), `${shas[0]}\n`);

  assertStdout(runMine(["rev-parse", "main"], { cwd: repo }), `${shas[0]}\n`);
});

test("revisions resolve against packed refs", () => {
  const { repo, shas } = linearRepo(3);
  git(["branch", "feature", shas[0]], { cwd: repo });
  git(["pack-refs", "--all"], { cwd: repo });

  assertStdout(runMine(["rev-parse", "feature"], { cwd: repo }), `${shas[0]}\n`);
});

test("show-ref --head includes HEAD", () => {
  const { repo } = linearRepo(2);
  assertMatchesGit(runMine(["show-ref", "--head"], { cwd: repo }), runGit(["show-ref", "--head"], { cwd: repo }));
});

test("update-ref points a ref at a new commit", () => {
  const { repo, shas } = linearRepo(3);
  assertExit(runMine(["update-ref", "refs/heads/main", shas[0]], { cwd: repo }), 0);
  assertStdout(runMine(["rev-parse", "main"], { cwd: repo }), `${shas[0]}\n`);
});

test("update-ref creates a ref that did not exist", () => {
  const { repo, shas } = linearRepo(2);
  assertExit(runMine(["update-ref", "refs/heads/feature", shas[0]], { cwd: repo }), 0);
  assertStdout(runGit(["rev-parse", "feature"], { cwd: repo }), `${shas[0]}\n`);
});

test("update-ref accepts a revision as the new value", () => {
  const { repo, shas } = linearRepo(3);
  assertExit(runMine(["update-ref", "refs/heads/feature", "HEAD~1"], { cwd: repo }), 0);
  assertStdout(runGit(["rev-parse", "feature"], { cwd: repo }), `${shas[1]}\n`);
});

test("update-ref -d deletes a ref", () => {
  const { repo, shas } = linearRepo(2);
  git(["branch", "doomed", shas[0]], { cwd: repo });
  assertExit(runMine(["update-ref", "-d", "refs/heads/doomed"], { cwd: repo }), 0);

  const remaining = runGit(["show-ref"], { cwd: repo });
  assert.ok(!/doomed/.test(remaining.out), `expected the ref to be gone, got:\n${remaining.out}`);
});

test("update-ref -d removes a packed ref as well as a loose one", () => {
  const { repo, shas } = linearRepo(2);
  git(["branch", "doomed", shas[0]], { cwd: repo });
  git(["pack-refs", "--all"], { cwd: repo });

  assertExit(runMine(["update-ref", "-d", "refs/heads/doomed"], { cwd: repo }), 0);
  const remaining = runGit(["show-ref"], { cwd: repo });
  assert.ok(!/doomed/.test(remaining.out), `expected the packed ref to be gone, got:\n${remaining.out}`);
});

test("a ref we write is visible to the real git binary", () => {
  const { repo, shas } = linearRepo(3);
  runMine(["update-ref", "refs/heads/written", shas[1]], { cwd: repo });

  const log = runGit(["log", "--format=%H", "-n", "1", "written"], { cwd: repo });
  assertExit(log, 0);
  assert.strictEqual(log.out.trim(), shas[1]);
});

test("symbolic-ref reports what HEAD points at", () => {
  const { repo } = linearRepo(2);
  assertMatchesGit(runMine(["symbolic-ref", "HEAD"], { cwd: repo }), runGit(["symbolic-ref", "HEAD"], { cwd: repo }));
});

test("symbolic-ref repoints HEAD at another branch", () => {
  const { repo, shas } = linearRepo(2);
  git(["branch", "feature", shas[0]], { cwd: repo });

  assertExit(runMine(["symbolic-ref", "HEAD", "refs/heads/feature"], { cwd: repo }), 0);
  assertStdout(runGit(["symbolic-ref", "HEAD"], { cwd: repo }), "refs/heads/feature\n");
  assertStdout(runMine(["rev-parse", "HEAD"], { cwd: repo }), `${shas[0]}\n`);
});

test("update-ref fails when deleting a ref that does not exist", () => {
  const { repo } = linearRepo(1);
  assertFatal(runMine(["update-ref", "-d", "refs/heads/missing"], { cwd: repo }));
});

test("show-ref prints nothing in a repository with no refs", () => {
  const { mineRepo } = require("../helpers/fixtures");
  const repo = mineRepo();
  const res = runMine(["show-ref"], { cwd: repo });
  assertExit(res, 0);
  assert.strictEqual(res.out, "");
});
