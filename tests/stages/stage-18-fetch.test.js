"use strict";

// Stage 18: Incremental fetch
//
// Clone asks for everything; fetch negotiates. It sends `have` lines for what
// it already holds, and the server replies with a thin pack whose deltas may
// reference base objects deliberately left out, because the server knows we
// have them. Resolving those means falling back to the local object database.

const assert = require("node:assert");
const path = require("node:path");
const { test, before, after } = require("node:test");

const { runMine, runGit, git } = require("../helpers/spawn");
const { tmpDir, materialize } = require("../helpers/fixtures");
const { startGitHttpServer } = require("../helpers/git-http-server");
const { assertExit, assertNoStackTrace, assertStdout } = require("../helpers/assertions");
const { discoverRefs, fetchPack } = require("../../app/git/protocol/upload-pack");
const { readEntries } = require("../../app/git/pack");

const OBJ_REF_DELTA = 7;

let server;
let projectRoot;

before(async () => {
  projectRoot = tmpDir("mygit-fetch-serve-");
  server = await startGitHttpServer(projectRoot);
});

after(async () => {
  if (server) await server.close();
});

// A source repository plus the bare copy the server publishes. `advance`
// commits to the source and pushes, simulating remote activity.
function publish(name) {
  const work = tmpDir(`mygit-fetch-src-${name}-`);
  const bare = path.join(projectRoot, `${name}.git`);

  git(["init", "-q", "--initial-branch=main", "."], { cwd: work });
  materialize(work, { "large.txt": "the quick brown fox\n".repeat(500), "a.txt": "first\n" });
  git(["add", "-A"], { cwd: work });
  git(["commit", "-q", "-m", "first commit"], { cwd: work });
  git(["clone", "-q", "--bare", work, bare], { cwd: projectRoot });

  return {
    url: `${server.url}/${name}.git`,
    work,
    advance(files, message) {
      materialize(work, files);
      git(["add", "-A"], { cwd: work });
      git(["commit", "-q", "-m", message], { cwd: work });
      git(["push", "-q", bare, "main"], { cwd: work });
      return git(["rev-parse", "main"], { cwd: work }).out.trim();
    },
    tag(tagName) {
      git(["tag", tagName], { cwd: work });
      git(["push", "-q", bare, tagName], { cwd: work });
    },
  };
}

function cloned(source) {
  const workspace = tmpDir("mygit-fetch-clone-");
  const target = path.join(workspace, "clone");
  assertExit(runMine(["clone", source.url, target], { cwd: workspace }), 0);
  return target;
}

test("fetch updates the remote-tracking ref", () => {
  const source = publish("basic");
  const target = cloned(source);
  const tip = source.advance({ "a.txt": "second\n" }, "second commit");

  assertExit(runMine(["fetch"], { cwd: target }), 0);
  assertStdout(runGit(["rev-parse", "refs/remotes/origin/main"], { cwd: target }), `${tip}\n`);
});

test("fetch downloads the objects for the new commits", () => {
  const source = publish("objects");
  const target = cloned(source);
  source.advance({ "a.txt": "second\n", "added.txt": "new file\n" }, "second commit");

  runMine(["fetch"], { cwd: target });

  const log = runGit(["log", "--format=%s", "refs/remotes/origin/main"], { cwd: target });
  assertExit(log, 0);
  assert.strictEqual(log.out, "second commit\nfirst commit\n");
});

test("the repository stays healthy after a fetch", () => {
  const source = publish("healthy");
  const target = cloned(source);
  source.advance({ "a.txt": "second\n" }, "second commit");

  runMine(["fetch"], { cwd: target });
  assertExit(runGit(["fsck"], { cwd: target }), 0);
});

test("fetch leaves the local branch where it was", () => {
  const source = publish("local-branch");
  const target = cloned(source);
  const before = runGit(["rev-parse", "main"], { cwd: target }).out;
  source.advance({ "a.txt": "second\n" }, "second commit");

  runMine(["fetch"], { cwd: target });

  assert.strictEqual(runGit(["rev-parse", "main"], { cwd: target }).out, before);
  assert.notStrictEqual(runGit(["rev-parse", "refs/remotes/origin/main"], { cwd: target }).out, before);
});

test("fetch reports when there is nothing new", () => {
  const source = publish("up-to-date");
  const target = cloned(source);

  const res = runMine(["fetch"], { cwd: target });
  assertExit(res, 0);
  assert.match(res.err, /Already up to date/);
});

test("fetch is idempotent", () => {
  const source = publish("idempotent");
  const target = cloned(source);
  const tip = source.advance({ "a.txt": "second\n" }, "second commit");

  runMine(["fetch"], { cwd: target });
  assertExit(runMine(["fetch"], { cwd: target }), 0);
  assertStdout(runGit(["rev-parse", "refs/remotes/origin/main"], { cwd: target }), `${tip}\n`);
});

test("fetch picks up several new commits at once", () => {
  const source = publish("several");
  const target = cloned(source);
  source.advance({ "a.txt": "second\n" }, "second commit");
  source.advance({ "a.txt": "third\n" }, "third commit");
  const tip = source.advance({ "a.txt": "fourth\n" }, "fourth commit");

  runMine(["fetch"], { cwd: target });

  assertStdout(runGit(["rev-parse", "refs/remotes/origin/main"], { cwd: target }), `${tip}\n`);
  assertExit(runGit(["fsck"], { cwd: target }), 0);
});

test("fetch retrieves tags", () => {
  const source = publish("tags");
  const target = cloned(source);
  source.advance({ "a.txt": "second\n" }, "second commit");
  source.tag("v1");

  runMine(["fetch"], { cwd: target });
  assertExit(runGit(["rev-parse", "refs/tags/v1"], { cwd: target }), 0);
});

test("the server sends a thin pack once we have history to offer", async () => {
  const source = publish("thin");
  const target = cloned(source);
  source.advance({ "large.txt": `${"the quick brown fox\n".repeat(500)}appended\n` }, "second commit");

  const advertisement = await discoverRefs(source.url);
  const haves = [runGit(["rev-parse", "HEAD"], { cwd: target }).out.trim()];

  const pack = await fetchPack(source.url, {
    wants: advertisement.refs.map((ref) => ref.sha),
    haves,
    capabilities: advertisement.capabilities,
    preferred: ["thin-pack", "ofs-delta"],
  });

  const deltas = readEntries(pack).filter((entry) => entry.type === OBJ_REF_DELTA);
  assert.ok(deltas.length > 0, "expected the server to send at least one REF_DELTA against an external base");
});

test("fetch resolves a thin pack whose delta base is only in the object database", () => {
  const source = publish("thin-resolve");
  const target = cloned(source);
  const body = "the quick brown fox\n".repeat(500);
  source.advance({ "large.txt": `${body}appended once\n` }, "second commit");
  const tip = source.advance({ "large.txt": `${body}appended twice\n` }, "third commit");

  assertExit(runMine(["fetch"], { cwd: target }), 0);
  assertStdout(runGit(["rev-parse", "refs/remotes/origin/main"], { cwd: target }), `${tip}\n`);
  assertExit(runGit(["fsck"], { cwd: target }), 0);

  const content = runGit(["show", `${tip}:large.txt`], { cwd: target });
  assertExit(content, 0);
  assert.strictEqual(content.out, `${body}appended twice\n`);
});

test("fetch fails without a stack trace when the remote is unreachable", () => {
  const source = publish("unreachable");
  const target = cloned(source);
  const res = runMine(["fetch", "http://127.0.0.1:1/nope.git"], { cwd: target });
  assert.notStrictEqual(res.code, 0);
  assertNoStackTrace(res);
});
