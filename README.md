# git

A Git implementation in Node.js, with no dependencies.

It reads and writes Git's object database, maintains a real `.git/index`, and
talks the smart HTTP protocol well enough to clone, fetch and push against any
Git server. Repositories it creates are ordinary Git repositories: `git log`,
`git status` and `git fsck` all work on them. It is self-hosting — running
`init`, `add -A` and `commit` over this repository's own source produces a
history that real `git` reports as clean and passes `git fsck`.

```bash
node app/main.js init
```

```bash
node app/main.js clone https://github.com/octocat/Hello-World.git
```

## What works

| Area | Commands |
| --- | --- |
| Repository | `init` |
| Objects | `cat-file`, `hash-object`, `ls-tree`, `write-tree`, `commit-tree` |
| Revisions | `rev-parse`, `show-ref`, `update-ref`, `symbolic-ref` |
| History | `log`, `commit`, `merge` |
| Index | `add`, `rm`, `status`, `ls-files`, `check-ignore` |
| Branches | `branch`, `checkout`, `switch`, `tag` |
| Comparison | `diff` |
| Remotes | `clone`, `fetch`, `push` |

Revisions are accepted anywhere an object is expected: `HEAD`, branch and tag
names, abbreviated SHAs, and the `~n`, `^n` and `^{type}` suffixes.

## The parts worth reading

**Packfiles** ([`app/git/pack.js`](app/git/pack.js),
[`app/git/pack-writer.js`](app/git/pack-writer.js)). A server never sends loose
objects; it sends a packfile whose entries are zlib streams laid end to end,
many of them stored as deltas against another object. Reading one means
knowing where each stream ends, which `zlib.inflateSync(buffer, { info: true })`
answers through `engine.bytesWritten`. Both delta encodings are resolved:
`OBJ_OFS_DELTA`, whose base sits at a negative offset within the pack, and
`OBJ_REF_DELTA`, whose base is named by SHA and — in a thin pack — may not be
in the pack at all, because the server knows the client already has it.

**Smart HTTP** ([`app/git/protocol/`](app/git/protocol)). Ref discovery,
pkt-line framing, capability negotiation, `want`/`have` exchange, and the
`receive-pack` command stream used by `push`.

**The index** ([`app/git/index-file.js`](app/git/index-file.js)). A binary
file of fixed-size records carrying stat data, each padded to an eight-byte
boundary and sorted by path as raw bytes, under a SHA-1 checksum. Rewriting an
index that `git add` produced yields a byte-identical file.

**Diff and merge** ([`app/git/diff.js`](app/git/diff.js),
[`app/git/merge.js`](app/git/merge.js)). Myers' shortest-edit-script, grouped
into hunks with context to produce unified diffs that match `git diff` byte for
byte. `merge` reuses it three ways: edits from the base to each side become
line ranges, and only overlapping ranges become conflicts, so independent
changes to the same file combine on their own.

## Testing

341 assertions across 20 stages, run by a local stand-in grading tester:

```bash
npm run grade
```

```bash
npm test
```

The tests judge in three ways, strictest first:

1. **Differential.** The same command runs against the real `git` binary in a
   parallel repository and the outputs are compared. Where a test says
   "matches the real git binary", git's behaviour is the specification.
2. **Interoperability.** Objects written here are read back by real `git`, and
   objects `git` wrote are read back here. Both directions have to work.
3. **Structural.** Object files are inflated and inspected byte by byte —
   header format, entry ordering, mode strings, raw SHA encoding.

Clone, fetch and push are tested against a local server built on git's own
`git-http-backend`, so the protocol and the packfiles on the wire are genuine
while no network is involved. Delta resolution is not taken on trust: the
fixtures are checked to confirm the server really does send `OBJ_OFS_DELTA`
entries, and the thin-pack path is confirmed to receive a `REF_DELTA` whose
base is deliberately absent.

[`STAGES.md`](STAGES.md) describes what each stage covers.

## Layout

```
app/
  main.js              argument parsing and dispatch
  git/
    repository.js      object read/write, .git discovery
    refs.js            loose and packed refs, HEAD
    revision.js        HEAD, branches, tags, ~ and ^ suffixes
    index-file.js      .git/index v2
    tree.js            tree encoding and git's entry ordering
    commit.js          commit headers, including multi-line values
    diff.js            Myers diff and unified output
    merge.js           merge base and three-way merge
    pack.js            packfile reading and delta resolution
    pack-writer.js     packfile writing
    ignore.js          .gitignore pattern matching
    protocol/          pkt-line, HTTP transport, upload-pack, receive-pack
    commands/          one class per subcommand
tests/
  stages/              one file per stage
  helpers/             repository fixtures, the local git HTTP server
scripts/grade.js       the stage grader
```

## Limitations

Deliberate, and worth stating plainly:

- **Loose objects only on disk.** Fetched packfiles are exploded into loose
  objects rather than stored as `.pack` files, and a repository that already
  contains packfiles cannot be read. Cloning with this tool works; pointing it
  at a repository `git clone` created does not.
- **Protocol v0.** Version 2 of the wire protocol is not implemented.
- **No rename detection** in `status` or `diff`.
- **SHA-1 only.** SHA-256 repositories are not supported.
- **Index v2 without extensions.** The tree cache and other extension blocks
  are dropped on write.
- Identity comes from the `GIT_AUTHOR_*` and `GIT_COMMITTER_*` environment
  variables; `user.name` in the config file is not consulted.
- No `rebase`, `cherry-pick`, `stash`, `reflog`, submodules, hooks, or
  `.gitattributes` handling.

Requires Node 18 or later; developed against Node 24.
