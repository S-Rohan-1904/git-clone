const fs = require("fs");
const path = require("path");

const SECTION = /^\[([\w.-]+)(?:\s+"(.*)")?\]$/;
const ENTRY = /^([\w.-]+)\s*=\s*(.*)$/;

function readConfig(gitDir) {
  const file = path.join(gitDir, "config");
  const config = {};

  if (!fs.existsSync(file)) {
    return config;
  }

  let section = null;

  for (const raw of fs.readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim();

    if (line === "" || line.startsWith("#") || line.startsWith(";")) {
      continue;
    }

    const heading = SECTION.exec(line);
    if (heading) {
      const [, name, subsection] = heading;
      config[name] = config[name] || {};
      section = subsection === undefined ? config[name] : (config[name][subsection] = config[name][subsection] || {});
      continue;
    }

    const entry = ENTRY.exec(line);
    if (entry && section) {
      section[entry[1]] = entry[2];
    }
  }

  return config;
}

function remoteUrl(gitDir, name) {
  const config = readConfig(gitDir);
  return (config.remote && config.remote[name] && config.remote[name].url) || null;
}

module.exports = { readConfig, remoteUrl };
