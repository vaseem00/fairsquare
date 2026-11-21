import "server-only";
/**
 * The loaded similar-buildings model (REAL_DATA.md section 15): its constants and backtest summary
 * from app_meta, and the cells of one DLD area and basis as an artifact for `compareSimilar`. The
 * comparable buildings of a listing are all in its DLD area, so one query by area and basis, plus
 * the listing's own building (it may have sales on the other basis only), returns everything the
 * comparison reads; the result is exactly what the whole table would give. Each building carries its
 * name as shown (`buildings.name`), which the list of similar buildings prints.
 */
import { and, eq, ne, or, sql } from "drizzle-orm";
import { buildProjectIndex, type ProjectIndex } from "@/lib/domain/project";
import { isIsoDate, type IsoDate } from "@/lib/domain/dates";
import type { SimilarArtifact, SimilarBasis } from "@/lib/domain/similar";
import { log } from "@/lib/log";
import { AREA_ALIASES, SimilarModelMetaSchema, type SimilarModelMeta } from "@/lib/similar/model";
import type { Db } from "../client";
import { getAppMetas } from "../meta";
import { buildings, similarCells, type SimilarCellDbRow } from "../schema";

export interface LoadedSimilarModel {
  model: SimilarModelMeta;
  /** app_meta.data_through of the loaded sales (equal to model.dataThrough). */
  dataThrough: IsoDate;
}

let parsed: { raw: string; model: SimilarModelMeta | null } | null = null;

function parseModel(raw: string): SimilarModelMeta | null {
  if (parsed && parsed.raw === raw) return parsed.model;
  let model: SimilarModelMeta | null = null;
  try {
    const r = SimilarModelMetaSchema.safeParse(JSON.parse(raw));
    if (r.success) model = r.data;
    else log.warn("similar_model_invalid", { paths: r.error.issues.slice(0, 5).map((i) => i.path.join(".")) });
  } catch {
    log.warn("similar_model_unreadable");
  }
  parsed = { raw, model };
  return model;
}

/**
 * The model that belongs to the loaded sales, or null: none loaded, unreadable, or left over from
 * another snapshot (its snapshotSha256 is not app_meta.open_data_sha).
 */
export async function readSimilarModel(db: Db): Promise<LoadedSimilarModel | null> {
  const m = await getAppMetas(db, ["similar_model", "open_data_sha", "data_through"]);
  const raw = m.get("similar_model")?.value;
  const through = m.get("data_through")?.value;
  if (!raw || !through || !isIsoDate(through)) return null;
  const model = parseModel(raw);
  if (!model || model.snapshotSha256 !== m.get("open_data_sha")?.value || model.dataThrough !== through) return null;
  return { model, dataThrough: through };
}

/** The artifact key of a building in `similarArea` artifacts. */
export const similarKey = (buildingId: number) => String(buildingId);

type NamedCell = SimilarCellDbRow & { buildingName: string };

function toArtifact(rows: readonly NamedCell[], model: SimilarModelMeta): SimilarArtifact {
  const index = new Map<number, number>();
  const out: SimilarArtifact["buildings"] = [];
  const cells: SimilarArtifact["cells"] = [];
  // A fixed order, so two runs add the same numbers in the same order.
  const sorted = [...rows].sort((x, y) => x.buildingId - y.buildingId || x.bedrooms - y.bedrooms || (x.basis < y.basis ? -1 : x.basis > y.basis ? 1 : 0));
  for (const r of sorted) {
    let b = index.get(r.buildingId);
    if (b === undefined) {
      b = out.length;
      index.set(r.buildingId, b);
      // `key` is the id (what a request names the building by); `building` is its name as shown.
      out.push({ key: similarKey(r.buildingId), building: r.buildingName, areaDld: r.areaDld, projectNumber: r.projectNumber, masterProject: r.masterProject });
    }
    cells.push({ b, bed: r.bedrooms, basis: r.basis, nRaw12: r.nRaw12, n12: r.n12, med12: r.med12, nOld1: r.nOld1, medOld1: r.medOld1, nOld2: r.nOld2, medOld2: r.medOld2 });
  }
  return { version: 1, dataThrough: model.dataThrough, windowStart: model.windowStart, buildings: out, cells };
}

/**
 * The cells of one basis in the DLD area of a building (`buildingId`) or in a named DLD area, as an
 * artifact. For a building, its own cells of both bases come too, so it is in the artifact (with its
 * place) even when it has no sale on the listing's basis; the comparison reads one basis only.
 * Empty when the building has no cell at all (it is not in the open data).
 */
export async function similarArea(
  db: Db,
  where: { buildingId: number } | { areaDld: string },
  basis: SimilarBasis,
  model: SimilarModelMeta,
): Promise<SimilarArtifact> {
  const area =
    "buildingId" in where
      ? sql`(select c.area_dld from similar_cells c where c.building_id = ${where.buildingId} limit 1)`
      : sql`${where.areaDld}`;
  const inArea = and(eq(similarCells.basis, basis), eq(similarCells.areaDld, area));
  const rows = await db
    .select({ cell: similarCells, buildingName: buildings.name })
    .from(similarCells)
    .innerJoin(buildings, eq(buildings.id, similarCells.buildingId))
    .where("buildingId" in where ? or(inArea, eq(similarCells.buildingId, where.buildingId)) : inArea);
  return toArtifact(
    rows.map((r) => ({ ...r.cell, buildingName: r.buildingName })),
    model,
  );
}

let projects: { sha: string; index: ProjectIndex } | null = null;

/**
 * The project index of the loaded cells (REAL_DATA.md section 15.8): one row per building with a
 * project number (its name as shown, its registered project name, number, DLD area and community),
 * grouped by `buildProjectIndex`. Built once per loaded snapshot and kept in memory.
 */
export async function similarProjectIndex(db: Db, model: SimilarModelMeta): Promise<ProjectIndex> {
  if (projects && projects.sha === model.snapshotSha256) return projects.index;
  const rows = await db
    .selectDistinct({
      building: buildings.name,
      project: buildings.project,
      projectNumber: similarCells.projectNumber,
      areaDld: similarCells.areaDld,
      masterProject: similarCells.masterProject,
    })
    .from(similarCells)
    .innerJoin(buildings, eq(buildings.id, similarCells.buildingId))
    .where(ne(similarCells.projectNumber, ""));
  const index = buildProjectIndex(
    rows.map((r) => ({ ...r, project: r.project ?? "" })),
    AREA_ALIASES.map((a) => a.alias),
  );
  projects = { sha: model.snapshotSha256, index };
  return index;
}