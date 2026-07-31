import { CONFIG } from "./config.js";
import { setDoc, getDoc, deleteDoc, listDocs } from "./firebase.js";
import { sendMessage, sendPhoto, answerCallback, createInstantInviteLink, exportInviteLink, sendDocument } from "./telegram.js";

export function isAdmin(userId) {
  return String(userId) === String(CONFIG.ADMIN_ID);
}

export async function setState(userId, state, temp) {
  await setDoc("states", String(userId), {
    state, temp: temp ? JSON.stringify(temp) : ""
  });
}
export async function getState(userId) {
  const s = await getDoc("states", String(userId));
  return s || { state: "" };
}
export async function clearState(userId) {
  await deleteDoc("states", String(userId));
}

export async function sendAdminPanel(chatId) {
  await sendMessage(chatId, "🔐 <b>Admin Panel</b>", {
    inline_keyboard: [
      [{ text: "📊 Total Stats", callback_data: "adm_stats", style: "primary" }],
      [{ text: "📥 Download Database", callback_data: "adm_download", style: "primary" }],
      [{ text: "📢 Broadcast", callback_data: "adm_broadcast", style: "primary" }],
      [{ text: "➕ Add Force-Join Channel", callback_data: "adm_addforce", style: "success" }],
      [{ text: "📋 View Force-Join Channels", callback_data: "adm_viewforce", style: "primary" }],
      [{ text: "🗑 Remove Force-Join Channel", callback_data: "adm_removeforce", style: "danger" }],
      [{ text: "🖼 Set Start Message", callback_data: "adm_setstart", style: "primary" }],
      [{ text: "🖼 Set Join Message", callback_data: "adm_setjoin", style: "primary" }],
      [{ text: "📋 View Channels", callback_data: "adm_viewchannels", style: "primary" }],
      [{ text: "🗑 Remove Channel by ID", callback_data: "adm_removechannel", style: "danger" }]
    ]
  });
}

export async function handleAdminCallback(callbackQuery, data) {
  const chatId = callbackQuery.message.chat.id;
  const userId = callbackQuery.from.id;
  if (!isAdmin(userId)) return answerCallback(callbackQuery.id, "Not authorized.");

  await answerCallback(callbackQuery.id, "");

  if (data === "adm_stats") {
    const users = await listDocs("users");
    const channels = await listDocs("channels");
    const forceChannels = await listDocs("force_channels");
    return sendMessage(chatId, `📊 Total Users: ${users.length}\n📢 Total Channels/Groups: ${channels.length}\n🔗 Force-Join Channels: ${forceChannels.length}`);
  }

  if (data === "adm_download") {
    await sendMessage(chatId, "⏳ Preparing database export...");
    const [users, channels, forceChannels, settings] = await Promise.all([
      listDocs("users"),
      listDocs("channels"),
      listDocs("force_channels"),
      getDoc("settings", "config")
    ]);

    const dbExport = {
      exportedAt: new Date().toISOString(),
      users,
      channels,
      force_channels: forceChannels,
      settings: settings || {}
    };

    const jsonContent = JSON.stringify(dbExport, null, 2);
    await sendDocument(chatId, "database.json", jsonContent, `📦 Database export — ${users.length} users, ${channels.length} channels`);
    return;
  }

  if (data === "adm_broadcast") {
    await setState(userId, "awaiting_broadcast_photo", {});
    return sendMessage(chatId, "📸 Send a photo for the broadcast, or send /skip to send text-only.");
  }

  if (data === "adm_addforce") {
    await setState(userId, "awaiting_force_channel");
    return sendMessage(chatId, "Send the channel username (e.g. @mychannel) or numeric chat ID. Bot must already be admin there.\n\nYou can add as many as you want, one at a time. Send /done when finished.");
  }

  if (data === "adm_viewforce") {
    const channels = await listDocs("force_channels");
    if (channels.length === 0) return sendMessage(chatId, "No force-join channels set.");
    const list = channels.map(c => `• ${c.title || c.id}\nID: ${c.id}`).join("\n\n");
    return sendMessage(chatId, `Total: ${channels.length}\n\n${list}`);
  }

  if (data === "adm_removeforce") {
    await setState(userId, "awaiting_remove_force_channel");
    return sendMessage(chatId, "Send the chat ID of the force-join channel to remove.");
  }

  if (data === "adm_setstart") {
    await setState(userId, "awaiting_start_photo");
    return sendMessage(chatId, "Send the photo for the /start message.");
  }

  if (data === "adm_setjoin") {
    await setState(userId, "awaiting_join_photo");
    return sendMessage(chatId, "Send the photo for the join-accepted message. (You can use {channel} in the caption to auto-insert the channel name.)");
  }

  if (data === "adm_viewchannels") {
    const channels = await listDocs("channels");
    if (channels.length === 0) return sendMessage(chatId, "No channels/groups added yet.");
    const list = channels.map(c => `• ${c.title || c.id} (${c.type})\n${c.inviteLink || "no link"}`).join("\n\n");
    return sendMessage(chatId, list);
  }

  if (data === "adm_removechannel") {
    await setState(userId, "awaiting_remove_channel_id");
    return sendMessage(chatId, "Send the chat ID of the channel/group to remove.");
  }
}

export async function handleStateInput(msg, ctx) {
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  const state = await getState(userId);
  if (!state.state) return false;

  if (state.state === "awaiting_broadcast_photo") {
    if (msg.photo) {
      const fileId = msg.photo[msg.photo.length - 1].file_id;
      await setState(userId, "awaiting_broadcast_text", { photo: fileId });
      await sendMessage(chatId, "✏️ Now send the broadcast text.");
      return true;
    }
    if (msg.text && msg.text.trim() === "/skip") {
      await setState(userId, "awaiting_broadcast_text", {});
      await sendMessage(chatId, "✏️ Now send the broadcast text.");
      return true;
    }
    await sendMessage(chatId, "Please send a photo, or /skip.");
    return true;
  }

  if (state.state === "awaiting_broadcast_text" && msg.text) {
    const temp = JSON.parse((await getState(userId)).temp || "{}");
    temp.text = msg.text;
    await setState(userId, "awaiting_broadcast_button", temp);
    await sendMessage(chatId,
      "🔘 Add an inline button? Send in this format:\n\n<code>ButtonText | https://example.com | success</code>\n\nColor options: primary, success, danger\n\nOr send /skip to send without a button."
    );
    return true;
  }

  if (state.state === "awaiting_broadcast_button" && msg.text) {
    const temp = JSON.parse((await getState(userId)).temp || "{}");

    let replyMarkup = null;
    if (msg.text.trim() !== "/skip") {
      const parts = msg.text.split("|").map(p => p.trim());
      const btnText = parts[0];
      const btnUrl = parts[1];
      const btnColor = parts[2] && ["primary", "success", "danger"].includes(parts[2]) ? parts[2] : undefined;

      if (!btnText || !btnUrl) {
        await sendMessage(chatId, "Invalid format. Use: ButtonText | https://url | color — or send /skip.");
        return true;
      }

      const button = { text: btnText, url: btnUrl };
      if (btnColor) button.style = btnColor;
      replyMarkup = { inline_keyboard: [[button]] };
    }

    await clearState(userId);
    await sendMessage(chatId, "🚀 Broadcast started in background. You'll get a summary when it's done.");

    const task = runBroadcast(chatId, temp.text, temp.photo, replyMarkup);
    if (ctx && ctx.waitUntil) ctx.waitUntil(task); else await task;

    return true;
  }

  if (state.state === "awaiting_force_channel" && msg.text) {
    if (msg.text.trim() === "/done") {
      await clearState(userId);
      await sendMessage(chatId, "✅ Done adding force-join channels.");
      return true;
    }
    const channelId = msg.text.trim();
    const link = await createInstantInviteLink(channelId);
    if (!link) {
      await sendMessage(chatId, "Couldn't generate a link. Make sure the bot is admin there with invite permission. Send another channel or /done.");
      return true;
    }
    await setDoc("force_channels", channelId, { title: channelId, link });
    await sendMessage(chatId, `✅ Added: ${channelId}\nSend another channel or /done to finish.`);
    return true;
  }

  if (state.state === "awaiting_remove_force_channel" && msg.text) {
    await deleteDoc("force_channels", msg.text.trim());
    await clearState(userId);
    await sendMessage(chatId, "✅ Removed (if it existed).");
    return true;
  }

  if (state.state === "awaiting_start_photo" && msg.photo) {
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    await setState(userId, "awaiting_start_caption", { photo: fileId });
    await sendMessage(chatId, "Now send the caption text.");
    return true;
  }
  if (state.state === "awaiting_start_caption" && msg.text) {
    const temp = JSON.parse((await getState(userId)).temp || "{}");
    await setDoc("settings", "config", { startPhoto: temp.photo, startCaption: msg.text });
    await clearState(userId);
    await sendMessage(chatId, "✅ Start message updated.");
    return true;
  }

  if (state.state === "awaiting_join_photo" && msg.photo) {
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    await setState(userId, "awaiting_join_caption", { photo: fileId });
    await sendMessage(chatId, "Now send the caption text. (Use {channel} to auto-insert the channel name.)");
    return true;
  }
  if (state.state === "awaiting_join_caption" && msg.text) {
    const temp = JSON.parse((await getState(userId)).temp || "{}");
    await setDoc("settings", "config", { joinPhoto: temp.photo, joinCaption: msg.text });
    await clearState(userId);
    await sendMessage(chatId, "✅ Join message updated.");
    return true;
  }

  if (state.state === "awaiting_remove_channel_id" && msg.text) {
    await deleteDoc("channels", msg.text.trim());
    await clearState(userId);
    await sendMessage(chatId, "✅ Removed (if it existed).");
    return true;
  }

  return false;
}

async function runBroadcast(adminChatId, caption, photoFileId, replyMarkup) {
  const users = await listDocs("users");
  let sent = 0, failed = 0;
  for (const u of users) {
    try {
      if (photoFileId) await sendPhoto(u.chatId, photoFileId, caption, replyMarkup);
      else await sendMessage(u.chatId, caption, replyMarkup);
      sent++;
    } catch (e) {
      failed++;
    }
  }
  await sendMessage(adminChatId, `Broadcast done. Sent: ${sent}, Failed: ${failed}`);
}
