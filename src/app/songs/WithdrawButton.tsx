"use client";

import { useState, useTransition } from "react";
import { withdrawNomination } from "./actions";

// Eigener Client-Button (statt nacktem <form action>), damit ein fehlgeschlagenes
// Zurücknehmen dem Nutzer angezeigt werden kann — konsistent zum Result-Pattern
// der übrigen Song-Actions.
export function WithdrawButton({ nominationId }: { nominationId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onClick() {
    setError(null);
    startTransition(async () => {
      const res = await withdrawNomination(nominationId);
      if (res.status === "error") setError(res.error);
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="rounded border border-zinc-300 px-2 py-1 text-xs transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
      >
        {pending ? "…" : "Zurücknehmen"}
      </button>
      {error && (
        <span className="text-xs text-red-800 dark:text-red-200">{error}</span>
      )}
    </div>
  );
}
