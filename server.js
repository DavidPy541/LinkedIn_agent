import express from "express";
import { chromium } from "playwright";
import fs from "fs";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3001;
const BASE = "https://www.linkedin.com";

// ---------------- API KEY ----------------
const API_KEY = process.env.API_KEY || "";

function requireKey(req, res, next) {
  if (!API_KEY) return res.status(500).json({ error: "API_KEY not set" });
  const key = req.header("x-api-key");
  if (key !== API_KEY) return res.status(401).json({ error: "unauthorized" });
  next();
}

// ---------------- PLAYWRIGHT (PERSISTENT PROFILE) ----------------

let context = null;
let page = null;

async function getPage() {
  if (page) return page;

  console.log("Launching persistent LinkedIn profile...");

  context = await chromium.launchPersistentContext(
    "./linkedin-profile",
    {
      headless: false,
      args: ["--disable-blink-features=AutomationControlled"],
      viewport: { width: 1366, height: 768 },
    }
  );

  page = context.pages()[0] || await context.newPage();

  console.log("Browser ready.");

  return page;
}

async function ensureLoggedIn(page) {
  const url = page.url();
  if (url.includes("/login")) {
    throw new Error("LinkedIn session invalid – please login again");
  }
}

// ---------------- ROUTES ----------------

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

// ---- DEBUG FEED ----
app.get("/messages/debug", requireKey, async (req, res) => {
  try {
    const page = await getPage();

    await page.goto(`${BASE}/feed/`, {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });

    await page.waitForTimeout(1000);

    const url = page.url();
    const title = await page.title();

    res.json({ url, title });

  } catch (e) {
    console.error("DEBUG ERROR:", e);
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ---- UNREAD MESSAGES ----
app.get("/messages/unread", requireKey, async (req, res) => {
  const limit = Number(req.query.limit || 10);

  try {
    const page = await getPage();

    await page.goto(`${BASE}/messaging/`, {
      waitUntil: "domcontentloaded",
      timeout: 20000
    });

    await page.waitForTimeout(3000);
    await ensureLoggedIn(page);

    const items = page.locator("li.msg-conversation-listitem");
    const total = await items.count();

    const out = [];

    for (let i = 0; i < total; i++) {
      if (out.length >= limit) break;

      const item = items.nth(i);

      const cls = (await item.getAttribute("class")) || "";
      const unreadByClass = /--unread\b/i.test(cls);

      const unreadBadge =
        (await item.locator("[class*='unread']").count()) > 0;

      const text = ((await item.innerText()) || "").trim();
      const unreadByText = /unread|Nepřečten/i.test(text);

      const isUnread = unreadByClass || unreadBadge || unreadByText;
      if (!isUnread) continue;

      await item.click({ timeout: 1000 });
      await page.waitForTimeout(500);

      const openedUrl = page.url();
      const threadId =
        openedUrl.includes("/messaging/thread/")
          ? openedUrl.split("/messaging/thread/")[1].split("/")[0]
          : null;

      out.push({
        threadId,
        senderName: text.split("\n")[0] || "Unknown",
        snippet: text.split("\n").slice(1).join(" ").trim().slice(0, 300),
        url: openedUrl,
        isUnread,
      });
    }

    res.json(out);

  } catch (e) {
    console.error("UNREAD ERROR:", e);
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ---- MARK READ ----
app.post("/messages/:threadId/mark-read", requireKey, async (req, res) => {
  const { threadId } = req.params;

  try {
    const page = await getPage();

    await page.goto(`${BASE}/messaging/thread/${threadId}/`, {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });

    await page.waitForTimeout(1000);
    await ensureLoggedIn(page);

    res.json({ ok: true, threadId });

  } catch (e) {
    console.error("MARK READ ERROR:", e);
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.listen(PORT, () => {
  console.log(`LI worker running on :${PORT}`);
});
