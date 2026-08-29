"use strict";

// Stage 16: Tags
//
// A lightweight tag is just a ref. An annotated tag is a fourth object type
// with its own header block, which is why revision resolution has to peel
// through it to reach the commit.

const assert = require("node:assert");
const { test } = require("node:test");

const { runMine, runGit, git } = require("../helpers/spawn");
const { linearRepo } = require("../helpers/history");
const { assertExit, assertFatal, assertStdout, assertMatchesGit } = require("../helpers/assertions");

test("tag creates a lightweight tag at HEAD", () => {
  const { repo, shas } = linearRepo(2);
  assertExit(runMine(["tag", "v1"], { cwd: repo }), 0);
  assertStdout(runGit(["rev-parse", "v1"], { cwd: repo }), `${shas[1]}\n`);
});

test("a lightweight tag points straight at the commit", () => {
  const { repo } = linearRepo(2);
  runMine(["tag", "v1"], { cwd: repo });
  assertStdout(runGit(["cat-file", "-t", "v1"], { cwd: repo }), "commit\n");
});

test("tag creates a tag at a given revision", () => {
  const { repo, shas } = linearRepo(3);
  runMine(["tag", "old", "HEAD~2"], { cwd: repo });
  assertStdout(runGit(["rev-parse", "old"], { cwd: repo }), `${shas[0]}\n`);
});

test("tag lists tags sorted by name", () => {
  const { repo } = linearRepo(2);
  runMine(["tag", "v2"], { cwd: repo });
  runMine(["tag", "v1"], { cwd: repo });
  runMine(["tag", "alpha"], { cwd: repo });
  assertMatchesGit(runMine(["tag"], { cwd: repo }), runGit(["tag"], { cwd: repo }));
});

test("tag prints nothing when there are no tags", () => {
  const { repo } = linearRepo(1);
  const res = runMine(["tag"], { cwd: repo });
  assertExit(res, 0);
  assert.strictEqual(res.out, "");
});

test("tag -a writes an annotated tag object", () => {
  const { repo } = linearRepo(2);
  assertExit(runMine(["tag", "-a", "v1", "-m", "release one"], { cwd: repo }), 0);
  assertStdout(runGit(["cat-file", "-t", "v1"], { cwd: repo }), "tag\n");
});

test("an annotated tag object has the expected header block", () => {
  const { repo, shas } = linearRepo(2);
  runMine(["tag", "-a", "v1", "-m", "release one"], { cwd: repo });

  const body = runGit(["cat-file", "-p", "v1"], { cwd: repo }).out;
  assert.match(body, new RegExp(`^object ${shas[1]}$`, "m"));
  assert.match(body, /^type commit$/m);
  assert.match(body, /^tag v1$/m);
  assert.match(body, /^tagger .+ <.+@.+> \d+ [+-]\d{4}$/m);
  assert.match(body, /release one/);
});

test("an annotated tag we write is accepted by git fsck", () => {
  const { repo } = linearRepo(2);
  runMine(["tag", "-a", "v1", "-m", "release one"], { cwd: repo });
  assertExit(runGit(["fsck"], { cwd: repo }), 0);
});

test("an annotated tag peels to its commit", () => {
  const { repo, shas } = linearRepo(2);
  runMine(["tag", "-a", "v1", "-m", "release one"], { cwd: repo });
  assertStdout(runMine(["rev-parse", "v1^{commit}"], { cwd: repo }), `${shas[1]}\n`);
  assertMatchesGit(
    runMine(["rev-parse", "v1^{commit}"], { cwd: repo }),
    runGit(["rev-parse", "v1^{commit}"], { cwd: repo }),
  );
});

test("an annotated tag can be logged from", () => {
  const { repo } = linearRepo(3);
  runMine(["tag", "-a", "v1", "-m", "tagged"], { cwd: repo });
  assertMatchesGit(runMine(["log", "--oneline", "v1"], { cwd: repo }), runGit(["log", "--oneline", "v1"], { cwd: repo }));
});

test("tag -d deletes a tag", () => {
  const { repo } = linearRepo(2);
  runMine(["tag", "v1"], { cwd: repo });
  assertExit(runMine(["tag", "-d", "v1"], { cwd: repo }), 0);
  assertStdout(runGit(["tag"], { cwd: repo }), "");
});

test("tag refuses to overwrite an existing tag", () => {
  const { repo } = linearRepo(2);
  runMine(["tag", "v1"], { cwd: repo });
  assertFatal(runMine(["tag", "v1"], { cwd: repo }));
});

test("tag -d fails for a tag that does not exist", () => {
  const { repo } = linearRepo(2);
  assertFatal(runMine(["tag", "-d", "missing"], { cwd: repo }));
});

test("show-ref lists tags we created", () => {
  const { repo } = linearRepo(2);
  runMine(["tag", "v1"], { cwd: repo });
  runMine(["tag", "-a", "v2", "-m", "annotated"], { cwd: repo });
  assertMatchesGit(runMine(["show-ref"], { cwd: repo }), runGit(["show-ref"], { cwd: repo }));
});

test("a tag created by git is listed by us", () => {
  const { repo } = linearRepo(2);
  git(["tag", "from-git"], { cwd: repo });
  git(["tag", "-a", "annotated-by-git", "-m", "theirs"], { cwd: repo });
  assertMatchesGit(runMine(["tag"], { cwd: repo }), runGit(["tag"], { cwd: repo }));
});
