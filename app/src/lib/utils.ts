import { createCn } from "cn/config"

/**
 * Class merging (clsx + tailwind-merge semantics) that knows DESIGN.md section 2.2's type scale:
 * `text-caption`, `text-body`, ... are font sizes, so they replace `text-sm` and never knock out a
 * text colour such as `text-muted-foreground` (the default config reads unknown `text-*` as colours).
 */
export const cn = createCn({
  extend: {
    classGroups: {
      "font-size": [{ text: ["caption", "body", "lead", "title", "heading", "display-sm", "display-md", "display"] }],
    },
  },
})
