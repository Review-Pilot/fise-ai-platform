import { describe, it, expect } from "vitest";
import * as cheerio from "cheerio";
import { detectPlatform, detectParked, isSocialOnlyUrl } from "@/lib/site/platform";
import { detectChatTools, hasRealChat } from "@/lib/site/widgets";
import { extractContacts, rankContacts, classifyEmail } from "@/lib/site/contacts";
import { normaliseDnc, normalisePhone } from "@/lib/dnc";

describe("platform detection", () => {
  it("detects WordPress and allows install", () => {
    const r = detectPlatform('<link href="/wp-content/themes/x/style.css">', "https://kinelectrical.co.za/");
    expect(r.platform).toBe("WordPress");
    expect(r.canInstall).toBe("yes");
  });
  it("flags free Wix subdomains as can't install", () => {
    const r = detectPlatform('<img src="https://static.wixstatic.com/a.png">', "https://joe.wixsite.com/plumbing");
    expect(r.platform).toBe("Wix");
    expect(r.canInstall).toBe("no");
  });
  it("flags Google Sites", () => {
    expect(detectPlatform('<meta name="generator" content="Google Sites">', "https://sites.google.com/view/x").canInstall).toBe("no");
  });
  it("defaults to custom HTML", () => {
    expect(detectPlatform("<html><body>hi</body></html>", "https://x.co.za").platform).toBe("Custom HTML");
  });
  it("detects parked pages and social-only URLs", () => {
    expect(detectParked("<h1>This domain is for sale</h1>", "", 200).parked).toBe(true);
    expect(detectParked("<p>" + "word ".repeat(300) + "</p>", "", 300).parked).toBe(false);
    expect(isSocialOnlyUrl("https://www.facebook.com/joesplumbing")).toBe(true);
    expect(isSocialOnlyUrl("https://joesplumbing.co.za")).toBe(false);
  });
});

describe("chat widget detection", () => {
  it("finds Tawk.to and contact forms", () => {
    const tools = detectChatTools('<script src="https://embed.tawk.to/abc/default"></script><form><textarea></textarea></form>');
    expect(tools.map((t) => t.id)).toEqual(["tawk", "contact_form"]);
    expect(hasRealChat(tools)).toBe(true);
  });
  it("treats WhatsApp buttons and forms as not a real chat", () => {
    const tools = detectChatTools('<a href="https://wa.me/27821234567">Chat</a>');
    expect(tools[0].category).toBe("whatsapp");
    expect(hasRealChat(tools)).toBe(false);
  });
});

describe("contact extraction", () => {
  const html = `<html><body>
    <p>Call us on 021 555 1234 or email <a href="mailto:info@kinelectrical.co.za">info@kinelectrical.co.za</a></p>
    <p>Owner: Thabo Mokoena — thabo@kinelectrical.co.za</p>
    <a href="https://wa.me/27821234567">WhatsApp</a>
    <a href="https://www.facebook.com/kinelectrical/">Facebook</a>
    <a href="https://www.facebook.com/sharer/sharer.php?u=x">share</a>
    <span data-cfemail="3a4f495f48"></span>
    <img src="logo@2x.png"> support@kinelectrical.co.za
    <form><textarea name="message"></textarea></form>
  </body></html>`;
  const $ = cheerio.load(html);
  const contacts = extractContacts($, "https://kinelectrical.co.za/contact", $("body").text());

  it("finds emails, phones, WhatsApp, socials and the form with their source page", () => {
    const kinds = contacts.map((c) => `${c.kind}:${c.value}`);
    expect(kinds).toContain("email:info@kinelectrical.co.za");
    expect(kinds).toContain("email:thabo@kinelectrical.co.za");
    expect(kinds).toContain("phone:+27215551234");
    expect(kinds).toContain("whatsapp:+27821234567");
    expect(kinds).toContain("facebook:https://www.facebook.com/kinelectrical");
    expect(kinds.some((k) => k.includes("sharer"))).toBe(false);
    expect(kinds.some((k) => k.includes("@2x"))).toBe(false);
    expect(contacts.every((c) => c.sourceUrl === "https://kinelectrical.co.za/contact")).toBe(true);
  });

  it("prefers the named owner email over info@ and support@", () => {
    const ranked = rankContacts(contacts, { name: "Thabo Mokoena", role: "Owner" });
    expect(ranked.bestRoute).toBe("owner_email");
    expect(ranked.contacts.find((c) => c.kind === "email")!.value).toBe("thabo@kinelectrical.co.za");
    expect(classifyEmail("support@x.co.za")).toBe("support");
    expect(classifyEmail("info@x.co.za")).toBe("generic");
    expect(classifyEmail("jane.smith@x.co.za")).toBe("named");
  });
});

describe("do-not-contact normalisation", () => {
  it("normalises emails, SA phones and domains", () => {
    expect(normalisePhone("082 123 4567")).toBe("+27821234567");
    expect(normalisePhone("+27 (0)82")).toBeNull();
    expect(normaliseDnc("Info@Shop.co.za ")).toEqual({ kind: "email", value: "info@shop.co.za" });
    expect(normaliseDnc("https://www.shop.co.za/contact")).toEqual({ kind: "domain", value: "shop.co.za" });
    expect(normaliseDnc("0821234567")).toEqual({ kind: "phone", value: "+27821234567" });
  });
});
