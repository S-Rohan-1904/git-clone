const { fatal } = require("../errors");
const { findGitDir, readObject } = require("../repository");
const { resolveRevision, peel } = require("../revision");
const { parseCommit, subject } = require("../commit");

const ABBREVIATED = 7;
const INDENT = "    ";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const PLACEHOLDERS = {
  H: (entry) => entry.sha,
  h: (entry) => entry.sha.slice(0, ABBREVIATED),
  T: (entry) => entry.commit.tree,
  P: (entry) => entry.commit.parents.join(" "),
  s: (entry) => subject(entry.commit.message),
  an: (entry) => entry.commit.author.name,
  ae: (entry) => entry.commit.author.email,
  cn: (entry) => entry.commit.committer.name,
  ce: (entry) => entry.commit.committer.email,
  ad: (entry) => formatDate(entry.commit.author),
  cd: (entry) => formatDate(entry.commit.committer),
};

function pad(value) {
  return String(value).padStart(2, "0");
}

function formatDate(identity) {
  const sign = identity.timezone.startsWith("-") ? -1 : 1;
  const hours = Number(identity.timezone.slice(1, 3));
  const minutes = Number(identity.timezone.slice(3, 5));
  const shifted = new Date((identity.seconds + sign * (hours * 60 + minutes) * 60) * 1000);

  return [
    DAYS[shifted.getUTCDay()],
    MONTHS[shifted.getUTCMonth()],
    shifted.getUTCDate(),
    `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}`,
    shifted.getUTCFullYear(),
    identity.timezone,
  ].join(" ");
}

function applyFormat(template, entry) {
  return template.replace(/%(H|h|T|P|s|an|ae|cn|ce|ad|cd|n|%)/g, (match, key) => {
    if (key === "n") return "\n";
    if (key === "%") return "%";
    return PLACEHOLDERS[key](entry);
  });
}

function renderDefault(entry) {
  const lines = [`commit ${entry.sha}`];
  const { author, message } = entry.commit;

  lines.push(`Author: ${author.name} <${author.email}>`);
  lines.push(`Date:   ${formatDate(author)}`);
  lines.push("");

  for (const line of message.replace(/\n+$/, "").split("\n")) {
    lines.push(`${INDENT}${line}`);
  }

  return lines.join("\n");
}

class LogCommand {
  constructor({ revision = "HEAD", oneline = false, format = null, maxCount = null } = {}) {
    this.revision = revision;
    this.oneline = oneline;
    this.format = format;
    this.maxCount = maxCount;
  }

  execute() {
    const gitDir = findGitDir();
    const start = peel(resolveRevision(this.revision, gitDir), "commit", gitDir);
    const entries = walk(start, gitDir, this.maxCount);

    if (entries.length === 0) {
      return;
    }

    const template = this.oneline ? "%h %s" : this.format;
    const rendered = template
      ? entries.map((entry) => applyFormat(template, entry))
      : entries.map(renderDefault);

    process.stdout.write(`${rendered.join(template ? "\n" : "\n\n")}\n`);
  }
}

function walk(start, gitDir, maxCount) {
  const seen = new Set();
  const entries = [];
  const queue = [load(start, gitDir)];

  while (queue.length > 0) {
    queue.sort((a, b) => b.commit.committer.seconds - a.commit.committer.seconds);
    const entry = queue.shift();

    if (seen.has(entry.sha)) {
      continue;
    }
    seen.add(entry.sha);
    entries.push(entry);

    if (maxCount !== null && entries.length >= maxCount) {
      break;
    }

    for (const parent of entry.commit.parents) {
      if (!seen.has(parent)) {
        queue.push(load(parent, gitDir));
      }
    }
  }

  return entries;
}

function load(sha, gitDir) {
  const object = readObject(sha, gitDir);

  if (object.type !== "commit") {
    throw fatal(`${sha} is not a commit`);
  }

  return { sha: object.sha, commit: parseCommit(object.body) };
}

module.exports = LogCommand;
