import { getDoc, setDoc, listDocs } from "./firebase.js";
import {
  sendMessage, sendPhoto, answerCallback,
  getChatMember, approveJoinRequest, exportInviteLink, tgCall
} from "./telegram.js";
import { isAdmin, sendAdminPanel, handleAdminCallback, handleStateInput } from "./admin.js";
import { handlePing, handleDeveloper, handleHelp, handleStatistics, handleCheckUser } from "./commands.js";

let BOT_USERNAME = null;
async function getBotUsername() {
  if (BOT_USERNAME) return BOT_USERNAME;
  const res = await tgCall("getMe", {});
  BOT_USERNAME = res.result.username;
  return BOT_USERNAME;
}

async function getSettings() {
  const s = await getDoc("settings", "config");
  return s || {};
}

async function saveUser(userId, chatId, firstName) {
  try {
    const existing = await getDoc("users", String(userId));
    if (!existing) {
      await setDoc("users", String(userId), {
        chatId, name: firstName || "", verified: false, joinedAt: Date.now()
      });
    } else if (existing.chatId !== chatId || existing.name !== firstName) {
      await setDoc("users", String(userId), { chatId, name: firstName || existing.name });
    }
    return existing;
  } catch (err) {
    console.log("saveUser error:", err.message);
    return null;
  }
}

async function dmMessage(userId, text, replyMarkup, firstName) {
  await saveUser(userId, userId, firstName || "");
  return sendMessage(userId, text, replyMarkup);
}
async function dmPhoto(userId, photo, caption, replyMarkup, firstName) {
  await saveUser(userId, userId, firstName || "");
  return sendPhoto(userId, photo, caption, replyMarkup);
}

async function getUnjoinedChannels(userId) {
  const forceChannels = await listDocs("force_channels");
  const checks = forceChannels.map(async ch => {
    try {
      const status = await getChatMember(ch.id, userId);
      const joined = status && ["member", "administrator", "creator"].includes(status);
      return joined ? null : ch;
    } catch (err) {
      return ch;
    }
  });
  const results = await Promise.all(checks);
  return results.filter(Boolean);
}

function buildGateButtons(unjoinedChannels) {
  const rows = [];
  for (let i = 0; i < unjoinedChannels.length; i += 2) {
    const row = [{ text: "Join", url: unjoinedChannels[i].link, style: "success" }];
    if (unjoinedChannels[i + 1]) row.push({ text: "Join", url: unjoinedChannels[i + 1].link, style: "success" });
    rows.push(row);
  }
  rows.push([{ text: "✅ Verify", callback_data: "verify", style: "danger" }]);
  return rows;
}

async function sendGateMenu(chatId, settings, unjoinedChannels) {
  const caption = settings.startCaption || "Add me to your channel ⚡";
  const photo = settings.startPhoto;
  const markup = { inline_keyboard: buildGateButtons(unjoinedChannels) };
  if (photo) await sendPhoto(chatId, photo, caption, markup);
  else await sendMessage(chatId, caption, markup);
}

async function sendAccessRestricted(chatId, unjoinedChannels) {
  const markup = { inline_keyboard: buildGateButtons(unjoinedChannels) };
  await sendMessage(chatId, "🚫 Access restricted. Please join the required channel(s) first, then tap Verify.", markup);
}

async function sendMainMenu(chatId, settings) {
  const botUsername = await getBotUsername();
  const caption = settings.startCaption || "Add me to your channel ⚡";
  const photo = settings.startPhoto;
  const buttons = [
    [{ text: "➕ Add to Channel", url: `https://t.me/${botUsername}?startchannel=new&admin=post_messages+invite_users`, style: "success" }],
    [{ text: "➕ Add to Group", url: `https://t.me/${botUsername}?startgroup=new&admin=invite_users`, style: "danger" }]
  ];
  const markup = { inline_keyboard: buttons };
  if (photo) await sendPhoto(chatId, photo, caption, markup);
  else await sendMessage(chatId, caption, markup);
}

async function handleStart(chatId, userId, firstName) {
  await saveUser(userId, chatId, firstName);

  const settings = await getSettings();
  const unjoined = await getUnjoinedChannels(userId);

  if (unjoined.length === 0) {
    await setDoc("users", String(userId), { verified: true });
    return sendMainMenu(chatId, settings);
  }
  return sendGateMenu(chatId, settings, unjoined);
}

async function handleVerify(callbackQuery) {
  const userId = callbackQuery.from.id;
  const chatId = callbackQuery.message.chat.id;
  const settings = await getSettings();

  const unjoined = await getUnjoinedChannels(userId);

  if (unjoined.length === 0) {
    await setDoc("users", String(userId), { verified: true });
    await answerCallback(callbackQuery.id, "✅ Verified!");
    await sendMainMenu(chatId, settings);
  } else {
    await answerCallback(callbackQuery.id, `❌ You still need to join ${unjoined.length} more channel(s).`);
    await sendGateMenu(chatId, settings, unjoined);
  }
}

async function handleMyChatMember(update) {
  const chat = update.chat;
  const newStatus = update.new_chat_member.status;
  const fromUser = update.from;

  if (!["channel", "group", "supergroup"].includes(chat.type)) return;
  if (newStatus !== "administrator") return;

  let link = null;
  if (chat.type === "channel" || chat.type === "supergroup") {
    link = await exportInviteLink(chat.id);
  }

  await setDoc("channels", String(chat.id), {
    title: chat.title || "",
    type: chat.type,
    inviteLink: link || "",
    ownerId: fromUser.id,
    addedAt: Date.now()
  });

  await sendMessage(chat.id, "Thanks for adding me! I automatically accept join requests and alert you on the bot.");
  await dmMessage(fromUser.id, `✅ Added to "${chat.title}". I'll auto-accept join requests and notify you here.`, undefined, fromUser.first_name);
}

async function handleJoinRequest(update) {
  const chatId = update.chat.id;
  const user = update.from;

  const channel = await getDoc("channels", String(chatId));
  if (!channel) return;

  await approveJoinRequest(chatId, user.id);

  const settings = await getSettings();
  let caption = settings.joinCaption || "Welcome! Your request has been accepted 🎉";
  caption = caption.replace(/{channel}/g, channel.title || "the channel");

  const photo = settings.joinPhoto;

  if (photo) await dmPhoto(user.id, photo, caption, undefined, user.first_name);
  else await dmMessage(user.id, caption, undefined, user.first_name);

  if (channel.ownerId) {
    await dmMessage(channel.ownerId, `👤 New member accepted in "${channel.title}": ${user.first_name}`, undefined, "");
  }
}

export default {
  async fetch(request, env, ctx) {
    if (request.method !== "POST") return new Response("OK");
    const update = await request.json();

    try {
      if (update.message) {
        const msg = update.message;
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const text = (msg.text || "").trim();

        if (text === "/start") {
          await handleStart(chatId, userId, msg.from.first_name);
        } else if (text === "/openhxji") {
          if (isAdmin(userId)) await sendAdminPanel(chatId);
        } else if (text === "/ping") {
          await handlePing(chatId);
        } else if (text === "/developer") {
          await handleDeveloper(chatId);
        } else if (text === "/statistics") {
          await handleStatistics(chatId);
        } else if (text === "/help") {
          await handleHelp(chatId, userId);
        } else if (text.startsWith("/check_") && isAdmin(userId)) {
          await handleCheckUser(chatId, text.replace("/check_", "").trim());
        } else if (isAdmin(userId)) {
          const handled = await handleStateInput(msg, ctx);
          if (!handled) await saveUser(userId, chatId, msg.from.first_name);
        } else {
          await saveUser(userId, chatId, msg.from.first_name);
          const unjoined = await getUnjoinedChannels(userId);
          if (unjoined.length > 0) {
            await sendAccessRestricted(chatId, unjoined);
          } else {
            await setDoc("users", String(userId), { verified: true });
          }
        }
      }

      if (update.callback_query) {
        const cq = update.callback_query;
        const data = cq.data;
        const userId = cq.from.id;
        const chatId = cq.message.chat.id;

        if (data === "verify") {
          await handleVerify(cq);
        } else if (data.startsWith("adm_")) {
          await handleAdminCallback(cq, data);
        } else {
          if (!isAdmin(userId)) {
            const unjoined = await getUnjoinedChannels(userId);
            if (unjoined.length > 0) {
              await answerCallback(cq.id, "🚫 Please join the required channel(s) first.");
              await sendAccessRestricted(chatId, unjoined);
              return new Response("OK");
            }
          }
          await answerCallback(cq.id, "");
        }
      }

      if (update.my_chat_member) await handleMyChatMember(update.my_chat_member);
      if (update.chat_join_request) await handleJoinRequest(update.chat_join_request);
    } catch (err) {
      console.log("Error:", err.message);
    }

    return new Response("OK");
  }
};
