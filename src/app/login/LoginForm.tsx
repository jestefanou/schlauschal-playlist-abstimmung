"use client";

import { useActionState } from "react";
import { requestMagicLink, type LoginState } from "./actions";

const initialState: LoginState = { status: "idle" };

export function LoginForm({ initialCode }: { initialCode: string }) {
  const [state, formAction, pending] = useActionState(
    requestMagicLink,
    initialState,
  );

  const codeValue =
    state.status === "error" && state.lastCode !== undefined
      ? state.lastCode
      : initialCode;

  return (
    <form action={formAction} className="flex flex-col gap-4 w-full max-w-sm">
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">E-Mail</span>
        <input
          type="email"
          name="email"
          required
          autoComplete="email"
          className="rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
          placeholder="du@beispiel.de"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">
          Invite-Code{" "}
          <span className="text-zinc-500 font-normal">
            (nur beim ersten Login)
          </span>
        </span>
        <input
          type="text"
          name="code"
          defaultValue={codeValue}
          className="rounded border border-zinc-300 px-3 py-2 font-mono dark:border-zinc-700 dark:bg-zinc-900"
          placeholder="z. B. ABCD-EFGH"
        />
      </label>
      <button
        type="submit"
        disabled={pending || state.status === "success"}
        className="rounded bg-black px-4 py-2 font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
      >
        {pending ? "Sende Magic Link…" : "Magic Link anfordern"}
      </button>
      {state.status === "error" && (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {state.error}
        </p>
      )}
      {state.status === "success" && (
        <p className="rounded border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-200">
          {state.message}
        </p>
      )}
    </form>
  );
}
