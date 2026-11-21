import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Readable } from "node:stream";
import { afterAll, describe, expect, it } from "vitest";
import { listZipEntries, openZipCsv, pickCsvEntry, ZipFormatError } from "@/lib/ingest/zip";
import { makeZip } from "../../helpers/zip-writer";

const dir = mkdtempSync(path.join(tmpdir(), "fairsquare-zip-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function file(name: string, buf: Buffer): string {
  const f = path.join(dir, name);
  writeFileSync(f, buf);
  return f;
}

async function text(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.from(c as Buffer));
  return Buffer.concat(chunks).toString("utf8");
}

const CSV = Buffer.from("transaction_id,building_name_en\n1-11-2026-1,TEST TOWER A\n".repeat(200), "utf8");

describe("zip reader (Node built-ins only)", () => {
  it("streams the largest .csv entry (deflate), skipping folders, other files and __MACOSX", async () => {
    const f = file(
      "a.zip",
      makeZip([
        { name: "readme.txt", data: Buffer.from("x".repeat(5000)) },
        { name: "__MACOSX/._Transactions.csv", data: Buffer.from("y".repeat(9000)) },
        { name: "small.csv", data: Buffer.from("a,b\n1,2\n") },
        { name: "data/Transactions.csv", data: CSV },
      ]),
    );
    const { entry, stream } = await openZipCsv(f);
    expect(entry.name).toBe("data/Transactions.csv");
    expect(await text(stream)).toBe(CSV.toString("utf8"));
  });

  it("reads stored entries, ZIP64 records and an archive comment", async () => {
    const stored = file("s.zip", makeZip([{ name: "t.csv", data: CSV, method: 0 }], { comment: "TEST comment" }));
    expect(await text((await openZipCsv(stored)).stream)).toBe(CSV.toString("utf8"));
    const z64 = file("z64.zip", makeZip([{ name: "t.csv", data: CSV }], { zip64: true }));
    const entries = await listZipEntries(z64);
    expect(entries[0]).toMatchObject({ name: "t.csv", size: CSV.length });
    expect(await text((await openZipCsv(z64)).stream)).toBe(CSV.toString("utf8"));
  });

  it("an empty csv entry is an empty stream", async () => {
    const f = file("empty.zip", makeZip([{ name: "t.csv", data: Buffer.alloc(0), method: 0 }]));
    expect(await text((await openZipCsv(f)).stream)).toBe("");
  });

  it("refuses non-zip files, zips without a csv, encrypted and unknown-method entries, and damaged data", async () => {
    await expect(listZipEntries(file("not.zip", Buffer.from("hello, this is not a zip file at all")))).rejects.toThrow(ZipFormatError);
    await expect(listZipEntries(file("tiny.zip", Buffer.from("PK")))).rejects.toThrow(/Not a zip file/);
    expect(() => pickCsvEntry([])).toThrow(/no .csv file/);
    await expect(openZipCsv(file("nocsv.zip", makeZip([{ name: "a.txt", data: Buffer.from("x") }])))).rejects.toThrow(/no .csv file/);

    const enc = makeZip([{ name: "t.csv", data: CSV }]);
    // Set the "encrypted" flag in the central directory header (offset 8 of the 0x02014b50 record).
    const cd = enc.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    enc.writeUInt16LE(enc.readUInt16LE(cd + 8) | 0x1, cd + 8);
    await expect(openZipCsv(file("enc.zip", enc))).rejects.toThrow(/encrypted/);

    const bz = makeZip([{ name: "t.csv", data: CSV }]);
    const cd2 = bz.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    bz.writeUInt16LE(12, cd2 + 10);
    await expect(openZipCsv(file("bzip.zip", bz))).rejects.toThrow(/method 12/);

    const bad = makeZip([{ name: "t.csv", data: CSV, method: 0 }]);
    bad[40] ^= 0xff; // flip a byte of the stored data: the CRC no longer matches
    await expect(text((await openZipCsv(file("crc.zip", bad))).stream)).rejects.toThrow(/CRC mismatch/);
  });
});
