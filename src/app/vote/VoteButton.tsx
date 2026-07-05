"use client";

import { useState, useTransition } from "react";
import { castVote, withdrawVote, type VoteResult } from "./actions";

// Sofort-Toggle (Q5.3): ein Klick gibt die Stimme, ein weiterer zieht sie zurück.
// Fehler (Budget, Phase vorbei, Doppel-Stimme) kommen als Result zurück und
// werden inline angezeigt — konsistent zum Pattern der Song-Actions.
export function VoteButton({
  nominationId,
  voted,
  budgetLeft,
}: {
  nominationId: string;
  voted: boolean;
  budgetLeft: number;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const blocked = !voted && budgetLeft <= 0;

  function onClick() {
    setError(null);
    startTransition(async () => {
      const res: VoteResult = voted
        ? await withdrawVote(nominationId)
        : await castVote(nominationId);
      if (res.status === "error") setError(res.error);
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={pending || blocked}
        title={blocked ? "Stimmen-Budget aufgebraucht" : undefined}
        className={
          voted
            ? "rounded bg-black px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
            : "rounded border border-zinc-300 px-3 py-1 text-xs transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
        }
      >
        {pending ? "…" : voted ? "Zurückziehen" : "Abstimmen"}
      </button>
      {error && (
        <span className="max-w-48 text-right text-xs text-red-800 dark:text-red-200">
          {error}
        </span>
      )}
    </div>
  );
}
