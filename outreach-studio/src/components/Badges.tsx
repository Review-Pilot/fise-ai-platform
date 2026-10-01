export function ScoreBadge({ score }: { score: number | null }) {
  if (score === null || score === undefined) return <span className="badge bg-gray-100 text-gray-500">—</span>;
  const cls = score >= 75 ? "bg-green-100 text-green-800" : score >= 50 ? "bg-amber-100 text-amber-800" : "bg-gray-100 text-gray-600";
  return <span className={`badge ${cls}`}>{score}</span>;
}

const STATUS_CLS: Record<string, string> = {
  New: "bg-gray-100 text-gray-700",
  Qualified: "bg-blue-100 text-blue-800",
  Contacted: "bg-indigo-100 text-indigo-800",
  Replied: "bg-purple-100 text-purple-800",
  "Demo booked": "bg-teal-100 text-teal-800",
  Won: "bg-green-100 text-green-800",
  Lost: "bg-gray-200 text-gray-600",
  "Do not contact": "bg-red-100 text-red-800",
};

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge ${STATUS_CLS[status] ?? "bg-gray-100"}`}>{status}</span>;
}

export const ROUTE_LABEL: Record<string, string> = {
  owner_email: "Owner email",
  generic_email: "General email",
  phone: "Phone",
  whatsapp: "WhatsApp",
  contact_form: "Contact form",
  none: "None found",
};
