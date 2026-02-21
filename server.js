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

// ---------------- PLAYWRIGHT ----------------
async function newContext() {
  const browser = await chromium.launch({
    headless: true,
    args: ["--disable-blink-features=AutomationControlled"],
  });

  let context;

  if (process.env.STORAGE_STATE_JSON) {
    const state = JSON.parse(process.env.STORAGE_STATE_JSON);
    context = await browser.newContext({ storageState: state });
  } else {
    context = await browser.newContext({ storageState: "storageState.json" });
  }

  return { browser, context };
}

async function ensureLoggedIn(page) {
  const url = page.url();
  if (url.includes("/login")) {
    throw new Error("LinkedIn session invalid → regenerate storageState.json");
  }
}

// ---------------- ROUTES ----------------

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

// ---- DEBUG FEED ----
app.get("/messages/debug", requireKey, async (req, res) => {
  let browser, context;

  try {
    const ctx = await newContext();
    browser = ctx.browser;
    context = ctx.context;

    const page = await context.newPage();

    await page.goto(`${BASE}/feed/`, {
      waitUntil: "domcontentloaded",
      timeout: 10000,
    });

    await page.waitForTimeout(1000);

    const url = page.url();
    const title = await page.title();

    res.json({ url, title });

  } catch (e) {
    console.error("DEBUG ERROR:", e);
    res.status(500).json({ error: String(e?.message || e) });

  } finally {
    if (context) await context.close();
    if (browser) await browser.close();
  }
});

// ---- UNREAD MESSAGES ----
app.get("/messages/unread", requireKey, async (req, res) => {
  const limit = Number(req.query.limit || 10);

  let browser, context;

  try {
    const ctx = await newContext();
    browser = ctx.browser;
    context = ctx.context;

    const page = await context.newPage();

    await page.goto(`${BASE}/messaging/`, {
      waitUntil: "commit",
      timeout: 20000
    });
    
    const rawPage = await page.content();
    fs.writeFileSync("/tmp/unread_page_raw.html", rawPage);

    await page.waitForSelector("body", { timeout: 15000 });
    await page.waitForTimeout(3000);

    await page.waitForTimeout(1000);
    await ensureLoggedIn(page);

    // FORENSIC DEBUG
    await page.screenshot({ path: "/tmp/unread_page.png", fullPage: true });

    const html = await page.content();
    fs.writeFileSync("/tmp/unread_page.html", html);

    console.log("HTML length:", html.length);

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

  } finally {
    if (context) await context.close();
    if (browser) await browser.close();
  }
});

// ---- MARK READ ----
app.post("/messages/:threadId/mark-read", requireKey, async (req, res) => {
  const { threadId } = req.params;

  let browser, context;

  try {
    const ctx = await newContext();
    browser = ctx.browser;
    context = ctx.context;

    const page = await context.newPage();

    await page.goto(`${BASE}/messaging/thread/${threadId}/`, {
      waitUntil: "domcontentloaded",
      timeout: 10000,
    });

    await page.waitForTimeout(1000);
    await ensureLoggedIn(page);

    res.json({ ok: true, threadId });

  } catch (e) {
    console.error("MARK READ ERROR:", e);
    res.status(500).json({ error: String(e?.message || e) });

  } finally {
    if (context) await context.close();
    if (browser) await browser.close();
  }
});

app.get("/debug/file", requireKey, (req, res) => {
  const file = req.query.name;
  if (!file) return res.status(400).send("Missing name");

  const path = `/tmp/${file}`;
  res.sendFile(path);
});

app.listen(PORT, () => {
  console.log(`LI worker running on :${PORT}`);
});