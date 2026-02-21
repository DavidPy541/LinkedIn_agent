import { chromium } from "playwright";
import fs from "fs";

const OUT = "storageState.json";

(async () => {
  const browser = await chromium.launch({
    headless: false,
    args: ["--no-sandbox"],
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  // otevře login; ty se normálně přihlásíš (2FA atd.)
  await page.goto("https://www.linkedin.com/login", { waitUntil: "domcontentloaded" });

  console.log("✅ Přihlas se do LinkedIn v otevřeném okně.");
  console.log("✅ Až budeš na feedu, stiskni ENTER tady v terminálu…");

  process.stdin.resume();
  await new Promise((resolve) => process.stdin.once("data", resolve));

  // uloží session
  const state = await context.storageState();
  fs.writeFileSync(OUT, JSON.stringify(state, null, 2), "utf-8");

  console.log(`✅ Uloženo: ${OUT}`);
  await browser.close();
})();
