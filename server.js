import express from "express";
import { chromium } from "playwright";
import fs from "fs";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3001;

// --- API KEY ---
const API_KEY = process.env.API_KEY || "";
function requireKey(req, res, next) {
  if (!API_KEY) return res.status(500).json({ error: "API_KEY not set" });
  const key = req.header("x-api-key");
  if (key !== API_KEY) return res.status(401).json({ error: "unauthorized" });
  next();
}

const BASE = "https://www.linkedin.com";

// ---- PLAYWRIGHT CONTEXT ----
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

// ---- ROUTES ----

app.get("/health", (req, res) => res.json({ ok: true }));

// DEBUG login test
app.get("/messages/debug", requireKey, async (req, res) => {
  let browser, context;

  try {
    const ctx = await newContext();
    browser = ctx.browser;
    context = ctx.context;

    const page = await context.newPage();
    await page.goto("https://www.linkedin.com/messaging/", { 
      waitUntil: "networkidle",
      timeout: 60000
    });

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

// THREADS debug (forensics + selector probe)
app.get("/messages/threads", requireKey, async (req, res) => {
  const limit = Number(req.query.limit || 10);

  const { browser, context } = await newContext();
  const page = await context.newPage();

  try {
    await page.goto(`${BASE}/messaging/`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(4000);

    const url = page.url();
    const title = await page.title();

    // Forensics: screenshot + HTML dump
    await page.screenshot({ path: "debug_messaging.png", fullPage: true });
    const html = await page.content();
    fs.writeFileSync("debug_messaging.html", html, "utf-8");

    // Check login (ale až po uložení důkazů)
    await ensureLoggedIn(page);

    // --- SELECTOR PROBE: zjistíme, jaké elementy LinkedIn v DOMu používá ---
    const counts = {
      a_thread: await page.locator("a[href*='/messaging/thread/']").count(),
      role_listitem: await page.locator("[role='listitem']").count(),
      role_list: await page.locator("[role='list']").count(),
      li_total: await page.locator("li").count(),
      msg_listitem_classic: await page.locator("li.msg-conversation-listitem").count(),
      data_control_conversation: await page.locator("[data-control-name*='conversation']").count(),
      data_test_conversation: await page.locator("[data-test-id*='conversation']").count(),
      unread_by_aria: await page.locator("span[aria-label*='unread'], span[aria-label*='Nepřečten']").count(),
      buttons: await page.locator("button").count(),
      asides: await page.locator("aside").count(),
    };

    // preview text (ať víme, že jsme fakt na messagingu)
    const bodyText = (await page.locator("body").innerText());
    const leftTextPreview = bodyText.slice(0, 1200);

    // ukázka pár <li> položek s textem (často jsou to právě konverzace)
    const liHandles = await page.locator("li").elementHandles();
    const liSample = [];
    for (const h of liHandles.slice(0, 60)) {
      const t = ((await h.innerText()) || "").trim();
      if (t && t.length > 20) liSample.push(t.slice(0, 240));
      if (liSample.length >= 5) break;
    }

    // ukázka pár <button> položek s textem (někdy jsou konverzace jako button)
    const btnHandles = await page.locator("button").elementHandles();
    const buttonSample = [];
    for (const h of btnHandles.slice(0, 80)) {
      const t = ((await h.innerText()) || "").trim();
      if (t && t.length > 20) buttonSample.push(t.slice(0, 240));
      if (buttonSample.length >= 5) break;
    }

    res.json({
      url,
      title,
      htmlLen: html.length,
      counts,
      liSample,
      buttonSample,
      leftTextPreview,
    });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  } finally {
    await context.close();
    await browser.close();
  }
});


app.get("/messages/unread", requireKey, async (req, res) => {
  const limit = Number(req.query.limit || 10);

  const { browser, context } = await newContext();
  const page = await context.newPage();

  try {
    await page.goto(`${BASE}/messaging/`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(4000);
    await ensureLoggedIn(page);

    // Konverzace jsou LI elementy
    const items = page.locator("li.msg-conversation-listitem");
    const total = await items.count();

    const out = [];
    for (let i = 0; i < total; i++) {
      if (out.length >= limit) break;

      const item = items.nth(i);

      // 1) nejspolehlivější bývá class name (LinkedIn často přidá --unread)
      const cls = (await item.getAttribute("class")) || "";
      const unreadByClass = /--unread\b/i.test(cls);

      // 2) badge / count (různé varianty podle UI)
      const unreadBadgeCount =
        (await item.locator(".msg-conversation-listitem__unread-count").count()) +
        (await item.locator(".msg-conversation-card__unread-count").count()) +
        (await item.locator("[class*='unread']").count());

      const unreadByBadge = unreadBadgeCount > 0;

      // 3) fallback: text/aria obsahuje “unread / nepřečten”
      const text = ((await item.innerText()) || "").trim();
      const aria = (await item.getAttribute("aria-label")) || "";
      const unreadByText = /unread|Nepřečten|nová zpráva/i.test(text + " " + aria);

      const isUnread = unreadByClass || unreadByBadge || unreadByText;
      if (!isUnread) continue;

      // URL threadu získáme z aktuálního aktivního threadu (ne z href)
      // — pro první verzi aspoň vrátíme text + index; URL doplníme v dalším kroku klikem

       // klikni na konverzaci, aby se otevřela a URL obsahovala threadId
      await item.click({ timeout: 5000 });
      await page.waitForTimeout(800);

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
    res.status(500).json({ error: String(e?.message || e) });
  } finally {
    await context.close();
    await browser.close();
  }
});


// MARK READ
app.post("/messages/:threadId/mark-read", requireKey, async (req, res) => {
  const { threadId } = req.params;

  const { browser, context } = await newContext();
  const page = await context.newPage();

  try {
    await page.goto(`${BASE}/messaging/thread/${threadId}/`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    await ensureLoggedIn(page);

    res.json({ ok: true, threadId });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  } finally {
    await context.close();
    await browser.close();
  }
});

app.listen(PORT, () => console.log(`LI worker running on :${PORT}`));
