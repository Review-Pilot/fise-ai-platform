"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Card = { id: string; name: string; score: number | null; city: string | null; route: string | null; last: string | null };

export function Board({ columns }: { columns: { status: string; cards: Card[] }[] }) {
  const router = useRouter();
  const [cols, setCols] = useState(columns);
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  async function move(id: string, to: string) {
    const from = cols.find((c) => c.cards.some((x) => x.id === id));
    if (!from || from.status === to) return;
    if (to === "Do not contact" && !confirm("Add this lead's contact details to the do-not-contact list?")) return;
    const card = from.cards.find((x) => x.id === id)!;
    setCols(cols.map((c) => (c.status === from.status ? { ...c, cards: c.cards.filter((x) => x.id !== id) } : c.status === to ? { ...c, cards: [card, ...c.cards] } : c)));
    const res = await fetch(`/api/leads/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: to }) });
    if (!res.ok) router.refresh();
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-4">
      {cols.map((col) => (
        <div
          key={col.status}
          onDragOver={(e) => { e.preventDefault(); setOver(col.status); }}
          onDragLeave={() => setOver(null)}
          onDrop={(e) => { e.preventDefault(); setOver(null); if (drag) move(drag, col.status); }}
          className={`flex w-64 shrink-0 flex-col rounded-xl border p-2 ${over === col.status ? "border-brand bg-brand/5" : "border-gray-200 bg-gray-50"}`}
        >
          <div className="mb-2 flex items-center justify-between px-1 text-sm font-semibold">
            {col.status}<span className="text-xs font-normal text-gray-500">{col.cards.length}</span>
          </div>
          <div className="flex min-h-24 flex-col gap-2">
            {col.cards.map((c) => (
              <div key={c.id} draggable onDragStart={() => setDrag(c.id)} onDragEnd={() => setDrag(null)}
                className="cursor-grab rounded-lg border border-gray-200 bg-white p-2.5 text-sm shadow-sm active:cursor-grabbing">
                <Link href={`/leads/${c.id}`} className="font-medium hover:text-brand">{c.name}</Link>
                <div className="mt-0.5 flex justify-between text-xs text-gray-500">
                  <span>{c.city ?? ""}</span>
                  {c.score !== null && <span>{c.score}</span>}
                </div>
                {c.last && <div className="text-xs text-gray-400">last contact {c.last.slice(0, 10)}</div>}
                <label className="sr-only" htmlFor={`mv-${c.id}`}>Move {c.name}</label>
                <select id={`mv-${c.id}`} className="mt-1 w-full rounded border border-gray-200 text-xs md:hidden" value={col.status} onChange={(e) => move(c.id, e.target.value)}>
                  {cols.map((x) => <option key={x.status}>{x.status}</option>)}
                </select>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
