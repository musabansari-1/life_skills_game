"use client";

/** Shown when a conclusion is still being computed (e.g. another tab or a retried request). Polls until done. */
import { useRouter } from "next/navigation";
import { useEffect, useMemo } from "react";
import { createGameClient } from "@/client/gameClient";

export function Waiting({ attemptId, npcName }: { attemptId: string; npcName: string }) {
  const router = useRouter();
  const api = useMemo(() => createGameClient({ baseUrl: "" }), []);
  useEffect(() => {
    const t = setInterval(async () => {
      const a = await api.attempt(attemptId).catch(() => null);
      if (a && a.attempt.status !== "evaluating") router.refresh();
    }, 3000);
    return () => clearInterval(t);
  }, [api, attemptId, router]);
  return (
    <main className="flex-1 flex items-center justify-center p-6">
      <div className="text-center fade-up">
        <p className="eyebrow">Mission ending</p>
        <p className="font-display text-3xl mt-2">Still reading the room…</p>
        <p className="text-paper-3 text-sm mt-3">{npcName} is making notes. This page updates on its own.</p>
      </div>
    </main>
  );
}
