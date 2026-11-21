"use client";

/**
 * Overview (`/admin`, DESIGN.md section 3.8): range control, KPIs (number-ticker), funnel, verdicts
 * and comparisons per day. The verdict and per-day charts each have "Show as table".
 */
import { ArrowDownIcon, ArrowUpIcon, Building2Icon, EqualIcon, MinusIcon } from "lucide-react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { ChartOrTable } from "@/components/admin/chart-or-table";
import { SimpleTable } from "@/components/admin/data-table";
import { KpiGrid } from "@/components/admin/kpi-grid";
import { RangeToggle } from "@/components/admin/range-toggle";
import { Badge } from "@/components/ui/badge";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { bandLabel, COPY, t, tList } from "@/lib/copy";
import { formatDate, formatInt } from "@/lib/format";
import type { CheckBand } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { AdminStats } from "@/lib/validation/admin";
import { CHECK_BANDS } from "@/lib/validation/api";

const pct = (n: number, total: number) => (total > 0 ? Math.round((n / total) * 100) : 0);

function Bar({ value, max, className }: { value: number; max: number; className?: string }) {
  const w = max > 0 ? Math.max(value > 0 ? 1.5 : 0, (value / max) * 100) : 0;
  return (
    <div aria-hidden="true" className="h-3 w-full rounded-sm bg-muted">
      <div className={cn("h-3 rounded-sm", className)} style={{ width: `${w}%` }} />
    </div>
  );
}

function Funnel({ stats }: { stats: AdminStats }) {
  const f = stats.funnel;
  const labels = tList("admin.funnel");
  const values = [f.newVisitors, f.extractOk, f.checks, f.shares, f.cardViews, f.checksFromShares, f.leads];
  const max = Math.max(...values, 1);
  return (
    <section aria-labelledby="funnel-h" className="flex flex-col gap-3">
      <h2 id="funnel-h" className="text-title font-semibold wdth-title">
        {COPY["adminUi.funnelH2"]}
      </h2>
      <dl className="flex flex-col gap-2">
        {labels.map((label, i) => (
          <div key={label} className="grid grid-cols-[8.5rem_1fr_4.5rem] items-center gap-3">
            <dt className="text-sm">{label}</dt>
            <dd className="contents">
              <Bar value={values[i]} max={max} className="bg-chart-1" />
              <span className="num text-right text-sm font-medium">{formatInt(values[i])}</span>
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-sm text-muted-foreground">
        {f.kFactor === null ? COPY["adminUi.kFactorNone"] : t("admin.kFactor", { k: f.kFactor.toFixed(2) })}
      </p>
    </section>
  );
}

const VERDICT_BAR: Record<CheckBand, string> = {
  above: "bg-verdict-above",
  inline: "bg-verdict-inline",
  below: "bg-verdict-below",
  thin: "bg-muted-foreground/60",
  none: "bg-muted-foreground/35",
};

export function VerdictIcon({ band }: { band: CheckBand }) {
  if (band === "above") return <ArrowUpIcon aria-hidden="true" className="size-4 text-verdict-above" />;
  if (band === "below") return <ArrowDownIcon aria-hidden="true" className="size-4 text-verdict-below" />;
  // D§2.7: "in line" is Equal in the verdict colour; the two no-verdict rows stay neutral and distinct.
  if (band === "inline") return <EqualIcon aria-hidden="true" data-icon="equal" className="size-4 text-verdict-inline" />;
  if (band === "none") return <Building2Icon aria-hidden="true" data-icon="building" className="size-4 text-muted-foreground" />;
  return <MinusIcon aria-hidden="true" data-icon="minus" className="size-4 text-muted-foreground" />;
}

function Verdicts({ stats }: { stats: AdminStats }) {
  const total = CHECK_BANDS.reduce((s, b) => s + stats.verdicts[b], 0);
  const chart = (
    <dl className="flex flex-col gap-2">
      {CHECK_BANDS.map((b) => (
        <div key={b} className="grid grid-cols-[8rem_1fr_5.5rem] items-center gap-3 sm:grid-cols-[11rem_1fr_6rem]">
          <dt className="flex items-center gap-1.5 text-sm">
            <VerdictIcon band={b} />
            {bandLabel(b)}
          </dt>
          <dd className="contents">
            <Bar value={stats.verdicts[b]} max={Math.max(total, 1)} className={VERDICT_BAR[b]} />
            <span className="num text-right text-sm font-medium">
              {pct(stats.verdicts[b], total)}% <span className="text-muted-foreground">({formatInt(stats.verdicts[b])})</span>
            </span>
          </dd>
        </div>
      ))}
    </dl>
  );
  const table = (
    <SimpleTable
      caption={COPY["adminUi.verdictsH2"]}
      columns={[COPY["adminUi.colVerdict"], COPY["adminUi.colCount"], COPY["adminUi.colShare"]]}
      numeric={[1, 2]}
      rows={CHECK_BANDS.map((b) => [bandLabel(b), formatInt(stats.verdicts[b]), `${pct(stats.verdicts[b], total)}%`])}
    />
  );
  return <ChartOrTable title={COPY["adminUi.verdictsH2"]} chart={chart} table={table} />;
}

const chartConfig = {
  checks: { label: COPY["adminUi.colCount"], color: "var(--chart-1)" },
  extractFail: { label: COPY["admin.qualityFailures"], color: "var(--chart-5)" },
} satisfies ChartConfig;

function shortDate(d: string): string {
  return formatDate(d).replace(/ \d{4}$/, "");
}

function PerDay({ stats }: { stats: AdminStats }) {
  const totalChecks = stats.perDay.reduce((s, d) => s + d.checks, 0);
  const totalFails = stats.perDay.reduce((s, d) => s + d.extractFail, 0);
  const summary = t("adminUi.perDaySummary", { days: stats.range, checks: formatInt(totalChecks), fails: formatInt(totalFails) });
  const config = { ...chartConfig, checks: { ...chartConfig.checks, label: tList("admin.kpi")[0] } };
  const chart = (
    <ChartContainer config={config} className="aspect-auto h-56 w-full md:h-64" role="img" aria-label={summary}>
      <LineChart data={stats.perDay} margin={{ left: 4, right: 12, top: 8, bottom: 4 }} accessibilityLayer={false}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} tickFormatter={shortDate} />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={32} />
        <ChartTooltip content={<ChartTooltipContent labelFormatter={(v) => formatDate(String(v))} />} />
        <Line dataKey="checks" type="linear" stroke="var(--color-checks)" strokeWidth={2} dot={false} isAnimationActive={false} />
        <Line
          dataKey="extractFail"
          type="linear"
          stroke="var(--color-extractFail)"
          strokeWidth={2}
          strokeDasharray="4 3"
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ChartContainer>
  );
  const table = (
    <SimpleTable
      caption={COPY["adminUi.perDayH2"]}
      columns={[COPY["adminUi.colDate"], tList("admin.kpi")[0], COPY["admin.qualityFailures"]]}
      numeric={[1, 2]}
      rows={[...stats.perDay].reverse().map((d) => [formatDate(d.date), formatInt(d.checks), formatInt(d.extractFail)])}
    />
  );
  return (
    <ChartOrTable
      title={COPY["adminUi.perDayH2"]}
      summary={summary}
      chart={
        <>
          {chart}
          <ul className="flex flex-wrap gap-4 text-caption text-muted-foreground" aria-hidden="true">
            <li className="flex items-center gap-2">
              <span className="h-0.5 w-5 bg-chart-1" />
              {tList("admin.kpi")[0]}
            </li>
            <li className="flex items-center gap-2">
              <span className="h-0.5 w-5 border-t-2 border-dashed border-chart-5" />
              {COPY["admin.qualityFailures"]}
            </li>
          </ul>
        </>
      }
      table={table}
    />
  );
}

function TopRequests({ stats }: { stats: AdminStats }) {
  return (
    <section aria-labelledby="top-req-h" className="flex flex-col gap-3">
      <h2 id="top-req-h" className="text-title font-semibold wdth-title">
        {COPY["adminUi.topRequestsH2"]}
      </h2>
      {stats.topRequests.length === 0 ? (
        <p className="text-sm text-muted-foreground">{COPY["adminUi.topRequestsEmpty"]}</p>
      ) : (
        <SimpleTable
          caption={COPY["adminUi.topRequestsH2"]}
          columns={[COPY["adminUi.colTyped"], COPY["adminUi.colRequests"], COPY["adminUi.colStatus"]]}
          numeric={[1]}
          rows={stats.topRequests.map((r) => [
            r.text,
            formatInt(r.count),
            <Badge key="s" variant={r.resolved ? "secondary" : "outline"}>
              {r.resolved ? COPY["adminUi.covered"] : COPY["adminUi.notCovered"]}
            </Badge>,
          ])}
        />
      )}
    </section>
  );
}

export function OverviewView({ stats }: { stats: AdminStats }) {
  const f = stats.funnel;
  const kpiLabels = tList("admin.kpi");
  const kpiValues = [
    f.checks,
    f.extractOk,
    f.extractFail,
    f.shares,
    f.cardViews,
    f.checksFromShares,
    f.costOpened,
    f.leads,
    f.leadsWithdrawn,
  ];
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-display-sm font-[720] wdth-heading">{COPY["adminUi.overviewH1"]}</h1>
        <RangeToggle range={stats.range} />
      </div>
      <KpiGrid
        key={stats.range}
        label={COPY["adminUi.kpiLabel"]}
        items={kpiLabels.map((label, i) => ({ label, value: kpiValues[i] }))}
      />
      <div className="grid gap-8 border-t border-border pt-6 lg:grid-cols-2 lg:gap-12">
        <Funnel stats={stats} />
        <Verdicts stats={stats} />
      </div>
      <div className="border-t border-border pt-6">
        <PerDay stats={stats} />
      </div>
      <div className="border-t border-border pt-6">
        <TopRequests stats={stats} />
      </div>
    </div>
  );
}
