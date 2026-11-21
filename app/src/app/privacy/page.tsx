import type { Metadata } from "next";
import { connection } from "next/server";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { COPY, t, tList } from "@/lib/copy";
import { getEnv, leadPartner } from "@/lib/env";

export const metadata: Metadata = {
  title: COPY["privacy.h1"],
};

/**
 * /privacy (DESIGN.md sections 3.10 and 6.11). Static copy that matches the data model (A§3.3) and
 * A§6.7: what is stored (Data, Why, How long), what is not, who sees it, cookies, choices.
 * With a configured adviser partner (PARTNER_NAME, PARTNER_REGULATOR and PARTNER_LICENCE all set,
 * REAL_DATA.md section 8) the page names it. Without one there is no adviser opt-in, so the table
 * drops the name-and-mobile row and the partner sentences give way to the `*NoPartner` wording.
 */
export default async function PrivacyPage() {
  // The partner is a runtime value (the environment is never read at build time, A§7.1).
  await connection();
  const partner = leadPartner(getEnv());
  const vars = { PARTNER_NAME: partner?.name ?? "" };
  const data = tList("privacy.stores", vars);
  const why = tList("privacy.why", vars);
  const keep = tList("privacy.keep", vars);
  const all = data.map((d, i) => ({ data: d, why: why[i], keep: keep[i] }));
  // The last row is the name and mobile sent to the partner.
  const rows = partner ? all : all.slice(0, -1);

  const h2 = "type-heading text-foreground";
  const prose = "type-prose text-foreground";

  return (
    <div className="mx-auto w-full max-w-[1264px] gutter pt-8 pb-16 md:pt-12 lg:pt-16">
    <article className="flex max-w-[880px] flex-col gap-12 md:gap-14 lg:ml-[calc((100%+24px)/6)]">
      <h1 tabIndex={-1} className="type-display-md text-foreground outline-none">
        {COPY["privacy.h1"]}
      </h1>

      <section aria-labelledby="stores" className="flex flex-col gap-4">
        <h2 id="stores" className={h2}>
          {COPY["privacy.storesH2"]}
        </h2>
        {/* Phones: one block per row. From 768px: the table. */}
        <ul className="flex flex-col border-b border-border md:hidden">
          {rows.map((r) => (
            <li key={r.data} className="border-t border-border py-4">
              <dl className="flex flex-col gap-2 text-body">
                <div>
                  <dt className="type-label text-muted-foreground">{COPY["privacy.colData"]}</dt>
                  <dd className="text-foreground">{r.data}</dd>
                </div>
                <div>
                  <dt className="type-label text-muted-foreground">{COPY["privacy.colWhy"]}</dt>
                  <dd className="text-foreground">{r.why}</dd>
                </div>
                <div>
                  <dt className="type-label text-muted-foreground">{COPY["privacy.howLongH2"]}</dt>
                  <dd className="text-foreground">{r.keep}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
        <div className="hidden md:block">
          <Table className="table-fixed text-[15px]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="type-label w-[40%] text-muted-foreground">{COPY["privacy.colData"]}</TableHead>
                <TableHead className="type-label w-[32%] text-muted-foreground">{COPY["privacy.colWhy"]}</TableHead>
                <TableHead className="type-label text-muted-foreground">{COPY["privacy.howLongH2"]}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.data} className="hover:bg-transparent [&>td]:align-top">
                  <TableCell className="py-3 whitespace-normal text-foreground">{r.data}</TableCell>
                  <TableCell className="py-3 whitespace-normal">{r.why}</TableCell>
                  <TableCell className="py-3 whitespace-normal">{r.keep}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <section aria-labelledby="how-long" className="flex flex-col gap-3">
        <h2 id="how-long" className={h2}>
          {COPY["privacy.howLongH2"]}
        </h2>
        <p className={prose}>{partner ? COPY["privacy.howLong"] : COPY["privacy.howLongNoPartner"]}</p>
      </section>

      <section aria-labelledby="not-stored" className="flex flex-col gap-3">
        <h2 id="not-stored" className={h2}>
          {COPY["privacy.notH2"]}
        </h2>
        <p className={prose}>{COPY["privacy.not"]}</p>
      </section>

      <section aria-labelledby="who" className="flex flex-col gap-3">
        <h2 id="who" className={h2}>
          {COPY["privacy.whoH2"]}
        </h2>
        <p className={prose}>{partner ? t("privacy.who", vars) : COPY["privacy.whoNoPartner"]}</p>
      </section>

      <section aria-labelledby="cookies" className="flex flex-col gap-3">
        <h2 id="cookies" className={h2}>
          {COPY["privacy.cookiesH2"]}
        </h2>
        <p className={prose}>{COPY["privacy.cookies"]}</p>
      </section>

      <section aria-labelledby="choices" className="flex flex-col gap-3">
        <h2 id="choices" className={h2}>
          {COPY["privacy.choicesH2"]}
        </h2>
        <p className={prose}>{partner ? COPY["privacy.choices"] : COPY["privacy.choicesNoPartner"]}</p>
      </section>
    </article>
    </div>
  );
}
