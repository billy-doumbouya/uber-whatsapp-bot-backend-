// src/services/aiService.js — CORRIGÉ (une seule définition de runAI, fusionnée)

const { messageLogDb } = require("../lib/db");
const { getBotConfig } = require("./configService");
const logger = require("../utils/logger");

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

const DEFAULT_FALLBACK_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-3-flash-preview",
];

const COMPANY_NAME = "UBER";

const DEFAULT_SYSTEM_PROMPT = `
Tu es l'assistant WhatsApp de ${COMPANY_NAME}, service de commande de cartes VISA.
Ton rôle : accueillir le client, répondre à ses questions, et collecter
poliment les informations suivantes, une par une si besoin :
prénom, nom, numéro de téléphone à associer à la carte, email (optionnel),
adresse complète, type de carte (Visa Classic, Visa Gold, ou Visa Business).

Sois chaleureux, concis, utilise le français. Ne redemande jamais une
information déjà connue (voir contexte ci-dessous) — confirme-la plutôt.

Dès qu'une information est fournie ou corrigée, appelle update_customer_info.
Si le client demande explicitement le lien du formulaire, à tout moment,
appelle provide_form_link.
Quand TOUTES les informations obligatoires (prénom, nom, téléphone, adresse,
type de carte) sont réunies et confirmées, appelle request_documents UNE SEULE FOIS.
`.trim();

const tools = [
  {
    functionDeclarations: [
      {
        name: "update_customer_info",
        description:
          "Enregistre ou met à jour une information client extraite du message. " +
          "N'appelle cette fonction que pour les champs réellement fournis par le client.",
        parameters: {
          type: "OBJECT",
          properties: {
            firstName: { type: "STRING" },
            lastName: { type: "STRING" },
            phone: {
              type: "STRING",
              description:
                "Numéro à associer à la carte, format international (ex: +224621000000)",
            },
            email: { type: "STRING" },
            address: { type: "STRING" },
            cardType: {
              type: "STRING",
              enum: ["VISA_CLASSIC", "VISA_GOLD", "VISA_BUSINESS"],
            },
          },
        },
      },
      {
        name: "provide_form_link",
        description:
          "À appeler si le client demande explicitement le lien du formulaire (par exemple " +
          "quand il veut commander/passer commande), à tout moment de la conversation, " +
          "même si toutes les infos ne sont pas encore réunies.",
        parameters: { type: "OBJECT", properties: {} },
      },
      {
        name: "request_documents",
        description:
          "À appeler UNE SEULE FOIS, quand prénom, nom, téléphone, adresse et type de " +
          "carte ont tous été collectés et confirmés. Déclenche le récapitulatif complet, " +
          "l'envoi du lien de formulaire, et le passage à l'étape des documents.",
        parameters: { type: "OBJECT", properties: {} },
      },
    ],
  },
];

async function buildContents(phone) {
  const logs = (await messageLogDb.findByPhone(phone, { limit: 30 })).reverse();
  return logs.map((l) => ({
    role: l.direction === "IN" ? "user" : "model",
    parts: [{ text: l.content }],
  }));
}

async function getFallbackModels() {
  const configured = await getBotConfig("ai_models_fallback");
  if (!configured) return DEFAULT_FALLBACK_MODELS;
  const list = configured
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length ? list : DEFAULT_FALLBACK_MODELS;
}

async function callGemini(model, { contents, systemInstruction }) {
  const url = `${GEMINI_BASE_URL}/models/${model}:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": process.env.GEMINI_API_KEY,
    },
    body: JSON.stringify({
      contents,
      systemInstruction: { parts: [{ text: systemInstruction }] },
      tools,
    }),
  });

  if (!res.ok) {
    const err = new Error(`Gemini [${model}] → HTTP ${res.status}`);
    err.status = res.status;
    err.body = await res.text().catch(() => "");
    throw err;
  }

  return res.json();
}

async function generateWithFallback(payload) {
  const models = await getFallbackModels();
  let lastErr;

  for (const model of models) {
    try {
      return { model, data: await callGemini(model, payload) };
    } catch (err) {
      lastErr = err;
      const retryable = [429, 500, 503].includes(err.status);
      logger.warn(
        { model, status: err.status },
        "Modèle Gemini indisponible, tentative suivante",
      );
      if (!retryable) throw err;
    }
  }
  throw lastErr;
}

async function getCardPrices() {
  const [classic, gold, business] = await Promise.all([
    getBotConfig("price_visa_classic"),
    getBotConfig("price_visa_gold"),
    getBotConfig("price_visa_business"),
  ]);
  return {
    VISA_CLASSIC: classic || "non défini",
    VISA_GOLD: gold || "non défini",
    VISA_BUSINESS: business || "non défini",
  };
}

// ── UNE SEULE version de runAI, fusionnée ──────────────────────
async function runAI(phone, conv) {
  const [systemPromptBase, prices] = await Promise.all([
    getBotConfig("ai_system_prompt"),
    getCardPrices(),
  ]);

  const known = conv.data?.collectedFields || {};
  const systemInstruction =
    `${systemPromptBase || DEFAULT_SYSTEM_PROMPT}\n\n` +
    `Tarifs actuels des cartes (utilise EXACTEMENT ces montants, ne les invente jamais) :\n` +
    `- Visa Classic : ${prices.VISA_CLASSIC}\n` +
    `- Visa Gold : ${prices.VISA_GOLD}\n` +
    `- Visa Business : ${prices.VISA_BUSINESS}\n\n` +
    `Informations déjà connues sur ce client (ne les redemande pas, confirme-les si besoin) :\n` +
    JSON.stringify(known, null, 2);

  const contents = await buildContents(phone);

  let result;
  try {
    result = await generateWithFallback({ contents, systemInstruction });
  } catch (err) {
    logger.error(
      { err: err.message, status: err.status, phone },
      "Tous les modèles Gemini ont échoué",
    );
    return {
      text: "Désolé, un problème technique est survenu. Réessayez dans un instant.",
      calls: [],
    };
  }

  const parts = result.data.candidates?.[0]?.content?.parts || [];
  let text = "";
  const calls = [];
  for (const part of parts) {
    if (part.text) text += part.text;
    if (part.functionCall) calls.push(part.functionCall);
  }

  return { text: text.trim(), calls };
}

module.exports = { runAI };
