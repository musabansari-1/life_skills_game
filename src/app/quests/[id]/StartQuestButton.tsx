"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { createGameClient } from "@/client/gameClient";

export function StartQuestButton({ questId, npcName, replayMode = "first" }: { questId: string; npcName: string; replayMode?: "first" | "second_chance" | "rehearsal" }) {
  const router = useRouter();
  const [pending, setPending] = useState<null | "voice" | "text">(null);
  const [error, setError] = useState<string | null>(null);
  const api = useMemo(() => createGameClient({ baseUrl: "" }), []);

  async function start(modality: "voice" | "text", mode: "story" | "practice" = "story") {
    setPending(modality);
    setError(null);
    try {
      const { attempt } = await api.startQuest(questId, modality, mode);
      router.push(`/play/${attempt.id}?mode=${modality}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start the scene.");
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => start("voice")} disabled={pending !== null} className="btn btn-primary">
          {pending === "voice" ? `${npcName} is picking up…` : replayMode === "rehearsal" ? "Rehearse the scene" : replayMode === "second_chance" ? "Try the repair again" : "Enter the scene"}
          {pending !== "voice" && <MicIcon />}
        </button>
        <button type="button" onClick={() => start("text")} disabled={pending !== null} className="btn btn-ghost">
          {pending === "text" ? "Entering…" : "Text only"}
        </button>
      </div>
      {replayMode !== "rehearsal" && <button type="button" onClick={() => start("voice", "practice")} disabled={pending !== null} className="btn btn-quiet self-start text-xs">Practice first · skills grow, story stays</button>}
      {error && (
        <p role="alert" className="text-sm text-warn">
          {error}
        </p>
      )}
    </div>
  );
}

function MicIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0M12 17v5" />
    </svg>
  );
}
