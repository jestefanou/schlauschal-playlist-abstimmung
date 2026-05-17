import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/auth/actions";

export async function Header() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims ?? null;

  if (!claims) return null;

  const email = typeof claims.email === "string" ? claims.email : null;

  return (
    <header className="flex items-center justify-between border-b border-zinc-200 bg-white px-6 py-3 dark:border-zinc-800 dark:bg-black">
      <div className="text-sm font-semibold tracking-tight">
        Schlauchschal Playlist
      </div>
      <form action={signOut} className="flex items-center gap-3">
        {email && (
          <span className="hidden text-sm text-zinc-600 sm:inline dark:text-zinc-400">
            {email}
          </span>
        )}
        <button
          type="submit"
          className="rounded border border-zinc-300 px-3 py-1 text-sm transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          Abmelden
        </button>
      </form>
    </header>
  );
}
