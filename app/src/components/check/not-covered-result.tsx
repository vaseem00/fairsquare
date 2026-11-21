"use client";

/**
 * The below slot of a not-covered result (docs/REDESIGN.md section 8.5; A§0.2): no stamp and no card.
 * - The sentence (RESULT_SPEC section 6.7): "We couldn't match “Nowhere Point Tower” to a building in
 *   Dubai Land Department sales data. DLD may list it under the project or developer name. Fairsquare
 *   covers 6 buildings. Request this one and track it under Saved." ({n} is `total` from GET
 *   /api/buildings). While no sales data is loaded, every comparison is "not covered", so the sentence
 *   says the data is being loaded instead. The fact line with Edit sits above it (the fact slot).
 * - "Search covered buildings" (a text button): choosing a building re-settles the result in place with
 *   the same values (no form, no balance; RESULT_SPEC section 7).
 * - "Request it and track" (the primary, in the sticky bar on phones): one POST /api/requests with the
 *   comparison code (choosing "None of these" alone files nothing). Then the plain status line
 *   "Requested. It shows under Saved. {n} other people asked for it too." and the inert "Requested".
 */
import { CheckIcon } from "lucide-react";
import { useState } from "react";
import { BuildingSearch, useCoverage } from "@/components/check/building-search";
import { ActionBar } from "@/components/flow/action-bar";
import { SimilarSection } from "@/components/result/similar-section";
import { SETTLE_AT, SettleIn } from "@/components/scene/use-settle";
import { usePublicConfig } from "@/components/shell/config-provider";
import { useMe } from "@/components/shell/me-provider";
import { Button } from "@/components/ui/button";
import type { PickedBuilding } from "@/hooks/use-check-flow";
import { api } from "@/lib/api/client";
import { COPY, t } from "@/lib/copy";
import { keepFiguresTogether } from "@/lib/format";
import type { CheckView } from "@/lib/types";

type RequestState =
  | { status: "idle" }
  | { status: "sending" }
  | { status: "done"; othersAsked: number }
  | { status: "error"; message: string };

/** Requests filed in this tab, so Back and Forward keep "Requested" (memory only). */
const requested = new Map<string, number>();

/** Tests: forget filed requests. */
export function __resetRequestedForTests(): void {
  requested.clear();
}

export function doneMessage(othersAsked: number): string {
  return othersAsked > 0 ? t("none.done", { n: othersAsked }) : COPY["none.doneAlone"];
}

/** The not-covered sentence: why there is no match, then the coverage count when it is known. */
export function notCoveredSentence(check: Pick<CheckView, "buildingText">, buildingsCovered?: number): string {
  const head = t("none.noMatch", { building: check.buildingText });
  return buildingsCovered === undefined ? head : `${head} ${t("none.body", { n: buildingsCovered })}`;
}

/**
 * The not-covered sentence on its own (the /c page): why there is no match, or, while no sales data is
 * loaded, that it is being loaded.
 */
export function NotCoveredSentence({ check, className }: { check: CheckView; className?: string }) {
  const { data } = usePublicConfig();
  return (
    <p className={className ?? "type-lead max-w-[52ch] text-foreground num"} data-slot="verdict-sentence">
      {keepFiguresTogether(data.loaded ? notCoveredSentence(check) : COPY["data.loading"])}
    </p>
  );
}

export function NotCoveredBelow({
  check,
  onPickBuilding,
}: {
  check: CheckView;
  onPickBuilding: (b: PickedBuilding) => void;
}) {
  const { refresh } = useMe();
  const { data } = usePublicConfig();
  const coverage = useCoverage(data.loaded);
  const [searchOpen, setSearchOpen] = useState(false);
  const [req, setReq] = useState<RequestState>(() => {
    const n = requested.get(check.code);
    return n === undefined ? { status: "idle" } : { status: "done", othersAsked: n };
  });

  const request = async () => {
    if (req.status === "sending" || req.status === "done") return;
    setReq({ status: "sending" });
    const res = await api.requests.create({
      text: check.buildingText,
      ...(check.areaText ? { area: check.areaText } : {}),
      code: check.code,
    });
    if (!res.ok) {
      setReq({ status: "error", message: res.error.message || COPY["error.compareFailed"] });
      return;
    }
    requested.set(check.code, res.data.othersAsked);
    // The role="status" line below announces it: no second announce() of the same text.
    setReq({ status: "done", othersAsked: res.data.othersAsked });
    void refresh();
  };

  const done = req.status === "done";
  const sending = req.status === "sending";
  // No sales data loaded yet (REAL_DATA.md section 7): every comparison is "not covered" for now.
  const sentence = !data.loaded
    ? COPY["data.loading"]
    : notCoveredSentence(check, coverage?.total);

  return (
    <div className="flex flex-col items-start gap-4 pt-4" data-slot="result-below">
      <SettleIn at={SETTLE_AT.rest}>
        <p className="type-lead max-w-[52ch] text-foreground num" data-slot="verdict-sentence">
          {keepFiguresTogether(sentence)}
        </p>
      </SettleIn>
      <Button type="button" variant="link" onClick={() => setSearchOpen(true)} className="self-start">
        {COPY["pick.search"]}
      </Button>
      <BuildingSearch open={searchOpen} onOpenChange={setSearchOpen} onPick={onPickBuilding} />
      {/* The second tier (REAL_DATA.md section 15.8): a building that is not in the data gets a range only
          from the project route (off-plan, its project named, other buildings of it with sales); an area
          or a community alone never does. Otherwise this renders nothing. */}
      <SimilarSection check={check} />
      {/* Always in the page (a live region must exist before it speaks); visible once requested. */}
      <p role="status" className={done ? "max-w-[52ch] text-body text-foreground" : "sr-only"} data-slot="request-done">
        {done ? doneMessage(req.othersAsked) : ""}
      </p>
      {req.status === "error" ? (
        <p role="alert" className="max-w-[52ch] border-l-2 border-destructive pl-3 text-body text-destructive" data-slot="request-error">
          {req.message}
        </p>
      ) : null}
      <SettleIn at={SETTLE_AT.edit} className="w-full">
        <ActionBar>
          <Button
            type="button"
            size="lg"
            variant={done ? "outline" : "default"}
            aria-disabled={done || sending || undefined}
            onClick={request}
            className="gap-2"
            data-slot="request-button"
          >
            {done ? <CheckIcon aria-hidden="true" strokeWidth={1.75} /> : null}
            {done ? COPY["none.ctaDone"] : COPY["none.cta"]}
          </Button>
        </ActionBar>
      </SettleIn>
    </div>
  );
}
