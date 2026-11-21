"use client";

/**
 * Sales data (`/admin/sales`, DESIGN.md section 3.8): the "Data source" panel (REAL_DATA.md section
 * 12), then Tabs for Sales, Register a sale, Buildings and Import CSV. The open tab is kept in `?tab=` (replaceState, no reload) so a refresh keeps it.
 * Below 768px the tabs become a Select (D§3.8: admin works in one column on phones), so a long
 * label never wraps onto a second row over the panel below.
 */
import { useState } from "react";
import { BuildingsPanel } from "@/components/admin/buildings-panel";
import { DataSourcePanel } from "@/components/admin/data-source-panel";
import { ImportPanel } from "@/components/admin/import-panel";
import { RegisterSaleForm } from "@/components/admin/register-sale-form";
import { SalesTable } from "@/components/admin/sales-table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { adminApi } from "@/lib/api/admin-client";
import { COPY, tList } from "@/lib/copy";
import {
  SALES_TABS,
  type AdminBuildingOption,
  type AdminBuildingsPage,
  type AdminSale,
  type DataSourcePanel as DataSourcePanelData,
  type SalesTab,
} from "@/lib/validation/admin";

const LABELS = tList("admin.salesTabs");

export function SalesView({
  initialSales,
  initialBuildings,
  initialOptions,
  initialTab,
  dataSource = null,
}: {
  initialSales: AdminSale[];
  /** The Buildings tab's first page (searched and paged on the server). */
  initialBuildings: AdminBuildingsPage;
  /** Every building as id, name and area, for the pickers. */
  initialOptions: AdminBuildingOption[];
  initialTab: SalesTab;
  /** The "Data source" panel (REAL_DATA.md section 12); null when it could not be read. */
  dataSource?: DataSourcePanelData | null;
}) {
  const [tab, setTab] = useState<SalesTab>(initialTab);
  const [options, setOptions] = useState(initialOptions);
  // Bumped after a buildings import so the Buildings tab reloads its page.
  const [buildingsVersion, setBuildingsVersion] = useState(0);
  const [shown, setShown] = useState<Set<SalesTab>>(() => new Set([initialTab]));

  function choose(next: SalesTab) {
    setTab(next);
    setShown((s) => new Set(s).add(next));
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    window.history.replaceState(null, "", url);
  }

  async function reloadBuildings() {
    const res = await adminApi.buildings.options();
    if (res.ok) setOptions(res.data.options);
    setBuildingsVersion((v) => v + 1);
  }

  /** A building added on the Buildings tab joins the pickers at once. */
  function addOption(b: AdminBuildingOption) {
    setOptions((list) =>
      [...list.filter((x) => x.id !== b.id), { id: b.id, name: b.name, area: b.area }].sort(
        (x, y) => x.name.localeCompare(y.name) || x.id - y.id,
      ),
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-display-sm font-[720] wdth-heading">{COPY["adminUi.salesH1"]}</h1>
      <DataSourcePanel data={dataSource} />
      <Tabs value={tab} onValueChange={(v) => choose(v as SalesTab)} className="gap-6">
        <div className="md:hidden">
          <Select
            value={tab}
            onValueChange={(v) => {
              if (typeof v === "string" && (SALES_TABS as readonly string[]).includes(v)) choose(v as SalesTab);
            }}
            items={SALES_TABS.map((k, i) => ({ value: k, label: LABELS[i] }))}
          >
            <SelectTrigger aria-label={COPY["adminUi.salesTabSelect"]} className="w-full" data-slot="sales-tab-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SALES_TABS.map((k, i) => (
                <SelectItem key={k} value={k}>
                  {LABELS[i]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <TabsList
          variant="line"
          className="hidden h-auto w-full flex-nowrap justify-start overflow-x-auto border-b border-border pb-1 group-data-horizontal/tabs:h-auto md:flex"
        >
          {SALES_TABS.map((k, i) => (
            <TabsTrigger key={k} value={k} className="h-10 min-h-10 flex-none px-3 text-sm text-muted-foreground data-active:text-foreground">
              {LABELS[i]}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="sales">
          <SalesTable initialSales={initialSales} buildings={options} refreshOnMount={shown.size > 1} />
        </TabsContent>
        <TabsContent value="register">
          <RegisterSaleForm buildings={options} />
        </TabsContent>
        <TabsContent value="buildings">
          <BuildingsPanel initial={initialBuildings} reloadKey={buildingsVersion} onAdded={addOption} />
        </TabsContent>
        <TabsContent value="import">
          <ImportPanel
            onImported={(r) => {
              if (r.kind !== "sales") void reloadBuildings();
            }}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
