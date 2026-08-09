import React from "react";
import { toast } from "sonner";

const RETRY_FLAG_PREFIX = "lazy-retry:";

const isRecoverableChunkError = (error: unknown) => {
  const message = String(
    (error as { message?: string } | null | undefined)?.message || error || ""
  ).toLowerCase();

  return (
    message.includes("failed to fetch dynamically imported module") ||
    message.includes("importing a module script failed") ||
    message.includes("chunkloaderror") ||
    message.includes("loading chunk") ||
    message.includes("dynamically imported module")
  );
};

export const lazyWithRetry = <T extends React.ComponentType<any>>(
  importer: () => Promise<{ default: T }>,
  key: string
) =>
  React.lazy(async () => {
    try {
      const loaded = await importer();
      if (typeof window !== "undefined") {
        sessionStorage.removeItem(`${RETRY_FLAG_PREFIX}${key}`);
      }
      return loaded;
    } catch (error) {
      if (
        typeof window !== "undefined" &&
        isRecoverableChunkError(error)
      ) {
        const storageKey = `${RETRY_FLAG_PREFIX}${key}`;
        const hasRetried = sessionStorage.getItem(storageKey) === "1";

        if (!hasRetried) {
          sessionStorage.setItem(storageKey, "1");
          toast.info("A new version is available. Reloading this page...");
          await new Promise((resolve) => window.setTimeout(resolve, 900));
          window.location.reload();
          await new Promise(() => {});
        }
      }

      throw error;
    }
  });
