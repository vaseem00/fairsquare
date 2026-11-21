"use client";

import { useEffect, useState } from "react";

export interface ImageSize {
  width: number;
  height: number;
}

/** The natural size of an image URL (null until loaded): the balance sizes the screenshot on its pan with it. */
export function useImageSize(url: string | null, known?: ImageSize | null): ImageSize | null {
  const [measured, setMeasured] = useState<{ url: string; size: ImageSize } | null>(null);
  useEffect(() => {
    if (!url || known) return;
    let live = true;
    const img = new Image();
    img.onload = () => {
      if (live && img.naturalWidth > 0) setMeasured({ url, size: { width: img.naturalWidth, height: img.naturalHeight } });
    };
    img.src = url;
    return () => {
      live = false;
    };
  }, [url, known]);
  if (known) return known;
  return measured && measured.url === url ? measured.size : null;
}
