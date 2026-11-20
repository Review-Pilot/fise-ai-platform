export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const sp = await searchParams;
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <form method="post" action="/api/login" className="card w-full max-w-sm space-y-4">
        <div>
          <div className="h1">Fise Outreach Studio</div>
          <p className="muted">Sign in to continue</p>
        </div>
        <input type="hidden" name="next" value={sp.next ?? "/"} />
        <div>
          <label className="label" htmlFor="password">Password</label>
          <input className="input" id="password" name="password" type="password" autoFocus required />
        </div>
        {sp.error && <p className="text-sm text-red-600">That password is not right.</p>}
        <button className="btn-primary w-full">Sign in</button>
      </form>
    </div>
  );
}
