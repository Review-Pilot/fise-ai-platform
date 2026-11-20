import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";
export const metadata = { title: "FiseOutreachBot" };

export default function BotInfo() {
  const { profile } = getSettings();
  return (
    <div className="mx-auto max-w-2xl space-y-3 p-8 text-sm leading-6">
      <h1 className="h1">FiseOutreachBot</h1>
      <p>FiseOutreachBot is operated by {profile.company}. It occasionally reads a small business&rsquo;s public homepage, contact and about pages to understand what the business does before we get in touch about website chat.</p>
      <p>It fetches at most a handful of pages per site, waits between requests, and obeys robots.txt. To block it, add:</p>
      <pre className="rounded bg-gray-100 p-3">User-agent: FiseOutreachBot{"\n"}Disallow: /</pre>
      <p>Questions or removal requests: {profile.senderName}, {profile.phone}, {profile.address}.</p>
    </div>
  );
}
