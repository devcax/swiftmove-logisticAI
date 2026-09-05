"use client";

import * as React from "react";
import createCache, { type EmotionCache } from "@emotion/cache";
import { CacheProvider } from "@emotion/react";
import CssBaseline from "@mui/material/CssBaseline";
import { ThemeProvider } from "@mui/material/styles";
import { useServerInsertedHTML } from "next/navigation";
import theme from "./theme";

function createEmotionCache(): { cache: EmotionCache; flush: () => string[] } {
  const cache = createCache({ key: "mui", prepend: true });
  cache.compat = true;

  const prevInsert = cache.insert;
  let inserted: string[] = [];
  cache.insert = (...args) => {
    const serialized = args[1];
    if (serialized.name && !inserted.includes(serialized.name)) {
      inserted.push(serialized.name);
    }
    return prevInsert(...args);
  };

  const flush = () => {
    const prev = inserted;
    inserted = [];
    return prev;
  };

  return { cache, flush };
}

export default function ThemeRegistry({
  children,
}: {
  children: React.ReactNode;
}) {
  const [{ cache, flush }] = React.useState(createEmotionCache);

  useServerInsertedHTML(() => {
    const names = flush();
    if (names.length === 0) return null;
    let styles = "";
    for (const name of names) {
      styles += cache.inserted[name];
    }
    return (
      <style
        data-emotion={`${cache.key} ${names.join(" ")}`}
        dangerouslySetInnerHTML={{ __html: styles }}
      />
    );
  });

  return (
    <CacheProvider value={cache}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </CacheProvider>
  );
}
