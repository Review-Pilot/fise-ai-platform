import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fos-calls-"));
process.env.VAPI_API_KEY = "v";
process.env.VAPI_PHONE_NUMBER_ID = "pn";
process.env.VAPI_ASSISTANT_ID = "as";
delete process.env.ANTHROPIC_API_KEY;

const TUE_10 = new Date("2026-09-29T10:00:00+02:00");
const dialled: { phone: string; firstMessage: string; brief: string }[] = [];
const dial = async (o: { phone: string; firstMessage: string; brief: string }) => {
  dialled.push(o);
  return `vapi_${dialled.length}`;
};

async function lead(name: string, phone: string, consent: "none" | "granted" = "granted") {
  const { createLead, updateLead } = await import("@/lib/leads");
  const l = createLead({ business_name: name, website: `https://${name.replace(/\W/g, "").toLowerCase()}.test` });
  updateLead(l.id, { consent_status: consent, contacts: [{ kind: "phone", value: phone, sourceUrl: "https://x.test/contact", foundAt: "" }] });
  return l.id;
}

beforeAll(async () => {
  const { updateSettings } = await import("@/lib/settings");
  updateSettings("calls", { testNumber: "082 999 0000", dailyCap: 1 });
});

describe("Vapi calling guard rails", () => {
  it("always opens with the automated-assistant disclosure", async () => {
    const { buildBrief } = await import("@/lib/calls");
    const { getLead } = await import("@/lib/leads");
    const b = await buildBrief(getLead(await lead("Disclose Co", "0215550000"))!);
    expect(b.firstMessage).toMatch(/^Hi, this is an automated assistant calling on behalf of/);
    expect(b.brief).toMatch(/remove me/);
  });

  it("test mode only allows your own number, any time of day", async () => {
    const { createTestCall, placeCall, addLeadsToCallBatch, getCall } = await import("@/lib/calls");
    await expect(addLeadsToCallBatch([await lead("Too Early", "0215550001")])).rejects.toThrow(/Test mode is on/);
    const id = await createTestCall();
    const r = await placeCall(id, { dial, now: new Date("2026-09-29T21:00:00+02:00") });
    expect(r.status).toBe("started");
    expect(dialled[0].phone).toBe("+27829990000");
    expect(getCall(id)!.status).toBe("in_progress");
  });

  it("marks the test as passed after a real transcript, then allows live batches with consent", async () => {
    const { handleEndOfCall, addLeadsToCallBatch } = await import("@/lib/calls");
    const { getSettings, updateSettings } = await import("@/lib/settings");
    await handleEndOfCall({ vapiCallId: "vapi_1", transcript: "AI: Hi, this is an automated assistant...\nUser: Sounds good, thanks." });
    expect(getSettings().calls.testPassedAt).toBeTruthy();
    updateSettings("calls", { testMode: false });
    const noConsent = await lead("No Consent", "0215550002", "none");
    const ok = await lead("Has Consent", "0215550003");
    const r = await addLeadsToCallBatch([noConsent, ok]);
    expect(r.added).toBe(1);
    expect(r.skipped[0].reason).toMatch(/POPIA s69/);
  });

  it("only dials Mon–Fri 08:00–17:00 SAST, not on holidays, within the daily cap", async () => {
    const { approveBatch } = await import("@/lib/batches");
    const { placeCall } = await import("@/lib/calls");
    const { db } = await import("@/lib/db");
    const batch = db().prepare("SELECT id FROM batches WHERE type = 'call' AND status = 'pending_approval'").get() as { id: string };
    const call = db().prepare("SELECT id FROM calls WHERE batch_id = ?").get(batch.id) as { id: string };
    // Not callable before approval
    expect((await placeCall(call.id, { dial, now: TUE_10 })).status).toBe("skipped");
    approveBatch(batch.id);
    const sat = await placeCall(call.id, { dial, now: new Date("2026-10-03T10:00:00+02:00") });
    expect(sat.status).toBe("rescheduled");
    const heritage = await placeCall(call.id, { dial, now: new Date("2026-09-24T10:00:00+02:00") });
    expect(heritage.status).toBe("rescheduled");
    expect(new Date((heritage as { runAt: Date }).runAt).toISOString()).toBe(new Date("2026-09-25T08:00:00+02:00").toISOString());
    expect((await placeCall(call.id, { dial, now: TUE_10 })).status).toBe("started");

    // Daily cap (1) reached → next one is pushed to tomorrow
    const again = await lead("Second Call", "0215550004");
    const { addLeadsToCallBatch } = await import("@/lib/calls");
    const b2 = await addLeadsToCallBatch([again]);
    approveBatch(b2.batchId!);
    const c2 = db().prepare("SELECT id FROM calls WHERE lead_id = ?").get(again) as { id: string };
    const capped = await placeCall(c2.id, { dial, now: new Date(TUE_10.getTime() + 3600_000) });
    expect(capped.status).toBe("rescheduled");
    expect((capped as { why: string }).why).toMatch(/Daily call cap/);
  });

  it("'remove me' on a call opts the lead out everywhere; bookings update the pipeline", async () => {
    const { handleEndOfCall } = await import("@/lib/calls");
    const { getLead } = await import("@/lib/leads");
    const { isBlocked } = await import("@/lib/dnc");
    const { db } = await import("@/lib/db");
    const call = db().prepare("SELECT id, lead_id, vapi_call_id FROM calls WHERE status = 'in_progress' AND is_test = 0").get() as { id: string; lead_id: string; vapi_call_id: string };
    // Classifier says "call_back" but the person clearly asked to be removed → do_not_contact wins
    const outcome = await handleEndOfCall({ vapiCallId: call.vapi_call_id, structuredOutcome: "call_back", transcript: "AI: Hi, this is an automated assistant.\nUser: Please remove me from your list." });
    expect(outcome).toBe("do_not_contact");
    expect(getLead(call.lead_id)!.status).toBe("Do not contact");
    expect(isBlocked({ phone: "0215550003" })).toBeTruthy();

    const booked = await lead("Booked Co", "0215550005");
    db().prepare("INSERT INTO calls (id, lead_id, phone, status, vapi_call_id, created_at) VALUES ('c_b', ?, '+27215550005', 'in_progress', 'vapi_b', '')").run(booked);
    await handleEndOfCall({ vapiCallId: "vapi_b", structuredOutcome: "booked", transcript: "User: Yes, Thursday at 10 works." });
    expect(getLead(booked)!.status).toBe("Demo booked");
    expect(getLead(booked)!.consent_status).toBe("granted");
  });
});
