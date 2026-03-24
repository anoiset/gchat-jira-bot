import express from "express";
import fetch from "node-fetch";
import dotenv from 'dotenv';
dotenv.config();
const app = express();
app.use(express.json());

// ─── ENV VARIABLES ─────────────────────────────
const {
  JIRA_DOMAIN,
  JIRA_EMAIL,
  JIRA_API_TOKEN,
  JIRA_PROJECT,
  OPENAI_API_KEY
} = process.env;

// 🧠 In-memory session store (use Redis in production)
const sessions = {};

// ─── ENTRY POINT ───────────────────────────────
app.post("/", async (req, res) => {
  try {
    const event = req.body;

    if (event.type === "ADDED_TO_SPACE") {
      return res.json({ text: "👋 Jira Bot ready! Tag me to create tickets." });
    }

    if (event.type === "MESSAGE") {
      return await handleMessage(event, res);
    }

    return res.json({ text: "Unsupported event" });

  } catch (err) {
    console.error(err);
    return res.json({ text: "❌ Server error" });
  }
});

// ─── HANDLE MESSAGE ────────────────────────────
async function handleMessage(event, res) {
  const message = event.message;
  const senderName = message.sender.displayName;
  const senderId = message.sender.name;

  const text = (message.argumentText || "").trim();
  const attachments = message.attachments || [];

  const sessionKey = senderId;
  const session = sessions[sessionKey];
    console.log("ALL SESSIONS:", sessions);
    console.log("CURRENT SESSION:", sessionKey, session);
  // ── COMMAND FLOW ───────────────────────────
  if (session && session.state === "DRAFT") {
    if (text === "/confirm") {
      return await createTicket(session, senderName, sessionKey, res);
    }

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

  // ── WAITING ATTACHMENT ─────────────────────
  if (session && session.state === "WAITING_ATTACHMENT") {
    return await createTicket(session, senderName, sessionKey, res, attachments);
  }

  // ── WAITING REPHRASE ───────────────────────
  if (session && session.state === "WAITING_REPHRASE") {
    const structured = await parseWithOpenAI(text, senderName);
    if (!structured) return res.json({ text: "❌ Couldn't parse." });

    return saveDraft(structured, text, senderName, sessionKey, res);
  }

  // ── NEW MESSAGE ────────────────────────────
  if (!text) {
    return res.json({ text: "👋 Describe your issue." });
  }

  const structured = await parseWithOpenAI(text, senderName);
  console.log("Structured data:", structured, OPENAI_API_KEY);
  if (!structured) return res.json({ text: "❌ Failed to understand." });

  return saveDraft(structured, text, senderName, sessionKey, res);
}

// ─── SAVE DRAFT ───────────────────────────────
function saveDraft(structured, rawText, senderName, sessionKey, res) {
  sessions[sessionKey] = {
    state: "DRAFT",
    structured,
    rawText,
    senderName
  };

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

// ─── OPENAI PARSER ───────────────────────────
async function parseWithOpenAI(text, senderName) {
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `Extract Jira JSON:
{
  "summary": "",
  "description": "",
  "priority": "High|Medium|Low",
  "issueType": "Bug|Task|Improvement"
}`
          },
          {
            role: "user",
            content: `${text}`
          }
        ]
      })
    });

    const data = await response.json();
    console.log("OpenAI response:", data);
    return JSON.parse(data.choices[0].message.content);

  } catch (err) {
    console.error("OpenAI error:", err);
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
        "Authorization":
          "Basic " + Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString("base64"),
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
    console.error(err);
    return res.json({ text: "❌ Failed to create ticket" });
  }
}

// ─── START SERVER ─────────────────────────────
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log("🚀 Server running on", PORT));