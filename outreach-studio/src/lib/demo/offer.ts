// Who gets the "free demo" button: warm leads automatically, cold leads only if you switch it on.
import type { Lead } from "../types";
import { getSettings } from "../settings";

export function isWarm(l: Lead): boolean {
  return l.consent_status === "granted" || ["Replied", "Demo booked", "Won"].includes(l.status) || Boolean(l.replied_at);
}

export function demoOfferOn(l: Lead): boolean {
  if (l.demo_offer === 1) return true;
  if (l.demo_offer === 0) return false;
  return isWarm(l) && getSettings().demo.autoForWarm;
}

export const CTA_DEMO = "Get your free demo";
export const CTA_INFO = "See how Fise works";
