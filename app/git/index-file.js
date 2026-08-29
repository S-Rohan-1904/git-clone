const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const { fatal } = require("./errors");

const SIGNATURE = "DIRC";
const VERSION = 2;
const HEADER_BYTES = 12;
const ENTRY_FIXED_BYTES = 62;
const CHECKSUM_BYTES = 20;
const ALIGNMENT = 8;
const NAME_MASK = 0x0fff;
const STAGE_SHIFT = 12;
const STAGE_MASK = 0x3000;
const INDEX_FILE = "index";

function indexPath(gitDir) {
  return path.join(gitDir, INDEX_FILE);
}

function readIndex(gitDir) {
  const file = indexPath(gitDir);

  if (!fs.existsSync(file)) {
    return { version: VERSION, entries: [] };
  }

  const buffer = fs.readFileSync(file);

  if (buffer.length < HEADER_BYTES + CHECKSUM_BYTES) {
    throw fatal("index file is too short");
  }
  if (buffer.subarray(0, 4).toString("ascii") !== SIGNATURE) {
    throw fatal("index file has an invalid signature");
  }

  const version = buffer.readUInt32BE(4);
  if (version !== VERSION) {
    throw fatal(`unsupported index version ${version}`);
  }

  const count = buffer.readUInt32BE(8);
  const entries = [];
  let offset = HEADER_BYTES;

  for (let index = 0; index < count; index += 1) {
    const start = offset;
    const flags = buffer.readUInt16BE(start + 60);
    const nameLength = flags & NAME_MASK;

    let end = start + ENTRY_FIXED_BYTES;
    if (nameLength < NAME_MASK) {
      end += nameLength;
    } else {
      while (buffer[end] !== 0) {
        end += 1;
      }
    }

    entries.push({
      ctimeSeconds: buffer.readUInt32BE(start),
      ctimeNanoseconds: buffer.readUInt32BE(start + 4),
      mtimeSeconds: buffer.readUInt32BE(start + 8),
      mtimeNanoseconds: buffer.readUInt32BE(start + 12),
      device: buffer.readUInt32BE(start + 16),
      inode: buffer.readUInt32BE(start + 20),
      mode: buffer.readUInt32BE(start + 24),
      uid: buffer.readUInt32BE(start + 28),
      gid: buffer.readUInt32BE(start + 32),
      size: buffer.readUInt32BE(start + 36),
      sha: buffer.subarray(start + 40, start + 60).toString("hex"),
      stage: (flags & STAGE_MASK) >> STAGE_SHIFT,
      path: buffer.subarray(start + ENTRY_FIXED_BYTES, end).toString("utf8"),
    });

    offset = start + paddedLength(end - start);
  }

  return { version, entries };
}

function paddedLength(length) {
  return Math.ceil((length + 1) / ALIGNMENT) * ALIGNMENT;
}

function serializeEntry(entry) {
  const name = Buffer.from(entry.path, "utf8");
  const length = paddedLength(ENTRY_FIXED_BYTES + name.length);
  const buffer = Buffer.alloc(length);

  buffer.writeUInt32BE(entry.ctimeSeconds >>> 0, 0);
  buffer.writeUInt32BE(entry.ctimeNanoseconds >>> 0, 4);
  buffer.writeUInt32BE(entry.mtimeSeconds >>> 0, 8);
  buffer.writeUInt32BE(entry.mtimeNanoseconds >>> 0, 12);
  buffer.writeUInt32BE(entry.device >>> 0, 16);
  buffer.writeUInt32BE(entry.inode >>> 0, 20);
  buffer.writeUInt32BE(entry.mode >>> 0, 24);
  buffer.writeUInt32BE(entry.uid >>> 0, 28);
  buffer.writeUInt32BE(entry.gid >>> 0, 32);
  buffer.writeUInt32BE(entry.size >>> 0, 36);
  buffer.set(Buffer.from(entry.sha, "hex"), 40);
  buffer.writeUInt16BE(
    ((entry.stage || 0) << STAGE_SHIFT) | Math.min(name.length, NAME_MASK),
    60,
  );
  buffer.set(name, ENTRY_FIXED_BYTES);

  return buffer;
}

function sortEntries(entries) {
  return [...entries].sort((a, b) => {
    const byPath = Buffer.compare(Buffer.from(a.path), Buffer.from(b.path));
    return byPath !== 0 ? byPath : (a.stage || 0) - (b.stage || 0);
  });
}

function writeIndex(gitDir, entries) {
  const sorted = sortEntries(entries);
  const header = Buffer.alloc(HEADER_BYTES);

  header.write(SIGNATURE, 0, "ascii");
  header.writeUInt32BE(VERSION, 4);
  header.writeUInt32BE(sorted.length, 8);

  const body = Buffer.concat([header, ...sorted.map(serializeEntry)]);
  const checksum = crypto.createHash("sha1").update(body).digest();

  fs.writeFileSync(indexPath(gitDir), Buffer.concat([body, checksum]));
}

function entryFromStat(fullPath, relativePath, sha, mode) {
  const stats = fs.statSync(fullPath, { bigint: true });

  return {
    ctimeSeconds: Number(stats.ctimeNs / 1000000000n),
    ctimeNanoseconds: Number(stats.ctimeNs % 1000000000n),
    mtimeSeconds: Number(stats.mtimeNs / 1000000000n),
    mtimeNanoseconds: Number(stats.mtimeNs % 1000000000n),
    device: Number(stats.dev),
    inode: Number(stats.ino),
    mode,
    uid: Number(stats.uid),
    gid: Number(stats.gid),
    size: Number(stats.size),
    sha,
    stage: 0,
    path: relativePath,
  };
}

module.exports = { readIndex, writeIndex, entryFromStat, sortEntries, indexPath };
