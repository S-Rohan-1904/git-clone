"use strict";

// Stage 19: Write packfiles and push
//
// The mirror of stage 7. Writing the format proves the format was understood
// rather than merely parsed, and the judge is unforgiving: a bad packfile is
// rejected outright by `git-receive-pack` on the far side.

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { test, before, after } = require("node:test");

const { runMine, runGit, git } = require("../helpers/spawn");
const { tmpDir, materialize, binaryBlob } = require("../helpers/fixtures");
const { startGitHttpServer } = require("../helpers/git-http-server");
const { assertExit, assertStdout, assertNoStackTrace } = require("../helpers/assertions");
const { writePack } = require("../../app/git/pack-writer");
const { unpack, readEntries } = require("../../app/git/pack");
const { hashObject } = require("../../app/git/repository");

let server;
let projectRoot;

before(async () => {
  projectRoot = tmpDir("mygit-push-serve-");
  server = await startGitHttpServer(projectRoot);
});

after(async () => {
  if (server) await server.close();
});

// Publishes a bare repository that accepts pushes over HTTP.
function publish(name) {
  const work = tmpDir(`mygit-push-src-${name}-`);
  const bare = path.join(projectRoot, `${name}.git`);

  git(["init", "-q", "--initial-branch=main", "."], { cwd: work });
  materialize(work, { "a.txt": "first\n" });
  git(["add", "-A"], { cwd: work });
  git(["commit", "-q", "-m", "first commit"], { cwd: work });
  git(["clone", "-q", "--bare", work, bare], { cwd: projectRoot });
  git(["config", "http.receivepack", "true"], { cwd: bare });

  return { url: `${server.url}/${name}.git`, bare };
}

function clonedFrom(source) {
  const workspace = tmpDir("mygit-push-clone-");
  const target = path.join(workspace, "clone");
  assertExit(runMine(["clone", source.url, target], { cwd: workspace }), 0);
  return target;
}

function commitIn(repo, files, message) {
  materialize(repo, files);
  runMine(["add", "-A"], { cwd: repo });
  assertExit(runMine(["commit", "-m", message], { cwd: repo }), 0);
}

test("writePack produces a packfile our own reader accepts", () => {
  const objects = [
    { type: "blob", data: Buffer.from("hello\n") },
    { type: "blob", data: binaryBlob(4, 300) },
  ];

  const parsed = unpack(writePack(objects), hashObject);

  assert.strictEqual(parsed.length, 2);
  assert.ok(parsed.some((object) => object.data.equals(objects[0].data)));
  assert.ok(parsed.some((object) => object.data.equals(objects[1].data)));
});

test("writePack encodes sizes that need a multi-byte header", () => {
  const large = Buffer.from("x".repeat(70000));
  const parsed = unpack(writePack([{ type: "blob", data: large }]), hashObject);

  assert.strictEqual(parsed.length, 1);
  assert.ok(parsed[0].data.equals(large), "a large object did not survive the round trip");
});

test("writePack records the object count in its header", () => {
  const objects = [1, 2, 3, 4].map((n) => ({ type: "blob", data: Buffer.from(`object ${n}\n`) }));
  assert.strictEqual(readEntries(writePack(objects)).length, 4);
});

test("push sends a commit the remote accepts", () => {
  const source = publish("basic");
  const target = clonedFrom(source);
  commitIn(target, { "a.txt": "second\n" }, "pushed commit");

  assertExit(runMine(["push"], { cwd: target }), 0);
  assertStdout(runGit(["log", "--format=%s", "-n", "1", "main"], { cwd: source.bare }), "pushed commit\n");
});

test("the remote repository stays healthy after a push", () => {
  const source = publish("healthy");
  const target = clonedFrom(source);
  commitIn(target, { "a.txt": "second\n", "sub/deep/new.txt": "d\n" }, "pushed commit");

  runMine(["push"], { cwd: target });
  assertExit(runGit(["fsck"], { cwd: source.bare }), 0);
});

test("push transfers new files and their contents", () => {
  const source = publish("contents");
  const target = clonedFrom(source);
  commitIn(target, { "added.txt": "brand new\n", "sub/nested.txt": "nested\n" }, "add files");

  runMine(["push"], { cwd: target });

  assertStdout(runGit(["show", "main:added.txt"], { cwd: source.bare }), "brand new\n");
  assertStdout(runGit(["show", "main:sub/nested.txt"], { cwd: source.bare }), "nested\n");
});

test("push sends several commits in one packfile", () => {
  const source = publish("several");
  const target = clonedFrom(source);
  commitIn(target, { "a.txt": "second\n" }, "second commit");
  commitIn(target, { "a.txt": "third\n" }, "third commit");
  commitIn(target, { "a.txt": "fourth\n" }, "fourth commit");

  runMine(["push"], { cwd: target });

  assertStdout(
    runGit(["log", "--format=%s", "main"], { cwd: source.bare }),
    "fourth commit\nthird commit\nsecond commit\nfirst commit\n",
  );
});

test("push creates a branch that does not exist on the remote", () => {
  const source = publish("new-branch");
  const target = clonedFrom(source);
  assertExit(runMine(["checkout", "-b", "feature"], { cwd: target }), 0);
  commitIn(target, { "feature.txt": "f\n" }, "feature commit");

  assertExit(runMine(["push", "origin", "feature"], { cwd: target }), 0);
  assertStdout(runGit(["log", "--format=%s", "-n", "1", "feature"], { cwd: source.bare }), "feature commit\n");
});

test("push sends only the objects the remote is missing", () => {
  const source = publish("incremental");
  const target = clonedFrom(source);
  commitIn(target, { "a.txt": "second\n" }, "second commit");
  runMine(["push"], { cwd: target });

  commitIn(target, { "a.txt": "third\n" }, "third commit");
  assertExit(runMine(["push"], { cwd: target }), 0);
  assertExit(runGit(["fsck"], { cwd: source.bare }), 0);
  assertStdout(runGit(["log", "--format=%s", "-n", "1", "main"], { cwd: source.bare }), "third commit\n");
});

test("push preserves file modes and symlinks", () => {
  const source = publish("modes");
  const target = clonedFrom(source);
  fs.writeFileSync(path.join(target, "run.sh"), "#!/bin/sh\n", { mode: 0o755 });
  fs.symlinkSync("a.txt", path.join(target, "link.txt"));
  runMine(["add", "-A"], { cwd: target });
  runMine(["commit", "-m", "modes"], { cwd: target });

  runMine(["push"], { cwd: target });

  const listing = runGit(["ls-tree", "main"], { cwd: source.bare }).out;
  assert.match(listing, /^100755 blob [0-9a-f]{40}\trun\.sh$/m);
  assert.match(listing, /^120000 blob [0-9a-f]{40}\tlink\.txt$/m);
});

test("push preserves binary content", () => {
  const source = publish("binary");
  const target = clonedFrom(source);
  commitIn(target, { "data.bin": binaryBlob(11, 4096) }, "binary commit");

  runMine(["push"], { cwd: target });

  const shown = runGit(["show", "main:data.bin"], { cwd: source.bare });
  assertExit(shown, 0);
  assert.ok(shown.stdout.equals(binaryBlob(11, 4096)), "binary content changed in transit");
});

test("a pushed history can be cloned back out", () => {
  const source = publish("roundtrip");
  const target = clonedFrom(source);
  commitIn(target, { "a.txt": "second\n", "extra.txt": "e\n" }, "pushed commit");
  runMine(["push"], { cwd: target });

  const workspace = tmpDir("mygit-push-reclone-");
  assertExit(runMine(["clone", source.url, path.join(workspace, "again")], { cwd: workspace }), 0);

  const again = path.join(workspace, "again");
  assert.strictEqual(fs.readFileSync(path.join(again, "a.txt"), "utf8"), "second\n");
  assert.strictEqual(fs.readFileSync(path.join(again, "extra.txt"), "utf8"), "e\n");
});

test("push updates the remote-tracking ref", () => {
  const source = publish("tracking");
  const target = clonedFrom(source);
  commitIn(target, { "a.txt": "second\n" }, "second commit");

  runMine(["push"], { cwd: target });

  assertStdout(
    runGit(["rev-parse", "refs/remotes/origin/main"], { cwd: target }),
    runGit(["rev-parse", "main"], { cwd: target }).out,
  );
});

test("push reports when the remote is already up to date", () => {
  const source = publish("up-to-date");
  const target = clonedFrom(source);
  const res = runMine(["push"], { cwd: target });
  assertExit(res, 0);
  assert.match(res.err, /up-to-date/i);
});

test("push fails without a stack trace when the remote is unreachable", () => {
  const source = publish("unreachable");
  const target = clonedFrom(source);
  commitIn(target, { "a.txt": "second\n" }, "second commit");

  const res = runMine(["push", "http://127.0.0.1:1/nope.git"], { cwd: target });
  assert.notStrictEqual(res.code, 0);
  assertNoStackTrace(res);
});
