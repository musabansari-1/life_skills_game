import Link from "next/link";
import { signOutAction } from "@/app/actions/auth";

export function TopBar({ playerName, right }: { playerName: string; right?: React.ReactNode }) {
  return (
    <header className="px-4 sm:px-6 py-4 flex items-center justify-between gap-4 border-b border-line">
      <Link href="/world" className="font-display text-lg tracking-wide">
        Counterpart
      </Link>
      <div className="flex items-center gap-3 text-sm">
        {right}
        <span className="text-paper-2 hidden sm:inline">{playerName}</span>
        <form action={signOutAction}>
          <button className="btn btn-quiet px-2 py-1 text-xs" type="submit">
            Sign out
          </button>
        </form>
      </div>
    </header>
  );
}
