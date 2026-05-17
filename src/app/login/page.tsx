import { LoginForm } from "./LoginForm";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string; auth_error?: string }>;
}) {
  const sp = await searchParams;
  const initialCode = sp.invite ?? "";
  const authError = sp.auth_error ?? "";

  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-zinc-50 px-6 py-16 dark:bg-black">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            Schlauchschal Playlist
          </h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Trag deine E-Mail ein — wir schicken dir einen Magic Link. Beim
            ersten Login brauchst du einen Invite-Code.
          </p>
        </header>
        {authError && (
          <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
            {authError}
          </p>
        )}
        <LoginForm initialCode={initialCode} />
        {process.env.NODE_ENV === "development" && (
          <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
            <strong>Dev:</strong> Magic-Link-Mails landen in{" "}
            <a
              href="http://127.0.0.1:54324"
              className="underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              Mailpit
            </a>
            , nicht im echten Postfach.
          </p>
        )}
      </div>
    </main>
  );
}
