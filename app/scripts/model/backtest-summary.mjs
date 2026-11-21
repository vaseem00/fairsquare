/**
 * Writes src/lib/similar/backtest.json from <MODEL_WORK>/backtest-run.json (backtest.py) and
 * <MODEL_WORK>/served.json (served.mjs), so no figure is copied by hand. Both must be of the snapshot
 * and the constants in the repository; this script refuses anything else.
 *
 *   node scripts/model/backtest-summary.mjs
 *
 * The two whole numbers the copy states (`statement`) are each the LOWER of their two measured
 * shares, rounded DOWN to a whole number of tenths.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = process.env.FAIRSQUARE_REPO || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const WORK = process.env.MODEL_WORK || path.join(REPO, ".data", "model");
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const run = read(path.join(WORK, "backtest-run.json"));
const served = read(path.join(WORK, "served.json"));
const constants = read(path.join(REPO, "src", "lib", "similar", "constants.json"));
const previous = read(path.join(REPO, "src", "lib", "similar", "backtest.json"));

for (const [name, r] of [["backtest-run.json", run], ["served.json", served]]) {
  if (r.constantsVersion !== constants.version) throw new Error(`${name} was made with constants version ${r.constantsVersion}, the repository has ${constants.version}. Run it again.`);
  if (r.snapshotSha256 !== constants.fittedOn.snapshotSha256) throw new Error(`${name} is of another snapshot than the one the constants were fitted on.`);
}

const T = run.tests;
const pick = (label, keys = ["typicalErrorPct", "p80ErrorPct", "p90ErrorPct", "coveragePct", "typicalRangePct"]) => {
  const t = T[label];
  if (!t) throw new Error(`backtest-run.json has no test "${label}"`);
  return { cases: t.cases, shownPct: t.shownPct, ...Object.fromEntries(keys.map((k) => [k, t.shown[k]])) };
};
const dates = Object.keys(T)
  .map((k) => /^D from (\d{4}-\d{2}-\d{2}): all real too-few$/.exec(k)?.[1])
  .filter(Boolean)
  .sort()
  .reverse();
const forward = (suffix) => dates.map((from) => ({ from, ...pick(`D from ${from}: ${suffix}`, ["typicalErrorPct", "p80ErrorPct", "coveragePct"]), shownCases: T[`D from ${from}: ${suffix}`].shown.n }));
const refusedHeld = T["LBO own thinned"].refusedWouldHaveHeldPct;

const leaveBuildingOut = { own: pick("LBO own thinned"), indirect: pick("LBO indirect thinned") };
const laterAll = forward("all real too-few");
const tenths = (...shares) => Math.floor(Math.min(...shares) / 10);
const calls = run.calls.all;

const out = {
  about:
    "Summary of the backtest of the similar-buildings comparison, written by scripts/model/backtest-summary.mjs from the output of scripts/model/backtest.py and served.mjs (never by hand). data:build copies it into manifest.json. Every figure is of the ranges the rule SHOWS (studios to 3 bedrooms). Percentages are of the building's true median AED per sq ft. Run the three scripts again whenever the constants, the rule or the snapshot they were fitted on change.",
  fittedOn: { dataThrough: constants.fittedOn.dataThrough, snapshotSha256: constants.fittedOn.snapshotSha256 },
  constantsVersion: constants.version,
  seed: run.seed,
  testCombinations: run.testCombinations,
  leaveBuildingOut,
  leaveProjectOut: {
    own: pick("LPO own thinned", ["typicalErrorPct", "p80ErrorPct", "coveragePct"]),
    indirect: pick("LPO indirect thinned", ["typicalErrorPct", "p80ErrorPct", "coveragePct"]),
  },
  next183Days: {
    note: "Real too-few combinations at the start date, scored against the median of the following 183 days (5 or more sales there). Prices moved 3% to 4% in each half-year.",
    all: laterAll,
    own: forward("real too-few, 1 to 4 own sales"),
    bedroomTypeNeverSold: forward("bedroom type not sold in 36 months"),
  },
  thinBuildings: {
    note: "Really thin combinations on a like-for-like noisy target, so both real and simulated sit below the level of the first table.",
    small5to9OwnCoveragePct: T["B small (5 to 9 sales), own"].shown.coveragePct,
    small5to9NoOwnCoveragePct: T["B small (5 to 9 sales), indirect"].shown.coveragePct,
    thin2to4HeldOutSaleCoveragePct: T["C real thin (2 to 4), one sale held out as the target"].shown.coveragePct,
    thin2to4HeldOutSaleSimulatedCoveragePct: T["C rich cut to 2 to 4, the same"].shown.coveragePct,
    oneSaleNoOwnCoveragePct: T["C real one-sale, indirect, that sale as the target"].shown.coveragePct,
    oneSaleNoOwnSimulatedCoveragePct: T["C rich cut to 2 to 4, indirect, one sale as the target"].shown.coveragePct,
  },
  consistencyRules: {
    note: "What the rules of constants version 2 refuse, and how often a range would have held the median had it been shown (leave building out, 1 to 4 own sales, thinned).",
    refusedCases: T["LBO own thinned"].refused,
    wouldHaveHeldPct: refusedHeld,
  },
  // Not recomputed by these scripts: the forward test on buildings first seen after the start date
  // (the verification of 19 Nov 2026). The classes it covers are never shown.
  notInTheData: previous.notInTheData,
  againstSameBuildingRule: {
    note: "Listings priced like single registered sales, on shown ranges. Of the results that say above: what the same-building rule says.",
    abovePct: calls.abovePct,
    withinPct: calls.withinPct,
    belowPct: calls.belowPct,
    aboveAgreesPct: calls.says_above.sameBuildingAbovePct,
    aboveInLinePct: calls.says_above.sameBuildingInLinePct,
    aboveOppositePct: calls.says_above.sameBuildingBelowPct,
  },
  served: {
    tooFewCombinations: served.tooFewCombinations,
    shownPct: served.shownPct,
    closePct: served.closePct,
    broadPct: served.broadPct,
    shownWeightedBySalesPct: served.shownWeightedBySalesPct,
    studioTo3ShownPct: served.studioTo3ShownPct,
    notShown: served.notShown,
    shownThatReadOtherBuildings: served.shownThatReadOtherBuildings,
    otherBuildingsMediansOver2x: served.otherBuildingsMediansOver2x,
    otherBuildingsMediansOver3x: served.otherBuildingsMediansOver3x,
    bedroomTypeNeverSold: served.bedroomTypeNeverSold,
  },
  statement: {
    about:
      "The two whole numbers the copy may state (similar.tested). heldOf10: the lower of the two leave-building-out shares (own, indirect), rounded down to tenths. heldLaterOf10: the lower of the two shares against the following 183 days (all shown real too-few combinations, two start dates), rounded down.",
    heldOf10: tenths(leaveBuildingOut.own.coveragePct, leaveBuildingOut.indirect.coveragePct),
    heldLaterOf10: tenths(...laterAll.map((x) => x.coveragePct)),
  },
};
const file = path.join(REPO, "src", "lib", "similar", "backtest.json");
fs.writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);
process.stdout.write(`statement: held ${out.statement.heldOf10} of 10, later ${out.statement.heldLaterOf10} of 10\nwritten ${file}\n`);
