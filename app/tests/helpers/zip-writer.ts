/**
 * A minimal .zip writer for tests of src/lib/ingest/zip.ts: stored or deflated entries, optionally
 * with the ZIP64 records (sizes and offsets moved to the ZIP64 extra field and end records).
 */
import { crc32, deflateRawSync } from "node:zlib";

export interface ZipInput {
  name: string;
  data: Buffer;
  /** 8 = deflate (default), 0 = stored. */
  method?: 0 | 8;
}

const MAX32 = 0xffffffff;

export function makeZip(entries: readonly ZipInput[], opts: { zip64?: boolean; comment?: string } = {}): Buffer {
  const z64 = opts.zip64 === true;
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const method = e.method ?? 8;
    const body = method === 8 ? deflateRawSync(e.data) : e.data;
    const crc = crc32(e.data) >>> 0;
    const name = Buffer.from(e.name, "utf8");
    const extra = z64 ? Buffer.alloc(4 + 16) : Buffer.alloc(0);
    if (z64) {
      extra.writeUInt16LE(0x0001, 0);
      extra.writeUInt16LE(16, 2);
      extra.writeBigUInt64LE(BigInt(e.data.length), 4);
      extra.writeBigUInt64LE(BigInt(body.length), 12);
    }
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(z64 ? 45 : 20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(z64 ? MAX32 : body.length, 18);
    local.writeUInt32LE(z64 ? MAX32 : e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(extra.length, 28);
    parts.push(local, name, extra, body);

    const cExtra = z64 ? Buffer.alloc(4 + 24) : Buffer.alloc(0);
    if (z64) {
      cExtra.writeUInt16LE(0x0001, 0);
      cExtra.writeUInt16LE(24, 2);
      cExtra.writeBigUInt64LE(BigInt(e.data.length), 4);
      cExtra.writeBigUInt64LE(BigInt(body.length), 12);
      cExtra.writeBigUInt64LE(BigInt(offset), 20);
    }
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(45, 4);
    c.writeUInt16LE(z64 ? 45 : 20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(method, 10);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(z64 ? MAX32 : body.length, 20);
    c.writeUInt32LE(z64 ? MAX32 : e.data.length, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt16LE(cExtra.length, 30);
    c.writeUInt32LE(z64 ? MAX32 : offset, 42);
    central.push(c, name, cExtra);
    offset += local.length + name.length + extra.length + body.length;
  }
  const cd = Buffer.concat(central);
  const tail: Buffer[] = [];
  if (z64) {
    const rec = Buffer.alloc(56);
    rec.writeUInt32LE(0x06064b50, 0);
    rec.writeBigUInt64LE(44n, 4);
    rec.writeUInt16LE(45, 12);
    rec.writeUInt16LE(45, 14);
    rec.writeBigUInt64LE(BigInt(entries.length), 24);
    rec.writeBigUInt64LE(BigInt(entries.length), 32);
    rec.writeBigUInt64LE(BigInt(cd.length), 40);
    rec.writeBigUInt64LE(BigInt(offset), 48);
    const loc = Buffer.alloc(20);
    loc.writeUInt32LE(0x07064b50, 0);
    loc.writeBigUInt64LE(BigInt(offset + cd.length), 8);
    loc.writeUInt32LE(1, 16);
    tail.push(rec, loc);
  }
  const comment = Buffer.from(opts.comment ?? "", "utf8");
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(z64 ? 0xffff : entries.length, 8);
  eocd.writeUInt16LE(z64 ? 0xffff : entries.length, 10);
  eocd.writeUInt32LE(z64 ? MAX32 : cd.length, 12);
  eocd.writeUInt32LE(z64 ? MAX32 : offset, 16);
  eocd.writeUInt16LE(comment.length, 20);
  return Buffer.concat([...parts, cd, ...tail, eocd, comment]);
}
