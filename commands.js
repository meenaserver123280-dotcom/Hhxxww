import { CONFIG } from "./config.js";
import { listDocs, getDoc } from "./firebase.js";
import { sendMessage } from "./telegram.js";
import { isAdmin } from "./admin.js";

export async function handlePing(chatId) {
  const start = Date.now();
  await sendMessage(chatId, "🏓 <b>Pinging...</b>");
  const latency = Date.now() - start;
  await sendMessage(chatId,
    `🟢 <b>Pong!</b>\n\n⚡ <b>Response Time:</b> <code>${latency}ms</code>\n✅ <b>Status:</b> Online &amp; Running Smooth`
  );
}

export async function handleDeveloper(chatId) {
  const text =
`✨ <b>DEVELOPER INFO</b> ✨

🛠️ This bot is crafted &amp; maintained by:
👑 <b>@HX_TEAM_OWNER</b>

💬 Need a custom bot, support, or have a business inquiry? Reach out anytime — always happy to help!

⚡ <i>Powered by HX OWNER</i>`;

  await sendMessage(chatId, text, {
    inline_keyboard: [
      [{ text: "💬 Contact Developer", url: "https://t.me/HX_TEAM_OWNER", style: "primary" }]
    ]
  });
}

export async function handleHelp(chatId, userId) {
  const text =
`📖 <b>HX REQ ACCEPTER — HELP</b>

<b>👤 Available Commands</b>
▫️ /start — Begin using the bot
▫️ /ping — Check bot speed &amp; status
▫️ /developer — Contact the developer
▫️ /statistics — View bot's live statistics
▫️ /help — Show this menu

<b>✨ What this bot does</b>
✅ Auto-accepts join requests instantly
📩 Sends a welcome DM to every new member
➕ One-tap add to your channel or group
🔔 Alerts you when someone joins

⚡ <i>Powered by HX OWNER</i>`;

  await sendMessage(chatId, text);
}

export async function handleStatistics(chatId) {
  const users = await listDocs("users");
  const verified = users.filter(u => u.verified).length;

  const text =
`📊 <b>BOT STATISTICS</b>

👥 <b>Total Users:</b> <code>${users.length}</code>
✅ <b>Verified Users:</b> <code>${users.length}</code>

⚡ <i>Powered by HX OWNER</i>`;

  await sendMessage(chatId, text);
}

export async function handleCheckUser(chatId, targetId) {
  const doc = await getDoc("users", String(targetId));
  if (!doc) {
    return sendMessage(chatId, `❌ No document found for user ID: <code>${targetId}</code>`);
  }
  return sendMessage(chatId,
    `✅ Found document for <code>${targetId}</code>:\n\n<pre>${JSON.stringify(doc, null, 2)}</pre>`
  );
}
