import type { SponsorRecord, WinnerStatus } from "@/lib/cloud";

/** A sponsor's public payment record: sponsors pay winners directly, so players can see who pays. */
export function SponsorRecordLine({ record, sponsor, short }: { record?: SponsorRecord; sponsor: string | null; short?: boolean }) {
  const who = sponsor || "The sponsor";
  let text: string, tone: string;
  if (record?.overdue_contests) {
    tone = "var(--red)";
    text = short ? `⚠ ${record.overdue_contests} unpaid` : `⚠ ${who} has ${record.overdue_contests} contest${record.overdue_contests === 1 ? "" : "s"} with winners still unpaid after the 72-hour deadline.`;
  } else if (record?.paid_contests) {
    tone = "inherit";
    text = short ? `✓ Paid ${record.paid_contests} of ${record.contests}` : `✓ ${who} has paid ${record.paid_contests} of ${record.contests} finished contest${record.contests === 1 ? "" : "s"} in full (${record.paid_zec} ZEC confirmed by winners).`;
  } else {
    tone = "inherit";
    text = short ? "New sponsor" : `${who} is a new sponsor with no payment record yet. New sponsors can offer up to 0.5 ZEC.`;
  }
  return (
    <span style={{ fontSize: short ? 12 : 13, fontWeight: 800, color: tone, opacity: short && tone === "inherit" ? 0.8 : 1, lineHeight: 1.5 }}>
      {text}{short ? "" : " The sponsor pays winners straight from their own wallet, and each winner confirms it arrived."}
    </span>
  );
}

/** How a sponsor-paid prize stands, shown next to a winner. */
export function WinnerPayState({ status, payBy, now }: { status?: WinnerStatus; payBy?: string | null; now: number | null }) {
  const late = !!payBy && !!now && Date.parse(payBy) < now;
  const label = status === "paid" ? "✓ received"
    : status === "sent" ? "sent, awaiting winner"
    : status === "disputed" ? "⚠ not received"
    : late ? "⚠ unpaid" : "to be paid";
  return <span style={{ fontWeight: 700, opacity: 0.85 }}> · {label}</span>;
}
