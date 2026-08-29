#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const GitClient = require("./git/commands/client");
const { GitError, usage } = require("./git/errors");

const {
  CatFileCommand,
  HashObjectCommand,
  LsTreeCommand,
  WriteTreeCommand,
  CommitTreeCommand,
  CloneCommand,
  RevParseCommand,
  ShowRefCommand,
  UpdateRefCommand,
  SymbolicRefCommand,
  LogCommand,
  LsFilesCommand,
  CheckIgnoreCommand,
  AddCommand,
  RmCommand,
  StatusCommand,
  CommitCommand,
  BranchCommand,
  CheckoutCommand,
  TagCommand,
  DiffCommand,
  FetchCommand,
  PushCommand,
  MergeCommand,
} = require("./git/commands");

const gitClient = new GitClient();

const USAGE = "usage: git <command> [<args>]";
const COMMIT_TREE_USAGE =
  "usage: git commit-tree <tree> [(-p <parent>)...] -m <message>";

async function main(argv) {
  const command = argv[0];

  switch (command) {
    case undefined:
      throw usage(USAGE);
    case "init":
      createGitDirectory();
      break;
    case "cat-file":
      handleCatFileCommand(argv.slice(1));
      break;
    case "hash-object":
      handleHashObjectCommand(argv.slice(1));
      break;
    case "ls-tree":
      handleLsTreeCommand(argv.slice(1));
      break;
    case "write-tree":
      gitClient.run(new WriteTreeCommand());
      break;
    case "commit-tree":
      handleCommitTreeCommand(argv.slice(1));
      break;
    case "clone":
      return handleCloneCommand(argv.slice(1));
    case "fetch":
      return gitClient.run(new FetchCommand({ remote: argv[1] || "origin" }));
    case "push":
      return gitClient.run(
        new PushCommand({ remote: argv[1] || "origin", branch: argv[2] }),
      );
    case "rev-parse":
      gitClient.run(new RevParseCommand({ revisions: argv.slice(1) }));
      break;
    case "show-ref":
      gitClient.run(
        new ShowRefCommand({ includeHead: argv.includes("--head") }),
      );
      break;
    case "update-ref":
      handleUpdateRefCommand(argv.slice(1));
      break;
    case "symbolic-ref":
      gitClient.run(new SymbolicRefCommand({ name: argv[1], target: argv[2] }));
      break;
    case "log":
      handleLogCommand(argv.slice(1));
      break;
    case "commit":
      handleCommitCommand(argv.slice(1));
      break;
    case "branch":
      handleBranchCommand(argv.slice(1));
      break;
    case "checkout":
    case "switch":
      handleCheckoutCommand(argv.slice(1));
      break;
    case "tag":
      handleTagCommand(argv.slice(1));
      break;
    case "merge":
      handleMergeCommand(argv.slice(1));
      break;
    case "diff":
      gitClient.run(
        new DiffCommand({
          cached: argv.includes("--cached") || argv.includes("--staged"),
          revisions: argv.slice(1).filter((arg) => !arg.startsWith("-")),
        }),
      );
      break;
    case "check-ignore":
      gitClient.run(new CheckIgnoreCommand({ paths: argv.slice(1) }));
      break;
    case "add":
      gitClient.run(
        new AddCommand({
          all: argv.includes("-A") || argv.includes("--all"),
          paths: argv.slice(1).filter((arg) => !arg.startsWith("-")),
        }),
      );
      break;
    case "rm":
      gitClient.run(
        new RmCommand({
          cached: argv.includes("--cached"),
          paths: argv.slice(1).filter((arg) => !arg.startsWith("-")),
        }),
      );
      break;
    case "status":
      gitClient.run(
        new StatusCommand({
          porcelain: argv.includes("--porcelain") || argv.includes("--short"),
        }),
      );
      break;
    case "ls-files":
      gitClient.run(
        new LsFilesCommand({
          stage: argv.includes("--stage") || argv.includes("-s"),
        }),
      );
      break;
    default:
      throw new GitError(
        `git: '${command}' is not a git command. See 'git --help'.`,
        1,
      );
  }
}

const REPOSITORY_DIRECTORIES = [
  "objects/info",
  "objects/pack",
  "refs/heads",
  "refs/tags",
];

const DEFAULT_CONFIG = [
  "[core]",
  "\trepositoryformatversion = 0",
  "\tfilemode = true",
  "\tbare = false",
  "",
].join("\n");

function createGitDirectory() {
  const gitDir = path.join(process.cwd(), ".git");

  for (const directory of REPOSITORY_DIRECTORIES) {
    fs.mkdirSync(path.join(gitDir, ...directory.split("/")), {
      recursive: true,
    });
  }

  fs.writeFileSync(path.join(gitDir, "HEAD"), "ref: refs/heads/main\n");

  fs.writeFileSync(path.join(gitDir, "config"), DEFAULT_CONFIG);

  console.log("Initialized git directory");
}

function handleCatFileCommand(args) {
  const [flag, objectName] = args;
  gitClient.run(new CatFileCommand(flag, objectName));
}

function handleHashObjectCommand(args) {
  let type = "blob";
  let write = false;
  let filePath;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === "-w") {
      write = true;
    } else if (arg === "-t") {
      i += 1;
      if (i >= args.length) {
        throw usage("usage: git hash-object [-t <type>] [-w] <file>");
      }
      type = args[i];
    } else if (filePath === undefined) {
      filePath = arg;
    } else {
      throw usage("usage: git hash-object [-t <type>] [-w] <file>");
    }
  }

  gitClient.run(new HashObjectCommand({ type, write, filePath }));
}

function handleMergeCommand(args) {
  let revision;
  let message;

  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "-m") {
      i += 1;
      message = args[i];
    } else if (!args[i].startsWith("-") && revision === undefined) {
      revision = args[i];
    }
  }

  gitClient.run(new MergeCommand({ revision, message }));
}

function handleCommitCommand(args) {
  const index = args.indexOf("-m");
  if (index === -1 || index + 1 >= args.length) {
    throw usage("usage: git commit -m <message>");
  }
  gitClient.run(new CommitCommand({ message: args[index + 1] }));
}

function handleBranchCommand(args) {
  const remove = args.includes("-d") || args.includes("-D");
  const positional = args.filter((arg) => !arg.startsWith("-"));
  gitClient.run(
    new BranchCommand({ name: positional[0], start: positional[1], remove }),
  );
}

function handleCheckoutCommand(args) {
  const create = args.includes("-b") || args.includes("-c");
  const positional = args.filter((arg) => !arg.startsWith("-"));
  gitClient.run(new CheckoutCommand({ target: positional[0], create }));
}

function handleTagCommand(args) {
  const options = { annotated: false, remove: false };
  const positional = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "-a") options.annotated = true;
    else if (arg === "-d") options.remove = true;
    else if (arg === "-m") {
      i += 1;
      options.message = args[i];
      options.annotated = true;
    } else positional.push(arg);
  }

  gitClient.run(
    new TagCommand({ ...options, name: positional[0], target: positional[1] }),
  );
}

function handleUpdateRefCommand(args) {
  if (args[0] === "-d") {
    gitClient.run(new UpdateRefCommand({ name: args[1], remove: true }));
    return;
  }

  gitClient.run(new UpdateRefCommand({ name: args[0], value: args[1] }));
}

function handleLogCommand(args) {
  const options = { oneline: false, format: null, maxCount: null };
  let revision;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === "--oneline") {
      options.oneline = true;
    } else if (arg === "-n" || arg === "--max-count") {
      i += 1;
      options.maxCount = Number(args[i]);
    } else if (arg.startsWith("--max-count=")) {
      options.maxCount = Number(arg.slice("--max-count=".length));
    } else if (arg.startsWith("-n")) {
      options.maxCount = Number(arg.slice(2));
    } else if (arg.startsWith("--format=")) {
      options.format = arg.slice("--format=".length);
    } else if (arg.startsWith("--pretty=format:")) {
      options.format = arg.slice("--pretty=format:".length);
    } else if (revision === undefined) {
      revision = arg;
    } else {
      throw usage(
        "usage: git log [<revision>] [--oneline] [-n <count>] [--format=<format>]",
      );
    }
  }

  gitClient.run(new LogCommand({ revision: revision || "HEAD", ...options }));
}

function handleCloneCommand(args) {
  const [url, directory] = args;
  return gitClient.run(new CloneCommand({ url, directory }));
}

function handleCommitTreeCommand(args) {
  const parents = [];
  let treeName;
  let message;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === "-p" || arg === "-m") {
      i += 1;
      if (i >= args.length) {
        throw usage(COMMIT_TREE_USAGE);
      }
      if (arg === "-p") {
        parents.push(args[i]);
      } else {
        message = message === undefined ? args[i] : `${message}\n\n${args[i]}`;
      }
    } else if (treeName === undefined) {
      treeName = arg;
    } else {
      throw usage(COMMIT_TREE_USAGE);
    }
  }

  gitClient.run(new CommitTreeCommand({ treeName, parents, message }));
}

function handleLsTreeCommand(args) {
  let nameOnly = false;
  let treeName;

  for (const arg of args) {
    if (arg === "--name-only") {
      nameOnly = true;
    } else if (treeName === undefined) {
      treeName = arg;
    } else {
      throw usage("usage: git ls-tree [--name-only] <tree-ish>");
    }
  }

  gitClient.run(new LsTreeCommand({ nameOnly, treeName }));
}

main(process.argv.slice(2)).catch((error) => {
  if (!(error instanceof GitError)) {
    throw error;
  }
  if (error.message) {
    process.stderr.write(`${error.message}\n`);
  }
  process.exitCode = error.code;
});
