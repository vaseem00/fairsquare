"use client";

/**
 * Import CSV (DESIGN.md section 3.8), three steps on one page:
 * 1. Kind (Sales, Buildings, Aliases), "Choose CSV file" and "Download template" (the header row is
 *    built in the browser from CSV_COLUMNS; there is no template file).
 * 2. Dry run, no writes: "23 rows ready. 2 rows rejected.", the rejected rows (Row, Problem), skipped
 *    duplicates, the per-building median impact, and [Import 23 sales] / [Choose another file].
 *    A Progress bar shows while uploading files over 1,000 rows.
 * 3. Done: toast "23 sales imported"; the impact summary stays on screen.
 */
import { DownloadIcon, UploadIcon } from "lucide-react";
import { useId, useRef, useState } from "react";
import { toast } from "sonner";
import { SimpleTable } from "@/components/admin/data-table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Progress, ProgressLabel } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { adminApi } from "@/lib/api/admin-client";
import { COPY, t, tList } from "@/lib/copy";
import { countDataLines, CSV_COLUMNS, templateCsv, templateFileName } from "@/lib/csv/parse";
import { bedsOption, formatInt } from "@/lib/format";
import { CSV_KINDS, CSV_REJECTED_LIST_MAX, type CsvKind, type ImportResult } from "@/lib/validation/admin";

/** Uploads with more rows than this show a progress bar. */
const PROGRESS_ROWS = 1000;

const KIND_LABELS = tList("admin.csvKind");
const KIND_ITEMS = CSV_KINDS.map((k, i) => ({ value: k, label: KIND_LABELS[i] }));

/** Starts a browser download of `text` as a CSV file. */
export function downloadTemplate(kind: CsvKind): void {
  const blob = new Blob([templateCsv(kind)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = templateFileName(kind);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function fmtPsf(v: number | null): string {
  return v === null ? COPY["adminUi.none"] : `${COPY["adminUi.aed"]} ${formatInt(v)}`;
}

export function ImportPanel({ onImported }: { onImported?: (r: ImportResult) => void }) {
  const id = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLHeadingElement>(null);
  const [kind, setKind] = useState<CsvKind>("sales");
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState<"check" | "import" | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  async function run(f: File, commit: boolean, k: CsvKind = kind) {
    setBusy(commit ? "import" : "check");
    setFileError(null);
    let rows = 0;
    try {
      rows = countDataLines(await f.text());
    } catch {
      rows = 0;
    }
    const showProgress = rows > PROGRESS_ROWS;
    setProgress(showProgress ? 0 : null);
    const res = await adminApi.import(k, f, commit, showProgress ? (p) => setProgress(Math.round(p * 100)) : undefined);
    setBusy(null);
    setProgress(null);
    if (!res.ok) {
      if (res.error.fields?.file) setFileError(res.error.fields.file);
      else toast.error(res.error.message);
      if (!commit) setResult(null);
      return;
    }
    setResult(res.data);
    if (commit) {
      const n = res.data.created + res.data.updated;
      toast.success(k === "sales" ? t("admin.csvDone", { ok: formatInt(n) }) : t("adminUi.csvDoneRows", { ok: formatInt(n) }));
      onImported?.(res.data);
    }
    requestAnimationFrame(() => resultRef.current?.focus());
  }

  function chooseAnother() {
    setFile(null);
    setResult(null);
    setFileError(null);
    if (fileRef.current) {
      fileRef.current.value = "";
      fileRef.current.click();
    }
  }

  const toImport = result ? result.created + result.updated : 0;
  const columns = CSV_COLUMNS[kind].join(", ");

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-kind`}>{COPY["adminUi.csvKindLabel"]}</Label>
          <Select
            value={kind}
            items={KIND_ITEMS}
            onValueChange={(v) => {
              if (typeof v !== "string") return;
              setKind(v as CsvKind);
              setResult(null);
              setFileError(null);
              if (file) void run(file, false, v as CsvKind);
            }}
          >
            <SelectTrigger id={`${id}-kind`} className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {KIND_ITEMS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <input
          ref={fileRef}
          id={`${id}-file`}
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          tabIndex={-1}
          aria-label={COPY["adminUi.csvFile"]}
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            setFile(f);
            setResult(null);
            if (f) void run(f, false);
          }}
        />
        <Button type="button" onClick={() => fileRef.current?.click()} disabled={busy !== null}>
          <UploadIcon aria-hidden="true" />
          {COPY["admin.csvChoose"]}
        </Button>
        <Button type="button" variant="outline" onClick={() => downloadTemplate(kind)}>
          <DownloadIcon aria-hidden="true" />
          {COPY["admin.csvTemplate"]}
        </Button>
      </div>

      <div className="flex flex-col gap-1 text-sm text-muted-foreground">
        <p>{t("adminUi.csvColumns", { columns })}</p>
        {kind === "sales" ? <p>{COPY["adminUi.csvSqm"]}</p> : null}
        {file ? <p className="text-foreground">{file.name}</p> : null}
      </div>

      <div role="status" aria-live="polite" className="flex flex-col gap-2">
        {busy ? <p className="text-sm">{busy === "check" ? COPY["adminUi.csvChecking"] : COPY["adminUi.csvImporting"]}</p> : null}
        {progress !== null ? (
          <Progress value={progress} className="max-w-md">
            <ProgressLabel className="sr-only">{COPY["adminUi.csvFile"]}</ProgressLabel>
          </Progress>
        ) : null}
      </div>

      {fileError ? (
        <Alert variant="destructive">
          <AlertDescription>{fileError}</AlertDescription>
        </Alert>
      ) : null}

      {result ? (
        <section aria-labelledby={`${id}-result`} className="flex flex-col gap-4 border-t border-border pt-6">
          <h3 id={`${id}-result`} ref={resultRef} tabIndex={-1} className="text-title font-semibold outline-none wdth-title">
            {result.committed
              ? t(result.kind === "sales" ? "admin.csvDone" : "adminUi.csvDoneRows", {
                  ok: formatInt(result.created + result.updated),
                })
              : t("admin.csvDry", { ok: formatInt(result.ok), bad: formatInt(result.rejectedCount) })}
          </h3>
          {result.skippedDuplicates > 0 ? (
            <p className="text-sm text-muted-foreground">{t("adminUi.csvDuplicates", { n: formatInt(result.skippedDuplicates) })}</p>
          ) : null}
          {result.updated > 0 && !result.committed ? (
            <p className="text-sm text-muted-foreground">{t("adminUi.csvUpdated", { n: formatInt(result.updated) })}</p>
          ) : null}

          {result.rejected.length > 0 ? (
            <div className="flex flex-col gap-2">
              <SimpleTable
                captionVisible
                caption={COPY["adminUi.csvRejectedH"]}
                columns={[COPY["adminUi.colRow"], COPY["adminUi.colProblem"]]}
                numeric={[0]}
                rows={result.rejected.map((r) => [formatInt(r.line), <span key="p" className="whitespace-normal">{r.reason}</span>])}
                className="md:w-auto"
              />
              {result.rejectedCount > result.rejected.length ? (
                <p className="text-caption text-muted-foreground">
                  {t("adminUi.csvMoreRejected", { n: formatInt(CSV_REJECTED_LIST_MAX) })}
                </p>
              ) : null}
            </div>
          ) : null}

          {result.impact.length > 0 ? (
            <SimpleTable
              captionVisible
              caption={COPY["adminUi.csvImpactH"]}
              columns={[
                COPY["adminUi.colBuilding"],
                COPY["adminUi.colBedrooms"],
                COPY["adminUi.colBefore"],
                COPY["adminUi.colAfter"],
                COPY["adminUi.colAdded"],
              ]}
              numeric={[2, 3, 4]}
              rows={result.impact.map((i) => [
                i.buildingName,
                bedsOption(i.bedrooms),
                fmtPsf(i.beforeMedianPsf),
                fmtPsf(i.afterMedianPsf),
                formatInt(i.added),
              ])}
            />
          ) : null}

          {!result.committed ? (
            <div className="flex flex-wrap gap-3">
              {toImport > 0 ? (
                <Button type="button" onClick={() => file && run(file, true)} disabled={busy !== null || !file}>
                  {kind === "sales"
                    ? t("admin.csvImport", { ok: formatInt(toImport) })
                    : t("adminUi.csvImportRows", { ok: formatInt(toImport) })}
                </Button>
              ) : (
                <p className="self-center text-sm">{COPY["adminUi.csvNothing"]}</p>
              )}
              <Button type="button" variant="outline" onClick={chooseAnother} disabled={busy !== null}>
                {COPY["adminUi.csvAnother"]}
              </Button>
            </div>
          ) : (
            <div>
              <Button type="button" variant="outline" onClick={chooseAnother}>
                {COPY["adminUi.csvAnother"]}
              </Button>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
