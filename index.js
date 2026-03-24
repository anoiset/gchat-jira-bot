import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import { google } from "googleapis";

dotenv.config();

const app = express();
app.use(express.json());

const {
  JIRA_DOMAIN,
  JIRA_EMAIL,
  JIRA_API_TOKEN,
  JIRA_PROJECT,
  OPENAI_API_KEY,
  GOOGLE_SERVICE_ACCOUNT_JSON, // JSON string of the service account key (for Cloud Run, set as env var)
} = process.env;

const sessions = {};

// ─── GOOGLE CHAT AUTH ─────────────────────────
function getChatClient() {
  let auth;

  if (GOOGLE_SERVICE_ACCOUNT_JSON) {
    // Use service account key from env var (recommended for Cloud Run)
    const credentials = JSON.parse(GOOGLE_SERVICE_ACCOUNT_JSON);
    auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/chat.bot"],
    });
  } else {
    // Fall back to Application Default Credentials
    auth = new google.auth.GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/chat.bot"],
    });
  }

  return google.chat({ version: "v1", auth });
}

// ─── SEND MESSAGE TO GOOGLE CHAT ──────────────
async function sendMessage(spaceName, text) {
  try {
    const chat = getChatClient();
    await chat.spaces.messages.create({
      parent: spaceName,
      requestBody: { text },
    });
  } catch (err) {
    console.error("Failed to send Google Chat message:", err.message);
  }
}

// ─── ENTRY POINT ──────────────────────────────
app.post("/", async (req, res) => {
  // Immediately acknowledge — Google Chat won't wait for your response body
  res.sendStatus(200);

  try {
    const event = req.body;
    console.log("Received event:", JSON.stringify(event, null, 2));

    const payload = event.chat?.messagePayload;

    // No message payload — could be ADDED_TO_SPACE or similar
    if (!payload?.message) {
      const spaceName = event.chat?.messagePayload?.space?.name || event.chat?.space?.name;
      if (spaceName) {
        await sendMessage(spaceName, "👋 Jira Bot ready! Tag me to create tickets.");
      }
      return;
    }

    const message = payload.message;
    const spaceName = message.space?.name;

    if (!spaceName) {
      console.error("No space name found in event");
      return;
    }

    await handleMessage(message, spaceName);
  } catch (err) {
    console.error("Top-level error:", err);
  }
});

// ─── HANDLE MESSAGE ───────────────────────────
async function handleMessage(message, spaceName) {
  const senderName = message.sender?.displayName || "Unknown";
  const senderId = message.sender?.name || "unknown";
  const text = (message.argumentText || message.text || "").trim();

  console.log("Sender:", senderName, "| Text:", text);

  const sessionKey = senderId;
  const session = sessions[sessionKey];

  // ── COMMAND FLOW ────────────────────────────
  if (session && session.state === "DRAFT") {
    if (text === "/confirm") return await createTicket(session, senderName, sessionKey, spaceName);
    if (text === "/rephrase") {
      sessions[sessionKey].state = "WAITING_REPHRASE";
      return await sendMessage(spaceName, "✏️ Re-describe your issue.");
    }
    if (text === "/attach") {
      sessions[sessionKey].state = "WAITING_ATTACHMENT";
      return await sendMessage(spaceName, "📎 Send attachments now.");
    }
    if (text === "/cancel") {
      delete sessions[sessionKey];
      return await sendMessage(spaceName, "🚫 Ticket cancelled.");
    }
  }

  if (session && session.state === "WAITING_ATTACHMENT") {
    return await createTicket(session, senderName, sessionKey, spaceName);
  }

  if (session && session.state === "WAITING_REPHRASE") {
    const structured = await parseWithOpenAI(text, senderName);
    if (!structured) return await sendMessage(spaceName, "❌ Couldn't parse your request. Please try again.");
    return await saveDraft(structured, text, senderName, sessionKey, spaceName);
  }

  // ── NEW MESSAGE ─────────────────────────────
  if (!text) {
    return await sendMessage(spaceName, "👋 Describe your issue and I'll create a Jira ticket!");
  }

  const structured = await parseWithOpenAI(text, senderName);
  if (!structured) return await sendMessage(spaceName, "❌ Failed to understand your request. Please rephrase.");

  return await saveDraft(structured, text, senderName, sessionKey, spaceName);
}

// ─── SAVE DRAFT ───────────────────────────────
async function saveDraft(structured, rawText, senderName, sessionKey, spaceName) {
  sessions[sessionKey] = { state: "DRAFT", structured, rawText, senderName };

  const draftText = `📋 *Draft Ticket*

*Summary:* ${structured.summary}
*Priority:* ${structured.priority}
*Type:* ${structured.issueType}

${structured.description}

──────────────
Reply:
✅ /confirm
✏️ /rephrase
📎 /attach
🚫 /cancel`;

  await sendMessage(spaceName, draftText);
}

// ─── OPENAI PARSER ────────────────────────────
async function parseWithOpenAI(text, senderName) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You extract Jira ticket fields from user messages. 
Respond ONLY with raw JSON, no markdown, no code fences, no explanation.
Format:
{
  "summary": "short title",
  "description": "detailed description",
  "priority": "High|Medium|Low",
  "issueType": "Bug|Task|Improvement"
}`,
          },
          { role: "user", content: text },
        ],
      }),
    });

    clearTimeout(timeout);
    const data = await response.json();
    console.log("OpenAI raw response:", JSON.stringify(data));

    const content = data.choices?.[0]?.message?.content || "";
    const cleaned = content
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();

    return JSON.parse(cleaned);
  } catch (err) {
    if (err.name === "AbortError") {
      console.error("OpenAI request timed out");
    } else {
      console.error("OpenAI error:", err);
    }
    return null;
  }
}

// ─── CREATE JIRA TICKET ──────────────────────
async function createTicket(session, senderName, sessionKey, spaceName) {
  try {
    const s = session.structured;

    const response = await fetch(`${JIRA_DOMAIN}/rest/api/3/issue`, {
      method: "POST",
      headers: {
        Authorization:
          "Basic " + Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString("base64"),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        fields: {
          project: { key: JIRA_PROJECT },
          summary: `[${senderName}] ${s.summary}`,
          description: {
            type: "doc",
            version: 1,
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: s.description }],
              },
            ],
          },
          issuetype: { name: s.issueType || "Task" },
          priority: { name: s.priority || "Medium" },
        },
      }),
    });

    const data = await response.json();
    console.log("Jira response:", JSON.stringify(data));

    if (data.key) {
      delete sessions[sessionKey];
      await sendMessage(
        spaceName,
        `✅ *Ticket Created*\n\nID: ${data.key}\nSummary: ${s.summary}\n\n🔗 ${JIRA_DOMAIN}/browse/${data.key}`
      );
    } else {
      await sendMessage(spaceName, "❌ Jira error: " + JSON.stringify(data));
    }
  } catch (err) {
    console.error("Jira error:", err);
    await sendMessage(spaceName, "❌ Failed to create ticket: " + err.message);
  }
}

// ─── START SERVER ─────────────────────────────
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log("🚀 Server running on port", PORT));