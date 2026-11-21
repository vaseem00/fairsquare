import { Fragment, type ReactNode } from "react";

const BED_TYPE = /(\d+-beds?)/;

/**
 * On-screen text with each "2-bed" or "2-beds" kept on one line: browsers break after a hard hyphen,
 * and "2-" at a line end reads badly. The text itself is unchanged (copy, search and screen readers
 * see the same string); only a nowrap span is added around the bed type.
 */
export function noBreakBeds(text: string): ReactNode {
  const parts = text.split(BED_TYPE);
  if (parts.length === 1) return text;
  return parts.map((p, i) =>
    i % 2 === 1 ? (
      <span key={i} className="whitespace-nowrap">
        {p}
      </span>
    ) : (
      <Fragment key={i}>{p}</Fragment>
    ),
  );
}
