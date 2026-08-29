class GitError extends Error {
  constructor(message, code = 128) {
    super(message);
    this.name = "GitError";
    this.code = code;
  }
}

function fatal(message) {
  return new GitError(`fatal: ${message}`, 128);
}

function usage(message) {
  return new GitError(message, 129);
}

function silentExit(code) {
  return new GitError("", code);
}

module.exports = { GitError, fatal, usage, silentExit };
