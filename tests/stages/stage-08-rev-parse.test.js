"use strict";

// Stage 8: Resolve revisions
//
// Every porcelain command takes a revision rather than a raw SHA, so this is
// the layer that makes `cat-file -p HEAD` and `log main~2` possible. git's
// own `rev-parse` is the oracle throughout.

const assert = require("node:assert");
const { test } = require("node:test");

const { runMine, runGit, git } = require("../helpers/spawn");
const { mineRepo } = require("../helpers/fixtures");
const { linearRepo, mergedRepo } = require("../helpers/history");
const { assertExit, assertFatal, assertStdout, assertMatchesGit } = require("../helpers/assertions");

function bothResolve(repo, spec) {
  assertMatchesGit(runMine(["rev-parse", spec], { cwd: repo }), runGit(["rev-parse", spec], { cwd: repo }));
}

test("rev-parse resolves HEAD", () => {
  const { repo } = linearRepo(3);
  bothResolve(repo, "HEAD");
});

test("rev-parse resolves a branch name", () => {
  const { repo } = linearRepo(2);
  bothResolve(repo, "main");
});

test("rev-parse resolves a fully qualified ref", () => {
  const { repo } = linearRepo(2);
  bothResolve(repo, "refs/heads/main");
});

test("rev-parse resolves a full SHA to itself", () => {
  const { repo, shas } = linearRepo(2);
  assertStdout(runMine(["rev-parse", shas[1]], { cwd: repo }), `${shas[1]}\n`);
});

test("rev-parse resolves an abbreviated SHA", () => {
  const { repo, shas } = linearRepo(2);
  assertStdout(runMine(["rev-parse", shas[0].slice(0, 7)], { cwd: repo }), `${shas[0]}\n`);
});

test("rev-parse walks ancestors with ~", () => {
  const { repo } = linearRepo(4);
  bothResolve(repo, "HEAD~1");
  bothResolve(repo, "HEAD~3");
  bothResolve(repo, "main~2");
});

test("rev-parse treats a bare ~ as one ancestor", () => {
  const { repo } = linearRepo(3);
  bothResolve(repo, "HEAD~");
});

test("rev-parse selects parents with ^", () => {
  const { repo } = linearRepo(3);
  bothResolve(repo, "HEAD^");
});

test("rev-parse selects the second parent of a merge with ^2", () => {
  const { repo } = mergedRepo();
  bothResolve(repo, "HEAD^1");
  bothResolve(repo, "HEAD^2");
});

test("rev-parse treats ^0 as the commit itself", () => {
  const { repo } = linearRepo(2);
  bothResolve(repo, "HEAD^0");
});

test("rev-parse peels a commit to its tree with ^{tree}", () => {
  const { repo } = linearRepo(2);
  bothResolve(repo, "HEAD^{tree}");
});

test("rev-parse peels to a commit with ^{commit}", () => {
  const { repo } = linearRepo(2);
  bothResolve(repo, "HEAD^{commit}");
});

test("rev-parse chains suffixes left to right", () => {
  const { repo } = linearRepo(4);
  bothResolve(repo, "HEAD~2^{tree}");
  bothResolve(repo, "main~1~1");
});

test("rev-parse resolves several revisions in one invocation", () => {
  const { repo } = linearRepo(3);
  assertMatchesGit(
    runMine(["rev-parse", "HEAD", "HEAD~1", "main"], { cwd: repo }),
    runGit(["rev-parse", "HEAD", "HEAD~1", "main"], { cwd: repo }),
  );
});

test("rev-parse resolves a tag name", () => {
  const { repo, shas } = linearRepo(3);
  git(["tag", "release-1", shas[1]], { cwd: repo });
  bothResolve(repo, "release-1");
  bothResolve(repo, "refs/tags/release-1");
});

test("rev-parse peels an annotated tag to its commit", () => {
  const { repo } = linearRepo(2);
  git(["tag", "-a", "annotated", "-m", "tagged"], { cwd: repo });
  bothResolve(repo, "annotated^{commit}");
});

test("rev-parse prefers a branch over an abbreviated SHA of the same spelling", () => {
  const { repo, shas } = linearRepo(2);
  git(["branch", "feature", shas[0]], { cwd: repo });
  assertStdout(runMine(["rev-parse", "feature"], { cwd: repo }), `${shas[0]}\n`);
});

test("cat-file accepts a revision instead of a SHA", () => {
  const { repo } = linearRepo(2);
  const res = runMine(["cat-file", "-p", "HEAD"], { cwd: repo });
  assertExit(res, 0);
  assert.match(res.out, /^tree [0-9a-f]{40}$/m);
  assert.match(res.out, /commit 1/);
});

test("cat-file -t works on a revision", () => {
  const { repo } = linearRepo(2);
  assertStdout(runMine(["cat-file", "-t", "HEAD"], { cwd: repo }), "commit\n");
  assertStdout(runMine(["cat-file", "-t", "HEAD^{tree}"], { cwd: repo }), "tree\n");
});

test("ls-tree accepts a commit and lists its tree", () => {
  const { repo } = linearRepo(2);
  assertMatchesGit(
    runMine(["ls-tree", "--name-only", "HEAD"], { cwd: repo }),
    runGit(["ls-tree", "--name-only", "HEAD"], { cwd: repo }),
  );
});

test("commit-tree accepts revisions for the tree and for parents", () => {
  const { repo } = linearRepo(2);
  const res = runMine(["commit-tree", "HEAD^{tree}", "-p", "HEAD", "-m", "from revisions"], { cwd: repo });
  assertExit(res, 0);
  const parent = runGit(["rev-parse", "HEAD"], { cwd: repo }).out.trim();
  const body = runGit(["cat-file", "-p", res.out.trim()], { cwd: repo });
  assert.match(body.out, new RegExp(`^parent ${parent}$`, "m"));
});

test("rev-parse fails with exit code 128 for an unknown name", () => {
  const { repo } = linearRepo(2);
  assertFatal(runMine(["rev-parse", "no-such-branch"], { cwd: repo }));
});

test("rev-parse fails when asked for a parent that does not exist", () => {
  const { repo } = linearRepo(1);
  assertFatal(runMine(["rev-parse", "HEAD~5"], { cwd: repo }));
});

test("rev-parse fails when a blob cannot be peeled to a tree", () => {
  const repo = mineRepo({ "blob.txt": "content\n" });
  const blob = git(["hash-object", "-w", "blob.txt"], { cwd: repo }).out.trim();
  assertFatal(runMine(["rev-parse", `${blob}^{tree}`], { cwd: repo }));
});
