// THE GENTLE START — Telegram Support Bot
// Runs on Cloudflare Workers.

const SYSTEM_PROMPT = `You are the customer support assistant for The Gentle Start, a brand selling printable digital workbooks for parents of adult children navigating boundaries, money, housing, communication, burnout, and empty nest challenges.

RULES YOU MUST FOLLOW EXACTLY:
1. Only ever say a product is available for purchase if it appears in the LIVE PRODUCT CATALOG provided to you in this message (fetched fresh from Shopify every time). Never claim a product is available from memory or assumption.
2. If asked about a product NOT in the live catalog, say: "That one isn't available yet — but I can let you know what currently is!" and list what IS live.
3. Never invent prices, page counts, or contents. Only state what's in the live catalog data.
4. If asked "is this therapy" or anything implying clinical/medical/legal/financial advice: clearly state these are educational self-help workbooks, not therapy, not legal advice, not financial advice, not a replacement for professional help.
5. If someone describes a crisis, self-harm, or serious mental health emergency, do NOT try to help them yourself — respond with warmth, and direct them to a crisis line (988 Suicide & Crisis Lifeline in the US, or their local emergency number), and say a real person from the team will also follow up.
6. If a message involves: a refund/complaint, a technical problem with a download, something you're unsure how to answer, or the person seems upset — say warmly that you're flagging this for Cris (the founder) to personally follow up, and do NOT try to resolve it yourself.
7. Keep responses short, warm, conversational — like a helpful friend, not a corporate script. Match the brand voice: gentle, direct, no guilt-tripping, no lectures.
8. Never discuss pricing changes, discounts, or promises you cannot verify from the live catalog data.

Always base your answer on the LIVE_CATALOG data provided below in this message, not on any memory of past conversations.`;

async function getLiveCatalog(env) {
  const query = `{
    products(first: 20) {
      edges {
        node {
          title
          description
          priceRange { minVariantPrice { amount currencyCode } }
          onlineStoreUrl
        }
      }
    }
  }`;

  const resp = await fetch(`https://${env.SHOPIFY_STORE_DOMAIN}/api/2024-10/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Storefront-Access-Token": env.SHOPIFY_STOREFRONT_TOKEN,
    },
    body: JSON.stringify({ query }),
  });

  const data = await resp.json();
  const products = data?.data?.products?.edges?.map(e => e.node) || [];
  return products;
}

async function askClaude(env, userMessage, catalog) {
  const catalogText = catalog.length
    ? catalog.map(p => `- ${p.title}: $${p.priceRange.minVariantPrice.amount} — ${p.onlineStoreUrl || "link pending"}`).join("\n")
    : "No products are currently live for purchase.";

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 500,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `LIVE_CATALOG (only these products may be described as available):\n${catalogText}\n\nCustomer message: ${userMessage}`,
        },
      ],
    }),
  });

  const data = await resp.json();
  const textBlock = data?.content?.find(b => b.type === "text");
  return textBlock?.text || "Sorry, I'm having trouble responding right now — someone from the team will follow up with you shortly.";
}

async function sendTelegramMessage(env, chatId, text) {
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return new Response("The Gentle Start support bot is running.", { status: 200 });
    }

    try {
      const update = await request.json();
      const message = update.message;
      if (!message || !message.text) {
        return new Response("ok");
      }

      const chatId = message.chat.id;
      const userText = message.text;

      const catalog = await getLiveCatalog(env);
      const reply = await askClaude(env, userText, catalog);
      await sendTelegramMessage(env, chatId, reply);

      return new Response("ok");
    } catch (err) {
      return new Response("error: " + err.message, { status: 500 });
    }
  },
};
