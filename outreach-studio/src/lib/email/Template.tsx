// The outreach email, built with React Email. Deliverability rules:
// table layout (React Email Section/Row render tables), max 600px, every style inline,
// system font stack, no scripts/forms/iframes/web fonts, one hosted image, ≤ 3 links,
// and a VML "bulletproof" button so Outlook shows a real rounded button.
import { Body, Container, Head, Html, Img, Link, Preview, Section, Text } from "@react-email/components";
import type { BrandColors, EmailCopy } from "../types";
import { ensureReadableOnWhite, parseColor, rgbToHsl, hslToRgb, toHex } from "../color";

export const FONT = "Arial, Helvetica, 'Segoe UI', sans-serif";

export interface TemplateProps {
  kind: "initial" | "followup1" | "followup2";
  copy: EmailCopy;
  /** Follow-ups use a plain body instead of benefits. */
  followupBody?: string;
  colors: BrandColors;
  businessName: string;
  image?: { src: string; width: number; height: number; alt: string } | null;
  ctaUrl: string;
  websiteUrl: string;
  unsubscribeUrl: string;
  reasonLine: string;
  sender: { name: string; title: string; company: string; phone: string; address: string };
}

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function bulletproofButton(opts: { href: string; text: string; bg: string; fg: string; width?: number }) {
  const width = opts.width ?? 280;
  const href = esc(opts.href);
  const text = esc(opts.text);
  return (
    `<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${href}" ` +
    `style="height:48px;v-text-anchor:middle;width:${width}px;" arcsize="17%" stroke="f" fillcolor="${opts.bg}"><w:anchorlock/>` +
    `<center style="color:${opts.fg};font-family:Arial,sans-serif;font-size:16px;font-weight:bold;">${text}</center></v:roundrect><![endif]-->` +
    `<!--[if !mso]><!-- --><a href="${href}" style="background-color:${opts.bg};border-radius:8px;color:${opts.fg};display:inline-block;` +
    `font-family:${FONT.replace(/'/g, "")};font-size:16px;font-weight:bold;line-height:48px;text-align:center;text-decoration:none;` +
    `width:${width}px;max-width:100%;-webkit-text-size-adjust:none;mso-hide:all;">${text}</a><!--<![endif]-->`
  );
}

function tint(hex: string, l: number) {
  const rgb = parseColor(hex) ?? [23, 105, 224];
  const [h, s] = rgbToHsl(rgb);
  return toHex(hslToRgb(h, Math.min(0.85, s), l));
}

const p = { fontSize: "16px", lineHeight: "24px", color: "#1f2937", margin: "0 0 16px", fontFamily: FONT } as const;

export function OutreachEmail(props: TemplateProps) {
  const { copy, colors } = props;
  const heading = ensureReadableOnWhite(colors.primary);
  const accentLine = colors.accent;
  const soft = tint(colors.primary, 0.96);
  const websiteHost = (() => {
    try {
      return new URL(props.websiteUrl).hostname.replace(/^www\./, "");
    } catch {
      return props.websiteUrl;
    }
  })();

  return (
    <Html lang="en" dir="ltr">
      <Head>
        <meta name="color-scheme" content="light" />
        <meta name="supported-color-schemes" content="light" />
      </Head>
      <Preview>{copy.preheader}</Preview>
      <Body style={{ backgroundColor: "#f4f5f7", margin: 0, padding: "24px 0", fontFamily: FONT }}>
        <Container style={{ maxWidth: "600px", width: "100%", backgroundColor: "#ffffff", borderRadius: "10px", border: "1px solid #e5e7eb" }}>
          {/* Brand band — a coloured table cell, not an image */}
          <Section>
            <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} border={0}>
              <tbody>
                <tr>
                  <td style={{ backgroundColor: colors.primary, height: "6px", lineHeight: "6px", fontSize: "1px", borderTopLeftRadius: "10px", borderTopRightRadius: "10px" }}>&nbsp;</td>
                </tr>
              </tbody>
            </table>
          </Section>

          <Section style={{ padding: "22px 32px 0" }}>
            <Text style={{ ...p, fontSize: "13px", lineHeight: "18px", color: "#6b7280", margin: 0, textTransform: "uppercase", letterSpacing: "0.5px" }}>
              Prepared for {props.businessName}
            </Text>
          </Section>

          <Section style={{ padding: "16px 32px 0" }}>
            <Text style={p}>{copy.greeting}</Text>
            {props.followupBody ? (
              props.followupBody
                .split(/\n\s*\n/)
                .filter(Boolean)
                .map((para, i) => (
                  <Text key={i} style={p}>
                    {para}
                  </Text>
                ))
            ) : (
              <Text style={p}>{copy.opening}</Text>
            )}
          </Section>

          {!props.followupBody &&
            copy.benefits.map((b, i) => (
              <Section key={i} style={{ padding: "0 32px 12px" }}>
                <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} border={0}>
                  <tbody>
                    <tr>
                      <td style={{ borderLeft: `4px solid ${accentLine}`, backgroundColor: soft, padding: "12px 16px", borderRadius: "0 6px 6px 0" }}>
                        <Text style={{ ...p, margin: "0 0 4px", fontWeight: "bold", color: heading }}>{b.title}</Text>
                        <Text style={{ ...p, margin: "0 0 6px", fontSize: "15px", lineHeight: "22px" }}>{b.detail}</Text>
                        <Text style={{ ...p, margin: 0, fontSize: "14px", lineHeight: "20px", color: "#4b5563", fontStyle: "italic" }}>
                          Customers ask: &ldquo;{b.exampleQuestion}&rdquo;
                        </Text>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </Section>
            ))}

          {props.image && (
            <Section style={{ padding: "8px 20px 4px" }}>
              <Img
                src={props.image.src}
                width={String(props.image.width)}
                height={String(props.image.height)}
                alt={props.image.alt}
                style={{ display: "block", width: "100%", maxWidth: `${props.image.width}px`, height: "auto", margin: "0 auto", border: 0, fontFamily: FONT, fontSize: "14px", color: "#374151" }}
              />
            </Section>
          )}

          {!props.followupBody && copy.comparison && (
            <Section style={{ padding: "12px 32px 0" }}>
              <Text style={p}>{copy.comparison}</Text>
            </Section>
          )}

          <Section style={{ padding: "8px 32px 20px", textAlign: "center" }}>
            <table role="presentation" cellPadding={0} cellSpacing={0} border={0} align="center" style={{ margin: "0 auto" }}>
              <tbody>
                <tr>
                  <td align="center" dangerouslySetInnerHTML={{ __html: bulletproofButton({ href: props.ctaUrl, text: copy.ctaText, bg: colors.primary, fg: colors.onPrimary }) }} />
                </tr>
              </tbody>
            </table>
          </Section>

          <Section style={{ padding: "0 32px 8px" }}>
            {!props.followupBody && <Text style={p}>{copy.closing}</Text>}
            <Text style={{ ...p, margin: "0 0 24px" }}>
              Kind regards,
              <br />
              <strong>{props.sender.name}</strong>
              <br />
              {props.sender.title}, {props.sender.company}
              <br />
              {props.sender.phone} ·{" "}
              <Link href={props.websiteUrl} style={{ color: heading, textDecoration: "underline" }}>
                {websiteHost}
              </Link>
            </Text>
          </Section>

          <Section style={{ padding: "16px 32px 24px", borderTop: "1px solid #e5e7eb" }}>
            <Text style={{ ...p, fontSize: "12px", lineHeight: "18px", color: "#6b7280", margin: "0 0 8px" }}>{props.reasonLine}</Text>
            <Text style={{ ...p, fontSize: "12px", lineHeight: "18px", color: "#6b7280", margin: 0 }}>
              {props.sender.company}, {props.sender.address}.{" "}
              <Link href={props.unsubscribeUrl} style={{ color: "#4b5563", textDecoration: "underline" }}>
                Unsubscribe
              </Link>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}
