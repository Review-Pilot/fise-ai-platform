"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Task = { id: string; lead_id: string; channel: string; message: string; url: string | null; business_name: string };
const LABEL: Record<string, string> = { whatsapp: "WhatsApp", contact_form: "Contact form", linkedin: "LinkedIn", facebook: "Facebook", instagram: "Instagram" };

export function TaskList({ tasks }: { tasks: Task[] }) {
  const router = useRouter();
  const [copied, setCopied] = useState<string | null>(null);
  const mark = async (id: string, status: string) => {
    await fetch(`/api/tasks/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }) });
    router.refresh();
  };
  if (!tasks.length) return <p className="muted">No manual tasks. Select leads and choose “Prepare manual tasks”.</p>;
  return (
    <ul className="divide-y divide-gray-100">
      {tasks.map((t) => (
        <li key={t.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
          <div className="min-w-0 flex-1 text-sm">
            <div className="font-medium">{LABEL[t.channel] ?? t.channel} · {t.business_name}</div>
            <p className="line-clamp-2 text-gray-600">{t.message}</p>
          </div>
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={async () => { await navigator.clipboard.writeText(t.message); setCopied(t.id); }}>{copied === t.id ? "Copied" : "Copy"}</button>
            {t.url && <a className="btn-secondary" href={t.url} target="_blank" rel="noreferrer">Open</a>}
            <button className="btn-primary" onClick={() => mark(t.id, "done")}>Mark sent</button>
            <button className="btn-secondary" onClick={() => mark(t.id, "skipped")}>Skip</button>
          </div>
        </li>
      ))}
    </ul>
  );
}
