const DEFAULT_NAME = "unknown";
const DEFAULT_EMAIL = "unknown@example.com";
const RAW_DATE = /^(\d+)\s+([+-]\d{4})$/;

function offset(date) {
  const minutes = -date.getTimezoneOffset();
  const sign = minutes < 0 ? "-" : "+";
  const absolute = Math.abs(minutes);

  return `${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}${String(absolute % 60).padStart(2, "0")}`;
}

function timestamp(value) {
  const raw = RAW_DATE.exec(value || "");
  if (raw) {
    return `${raw[1]} ${raw[2]}`;
  }

  const now = new Date();
  return `${Math.floor(now.getTime() / 1000)} ${offset(now)}`;
}

function identity(role) {
  const name = process.env[`GIT_${role}_NAME`] || DEFAULT_NAME;
  const email = process.env[`GIT_${role}_EMAIL`] || DEFAULT_EMAIL;

  return `${name} <${email}> ${timestamp(process.env[`GIT_${role}_DATE`])}`;
}

module.exports = { identity };
