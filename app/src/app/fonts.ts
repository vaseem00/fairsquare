/**
 * The two faces of the redesign (docs/REDESIGN.md section 2.1), self-hosted by next/font at build
 * time, so the nonce CSP is unchanged:
 * - Newsreader: the voice. Display, headings, the verdict, sentences and prose. Roman only (no italic
 *   is loaded). `font-optical-sizing: auto` lets the opsz axis follow the px size.
 * - Archivo: the tools. Buttons, inputs, labels, nav, tables, captions, figures and admin.
 * The stamp, card canvas and OG image keep their static WOFF instances (public/fonts).
 */
import { Archivo, Newsreader } from "next/font/google";

export const newsreader = Newsreader({
  subsets: ["latin"],
  axes: ["opsz"], // wght is variable by default (200-800); opsz 6-72
  display: "swap",
  variable: "--font-newsreader",
});

export const archivo = Archivo({
  subsets: ["latin"],
  axes: ["wdth"], // wght is variable by default
  display: "swap",
  variable: "--font-archivo",
});
