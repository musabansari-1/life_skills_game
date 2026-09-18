"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function StartQuestButton({ questId, npcName }: { questId: string; npcName: string }) {
  const router = useRouter();
  const [pending, setPending] = useState<null | "voice" | "text">(null);
  const [error, setError] = useState<string | null>(null);

  async function start(modality: "voice" | "text") {
    setPending(modality);
    setError(null);
    try {
      const res = await fetch(`/api/quests/${questId}/start`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ modality }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Couldn't start the scene.");
      router.push(`/play/${json.attemptId}?mode=${modality}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start the scene.");
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => start("voice")} disabled={pending !== null} className="btn btn-primary">
          {pending === "voice" ? `${npcName} is picking up…` : "Enter the scene"}
          {pending !== "voice" && <MicIcon />}
        </button>
        <button type="button" onClick={() => start("text")} disabled={pending !== null} className="btn btn-ghost">
          {pending === "text" ? "Entering…" : "Text only"}
        </button>
      </div>
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
