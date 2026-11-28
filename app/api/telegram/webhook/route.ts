import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const DB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://calledit.app";

function admin(): SupabaseClient | null {
  if (!DB_URL || !SERVICE_KEY) return null;
  return createClient(DB_URL, SERVICE_KEY, { auth: { persistSession: false } });
}

// ── Telegram helpers ──────────────────────────────────────────

async function tg(method: string, body: Record<string, unknown>) {
  if (!BOT_TOKEN) return null;
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function send(chatId: number, text: string, extra: Record<string, unknown> = {}) {
  return tg("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true, ...extra });
}

async function answer(callbackQueryId: string, text: string) {
  return tg("answerCallbackQuery", { callback_query_id: callbackQueryId, text });
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
}

function tgName(from: { first_name?: string; last_name?: string; username?: string }): string {
  return esc((from.first_name ?? "") + (from.last_name ? " " + from.last_name : "") || from.username || "Player").slice(0, 40);
}

// ── DM state: waiting for a prediction score ──────────────────
// In-memory map (per-instance); prediction prompts expire on restart — that's fine.
const pendingPrediction = new Map<number, { roundId: string; fixture: string; chatId: number }>();

// ── Commands ──────────────────────────────────────────────────

async function handleStart(chatId: number, isGroup: boolean) {
  const groupCmds = isGroup
    ? `\n<b>Group game:</b>\n/newround — Start a prediction round\n/predict — Submit your score (or tap the button)\n/round — See who has predicted\n/results — Reveal scores after full time\n`
    : "";
  await send(chatId,
    `<b>Called It</b> — the free-to-play prediction game on Zcash.\n\n` +
    `Seal your football score predictions before kickoff. The server checks them at full time and awards ranked points.\n\n` +
    `/seal — See open fixtures\n` +
    `/leaderboard — Top players this week\n` +
    `/syndicates — Top group pools\n` +
    `/play — Open the web app\n` +
    groupCmds +
    `\n<a href="${APP_URL}">Play now</a>`
  );
}

async function handleFixtures(chatId: number) {
  const db = admin();
  if (!db) return send(chatId, "Bot is not fully configured yet.");
  const { data: fixtures } = await db.from("fixtures").select("id, home, away, kickoff, home_goals, away_goals").gt("kickoff", new Date().toISOString()).order("kickoff").limit(5);
  if (!fixtures?.length) return send(chatId, `No open fixtures right now. Check back closer to match day!\n\n<a href="${APP_URL}">Open the app</a>`);
  let text = "<b>Open fixtures:</b>\n\n";
  for (const f of fixtures) {
    text += `⚽ <b>${esc(f.home)} vs ${esc(f.away)}</b>\n📅 ${fmtDate(f.kickoff)} UTC\n<a href="${APP_URL}/seal?f=${f.id}">Seal your prediction</a>\n\n`;
  }
  text += "Seal before kickoff — your call is locked and timestamped.";
  await send(chatId, text);
}

async function handleLeaderboard(chatId: number) {
  const db = admin();
  if (!db) return send(chatId, "Bot is not fully configured yet.");
  const { data } = await db.rpc("leaderboard", { p_period: "week", p_limit: 10, p_offset: 0 });
  if (!data?.length) return send(chatId, `No ranked players this week yet. Be the first!\n\n<a href="${APP_URL}">Play now</a>`);
  let text = "<b>Leaderboard — This Week</b>\n\n";
  for (const r of data as { rank: number; name: string; points: number }[]) {
    const medal = r.rank === 1 ? "🥇" : r.rank === 2 ? "🥈" : r.rank === 3 ? "🥉" : `#${r.rank}`;
    text += `${medal} <b>${esc(r.name)}</b> — ${r.points} pts\n`;
  }
  text += `\n<a href="${APP_URL}/ranks">Full leaderboard</a>`;
  await send(chatId, text);
}

async function handleSyndicates(chatId: number) {
  const db = admin();
  if (!db) return send(chatId, "Bot is not fully configured yet.");
  const { data } = await db.rpc("syndicate_leaderboard", { p_period: "all" });
  if (!data?.length) return send(chatId, `No syndicates ranked yet. Create one in the app!\n\n<a href="${APP_URL}/syndicates">Create a syndicate</a>`);
  let text = "<b>Top Syndicates</b>\n\n";
  for (const r of (data as { rank: number; name: string; member_count: number; total_points: number }[]).slice(0, 10)) {
    text += `#${r.rank} <b>${esc(r.name)}</b> — ${r.total_points} pts (${r.member_count} members)\n`;
  }
  text += `\n<a href="${APP_URL}/syndicates">View all</a>`;
  await send(chatId, text);
}

// ── Group game round ──────────────────────────────────────────

async function handleNewRound(chatId: number, fromId: number) {
  const db = admin();
  if (!db) return send(chatId, "Bot is not fully configured yet.");

  // Find the next upcoming fixture
  const { data: fixtures } = await db.from("fixtures").select("id, home, away, kickoff").gt("kickoff", new Date().toISOString()).order("kickoff").limit(1);
  if (!fixtures?.length) return send(chatId, "No upcoming fixtures to play. Check back closer to match day!");

  const f = fixtures[0];

  // Check if round already exists for this chat + fixture
  const { data: existing } = await db.from("tg_rounds").select("id, status").eq("chat_id", chatId).eq("fixture_id", f.id).maybeSingle();
  if (existing) {
    if (existing.status === "open") return send(chatId, `A round for <b>${esc(f.home)} vs ${esc(f.away)}</b> is already running! Use /predict or tap the button below to submit your score.`);
    if (existing.status === "revealed") return send(chatId, `The round for <b>${esc(f.home)} vs ${esc(f.away)}</b> is already finished. Wait for the next fixture.`);
  }

  // Create round
  const { data: round, error } = await db.from("tg_rounds").insert({ chat_id: chatId, fixture_id: f.id, started_by: fromId }).select("id").single();
  if (error) return send(chatId, "Could not start the round. Try again.");

  await send(chatId,
    `🎯 <b>NEW ROUND</b>\n\n` +
    `⚽ <b>${esc(f.home)} vs ${esc(f.away)}</b>\n` +
    `📅 ${fmtDate(f.kickoff)} UTC\n\n` +
    `Predict the final score! Tap "Predict" below or type /predict.\n` +
    `Your prediction stays hidden until after full time.\n\n` +
    `<b>Scoring:</b>\n` +
    `🎯 Exact score = 10 pts\n` +
    `✅ Correct result = 5 pts\n` +
    `❌ Wrong = 0 pts`,
    {
      reply_markup: {
        inline_keyboard: [[
          { text: "🔮 Predict", callback_data: `predict:${round.id}:${f.id}` },
          { text: "📊 Status", callback_data: `status:${round.id}` },
        ]],
      },
    }
  );
}

async function handlePredict(chatId: number, fromId: number, isGroup: boolean) {
  if (!isGroup) {
    // In DM, check if they have a pending prediction prompt
    return send(chatId, "Use /predict in a group chat where a round is running. Or type your score now if you've already tapped the Predict button (e.g. <code>2-1</code>).");
  }

  const db = admin();
  if (!db) return send(chatId, "Bot is not fully configured yet.");

  // Find the open round for this chat
  const { data: round } = await db.from("tg_rounds").select("id, fixture_id").eq("chat_id", chatId).eq("status", "open").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!round) return send(chatId, "No active round. Start one with /newround");

  const { data: f } = await db.from("fixtures").select("home, away, kickoff").eq("id", round.fixture_id).single();
  if (!f) return send(chatId, "Fixture not found.");

  if (new Date(f.kickoff) <= new Date()) return send(chatId, "This fixture has already kicked off. Predictions are locked.");

  // Check if already predicted
  const { data: existing } = await db.from("tg_predictions").select("id").eq("round_id", round.id).eq("tg_user_id", fromId).maybeSingle();
  if (existing) return send(chatId, "You've already locked in your prediction for this round! 🔒");

  // Send a DM prompt
  pendingPrediction.set(fromId, { roundId: round.id, fixture: `${f.home} vs ${f.away}`, chatId });

  await send(chatId,
    `I'll ask you for your score in a DM so it stays hidden from the group. Tap below:`,
    {
      reply_markup: {
        inline_keyboard: [[{ text: "🔮 Send my prediction", url: `https://t.me/${await getBotUsername()}?start=predict_${round.id}` }]],
      },
    }
  );
}

async function handlePredictDM(fromId: number, fromName: string, roundId: string) {
  const db = admin();
  if (!db) return;

  const { data: round } = await db.from("tg_rounds").select("id, fixture_id, chat_id, status").eq("id", roundId).maybeSingle();
  if (!round || round.status !== "open") return send(fromId, "This round is no longer open.");

  const { data: f } = await db.from("fixtures").select("home, away, kickoff").eq("id", round.fixture_id).single();
  if (!f) return send(fromId, "Fixture not found.");
  if (new Date(f.kickoff) <= new Date()) return send(fromId, "This fixture has already kicked off. Predictions are locked. ⏰");

  const { data: existing } = await db.from("tg_predictions").select("id").eq("round_id", roundId).eq("tg_user_id", fromId).maybeSingle();
  if (existing) return send(fromId, "You've already submitted your prediction for this round! 🔒");

  pendingPrediction.set(fromId, { roundId, fixture: `${f.home} vs ${f.away}`, chatId: round.chat_id });

  await send(fromId,
    `🔮 <b>Predict: ${esc(f.home)} vs ${esc(f.away)}</b>\n\n` +
    `Type the final score, e.g. <code>2-1</code> or <code>0-0</code>\n\n` +
    `Your prediction is hidden until full time.`
  );
}

async function handleScoreInput(chatId: number, fromId: number, fromName: string, text: string) {
  const pending = pendingPrediction.get(fromId);
  if (!pending) return false;

  const match = text.match(/^(\d{1,2})\s*[-–:]\s*(\d{1,2})$/);
  if (!match) {
    await send(chatId, `That doesn't look like a score. Type something like <code>2-1</code> or <code>0-0</code>.`);
    return true;
  }

  const home = parseInt(match[1], 10);
  const away = parseInt(match[2], 10);
  if (home > 20 || away > 20) {
    await send(chatId, "Let's keep it realistic — max 20 goals per side.");
    return true;
  }

  const db = admin();
  if (!db) { await send(chatId, "Bot is not fully configured."); return true; }

  // Verify round is still open
  const { data: round } = await db.from("tg_rounds").select("id, fixture_id, status, chat_id").eq("id", pending.roundId).maybeSingle();
  if (!round || round.status !== "open") {
    pendingPrediction.delete(fromId);
    await send(chatId, "This round is no longer open.");
    return true;
  }

  // Verify not past kickoff
  const { data: f } = await db.from("fixtures").select("kickoff").eq("id", round.fixture_id).single();
  if (f && new Date(f.kickoff) <= new Date()) {
    pendingPrediction.delete(fromId);
    await send(chatId, "Kickoff has passed — predictions are locked. ⏰");
    return true;
  }

  const { error } = await db.from("tg_predictions").upsert({
    round_id: pending.roundId,
    tg_user_id: fromId,
    tg_name: fromName.slice(0, 40),
    home_score: home,
    away_score: away,
  }, { onConflict: "round_id,tg_user_id" });

  pendingPrediction.delete(fromId);

  if (error) {
    await send(chatId, "Failed to save your prediction. Try again.");
    return true;
  }

  // Confirm in DM
  await send(chatId, `🔒 <b>Locked in: ${home}-${away}</b> for ${esc(pending.fixture)}\n\nYour prediction is sealed. Good luck!`);

  // Announce in the group (without revealing the score)
  const count = await db.from("tg_predictions").select("id", { count: "exact", head: true }).eq("round_id", pending.roundId);
  await send(round.chat_id, `🔮 <b>${esc(fromName)}</b> has sealed their prediction! (${count.count ?? "?"} total)`);

  return true;
}

async function handleRoundStatus(chatId: number, roundId?: string) {
  const db = admin();
  if (!db) return send(chatId, "Bot is not fully configured yet.");

  let round;
  if (roundId) {
    const { data } = await db.from("tg_rounds").select("id, fixture_id, status, chat_id").eq("id", roundId).maybeSingle();
    round = data;
  } else {
    const { data } = await db.from("tg_rounds").select("id, fixture_id, status, chat_id").eq("chat_id", chatId).order("created_at", { ascending: false }).limit(1).maybeSingle();
    round = data;
  }
  if (!round) return send(chatId, "No active round. Start one with /newround");

  const { data: f } = await db.from("fixtures").select("home, away, kickoff, home_goals, away_goals").eq("id", round.fixture_id).single();
  if (!f) return send(chatId, "Fixture not found.");

  const { data: preds } = await db.from("tg_predictions").select("tg_name, points, home_score, away_score").eq("round_id", round.id).order("created_at");

  const finished = f.home_goals !== null;
  let text = `📊 <b>Round: ${esc(f.home)} vs ${esc(f.away)}</b>\n`;
  text += `📅 ${fmtDate(f.kickoff)} UTC\n`;
  text += finished ? `⚽ <b>FT: ${f.home_goals}-${f.away_goals}</b>\n` : "";
  text += `Status: <b>${round.status === "revealed" ? "Finished" : round.status === "locked" ? "Locked" : "Open"}</b>\n\n`;

  if (!preds?.length) {
    text += "No predictions yet. Be the first!";
  } else if (round.status === "revealed") {
    text += "<b>Results:</b>\n";
    for (const p of preds) {
      const icon = p.points === 10 ? "🎯" : p.points === 5 ? "✅" : "❌";
      text += `${icon} <b>${esc(p.tg_name)}</b>: ${p.home_score}-${p.away_score} (${p.points} pts)\n`;
    }
  } else {
    text += `<b>${preds.length} prediction${preds.length === 1 ? "" : "s"} sealed:</b>\n`;
    for (const p of preds) text += `🔒 ${esc(p.tg_name)}\n`;
  }

  await send(chatId, text);
}

async function handleResults(chatId: number) {
  const db = admin();
  if (!db) return send(chatId, "Bot is not fully configured yet.");

  const { data: round } = await db.from("tg_rounds").select("id, fixture_id, status").eq("chat_id", chatId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!round) return send(chatId, "No round found. Start one with /newround");
  if (round.status === "revealed") return handleRoundStatus(chatId, round.id);

  const { data: f } = await db.from("fixtures").select("home, away, home_goals, away_goals").eq("id", round.fixture_id).single();
  if (!f) return send(chatId, "Fixture not found.");
  if (f.home_goals === null) return send(chatId, `<b>${esc(f.home)} vs ${esc(f.away)}</b> hasn't finished yet. Check back after full time.`);

  // Lock the round first
  await db.from("tg_rounds").update({ status: "locked" }).eq("id", round.id);

  // Score predictions
  const { data: results, error } = await db.rpc("tg_score_round", { p_round_id: round.id });
  if (error) return send(chatId, "Failed to score the round. Try /results again.");

  let text = `🏆 <b>RESULTS</b>\n\n`;
  text += `⚽ <b>${esc(f.home)} ${f.home_goals}-${f.away_goals} ${esc(f.away)}</b>\n\n`;

  if (!results?.length) {
    text += "No predictions were made for this round.";
  } else {
    let rank = 0;
    for (const r of results as { tg_name: string; home_score: number; away_score: number; points: number }[]) {
      rank++;
      const icon = r.points === 10 ? "🎯" : r.points === 5 ? "✅" : "❌";
      const medal = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `#${rank}`;
      text += `${medal} ${icon} <b>${esc(r.tg_name)}</b>: ${r.home_score}-${r.away_score} → <b>${r.points} pts</b>\n`;
    }
    const topScorer = results[0] as { tg_name: string; points: number };
    if (topScorer.points === 10) {
      text += `\n🎉 <b>${esc(topScorer.tg_name)} CALLED IT!</b> Exact score!`;
    } else if (topScorer.points > 0) {
      text += `\n👏 <b>${esc(topScorer.tg_name)}</b> takes the round!`;
    }
  }

  text += `\n\n<a href="${APP_URL}">Play the full game for ZEC prizes</a>`;
  await send(chatId, text);
}

// ── Bot username cache ────────────────────────────────────────
let botUsername: string | null = null;
async function getBotUsername(): Promise<string> {
  if (botUsername) return botUsername;
  const r = await tg("getMe", {}) as { result?: { username?: string } } | null;
  botUsername = r?.result?.username ?? "CalledItBot";
  return botUsername;
}

// ── Callback query handler (inline buttons) ──────────────────

async function handleCallback(query: { id: string; from: { id: number; first_name?: string; last_name?: string; username?: string }; data?: string }) {
  if (!query.data) return;
  const parts = query.data.split(":");
  const action = parts[0];
  const fromId = query.from.id;
  const fromName = tgName(query.from);

  if (action === "predict" && parts[1]) {
    const roundId = parts[1];
    await answer(query.id, "Check your DMs!");
    await handlePredictDM(fromId, fromName, roundId);
  } else if (action === "status" && parts[1]) {
    await answer(query.id, "Loading...");
    await handleRoundStatus(fromId, parts[1]);
  }
}

// ── Main webhook entry ────────────────────────────────────────

export async function POST(req: NextRequest) {
  if (!BOT_TOKEN) return NextResponse.json({ ok: false, error: "not configured" }, { status: 501 });

  const secret = req.headers.get("x-telegram-bot-api-secret-token");
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expected || secret !== expected) {
    return NextResponse.json({ ok: false }, { status: 403 });
  }

  try {
    const body = await req.json();

    // Handle inline button callbacks
    if (body.callback_query) {
      await handleCallback(body.callback_query);
      return NextResponse.json({ ok: true });
    }

    const msg = body.message;
    if (!msg?.chat?.id) return NextResponse.json({ ok: true });

    const chatId = msg.chat.id as number;
    const fromId = msg.from?.id as number;
    const fromName = msg.from ? tgName(msg.from) : "Player";
    const isGroup = msg.chat.type === "group" || msg.chat.type === "supergroup";
    const text = ((msg.text as string) ?? "").trim();

    // If user has a pending prediction and sends a score-like message in DM
    if (!isGroup && pendingPrediction.has(fromId) && text && !text.startsWith("/")) {
      const handled = await handleScoreInput(chatId, fromId, fromName, text);
      if (handled) return NextResponse.json({ ok: true });
    }

    const cmd = text.split(/\s/)[0].toLowerCase().replace(/@\w+$/, "");

    // Handle /start with deep link parameter (predict_<roundId>)
    if (cmd === "/start" && !isGroup) {
      const param = text.split(/\s/)[1];
      if (param?.startsWith("predict_")) {
        await handlePredictDM(fromId, fromName, param.replace("predict_", ""));
        return NextResponse.json({ ok: true });
      }
    }

    switch (cmd) {
      case "/start":
      case "/help":
        await handleStart(chatId, isGroup);
        break;
      case "/seal":
      case "/fixtures":
        await handleFixtures(chatId);
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
      case "/newround":
        if (!isGroup) { await send(chatId, "Use /newround in a group chat."); break; }
        await handleNewRound(chatId, fromId);
        break;
      case "/predict":
        await handlePredict(chatId, fromId, isGroup);
        break;
      case "/round":
      case "/status":
        await handleRoundStatus(chatId);
        break;
      case "/results":
      case "/reveal":
        if (!isGroup) { await send(chatId, "Use /results in the group chat."); break; }
        await handleResults(chatId);
        break;
      case "/play":
        await send(chatId, `<a href="${APP_URL}">Open Called It</a>`);
        break;
      default:
        // In DMs, try to parse as a score if pending
        if (!isGroup && pendingPrediction.has(fromId)) {
          await handleScoreInput(chatId, fromId, fromName, text);
        } else if (text.startsWith("/")) {
          await send(chatId,
            isGroup
              ? `Try:\n/newround — Start a prediction round\n/predict — Submit your score\n/round — See who's predicted\n/results — Reveal scores\n/leaderboard — Top players`
              : `Try:\n/seal — Open fixtures\n/leaderboard — Top players\n/syndicates — Group pools\n/play — Open the app`
          );
        }
    }
  } catch {
    // Telegram retries on 5xx, so always return 200
  }

  return NextResponse.json({ ok: true });
}
