import { db } from "@/lib/db";
import { LEAD_STATUSES } from "@/lib/types";
import { Board } from "./Board";

export default function PipelinePage() {
  const rows = db()
    .prepare(
      `SELECT id, business_name name, fit_score score, city, best_route route, last_contacted_at last, status FROM leads
       WHERE qualified = 1 OR status NOT IN ('New') ORDER BY COALESCE(last_contacted_at, updated_at) DESC LIMIT 1000`,
    )
    .all() as { id: string; name: string; score: number | null; city: string | null; route: string | null; last: string | null; status: string }[];
  const columns = LEAD_STATUSES.map((status) => ({ status, cards: rows.filter((r) => r.status === status).slice(0, 150) }));
  return (
    <div className="space-y-4">
      <div>
        <h1 className="h1">Pipeline</h1>
        <p className="muted">Drag cards between stages. Moving to “Do not contact” blocks the lead on every channel.</p>
      </div>
      <Board columns={columns} />
    </div>
  );
}
