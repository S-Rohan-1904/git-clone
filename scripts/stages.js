"use strict";

// The stage ladder. Stages 1-7 mirror the CodeCrafters "Build your own Git"
// challenge; later phases append their own stages to this list.
module.exports = [
  { id: "01", title: "Initialize the .git directory", file: "tests/stages/stage-01-init.test.js" },
  { id: "02", title: "Read a blob object", file: "tests/stages/stage-02-cat-file.test.js" },
  { id: "03", title: "Create a blob object", file: "tests/stages/stage-03-hash-object.test.js" },
  { id: "04", title: "Read a tree object", file: "tests/stages/stage-04-ls-tree.test.js" },
  { id: "05", title: "Write a tree object", file: "tests/stages/stage-05-write-tree.test.js" },
  { id: "06", title: "Create a commit", file: "tests/stages/stage-06-commit-tree.test.js" },
  { id: "07", title: "Clone a repository", file: "tests/stages/stage-07-clone.test.js" },
  { id: "08", title: "Resolve revisions", file: "tests/stages/stage-08-rev-parse.test.js" },
  { id: "09", title: "References", file: "tests/stages/stage-09-refs.test.js" },
  { id: "10", title: "Walk history", file: "tests/stages/stage-10-log.test.js" },
  { id: "11", title: "The index", file: "tests/stages/stage-11-index.test.js" },
  { id: "12", title: "Ignore rules", file: "tests/stages/stage-12-ignore.test.js" },
  { id: "13", title: "Stage and unstage changes", file: "tests/stages/stage-13-add-status.test.js" },
  { id: "14", title: "Commit from the index", file: "tests/stages/stage-14-commit.test.js" },
  { id: "15", title: "Branches and checkout", file: "tests/stages/stage-15-branch-checkout.test.js" },
  { id: "16", title: "Tags", file: "tests/stages/stage-16-tag.test.js" },
  { id: "17", title: "Diff", file: "tests/stages/stage-17-diff.test.js" },
  { id: "18", title: "Incremental fetch", file: "tests/stages/stage-18-fetch.test.js" },
  { id: "19", title: "Write packfiles and push", file: "tests/stages/stage-19-push.test.js" },
  { id: "20", title: "Merge", file: "tests/stages/stage-20-merge.test.js" },
];
