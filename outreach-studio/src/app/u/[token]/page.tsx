import { verifyUnsubscribeToken } from "@/lib/unsubscribe";
import { optOut } from "@/lib/optout";
import { isBlocked } from "@/lib/dnc";
import { getSettings } from "@/lib/settings";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const metadata = { title: "Unsubscribe", robots: { index: false } };

async function confirm(formData: FormData) {
  "use server";
  const token = String(formData.get("token"));
  const v = verifyUnsubscribeToken(token);
  if (v) optOut({ leadId: v.leadId, email: v.email, channel: "email", reason: "Unsubscribed via link" });
  redirect(`/u/${token}?done=1`);
}

export default async function Unsubscribe({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ done?: string }> }) {
  const { token } = await params;
  const { done } = await searchParams;
  const v = verifyUnsubscribeToken(token);
  const { profile } = getSettings();
  const already = v ? Boolean(isBlocked({ email: v.email })) : false;
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
      <div className="card w-full max-w-md space-y-4 text-center">
        <h1 className="h1">{profile.company}</h1>
        {!v ? (
          <p>This unsubscribe link isn&rsquo;t valid. Please reply to the email with &ldquo;unsubscribe&rdquo; and we&rsquo;ll remove you.</p>
        ) : done || already ? (
          <>
            <p className="text-lg font-medium">You&rsquo;re unsubscribed.</p>
            <p className="muted">{v.email} won&rsquo;t receive any more emails, calls or messages from {profile.company}.</p>
          </>
        ) : (
          <form action={confirm} className="space-y-4">
            <input type="hidden" name="token" value={token} />
            <p>Stop all contact from {profile.company} to <strong>{v.email}</strong>?</p>
            <button className="btn-primary w-full">Unsubscribe</button>
          </form>
        )}
        <p className="text-xs text-gray-500">{profile.company}, {profile.address}</p>
      </div>
    </div>
  );
}
