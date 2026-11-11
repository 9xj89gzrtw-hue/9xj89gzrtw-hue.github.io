# RELEASE_NOTES_v1.2 — v1.2.0: WB & Ozon Seller Inspector + net-whitelist SNI pack

**Дата:** 2026-11-10 (сессия NOV11)
**Объект релиза:** `wb-ozon-seller-inspector.user.js` → **v1.2.0** + `net-whitelist/` + витрина `tg-chats/`, `data-clipper/`, `downloads/`

---

## Что нового

1. **WB & Ozon Seller Inspector v1.2.0** (`wb-ozon-seller-inspector/core.js` + `panel.js`, сборка `tools/build-wb-ozon.mjs`).
   - Пилюля на WB/Ozon: считает чистую маржу карточки (комиссия, СПП, налог, логистика, закуп) и выгружает конкурентов в Excel-friendly CSV.
   - Free: 50 карточек. Pro: ключ `TW1-CLIP-…` / `TW1-ALL-…` — лимит снимается офлайн (ECDSA P-256, без сервера).

2. **net-whitelist** (`net-whitelist/`, генератор + живой SNI-пак).
   - `https://9xj89gzrtw-hue.github.io/net-whitelist/` — генератор профилей Happ / v2rayNG / Sing-Box / Nekoray.
   - Живой пакет: **1 384 домена** (234 core + 1 150 shops), TLS/HTTPS пробы, проверено 2026-11-10: 919 TLS 1.3, 976 ALPN h2, реальные `ping_ms` по 1 271 домену.

3. **Витрина** (`tg-chats/`, `data-clipper/`, `downloads/`, `assets/`).
   - Новые лоты Plati.Market: №14 `sni-whitelist-pro` (6390371, 98.71 ₽ / $0.99), №15 `wb-ozon-extension-pro` (6390375, 198.74 ₽ / $1.99).
   - e2e покупателя: **15/15 PASS** на живом сайте.

## Проверки

- `shasum -a 256 -c downloads/SHA256SUMS.txt` — 11 опубликованных файлов, все OK. Манифест строится по списку файлов из git-индекса, поэтому в нём нет локальных пак-выгрузок, которые не публикуются на GitHub Pages.
- Ассеты релиза v1.2.0 проверяются отдельно: `shasum -a 256 -c SHA256SUMS.txt` в папке со скачанными ассетами → 6/6 OK (манифест релиза покрывает только его собственные ассеты).
- Живой e2e (`agent2_out/nov11_e2e.cjs` → `nov12_e2e.json`): 15/15 PASS, 0 FAIL. Слои: карточка Plati (HTTP 200 + заголовок совпадает с живым названием лота + ровно 1 превью), ссылка оплаты oplata.info (302 → касса), покупательский путь (ключ TW1 активирует `isPro`, xlsx скачивается в 0 кликов). SNI-лот скачал `sni-whitelist-500-rf-nov2026.xlsx` (613 531 Б) через 1-клик ссылку `?key=…&pack=sni-whitelist&download=xlsx`.
- Live-статус: `https://9xj89gzrtw-hue.github.io/net-whitelist/` → 200, `tg-chats/` → 200, `downloads/sni-whitelist-demo-25.csv` → 200, `downloads/wb-ozon-seller-inspector.user.js` → `@version 1.2.0`.

## Известные ограничения

- «Белый список» SNI — решение оператора: он меняется. Страница проверяет домены живыми пробами из сети покупателя, колонка `operator_whitelist` — экспертная классификация, а не гарантия оператора.
- Нейро-обложки Nano Banana (Agent 4) по-прежнему ожидают доставки; на момент релиза использованы рендер-обложки из `assets/covers/`.

## Что дальше

- DEV.to: пост про v1.2.0 (userscript + net-whitelist + shop links).
- Полный отчёт: `agent2_out/NOV12_REPORT.md`.
