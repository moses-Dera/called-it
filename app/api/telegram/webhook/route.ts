import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://calledit.app";

function admin() {
  if (!URL || !SERVICE_KEY) return null;
  return createClient(URL, SERVICE_KEY, { auth: { persistSession: false } });
}

async function sendMessage(chatId: number, text: string, parseMode = "HTML") {
  if (!BOT_TOKEN) return;
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: parseMode, disable_web_page_preview: true }),
  });
}

async function handleStart(chatId: number) {
  await sendMessage(chatId,
    `<b>Called It</b> — the free-to-play prediction game on Zcash.\n\n` +
    `Seal your football score predictions before kickoff. The server checks them at full time and awards ranked points.\n\n` +
    `/seal — See open fixtures to predict\n` +
    `/leaderboard — Top players this week\n` +
    `/syndicates — Top group pools\n` +
    `/play — Open the web app\n\n` +
    `<a href="${APP_URL}">Play now</a>`
  );
}

async function handleSeal(chatId: number) {
  const db = admin();
  if (!db) return sendMessage(chatId, "Bot is not fully configured yet.");

  const { data: fixtures } = await db.from("fixtures").select("id, home, away, kickoff, home_goals, away_goals").gt("kickoff", new Date().toISOString()).order("kickoff").limit(5);
  if (!fixtures || fixtures.length === 0) {
    return sendMessage(chatId, "No open fixtures right now. Check back closer to match day!\n\n<a href=\"" + APP_URL + "\">Open the app</a>");
  }

  let text = "<b>Open fixtures:</b>\n\n";
  for (const f of fixtures) {
    const dt = new Date(f.kickoff).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
    text += `⚽ <b>${f.home} vs ${f.away}</b>\n📅 ${dt} UTC\n<a href="${APP_URL}/seal?f=${f.id}">Seal your prediction</a>\n\n`;
  }
  text += "Seal before kickoff — your call is locked and timestamped.";
  await sendMessage(chatId, text);
}

async function handleLeaderboard(chatId: number) {
  const db = admin();
  if (!db) return sendMessage(chatId, "Bot is not fully configured yet.");

  const { data } = await db.rpc("leaderboard", { p_period: "week", p_limit: 10, p_offset: 0 });
  if (!data || data.length === 0) {
    return sendMessage(chatId, "No ranked players this week yet. Be the first!\n\n<a href=\"" + APP_URL + "\">Play now</a>");
  }

  let text = "<b>Leaderboard — This Week</b>\n\n";
  for (const r of data as { rank: number; name: string; points: number }[]) {
    const medal = r.rank === 1 ? "🥇" : r.rank === 2 ? "🥈" : r.rank === 3 ? "🥉" : `#${r.rank}`;
    text += `${medal} <b>${escapeHtml(r.name)}</b> — ${r.points} pts\n`;
  }
  text += `\n<a href="${APP_URL}/ranks">Full leaderboard</a>`;
  await sendMessage(chatId, text);
}

async function handleSyndicates(chatId: number) {
  const db = admin();
  if (!db) return sendMessage(chatId, "Bot is not fully configured yet.");

  const { data } = await db.rpc("syndicate_leaderboard", { p_period: "all" });
  if (!data || data.length === 0) {
    return sendMessage(chatId, "No syndicates ranked yet. Create one in the app!\n\n<a href=\"" + APP_URL + "/syndicates\">Create a syndicate</a>");
  }

  let text = "<b>Top Syndicates</b>\n\n";
  for (const r of (data as { rank: number; name: string; member_count: number; total_points: number }[]).slice(0, 10)) {
    text += `#${r.rank} <b>${escapeHtml(r.name)}</b> — ${r.total_points} pts (${r.member_count} members)\n`;
  }
  text += `\n<a href="${APP_URL}/syndicates">View all</a>`;
  await sendMessage(chatId, text);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function POST(req: NextRequest) {
  if (!BOT_TOKEN) return NextResponse.json({ ok: false, error: "not configured" }, { status: 501 });

  const secret = req.headers.get("x-telegram-bot-api-secret-token");
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (expected && secret !== expected) {
    return NextResponse.json({ ok: false }, { status: 403 });
  }

  try {
    const body = await req.json();
    const msg = body.message;
    if (!msg?.text || !msg.chat?.id) return NextResponse.json({ ok: true });

    const chatId = msg.chat.id as number;
    const text = (msg.text as string).trim();
    const cmd = text.split(/\s/)[0].toLowerCase().replace(/@\w+$/, "");

    switch (cmd) {
      case "/start":
      case "/help":
        await handleStart(chatId);
        break;
      case "/seal":
      case "/fixtures":
      case "/predict":
        await handleSeal(chatId);
        break;
      case "/leaderboard":
      case "/ranks":
      case "/top":
        await handleLeaderboard(chatId);
        break;
      case "/syndicates":
      case "/groups":
        await handleSyndicates(chatId);
        break;
      case "/play":
        await sendMessage(chatId, `<a href="${APP_URL}">Open Called It</a>`);
        break;
      default:
        await sendMessage(chatId,
          `I didn't catch that. Try:\n/seal — Open fixtures\n/leaderboard — Top players\n/syndicates — Group pools\n/play — Open the app`
        );
    }
  } catch {
    // Telegram retries on 5xx, so always return 200
  }

  return NextResponse.json({ ok: true });
}
