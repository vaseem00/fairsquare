import type { MetadataRoute } from "next";
import { COPY } from "@/lib/copy";

/** Web app manifest (paper ground, petrol theme; DESIGN.md sections 2.1 and 2.8). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: COPY["app.name"],
    short_name: COPY["app.name"],
    description: COPY["app.description"],
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#F2F4F1",
    theme_color: "#0F4C5C",
    lang: "en",
    icons: [
      { src: "/icon.svg", type: "image/svg+xml", sizes: "any" },
      { src: "/apple-icon.png", type: "image/png", sizes: "180x180" },
    ],
  };
}
