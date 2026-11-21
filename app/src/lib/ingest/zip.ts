/**
 * A minimal .zip reader on Node built-ins, enough for the Data.Dubai download: it finds the largest
 * `.csv` entry through the central directory (ZIP64 included) and streams it through
 * `zlib.createInflateRaw()` (or as stored), checking the entry's CRC-32 at the end. Encrypted entries
 * and other compression methods are refused. Nothing is extracted to disk.
 */
import { createReadStream } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { crc32, createInflateRaw } from "node:zlib";

export class ZipFormatError extends Error {
  override name = "ZipFormatError";
}

const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
const SIG_ZIP64_EOCD = 0x06064b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;
const MAX_U16 = 0xffff;
const MAX_U32 = 0xffffffff;

export interface ZipEntry {
  name: string;
  method: number;
  flags: number;
  crc: number;
  compressedSize: number;
  size: number;
  localHeaderOffset: number;
}

async function readAt(fh: FileHandle, position: number, length: number): Promise<Buffer> {
  const buf = Buffer.alloc(length);
  const { bytesRead } = await fh.read(buf, 0, length, position);
  if (bytesRead !== length) throw new ZipFormatError("The zip file is truncated.");
  return buf;
}

const u64 = (b: Buffer, at: number): number => {
  const v = b.readBigUInt64LE(at);
  if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new ZipFormatError("The zip file is too large.");
  return Number(v);
};

/** Reads the central directory: every entry with its sizes and local header offset. */
export async function listZipEntries(path: string): Promise<ZipEntry[]> {
  const fh = await open(path, "r");
  try {
    const { size } = await fh.stat();
    const tailLen = Math.min(size, 22 + MAX_U16);
    if (tailLen < 22) throw new ZipFormatError("Not a zip file.");
    const tail = await readAt(fh, size - tailLen, tailLen);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === SIG_EOCD) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new ZipFormatError("Not a zip file (no end of central directory).");
    let total = tail.readUInt16LE(eocd + 10);
    let cdSize = tail.readUInt32LE(eocd + 12);
    let cdOffset = tail.readUInt32LE(eocd + 16);
    if (total === MAX_U16 || cdSize === MAX_U32 || cdOffset === MAX_U32) {
      const loc = eocd - 20;
      if (loc < 0 || tail.readUInt32LE(loc) !== SIG_ZIP64_LOCATOR) throw new ZipFormatError("Broken ZIP64 locator.");
      const z64At = u64(tail, loc + 8);
      const z64 = await readAt(fh, z64At, 56);
      if (z64.readUInt32LE(0) !== SIG_ZIP64_EOCD) throw new ZipFormatError("Broken ZIP64 directory.");
      total = u64(z64, 32);
      cdSize = u64(z64, 40);
      cdOffset = u64(z64, 48);
    }
    const cd = await readAt(fh, cdOffset, cdSize);
    const entries: ZipEntry[] = [];
    let p = 0;
    for (let n = 0; n < total; n++) {
      if (p + 46 > cd.length || cd.readUInt32LE(p) !== SIG_CENTRAL) throw new ZipFormatError("Broken central directory.");
      const flags = cd.readUInt16LE(p + 8);
      const method = cd.readUInt16LE(p + 10);
      const crc = cd.readUInt32LE(p + 16);
      let compressedSize = cd.readUInt32LE(p + 20);
      let uncompressed = cd.readUInt32LE(p + 24);
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      let localHeaderOffset = cd.readUInt32LE(p + 42);
      const name = cd.toString(flags & 0x800 ? "utf8" : "latin1", p + 46, p + 46 + nameLen);
      // ZIP64 extra field: only the values that are 0xFFFFFFFF in the header, in this order.
      let e = p + 46 + nameLen;
      const extraEnd = e + extraLen;
      while (e + 4 <= extraEnd) {
        const id = cd.readUInt16LE(e);
        const len = cd.readUInt16LE(e + 2);
        if (id === 0x0001) {
          let q = e + 4;
          if (uncompressed === MAX_U32) {
            uncompressed = u64(cd, q);
            q += 8;
          }
          if (compressedSize === MAX_U32) {
            compressedSize = u64(cd, q);
            q += 8;
          }
          if (localHeaderOffset === MAX_U32) localHeaderOffset = u64(cd, q);
        }
        e += 4 + len;
      }
      entries.push({ name, method, flags, crc, compressedSize, size: uncompressed, localHeaderOffset });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  } finally {
    await fh.close();
  }
}

/** The largest `.csv` entry, ignoring folders and macOS resource forks. */
export function pickCsvEntry(entries: readonly ZipEntry[]): ZipEntry {
  const csv = entries.filter((e) => /\.csv$/i.test(e.name) && !e.name.endsWith("/") && !e.name.startsWith("__MACOSX/"));
  if (csv.length === 0) throw new ZipFormatError("The zip file has no .csv file inside.");
  return csv.reduce((a, b) => (b.size > a.size ? b : a));
}

/** Checks the CRC-32 of the bytes passing through and fails the stream on a mismatch. */
function crcCheck(expected: number, name: string): Transform {
  let crc = 0;
  return new Transform({
    transform(chunk: Buffer, _enc, done) {
      crc = crc32(chunk, crc);
      done(null, chunk);
    },
    flush(done) {
      done(crc >>> 0 === expected >>> 0 ? null : new ZipFormatError(`The zip entry ${name} is damaged (CRC mismatch).`));
    },
  });
}

/** The uncompressed bytes of the zip's largest `.csv` entry, as a stream. */
export async function openZipCsv(path: string): Promise<{ entry: ZipEntry; stream: Readable }> {
  const entry = pickCsvEntry(await listZipEntries(path));
  if (entry.flags & 0x1) throw new ZipFormatError(`The zip entry ${entry.name} is encrypted.`);
  if (entry.method !== 0 && entry.method !== 8) {
    throw new ZipFormatError(`The zip entry ${entry.name} uses compression method ${entry.method}; only stored and deflate are supported.`);
  }
  const fh = await open(path, "r");
  let start: number;
  try {
    const local = await readAt(fh, entry.localHeaderOffset, 30);
    if (local.readUInt32LE(0) !== SIG_LOCAL) throw new ZipFormatError("Broken local file header.");
    start = entry.localHeaderOffset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
  } finally {
    await fh.close();
  }
  if (entry.compressedSize === 0) return { entry, stream: Readable.from([]) };
  const raw = createReadStream(path, { start, end: start + entry.compressedSize - 1 });
  const body = entry.method === 8 ? raw.pipe(createInflateRaw()) : raw;
  raw.on("error", (err: Error) => body.destroy(err));
  const checked = body.pipe(crcCheck(entry.crc, entry.name));
  body.on("error", (err: Error) => checked.destroy(err));
  // A reader that stops early (a refused header) must release the file too.
  checked.on("close", () => raw.destroy());
  return { entry, stream: checked };
}
