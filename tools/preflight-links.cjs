/* Pre-flight: are the payment links actually alive? A 403/404/archived page is
 * not a sales channel, and the page must not point at one. */
const { chromium } = require("/Users/evgenijdanilov/.npm/_npx/13ab0715f9f30c2e/node_modules/playwright");

const URLS = [
  ["digiseller-6354599", "https://digiseller.market/asp2/item/6354599"],
  ["plati-6354599", "https://plati.market/itm/6354599"],
  ["plati-6326936", "https://plati.market/itm/6326936"],
  ["telegram-Shop010_bot", "https://t.me/Shop010_bot"]
];

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    locale: "ru-RU",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
  });
  for (const [name, url] of URLS) {
    const page = await ctx.newPage();
    let status = null;
    try {
      const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
      status = res && res.status();
      await page.waitForTimeout(3500);
      const title = (await page.title()).slice(0, 110);
      const text = (await page.evaluate(() => document.body.innerText || "")).replace(/\s+/g, " ").slice(0, 700);
      const flags = {
        archived: /архив[^ы]|в архиве|снят с продажи|продажа приостановлена|товар недоступен/i.test(text),
        buy: /в корзину|купить|оплатить/i.test(text),
        notFound: /не найден|404|страница не существует/i.test(text)
      };
      console.log("\n### " + name + "  HTTP " + status + "\n  title: " + title + "\n  flags: " + JSON.stringify(flags) + "\n  text: " + text);
    } catch (e) {
      console.log("\n### " + name + "  ERROR " + e.message.split("\n")[0]);
    }
    await page.close();
  }
  await browser.close();
})();
