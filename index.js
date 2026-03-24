import express from "express";
import fetch from "node-fetch";
import dotenv from 'dotenv';
dotenv.config();

const app = express();
app.use(express.json());

const { JIRA_DOMAIN, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PROJECT, OPENAI_API_KEY } = process.env;

const sessions = {};

// ─── ENTRY POINT ───────────────────────────────
app.post("/", async (req, res) => {
  try {
    const event = req.body;
    console.log("Received event type:", event.type);
    console.log("Full event:", JSON.stringify(event, null, 2)); // 👈 Log everything for debugging

    if (event.type === "ADDED_TO_SPACE") {
      return res.json({ text: "👋 Jira Bot ready! Tag me to create tickets." });
    }

    if (event.type === "REMOVED_FROM_SPACE") {
      return res.json({});
    }

    if (event.type === "MESSAGE" || event.type === "APP_COMMAND") {
      return await handleMessage(event, res);
    }

    return res.json({ text: "Unsupported event type: " + event.type });

  } catch (err) {
    console.error("Top-level error:", err);
    return res.json({ text: "❌ Server error: " + err.message });
  }
});

// ─── HANDLE MESSAGE ────────────────────────────
async function handleMessage(event, res) {
  const message = event.message;

  if (!message) {
    console.error("No message in event:", event);
    return res.json({ text: "❌ No message received." });
  }

  const senderName = message.sender?.displayName || "Unknown";
  const senderId = message.sender?.name || "unknown";

  // argumentText strips the bot mention — fall back to text or body
  const text = (message.argumentText || message.text || message.body || "").trim();
  const attachments = message.attachments || [];

  console.log("Sender:", senderName, "| Text:", text);

  const sessionKey = senderId;
  const session = sessions[sessionKey];

  // ── COMMAND FLOW ───────────────────────────
  if (session && session.state === "DRAFT") {
    if (text === "/confirm") return await createTicket(session, senderName, sessionKey, res);
    if (text === "/rephrase") {
      sessions[sessionKey].state = "WAITING_REPHRASE";
      return res.json({ text: "✏️ Re-describe your issue." });
    }
    if (text === "/attach") {
      sessions[sessionKey].state = "WAITING_ATTACHMENT";
      return res.json({ text: "📎 Send attachments now." });
    }
    if (text === "/cancel") {
      delete sessions[sessionKey];
      return res.json({ text: "🚫 Ticket cancelled." });
    }
  }

  if (session && session.state === "WAITING_ATTACHMENT") {
    return await createTicket(session, senderName, sessionKey, res, attachments);
  }

  if (session && session.state === "WAITING_REPHRASE") {
    const structured = await parseWithOpenAI(text, senderName);
    if (!structured) return res.json({ text: "❌ Couldn't parse your request. Please try again." });
    return saveDraft(structured, text, senderName, sessionKey, res);
  }

  // ── NEW MESSAGE ────────────────────────────
  if (!text) {
    return res.json({ text: "👋 Describe your issue and I'll create a Jira ticket!" });
  }

  const structured = await parseWithOpenAI(text, senderName);
  if (!structured) return res.json({ text: "❌ Failed to understand your request. Please rephrase." });

  return saveDraft(structured, text, senderName, sessionKey, res);
}

// ─── SAVE DRAFT ───────────────────────────────
function saveDraft(structured, rawText, senderName, sessionKey, res) {
  sessions[sessionKey] = { state: "DRAFT", structured, rawText, senderName };

  return res.json({
    text:
`📋 *Draft Ticket*

*Summary:* ${structured.summary}
*Priority:* ${structured.priority}
*Type:* ${structured.issueType}

${structured.description}

──────────────
Reply:
✅ /confirm  
✏️ /rephrase  
📎 /attach  
🚫 /cancel`
  });
}

// ─── OPENAI PARSER (with timeout + JSON fence fix) ────────────────────────────
async function parseWithOpenAI(text, senderName) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000); // 20s timeout

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            // 👇 Explicitly forbid markdown fences in response
            content: `You extract Jira ticket fields from user messages. 
Respond ONLY with raw JSON, no markdown, no code fences, no explanation.
Format:
{
  "summary": "short title",
  "description": "detailed description",
  "priority": "High|Medium|Low",
  "issueType": "Bug|Task|Improvement"
}`
          },
          { role: "user", content: text }
        ]
      })
    });

    clearTimeout(timeout);
    const data = await response.json();
    console.log("OpenAI raw response:", JSON.stringify(data));

    const content = data.choices?.[0]?.message?.content || "";

    // Strip markdown fences if model ignores instructions
    const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

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

// ─── CREATE JIRA TICKET ───────────────────────
async function createTicket(session, senderName, sessionKey, res, attachments = []) {
  try {
    const s = session.structured;

    const response = await fetch(`${JIRA_DOMAIN}/rest/api/3/issue`, {
      method: "POST",
      headers: {
        "Authorization": "Basic " + Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString("base64"),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        fields: {
          project: { key: JIRA_PROJECT },
          summary: `[${senderName}] ${s.summary}`,
          description: {
            type: "doc",
            version: 1,
            content: [{
              type: "paragraph",
              content: [{ type: "text", text: s.description }]
            }]
          },
          issuetype: { name: s.issueType || "Task" },
          priority: { name: s.priority || "Medium" }
        }
      })
    });

    const data = await response.json();
    console.log("Jira response:", JSON.stringify(data));

    if (data.key) {
      delete sessions[sessionKey];
      return res.json({
        text:
`✅ *Ticket Created*

ID: ${data.key}
Summary: ${s.summary}

🔗 ${JIRA_DOMAIN}/browse/${data.key}`
      });
    }

    return res.json({ text: "❌ Jira error: " + JSON.stringify(data) });

  } catch (err) {
    console.error("Jira error:", err);
    return res.json({ text: "❌ Failed to create ticket: " + err.message });
  }
}

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log("🚀 Server running on port", PORT));