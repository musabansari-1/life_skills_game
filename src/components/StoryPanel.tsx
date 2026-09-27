"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createGameClient } from "@/client/gameClient";
import type { NarrativeView } from "@/contracts/api";
import { GOAL_LABELS, type PlayerGoal } from "@/engine/director/types";

export function StoryPanel({ story, busy, hideRecommendation = false }: { story: NarrativeView; busy: boolean; hideRecommendation?: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const p = hideRecommendation ? null : story.recommendation;
  async function prepare() {
    setPending(true); setError(null);
    try { await createGameClient({ baseUrl: "" }).refreshDirector(); router.refresh(); }
    catch (err) { setError(err instanceof Error ? err.message : "Couldn't prepare the next scene."); }
    finally { setPending(false); }
  }
  return <div className="space-y-4">
    {p && <section className="card border-brass/40 p-5 sm:p-7 relative overflow-hidden">
      <div className="absolute top-0 left-0 w-1 h-full bg-brass/60" />
      <p className="eyebrow text-brass">{p.eventType === "boss" ? "A conversation that matters" : p.eventType === "consequence" ? "Something you said is coming back" : p.eventType === "relationship" ? "A familiar voice" : p.eventType === "skill_challenge" ? "Also waiting for you" : "Also waiting for you"}</p>
      <h2 className="font-display text-2xl sm:text-3xl mt-2">{p.title}</h2>
      <p className="text-xs text-paper-3 mt-2">With {p.npcName} · {p.difficulty <= 2 ? "Room to find your footing" : p.difficulty >= 4 ? "Several skills, one conversation" : "Expect some pushback"}</p>
      <p className="text-paper-2 leading-relaxed mt-4 max-w-2xl">{p.summary}</p>
      <div className="flex flex-wrap gap-2 mt-4">{p.focus.slice(0, 3).map((s) => <span key={s} className="text-xs border border-line rounded-full px-2.5 py-1 text-paper-3">{s}</span>)}</div>
      <details className="mt-5 text-sm">
        <summary className="text-brass cursor-pointer">Why this appeared</summary>
        <p className="mt-3 text-paper-2 leading-relaxed">{p.whyNow}</p>
        <ul className="mt-2 space-y-1 text-paper-3">{p.history.filter((h) => !p.whyNow.includes(h)).slice(0, 3).map((h, i) => <li key={i}>{h}</li>)}</ul>
      </details>
      {!busy && <div className="mt-5">{p.approved ? <Link href={`/quests/${p.questId}`} className="btn btn-primary">See the situation <span aria-hidden>→</span></Link> : <button className="btn btn-primary" disabled={pending} onClick={prepare}>{pending ? "Preparing the situation…" : "See what's waiting"}</button>}</div>}
      {error && <p role="alert" className="text-sm text-warn mt-3">{error}</p>}
    </section>}
    {story.threads.length > 0 && <section className="card p-5 sm:p-6">
      <p className="eyebrow mb-4">Threads that connect</p>
      <ol className="space-y-5">{story.threads.slice().sort((a, b) => Number(a.status === "resolved") - Number(b.status === "resolved")).map((t) => <li key={t.id} className="border-l border-brass/30 pl-4">
        <p className="text-xs text-brass mb-1">{t.status === "resolved" ? "What came of it" : t.status === "ready" ? "Still in play" : "Taking shape"}</p>
        <h3 className="font-display text-lg">{t.title}</h3>
        <p className="text-sm text-paper-2 mt-1 leading-relaxed">{t.resolution ?? t.explanation}</p>
        <Link href={`/results/${t.sourceAttemptId}`} className="inline-block text-xs text-paper-3 hover:text-brass mt-2">Began with: {t.sourceTitle} <span aria-hidden>↗</span></Link>
      </li>)}</ol>
    </section>}
  </div>;
}

export function PlayerGoals({ story, busy }: { story: NarrativeView; busy: boolean }) {
  const router = useRouter();
  const [goals, setGoals] = useState(story.preferences.goals);
  const [upcoming, setUpcoming] = useState(story.preferences.upcoming);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  async function save() {
    setPending(true); setMessage("");
    try { await createGameClient({ baseUrl: "" }).saveGoals({ goals, upcoming }); setMessage("Your next situation will take this into account."); router.refresh(); }
    catch (err) { setMessage(err instanceof Error ? err.message : "Couldn't save your focus."); }
    finally { setPending(false); }
  }
  return <section className="card p-5">
    <p className="eyebrow">What are you working toward?</p>
    <p className="text-xs text-paper-3 mt-2 mb-3">Optional. Choose up to three, or let your conversations guide the story.</p>
    <fieldset disabled={busy || pending} className="space-y-2">
      <legend className="sr-only">Your goals</legend>
      {(Object.entries(GOAL_LABELS) as [PlayerGoal, string][]).map(([id, label]) => <label key={id} className="flex gap-2 items-center text-sm text-paper-2">
        <input type="checkbox" className="accent-[#c9a66b]" checked={goals.includes(id)} disabled={!goals.includes(id) && goals.length >= 3} onChange={() => setGoals((old) => old.includes(id) ? old.filter((g) => g !== id) : [...old, id])} />{label}
      </label>)}
      <label className="block text-xs text-paper-3 pt-3">Something coming up?
        <select aria-label="Upcoming conversation focus" className="mt-2 block w-full rounded border border-line bg-ink-2 p-2 text-paper" value={upcoming?.goal ?? ""} onChange={(e) => setUpcoming(e.target.value ? { goal: e.target.value as PlayerGoal, horizon: upcoming?.horizon ?? "soon" } : null)}>
          <option value="">Nothing specific</option>
          {(Object.entries(GOAL_LABELS) as [PlayerGoal, string][]).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
      </label>
      {upcoming && <select aria-label="When is it coming up?" className="w-full rounded border border-line bg-ink-2 p-2 text-sm text-paper" value={upcoming.horizon} onChange={(e) => setUpcoming({ ...upcoming, horizon: e.target.value as NonNullable<typeof upcoming>["horizon"] })}>
        <option value="soon">In the next day or two</option><option value="this_week">This week</option><option value="someday">Further ahead</option>
      </select>}
      <button type="button" className="btn btn-ghost text-xs mt-3" onClick={save}>{pending ? "Saving…" : "Save my focus"}</button>
    </fieldset>
    {busy && <p className="text-xs text-paper-3 mt-3">You can change your focus after this conversation.</p>}
    {message && <p role="status" className="text-xs text-paper-2 mt-3">{message}</p>}
  </section>;
}
