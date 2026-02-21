import { chromium } from "playwright";

const PROFILE_DIR = process.env.PROFILE_DIR || "/tmp/li-profile";

(async () => {
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: { width: 1280, height: 800 },
  });

  const page = await context.newPage();
  await page.goto("https://www.linkedin.com/login", { waitUntil: "domcontentloaded" });

  console.log("➡️  Přihlas se do LinkedIn v otevřeném okně.");
  console.log("➡️  Až budeš na https://www.linkedin.com/feed/, vrať se sem a stiskni ENTER.");

  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  await new Promise((resolve) => process.stdin.once("data", resolve));

  const state = await context.storageState();
  await context.close();

  // uložíme session do souboru
  await import("fs").then(fs =>
    fs.writeFileSync("storageState.json", JSON.stringify(state, null, 2))
  );

  console.log("✅ Uloženo do storageState.json");
})();
