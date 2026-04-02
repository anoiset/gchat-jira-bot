import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import { google } from "googleapis";
import FormData from "form-data";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);

dotenv.config();

const app = express();
app.use(express.json());

const {
  JIRA_DOMAIN,
  JIRA_EMAIL,
  JIRA_API_TOKEN,
  JIRA_PROJECT,
  OPENAI_API_KEY,
  GOOGLE_SERVICE_ACCOUNT_BASE64,
  GOOGLE_SERVICE_ACCOUNT_JSON,
} = process.env;

const sessions = {};

// ─── GOOGLE CHAT AUTH ─────────────────────────
function getGoogleAuth() {
  let credentials;

  if (GOOGLE_SERVICE_ACCOUNT_BASE64) {
    const decoded = Buffer.from(GOOGLE_SERVICE_ACCOUNT_BASE64, "base64").toString("utf-8");
    credentials = JSON.parse(decoded);
  } else if (GOOGLE_SERVICE_ACCOUNT_JSON) {
    credentials = JSON.parse(GOOGLE_SERVICE_ACCOUNT_JSON);
  }

  if (credentials) {
    return new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/chat.bot"],
    });
  }

  return new google.auth.GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/chat.bot"],
  });
}

const googleAuth = getGoogleAuth();

function getChatClient() {
  return google.chat({ version: "v1", auth: googleAuth });
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

// ─── SEND CARD MESSAGE TO GOOGLE CHAT ──────────────
async function sendCardMessage(spaceName, cardJson) {
  try {
    console.log("Sending card:", JSON.stringify(cardJson, null, 2));
    const chat = getChatClient();
    const response = await chat.spaces.messages.create({
      parent: spaceName,
      requestBody: {
        cardsV2: [cardJson],
      },
    });
    console.log("Card sent successfully:", response.data);
  } catch (err) {
    console.error("Failed to send Google Chat card:", err.message);
    console.error("Full error:", err);
  }
}

// ─── GET DEVICE INFO FROM API ────────────────
async function getDeviceInfo(email) {
  try {
    console.log('inside the device info function with email:', email);
    const response = await fetch(
      "https://logs-automation-326803110924.asia-south2.run.app/api/ingest/logs/retrieve",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email }),
      }
    );

    if (!response.ok) {
      console.error("API response not OK:", response.status);
      throw new Error(`API returned ${response.status}`);
    }

    const data = await response.json();
    
    if (!data.success || !data.metadata) {
      console.error("API returned unsuccessful response or missing metadata");
      throw new Error("Invalid API response");
    }

    const meta = data.metadata;
    return {
      deviceName: meta.deviceName || "Unknown",
      watchMAC: meta.deviceMac || "Unknown",
      watchVersion: meta.firmwareVersion || "Unknown",
      mobileVersion: meta.phoneModel || "Unknown",
      appVersion: meta.appVersion || "Unknown"
    };
  } catch (err) {
    console.error("Error fetching device info from API:", err.message);
    return {
      deviceName: "Unknown",
      watchMAC: "Unknown",
      watchVersion: "Unknown",
      mobileVersion: "Unknown",
      appVersion: "Unknown"
    };
  }
}

// ─── ENTRY POINT ──────────────────────────────
app.post("/", async (req, res) => {
  try {
    const event = req.body;
    console.log("===== FULL RAW EVENT =====");
    console.log(JSON.stringify(event, null, 2));
    console.log("Event type:", event.type);
    console.log("===== END EVENT =====");

    // Handle button clicks (CARD_CLICKED event)


    // Support both old format (event.chat) and new format (event.event.chat)
    const chatData = event.event?.chat || event.chat;
    const payload = chatData?.messagePayload;

    if (chatData?.buttonClickedPayload) {
      console.log("Button clicked");
      await handleCardClick(event, res);
      return;
    }

    // For non-interactive events, send 200 immediately
    res.sendStatus(200);

    if (!payload?.message) {
      const spaceName = payload?.space?.name || chatData?.space?.name;
      if (spaceName) {
        await sendMessage(spaceName, "👋 Jira Bot ready! Tag me to create tickets.");
      }
      return;
    }

    const message = payload.message;
    const spaceName = message.space?.name || payload.space?.name;

    if (!spaceName) {
      console.error("No space name found in event");
      return;
    }

    await handleMessage(message, spaceName);
  } catch (err) {
    console.error("Top-level error:", err);
    if (!res.headersSent) {
      res.sendStatus(500);
    }
  }
});

// ─── HANDLE CARD BUTTON CLICKS ───────────────────────────
async function handleCardClick(event, res) {
  try {
    const spaceName = event.space?.name;
    const userName = event.user?.displayName || "Unknown";
    const userEmail = event.user?.email || "unknown";
    const userId = event.user?.name || userEmail;

    const fn = event.common?.invokedFunction;

    if (!fn || !spaceName) {
      console.error("Missing invokedFunction or space in CARD_CLICKED event");
      res.json({
        actionResponse: { type: "NEW_MESSAGE" },
        text: "❌ Invalid request",
      });
      return;
    }

    const sessionKey = userId;
    const session = sessions[sessionKey];

    console.log(`Button clicked: ${fn} by ${userName}`);

    if (!session) {
      res.json({
        actionResponse: { type: "NEW_MESSAGE" },
        text: "⚠️ Session expired. Please start over.",
      });
      return;
    }

    if (fn === "createTicket") {
      const formInputs = event.common?.formInputs || {};
      
      if (formInputs.summary?.stringInputs?.value?.[0]) {
        session.structured.summary = formInputs.summary.stringInputs.value[0];
      }
      if (formInputs.description?.stringInputs?.value?.[0]) {
        session.structured.description = formInputs.description.stringInputs.value[0];
      }
      if (formInputs.priority?.stringInputs?.value?.[0]) {
        session.structured.priority = formInputs.priority.stringInputs.value[0];
      }
      if (formInputs.issueType?.stringInputs?.value?.[0]) {
        session.structured.issueType = formInputs.issueType.stringInputs.value[0];
      }

      res.json({
        actionResponse: { type: "NEW_MESSAGE" },
        text: "⏳ Creating ticket...",
      });
      await createTicket(session, userName, userEmail, sessionKey, spaceName);

    } else if (fn === "attach") {
      sessions[sessionKey].state = "WAITING_ATTACHMENT";
      res.json({
        actionResponse: { type: "NEW_MESSAGE" },
        text: "📎 Send your attachments now (attach a file to your message).",
      });

    } else if (fn === "cancel") {
      delete sessions[sessionKey];
      res.json({
        actionResponse: { type: "NEW_MESSAGE" },
        text: "🚫 Ticket cancelled.",
      });

    } else {
      res.json({
        actionResponse: { type: "NEW_MESSAGE" },
        text: "❌ Unknown action: " + fn,
      });
    }
  } catch (err) {
    console.error("Error handling card click:", err);
    if (!res.headersSent) {
      res.json({
        actionResponse: { type: "NEW_MESSAGE" },
        text: "❌ Error processing request",
      });
    }
  }
}

// ─── HANDLE MESSAGE ───────────────────────────
async function handleMessage(message, spaceName) {
  const senderName = message.sender?.displayName || "Unknown";
  const senderEmail = message.sender?.email || "unknown";
  const senderId = message.sender?.name || senderEmail;
  const text = (message.argumentText || message.text || "").trim();

  // Strip the bot mention from text if present
  const cleanText = text.replace(/^@\s*Jira\s*Bot\s*/i, "").trim();

  console.log("Sender:", senderName, "| Text:", cleanText);

  const sessionKey = senderId;
  const session = sessions[sessionKey];

  // ── COMMAND FLOW ────────────────────────────
  if (session && session.state === "DRAFT") {
    if (cleanText === "/confirm")
      return await createTicket(session, senderName, senderEmail, sessionKey, spaceName);
    if (cleanText === "/attach") {
      sessions[sessionKey].state = "WAITING_ATTACHMENT";
      return await sendMessage(spaceName, "📎 Send your attachments now (attach a file to your message).");
    }
    if (cleanText === "/cancel") {
      delete sessions[sessionKey];
      return await sendMessage(spaceName, "🚫 Ticket cancelled.");
    }
  }

  if (session && session.state === "WAITING_ATTACHMENT") {
    // ──────────────────────────────────────────
    // FIX: Check "attachments" (plural — new format) AND "attachment" (singular — old format)
    // ──────────────────────────────────────────
    const attachments = message.attachments || message.attachment || [];

    console.log("Attachments in event:", JSON.stringify(attachments, null, 2));

    if (attachments.length === 0) {
      return await sendMessage(
        spaceName,
        "⚠️ No attachments found. Please send a file/image with your message, or type /confirm to create without attachments."
      );
    }

    // Store the message name — we need it to fetch full attachment data via Chat API
    sessions[sessionKey].messageName = message.name;
    sessions[sessionKey].attachmentHints = attachments;

    await sendMessage(
      spaceName,
      `📎 ${attachments.length} attachment(s) received. Creating ticket...`
    );
    return await createTicket(
      sessions[sessionKey],
      senderName,
      senderEmail,
      sessionKey,
      spaceName
    );
  }

  // ── NEW MESSAGE ─────────────────────────────
  if (!cleanText) {
    return await sendMessage(spaceName, "👋 Describe your issue and I'll create a Jira ticket!");
  }

  const structured = await parseWithOpenAI(cleanText, senderName);
  if (!structured)
    return await sendMessage(spaceName, "❌ Failed to understand your request. Please rephrase.");

  return await saveDraft(structured, cleanText, senderName, senderEmail, sessionKey, spaceName);
}

// ─── SAVE DRAFT ───────────────────────────────
async function saveDraft(structured, rawText, senderName, senderEmail, sessionKey, spaceName) {
  // Fetch device info to show in draft
  const deviceInfo = await getDeviceInfo(senderEmail);
  
  // Format device info for display
  const deviceInfoText = `【Device Name】${deviceInfo.deviceName}
【Watch MAC】${deviceInfo.watchMAC}
【Watch Version】${deviceInfo.watchVersion}
【Mobile Version】${deviceInfo.mobileVersion}
【App Version】${deviceInfo.appVersion}`;
  
  // Store in session for later use in ticket creation
  sessions[sessionKey] = { 
    state: "DRAFT", 
    structured, 
    rawText, 
    senderName,
    deviceInfo 
  };
  console.log("deviceInfo stored in session:", deviceInfoText);
  // Format steps to reproduce if present
  let stepsSection = "";
  if (structured.stepsToReproduce && Array.isArray(structured.stepsToReproduce) && structured.stepsToReproduce.length > 0) {
    const formattedSteps = structured.stepsToReproduce
      .map((step, index) => `${index + 1}. ${step}`)
      .join('\n');
    stepsSection = `\n\n*Steps to Reproduce:*\n${formattedSteps}`;
  }

  // Create card with editable form fields
  const card = {
    cardId: "draft-ticket",
    card: {
      header: {
        title: "📋 Create Jira Ticket",
      },
      sections: [
        {
          widgets: [
            {
              textInput: {
                name: "summary",
                label: "Summary",
                type: "SINGLE_LINE",
                value: structured.summary,
              },
            },
            {
              textInput: {
                name: "description",
                label: "Description",
                type: "MULTIPLE_LINE",
                value: `${structured.description}${stepsSection ? '\n\n' + stepsSection.replace(/\*/g, '') : ''}`,
              },
            },
            {
              selectionInput: {
                name: "priority",
                label: "Priority",
                type: "DROPDOWN",
                items: [
                  {
                    text: "High",
                    value: "High",
                    selected: (structured.priority === "High"),
                  },
                  {
                    text: "Medium",
                    value: "Medium",
                    selected: (structured.priority === "Medium" || !structured.priority),
                  },
                  {
                    text: "Low",
                    value: "Low",
                    selected: (structured.priority === "Low"),
                  },
                ],
              },
            },
            {
              selectionInput: {
                name: "issueType",
                label: "Issue Type",
                type: "DROPDOWN",
                items: [
                  {
                    text: "Bug",
                    value: "Bug",
                    selected: (structured.issueType === "Bug" || !structured.issueType),
                  },
                  {
                    text: "Task",
                    value: "Task",
                    selected: (structured.issueType === "Task"),
                  },
                  {
                    text: "Improvement",
                    value: "Improvement",
                    selected: (structured.issueType === "Improvement"),
                  },
                ],
              },
            },
            {
              textParagraph: {
                text: `<b>Device Info (Auto-detected):</b><br>${deviceInfoText.replace(/\n/g, '<br>')}`,
              },
            },
            {
              divider: {},
            },
            {
              textParagraph: {
                text: `<i>Note: Click 'Attach Files' if you want to add attachments before creating the ticket.</i>`,
              },
            },
            {
              buttonList: {
                buttons: [
                  {
                    text: "✅ Create Ticket",
                    onClick: {
                      action: {
                        function: "createTicket",
                      },
                    },
                  },
                  {
                    text: "📎 Attach Files",
                    onClick: {
                      action: {
                        function: "attach",
                      },
                    },
                  },
                  {
                    text: "🚫 Cancel",
                    onClick: {
                      action: {
                        function: "cancel",
                      },
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    },
  };

  await sendCardMessage(spaceName, card);
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
You have to only provide the priority if it's explicitly mentioned by the user, otherwise leave it blank.

If the user mentions "steps to reproduce" or similar phrases, extract them as a separate field. Format steps as an array of strings (one per step). If not mentioned, omit the stepsToReproduce field entirely.

Format:
{
  "summary": "short title",
  "description": "detailed description",
  "stepsToReproduce": ["step 1", "step 2", "step 3"],
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
async function createTicket(session, senderName, senderEmail, sessionKey, spaceName) {
  try {
    const s = session.structured;
    
    // Use device info from session (already fetched during draft)
    const deviceInfo = session.deviceInfo || await getDeviceInfo(senderEmail);
    
    // Format steps to reproduce if present
    let stepsSection = "";
    if (s.stepsToReproduce && Array.isArray(s.stepsToReproduce) && s.stepsToReproduce.length > 0) {
      const formattedSteps = s.stepsToReproduce
        .map((step, index) => `${index + 1}. ${step}`)
        .join('\n');
      stepsSection = `\n\n【Steps to Reproduce】\n${formattedSteps}`;
    }
    
    const deviceInfoText = `【Device Name】${deviceInfo.deviceName}
【Watch MAC】${deviceInfo.watchMAC}
【Watch Version】${deviceInfo.watchVersion}
【Mobile Version】${deviceInfo.mobileVersion}
【App Version】${deviceInfo.appVersion}

─────────────────

${s.description}${stepsSection}`;

    const response = await fetch(`${JIRA_DOMAIN}/rest/api/3/issue`, {
      method: "POST",
      headers: {
        Authorization:
          "Basic " +
          Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString("base64"),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        fields: {
          project: { key: JIRA_PROJECT },
          summary: `${s.summary}`,
          description: {
            type: "doc",
            version: 1,
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: deviceInfoText }],
              },
            ],
          },
          issuetype: { name: s.issueType || "Bug" },
          priority: { name: s.priority || "Medium" },
        },
      }),
    });

    const data = await response.json();
    console.log("Jira response:", JSON.stringify(data));

    if (data.key) {
      // Handle attachments
      let attachmentStatus = "";
      if (session.messageName && session.attachmentHints?.length > 0) {
        const results = await downloadAndUploadAttachments(
          data.key,
          session.messageName
        );
        const successCount = results.filter((r) => r.success).length;
        const failCount = results.filter((r) => !r.success).length;
        if (failCount > 0) {
          attachmentStatus = `\n📎 Attachments: ${successCount} uploaded, ${failCount} failed`;
        } else if (successCount > 0) {
          attachmentStatus = `\n📎 ${successCount} attachment(s) uploaded`;
        }
      }

      delete sessions[sessionKey];
      await sendMessage(
        spaceName,
        `✅ *Ticket Created*\n\nID: ${data.key}\nSummary: ${s.summary}${attachmentStatus}\n\n🔗 ${JIRA_DOMAIN}/browse/${data.key}`
      );
    } else {
      await sendMessage(spaceName, "❌ Jira error: " + JSON.stringify(data));
    }
  } catch (err) {
    console.error("Jira error:", err);
    await sendMessage(spaceName, "❌ Failed to create ticket: " + err.message);
  }
}

// ─── DOWNLOAD FROM GOOGLE CHAT & UPLOAD TO JIRA ───────────
//
// The webhook event only sends partial attachment metadata (contentName, contentType).
// It does NOT include attachmentDataRef.resourceName needed to download the file.
//
// Solution:
// 1. Use chat.spaces.messages.get() to fetch the FULL message with complete attachment data
// 2. Extract attachmentDataRef.resourceName from the full response
// 3. Use chat.media.download() with that resourceName to get the file bytes
// 4. Upload the file bytes to Jira
//
async function downloadAndUploadAttachments(issueKey, messageName) {
  const results = [];
  const chat = getChatClient();

  try {
    // Step 1: Fetch the full message from Chat API to get complete attachment data
    console.log("Fetching full message:", messageName);
    const messageResponse = await chat.spaces.messages.get({
      name: messageName,
    });

    const fullMessage = messageResponse.data;
    // The full message uses "attachment" (singular) as the field name
    const fullAttachments = fullMessage.attachment || fullMessage.attachments || [];

    console.log("Full message attachment data:", JSON.stringify(fullAttachments, null, 2));

    if (fullAttachments.length === 0) {
      console.error("No attachments found in full message response");
      return [{ success: false, fileName: "unknown", error: "No attachments in full message" }];
    }

    // Step 2: Process each attachment
    for (const att of fullAttachments) {
      const fileName = att.contentName || "attachment";
      const contentType = att.contentType || "application/octet-stream";

      try {
        console.log(`Processing: ${fileName} (${contentType})`);
        console.log("Full attachment object:", JSON.stringify(att, null, 2));

        let fileBuffer;

        if (att.attachmentDataRef?.resourceName) {
          // ── PRIMARY METHOD: direct HTTP GET with ?alt=media ──
          const resourceName = att.attachmentDataRef.resourceName;
          console.log("Downloading via direct HTTP, resourceName:", resourceName);

          const authClient = await googleAuth.getClient();
          const tokenResponse = await authClient.getAccessToken();
          const accessToken = tokenResponse.token || tokenResponse;

          // IMPORTANT: Do NOT use encodeURIComponent on resourceName — it's base64
          // with = and / characters that must NOT be percent-encoded.
          // Plain string concat keeps the URL clean.
          const finalUrl = "https://chat.googleapis.com/v1/media/" + resourceName + "?alt=media";
          console.log(">>> Download URL:", finalUrl);

          const dlResponse = await fetch(finalUrl, {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          });

          if (!dlResponse.ok) {
            const errText = await dlResponse.text();
            console.error(">>> Download response status:", dlResponse.status);
            console.error(">>> Download response body:", errText);
            throw new Error(`media download failed: ${dlResponse.status} ${dlResponse.statusText}`);
          }

          fileBuffer = await dlResponse.buffer();

        } else if (att.driveDataRef?.driveFileId) {
          // ── DRIVE FILE: not supported yet ──
          console.log("Skipping Drive attachment:", att.driveDataRef.driveFileId);
          results.push({
            success: false,
            fileName,
            error: "Google Drive attachments not supported yet",
          });
          continue;

        } else if (att.downloadUri) {
          // ── FALLBACK: try downloadUri with bearer token ──
          console.log("Trying downloadUri fallback:", att.downloadUri);
          const authClient = await googleAuth.getClient();
          const tokenResponse = await authClient.getAccessToken();
          const accessToken = tokenResponse.token || tokenResponse;

          const dlResponse = await fetch(att.downloadUri, {
            headers: { Authorization: `Bearer ${accessToken}` },
          });

          if (!dlResponse.ok) {
            throw new Error(`downloadUri failed: ${dlResponse.status} ${dlResponse.statusText}`);
          }
          fileBuffer = await dlResponse.buffer();

        } else {
          console.error("No download method available:", JSON.stringify(att));
          results.push({ success: false, fileName, error: "No resourceName or downloadUri" });
          continue;
        }

        console.log(`Downloaded ${fileName}: ${fileBuffer.length} bytes`);

        // Step 3: Upload to Jira
        const form = new FormData();
        form.append("file", fileBuffer, {
          filename: fileName,
          contentType: contentType,
        });

        const uploadResponse = await fetch(
          `${JIRA_DOMAIN}/rest/api/3/issue/${issueKey}/attachments`,
          {
            method: "POST",
            headers: {
              Authorization:
                "Basic " +
                Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString("base64"),
              "X-Atlassian-Token": "no-check",
              ...form.getHeaders(),
            },
            body: form,
          }
        );

        if (uploadResponse.ok) {
          console.log(`✅ Uploaded ${fileName} to Jira issue ${issueKey}`);
          results.push({ success: true, fileName });
        } else {
          const errorText = await uploadResponse.text();
          console.error(`Failed to upload ${fileName} to Jira:`, errorText);
          results.push({ success: false, fileName, error: errorText });
        }
      } catch (err) {
        console.error(`Error processing attachment ${fileName}:`, err.message);
        results.push({ success: false, fileName, error: err.message });
      }
    }
  } catch (err) {
    console.error("Error fetching full message:", err.message);
    results.push({ success: false, fileName: "unknown", error: err.message });
  }

  return results;
}

// ─── START SERVER ─────────────────────────────
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log("🚀 Server running on port", PORT));