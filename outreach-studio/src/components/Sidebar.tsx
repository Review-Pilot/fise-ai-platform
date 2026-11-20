"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "Dashboard", icon: "M3 12l9-9 9 9M5 10v10h14V10" },
  { href: "/finder", label: "Lead Finder", icon: "M11 4a7 7 0 100 14 7 7 0 000-14zm10 17l-5-5" },
  { href: "/leads", label: "Leads", icon: "M4 6h16M4 12h16M4 18h10" },
  { href: "/outreach", label: "Outreach", icon: "M3 8l9 6 9-6M3 8v10h18V8M3 8l9-5 9 5" },
  { href: "/calls", label: "Calls", icon: "M5 4h4l2 5-3 2a11 11 0 005 5l2-3 5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2" },
  { href: "/pipeline", label: "Pipeline", icon: "M4 4h4v16H4zM10 4h4v10h-4zM16 4h4v6h-4z" },
  { href: "/settings", label: "Settings", icon: "M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-2.9 1.2V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-2.9-1.2l-.1.1a2 2 0 11-2.8-2.8l.1-.1A1.7 1.7 0 003 15H3a2 2 0 110-4h.1a1.7 1.7 0 001.2-2.9l-.1-.1a2 2 0 112.8-2.8l.1.1A1.7 1.7 0 0010 4V3a2 2 0 114 0v.1a1.7 1.7 0 002.9 1.2l.1-.1a2 2 0 112.8 2.8l-.1.1A1.7 1.7 0 0021 11h.1a2 2 0 110 4H21a1.7 1.7 0 00-1.6 1z" },
];

export function Sidebar() {
  const path = usePathname();
  return (
    <aside className="flex w-full shrink-0 flex-row gap-1 overflow-x-auto border-b border-gray-200 bg-white p-2 md:sticky md:top-0 md:h-screen md:w-56 md:flex-col md:border-b-0 md:border-r md:p-4">
      <div className="hidden px-2 pb-4 md:block">
        <div className="text-lg font-semibold tracking-tight">Fise <span className="text-brand">Outreach</span></div>
        <div className="text-xs text-gray-500">Studio</div>
      </div>
      {NAV.map((n) => {
        const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
        return (
          <Link
            key={n.href}
            href={n.href}
            className={`flex items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium ${
              active ? "bg-brand/10 text-brand" : "text-gray-700 hover:bg-gray-100"
            }`}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d={n.icon} />
            </svg>
            {n.label}
          </Link>
        );
      })}
    </aside>
  );
}
