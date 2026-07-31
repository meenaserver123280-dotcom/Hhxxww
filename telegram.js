import { CONFIG } from "./config.js";

const API = `https://api.telegram.org/bot${CONFIG.BOT_TOKEN}`;

export async function tgCall(method, params) {
  const res = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params)
  });
  return res.json();
}

export async function sendMessage(chatId, text, replyMarkup) {
  return tgCall("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    reply_markup: replyMarkup
  });
}

export async function sendPhoto(chatId, photoUrl, caption, replyMarkup) {
  return tgCall("sendPhoto", {
    chat_id: chatId,
    photo: photoUrl,
    caption,
    parse_mode: "HTML",
    reply_markup: replyMarkup
  });
}

export async function editMessageText(chatId, messageId, text, replyMarkup) {
  return tgCall("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: "HTML",
    reply_markup: replyMarkup
  });
}

export async function sendDocument(chatId, filename, jsonContent, caption) {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  if (caption) form.append("caption", caption);
  const blob = new Blob([jsonContent], { type: "application/json" });
  form.append("document", blob, filename);

  const res = await fetch(`${API}/sendDocument`, {
    method: "POST",
    body: form
  });
  return res.json();
}

export async function answerCallback(callbackQueryId, text) {
  return tgCall("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text,
    show_alert: !!text
  });
}

export async function getChatMember(chatId, userId) {
  const res = await tgCall("getChatMember", { chat_id: chatId, user_id: userId });
  return res.result ? res.result.status : null;
}

export async function approveJoinRequest(chatId, userId) {
  return tgCall("approveChatJoinRequest", { chat_id: chatId, user_id: userId });
}

export async function exportInviteLink(chatId) {
  const res = await tgCall("createChatInviteLink", {
    chat_id: chatId,
    creates_join_request: true
  });
  return res.result ? res.result.invite_link : null;
}

export async function createInstantInviteLink(chatId) {
  const res = await tgCall("createChatInviteLink", {
    chat_id: chatId,
    creates_join_request: false
  });
  return res.result ? res.result.invite_link : null;
}

export async function getChat(chatId) {
  const res = await tgCall("getChat", { chat_id: chatId });
  return res.result || null;
}
