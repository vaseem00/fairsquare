import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { AttributionText } from "@/components/data/attribution";
import { Balance } from "@/components/scene/balance";
import { buttonVariants } from "@/components/ui/button";
import { ACS_CONSTANTS } from "@/lib/acs/model";
import { getPublicConfig } from "@/lib/config";
import { COPY, t, tList, windowMonths, type CopyKey } from "@/lib/copy";
import { getDb } from "@/lib/db/client";
import { dubaiToday } from "@/lib/domain/dates";
import { getAppMeta } from "@/lib/db/meta";
import { getEnv } from "@/lib/env";
import { formatDate, formatTimestampDate } from "@/lib/format";
import { log } from "@/lib/log";
import { NEARBY_CONSTANTS } from "@/lib/nearby/model";
import { acsStatus } from "@/lib/services/acs";
import { nearbyStatus } from "@/lib/services/nearby";
import { SIMILAR_BACKTEST, SIMILAR_CONSTANTS } from "@/lib/similar/model";
import type { PublicConfig } from "@/lib/types";

export const metadata: Metadata = {
  title: COPY["how.h1"],
  description: COPY["how.intro"],
};

const SECTIONS: { id: string; h2: CopyKey }[] = [
  { id: "what", h2: "how.whatH2" },
  { id: "rules", h2: "how.rulesH2" },
  { id: "too-few", h2: "how.similarH" },
  { id: "adjusted", h2: "how.acsH" },
  { id: "nearby", h2: "how.nearbyH" },
  { id: "leaves-out", h2: "how.outH2" },
  { id: "data", h2: "how.dataH2" },
  { id: "reading", h2: "how.readH2" },
  { id: "not-a-valuation", h2: "how.valuationH2" },
];

/** "The sales Fairsquare uses run from … to …. Fairsquare last loaded them on …", or null before the first load. */
async function loadedLine(data: PublicConfig["data"]): Promise<string | null> {
  if (!data.loaded || !data.dataFrom || !data.dataThrough) return null;
  let importedAt: string | null = null;
  try {
    importedAt = await getAppMeta(getDb(), "data_imported_at");
  } catch (err) {
    log.warn("how_data_imported_at_failed", { err });
  }
  const date = !importedAt ? formatDate(data.dataThrough) : Number.isNaN(Date.parse(importedAt)) ? importedAt : formatTimestampDate(importedAt);
  return t("how.dataLive", { from: formatDate(data.dataFrom), to: formatDate(data.dataThrough), date });
}

/** The sections shown: "adjusted" (REAL_DATA.md section 16) and "nearby" (section 17) only while that answer can run. */
function sectionsFor(acsOn: boolean, nearbyOn: boolean) {
  return SECTIONS.filter((s) => (acsOn || s.id !== "adjusted") && (nearbyOn || s.id !== "nearby"));
}

function Section({ id, children }: { id: string; children: ReactNode }) {
  const s = SECTIONS.find((x) => x.id === id);
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="flex scroll-mt-[calc(var(--header-h)+16px)] flex-col gap-4">
      <h2 id={`${id}-h`} className="type-heading text-foreground">
        {s ? COPY[s.h2] : null}
      </h2>
      {children}
    </section>
  );
}

/**
 * "How the balance reads a listing" (docs/REDESIGN.md section 8.9): the scene's balance at rest, a
 * paper slip on the left pan and seven sale dots on the right, aria-hidden, with an HTML figcaption
 * of three labelled lines. No numbers in the drawing.
 */
function BalanceFigure({ months, bandPct }: { months: number; bandPct: number }) {
  return (
    <figure className="flex flex-col gap-5 sm:flex-row sm:items-center sm:gap-8" data-slot="how-figure">
      <div className="w-full max-w-[220px] shrink-0 self-center sm:self-auto">
        <Balance load={{ kind: "slip" }} dots={7} frame="figure" />
      </div>
      <figcaption className="flex flex-col gap-2">
        <span className="type-title text-foreground">{COPY["how.figCaption"]}</span>
        <span className="text-body text-foreground">{COPY["how.figListing"]}</span>
        <span className="text-body text-foreground num">{t("how.figSales", { months })}</span>
        <span className="text-body text-muted-foreground num">{t("how.figBand", { bandPct })}</span>
      </figcaption>
    </figure>
  );
}

/**
 * /how-it-works (docs/REDESIGN.md section 8.9): one prose column (max 640) in Newsreader with h2
 * sections and, on desktop, a sticky table of contents as a plain list of links. No numbered steps.
 * The rules come from `config.rules`. The data section (`#data`, REAL_DATA.md sections 2, 7 and 9)
 * names the source with the dataset and licence linked, the dates the loaded sales run between (or
 * that they are being loaded), what is included and left out, that ready and off-plan sales are
 * compared separately, that DIFC is not in DLD data, the size caveat, how often the data is
 * refreshed, and that Fairsquare is independent.
 */
export default async function HowItWorksPage() {
  // The rules and the import date are runtime values (environment and database).
  await connection();
  const config = await getPublicConfig();
  const { rules } = config;
  const ruleVars = { months: windowMonths(rules.windowDays), minSales: rules.minSales, bandPct: rules.bandPct };
  const terms = tList("how.ruleTerms", ruleVars);
  const details = tList("how.ruleDetails", ruleVars);
  const loaded = await loadedLine(config.data);
  // The page describes adjusted registered sales only while that answer can run: switched on
  // (ACS_TIER=off returns the site to the median and the second tier), with a usable model of the
  // loaded data that has not aged out (`acsStatus`, the same test a comparison makes).
  let acsOn = getEnv().ACS_TIER !== "off";
  if (acsOn) {
    try {
      acsOn = (await acsStatus(getDb(), dubaiToday())).active;
    } catch (err) {
      log.warn("how_acs_status_failed", { err });
    }
  }
  // The same for nearby registered sales, the last resort (`nearbyStatus`; NEARBY_TIER=off hides it).
  let nearbyOn = getEnv().NEARBY_TIER !== "off";
  if (nearbyOn) {
    try {
      nearbyOn = (await nearbyStatus(getDb(), dubaiToday())).active;
    } catch (err) {
      log.warn("how_nearby_status_failed", { err });
    }
  }
  const prose = "type-prose text-foreground";

  return (
    <div className="mx-auto w-full max-w-[1264px] gutter pt-8 pb-16 md:pt-12 lg:pt-16">
      <div className="lg:grid lg:grid-cols-12 lg:gap-6">
        <nav aria-labelledby="toc-h" className="hidden lg:col-span-2 lg:block">
          <div className="sticky top-[calc(var(--header-h)+32px)] flex flex-col gap-2">
            <p id="toc-h" className="type-label text-muted-foreground">
              {COPY["how.tocLabel"]}
            </p>
            {/* Symmetric padding, no minimum height: one line is a 44px target, and every entry,
                wrapped or not, keeps the same 24px gap to the next. */}
            <ul className="-my-3 flex flex-col">
              {sectionsFor(acsOn, nearbyOn).map((s) => (
                <li key={s.id}>
                  <a
                    href={`#${s.id}`}
                    className="flex items-center rounded-sm py-3 text-[15px] leading-snug text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
                  >
                    {COPY[s.h2]}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </nav>

        <article className="flex max-w-[640px] flex-col gap-12 md:gap-14 lg:col-span-8 lg:col-start-3">
          <header className="flex flex-col gap-5">
            <h1 tabIndex={-1} className="type-display-md text-foreground outline-none">
              {COPY["how.h1"]}
            </h1>
            <p className="type-lead max-w-[52ch] text-foreground">{COPY["how.intro"]}</p>
          </header>

          <Section id="what">
            <p className={prose}>{COPY["how.what"]}</p>
            <div className="mt-4 border-y border-border py-8">
              <BalanceFigure months={ruleVars.months} bandPct={rules.bandPct} />
            </div>
          </Section>

          <Section id="rules">
            <dl className="flex flex-col border-b border-border" data-slot="rules">
              {terms.map((term, i) => (
                <div key={term} className="flex flex-col gap-1 border-t border-border py-4 sm:flex-row sm:gap-6">
                  <dt className="font-display text-lg leading-snug font-[560] text-foreground sm:w-52 sm:shrink-0 num">{term}</dt>
                  <dd className={`${prose} num`}>{details[i]}</dd>
                </div>
              ))}
            </dl>
          </Section>

          {/* The second tier (REAL_DATA.md section 15): what it reads, when it declines, and what the tests found. */}
          <Section id="too-few">
            <p className={`${prose} num`}>{t("how.similarBody", ruleVars)}</p>
            <p className={`${prose} num`} data-slot="similar-tested">
              {t("how.similarTested", { held: SIMILAR_BACKTEST.statement.heldOf10, heldLater: SIMILAR_BACKTEST.statement.heldLaterOf10 })}
            </p>
            <p className={prose}>{COPY["how.similarWeaker"]}</p>
            {/* The project route (REAL_DATA.md section 15.8): only when the shipped constants carry it. */}
            {SIMILAR_CONSTANTS.projectRoute ? (
              <>
                <p className={prose} data-slot="similar-project">
                  {COPY["how.similarProject"]}
                </p>
                <p className={`${prose} num`} data-slot="similar-project-tested">
                  {t("how.similarProjectTested", { held: SIMILAR_CONSTANTS.projectRoute.heldOf10 })}
                </p>
              </>
            ) : null}
          </Section>

          {/* The first answer (REAL_DATA.md section 16): how sales are adjusted, when it declines, what the tests found. */}
          {acsOn ? (
            <Section id="adjusted">
              <p className={prose}>{COPY["how.acsBody"]}</p>
              <p className={prose} data-slot="acs-fallback">
                {COPY["how.acsFallback"]}
              </p>
              <p className={`${prose} num`} data-slot="acs-tested">
                {t("how.acsTested", { held: ACS_CONSTANTS.tested.heldOf10 })}
              </p>
              <p className={prose}>{COPY["how.acsLimits"]}</p>
            </Section>
          ) : null}

          {/* The last resort (REAL_DATA.md section 17): other buildings nearby, when it declines, what the tests found, how weak it is. */}
          {nearbyOn ? (
            <Section id="nearby">
              <p className={prose}>{COPY["how.nearbyBody"]}</p>
              <p className={prose} data-slot="nearby-out">
                {COPY["how.nearbyOut"]}
              </p>
              <p className={prose} data-slot="nearby-fallback">
                {COPY["how.nearbyFallback"]}
              </p>
              <p className={`${prose} num`} data-slot="nearby-tested">
                {t("how.nearbyTested", { held: NEARBY_CONSTANTS.tested.heldOf10 })}
              </p>
              <p className={prose} data-slot="nearby-weak">
                {COPY["how.nearbyWeak"]}
              </p>
            </Section>
          ) : null}

          <Section id="leaves-out">
            <p className={prose}>{COPY["how.out"]}</p>
          </Section>

          <Section id="data">
            <p className={prose} data-slot="data-line">
              <AttributionText source={config.data.source} />
            </p>
            <p className={`${prose} num`} data-slot="data-line">
              {loaded ?? COPY["data.loading"]}
            </p>
            <ul className="flex max-w-[62ch] list-disc flex-col gap-2 pl-5 font-display text-lg leading-relaxed text-foreground marker:text-muted-foreground" data-slot="data-included">
              {tList("how.dataIncluded").map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <p className={prose}>{COPY["how.dataBasis"]}</p>
            <p className={prose}>{COPY["how.dataDifc"]}</p>
            <p className={prose}>{COPY["how.dataSizes"]}</p>
            <p className={prose}>{COPY["how.dataRefresh"]}</p>
            <p className={prose} data-slot="data-line">
              {COPY["data.independent"]}
            </p>
          </Section>

          <Section id="reading">
            <p className={prose}>{COPY["how.read"]}</p>
          </Section>

          <Section id="not-a-valuation">
            <p className={prose}>{COPY["how.valuation"]}</p>
          </Section>

          <div className="border-t border-border pt-10">
            <Link href="/" className={buttonVariants({ size: "lg" })}>
              {COPY["nav.compareLong"]}
            </Link>
          </div>
        </article>
      </div>
    </div>
  );
}
