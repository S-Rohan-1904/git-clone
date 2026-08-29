"use strict";

// Stage 10: Walk history
//
// Two things are being tested: traversal order, and the commit parser. A
// commit header value continues onto the next line when that line is indented
// by one space, which is how `gpgsig` embeds an entire PGP signature -- naive
// line splitting works right up until it meets a signed commit.

const assert = require("node:assert");
const { test } = require("node:test");

const { runMine, runGit, git } = require("../helpers/spawn");
const { mineRepo } = require("../helpers/fixtures");
const { linearRepo, mergedRepo } = require("../helpers/history");
const { assertExit, assertFatal, assertStdout, assertMatchesGit } = require("../helpers/assertions");

function bothLog(repo, args) {
  assertMatchesGit(runMine(["log", ...args], { cwd: repo }), runGit(["log", ...args], { cwd: repo }));
}

test("log --oneline matches the real git binary", () => {
  const { repo } = linearRepo(4);
  bothLog(repo, ["--oneline"]);
});

test("log lists commits newest first", () => {
  const { repo, shas } = linearRepo(3);
  const res = runMine(["log", "--format=%H"], { cwd: repo });
  assertExit(res, 0);
  assert.deepStrictEqual(res.out.trim().split("\n"), [...shas].reverse());
});

test("log default output matches the real git binary", () => {
  const { repo } = linearRepo(3);
  bothLog(repo, []);
});

test("log renders the author date in the commit's own timezone", () => {
  const repo = mineRepo();
  git(["commit", "-q", "--allow-empty", "-m", "offset commit"], {
    cwd: repo,
    env: { GIT_AUTHOR_DATE: "1700000000 +0530", GIT_COMMITTER_DATE: "1700000000 +0530" },
  });
  bothLog(repo, []);
});

test("log indents every message line, including blank ones", () => {
  const repo = mineRepo();
  git(["commit", "-q", "--allow-empty", "-m", "subject line\n\nbody paragraph"], { cwd: repo });
  bothLog(repo, []);
});

test("log -n limits the number of commits", () => {
  const { repo } = linearRepo(5);
  bothLog(repo, ["--oneline", "-n", "2"]);
});

test("log --max-count limits the number of commits", () => {
  const { repo } = linearRepo(5);
  bothLog(repo, ["--oneline", "--max-count=3"]);
});

test("log starts from a given revision instead of HEAD", () => {
  const { repo } = linearRepo(4);
  bothLog(repo, ["--oneline", "HEAD~2"]);
});

test("log starts from a branch name", () => {
  const { repo, shas } = linearRepo(3);
  git(["branch", "feature", shas[1]], { cwd: repo });
  bothLog(repo, ["--oneline", "feature"]);
});

test("log --format supports the common placeholders", () => {
  const { repo } = linearRepo(3);
  bothLog(repo, ["--format=%H %s"]);
  bothLog(repo, ["--format=%h|%an|%ae"]);
  bothLog(repo, ["--format=%T"]);
});

test("log traverses both parents of a merge", () => {
  const { repo, base, side, mainline, merge } = mergedRepo();
  const res = runMine(["log", "--format=%H"], { cwd: repo });
  assertExit(res, 0);

  const seen = res.out.trim().split("\n");
  for (const [name, sha] of Object.entries({ merge, mainline, side, base })) {
    assert.ok(seen.includes(sha), `expected the ${name} commit to appear in the log`);
  }
});

test("log visits a commit reachable by two paths only once", () => {
  const { repo } = mergedRepo();
  const res = runMine(["log", "--format=%H"], { cwd: repo });
  const seen = res.out.trim().split("\n");
  assert.strictEqual(new Set(seen).size, seen.length, "a commit was emitted more than once");
});

test("log order over a merge matches the real git binary", () => {
  const { repo } = mergedRepo();
  bothLog(repo, ["--format=%H %s"]);
});

test("log lists a parent after its children", () => {
  const { repo, base, merge } = mergedRepo();
  const seen = runMine(["log", "--format=%H"], { cwd: repo }).out.trim().split("\n");
  assert.ok(seen.indexOf(merge) < seen.indexOf(base), "the merge commit should appear before its ancestor");
});

test("log parses a commit whose header contains a multi-line value", () => {
  const { repo } = linearRepo(1);
  const tree = git(["rev-parse", "HEAD^{tree}"], { cwd: repo }).out.trim();

  // A gpgsig header, whose continuation lines are indented by one space.
  const signature = ["-----BEGIN PGP SIGNATURE-----", "", "  not a real signature", "-----END PGP SIGNATURE-----"]
    .map((line, index) => (index === 0 ? line : ` ${line}`))
    .join("\n");

  const body = [
    `tree ${tree}`,
    "author Test Author <author@example.com> 1700000000 +0000",
    "committer Test Committer <committer@example.com> 1700000000 +0000",
    `gpgsig ${signature}`,
    "",
    "signed commit",
    "",
  ].join("\n");

  const sha = git(["hash-object", "-w", "-t", "commit", "--stdin"], { cwd: repo, input: body }).out.trim();
  runMine(["update-ref", "refs/heads/signed", sha], { cwd: repo });

  const res = runMine(["log", "--format=%H %s", "signed"], { cwd: repo });
  assertExit(res, 0);
  assert.strictEqual(res.out, `${sha} signed commit\n`);
});

test("log fails with exit code 128 for an unknown revision", () => {
  const { repo } = linearRepo(1);
  assertFatal(runMine(["log", "no-such-branch"], { cwd: repo }));
});

test("log fails when handed a blob", () => {
  const repo = mineRepo({ "blob.txt": "content\n" });
  const blob = git(["hash-object", "-w", "blob.txt"], { cwd: repo }).out.trim();
  assertFatal(runMine(["log", blob], { cwd: repo }));
});
