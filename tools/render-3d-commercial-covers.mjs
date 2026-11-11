/* render-3d-commercial-covers.mjs
 * Generates 15 high-end commercial 3D product covers (800x800) and OG cards (1200x630).
 * Integrates real Nano Banana 3D artwork and high-fidelity studio glassmorphism.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { chromium } = require("/Users/evgenijdanilov/.npm/_npx/13ab0715f9f30c2e/node_modules/playwright");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_COVERS = path.join(ROOT, "assets", "covers");
const OUT_OG = path.join(ROOT, "assets", "og");
const RAW_DIR = path.join(ROOT, "assets", "covers", "raw");

// Nano Banana raw image paths
const NANO_ALL_IN_ONE = path.join(RAW_DIR, "all-in-one-raw.jpg");
const NANO_WB_SELLERS = path.join(RAW_DIR, "wb-sellers-chats-raw.jpg");
const NANO_TG_CHATS = path.join(RAW_DIR, "tg-chats-raw.jpg");
const NANO_SNI_WHITELIST = path.join(RAW_DIR, "sni-whitelist-raw.jpg");
const NANO_WB_OZON = path.join(RAW_DIR, "wb-ozon-extension-raw.jpg");
const NANO_B2B_LEADS = path.join(RAW_DIR, "b2b-stores-leads-raw.jpg");
const NANO_AUDIO = path.join(RAW_DIR, "audio-dub-studio-raw.jpg");
const NANO_REALTY = path.join(RAW_DIR, "realty-jk-chats-raw.jpg");
const NANO_FREELANCE = path.join(RAW_DIR, "freelance-it-chats-raw.jpg");
const NANO_DATA_CLIPPER = path.join(RAW_DIR, "data-clipper-raw.jpg");
const NANO_DOCSEARCH = path.join(RAW_DIR, "docsearch-raw.jpg");
const NANO_NEWSFLOW = path.join(RAW_DIR, "newsflow-raw.jpg");
const NANO_LIVE_RADAR = path.join(RAW_DIR, "live-radar-raw.jpg");
const NANO_BASE_TAX = path.join(RAW_DIR, "base-tax-audit-raw.jpg");
const NANO_ALGO_TYCOON = path.join(RAW_DIR, "algo-tycoon-raw.jpg");

function toDataUri(filePath) {
  if (fs.existsSync(filePath)) {
    const buf = fs.readFileSync(filePath);
    return "data:image/jpeg;base64," + buf.toString("base64");
  }
  return null;
}

const ITEMS = [
  {
    slug: "all-in-one",
    kicker: "ALL-IN-ONE PRO 2026",
    title: "8 продуктов в одном ключе",
    sub: "Telegram, звук, парсер, рынки, налоги, VLESS — всё в браузере",
    price: "1 290 ₽",
    priceAlt: "$14.99 · USDC на Base",
    badge: "8 В 1 PRO · ПОЖИЗНЕННЫЙ ДОСТУП",
    glowColor: "rgba(99, 102, 241, 0.45)",
    accentColor: "#6366f1",
    nanoImage: toDataUri(NANO_ALL_IN_ONE),
    visualType: "nano"
  },
  {
    slug: "wb-sellers-chats",
    kicker: "WB & OZON SELLERS CHATS",
    title: "230+ чатов селлеров Wildberries и Ozon",
    sub: "Поставщики, опт, склады и карго — живые открытые группы без заявок",
    price: "149 ₽",
    priceAlt: "$1.49 · USDC на Base",
    badge: "ВЫГРУЗКА В EXCEL В 1 КЛИК",
    glowColor: "rgba(217, 70, 239, 0.45)",
    accentColor: "#d946ef",
    nanoImage: toDataUri(NANO_WB_SELLERS),
    visualType: "nano"
  },
  {
    slug: "b2b-stores-leads",
    kicker: "B2B LEADS & STORES 2026",
    title: "1 240 интернет-магазинов и оптовиков РФ в Excel",
    sub: "Телефоны, Email, Telegram, VK и CMS — проверенные юрлица",
    price: "249 ₽",
    priceAlt: "$2.49 · USDC на Base",
    badge: "100% ЖИВЫЕ САЙТЫ · EXCEL",
    glowColor: "rgba(16, 185, 129, 0.45)",
    accentColor: "#10b981",
    nanoImage: toDataUri(NANO_B2B_LEADS),
    visualType: "nano"
  },
  {
    slug: "realty-jk-chats",
    kicker: "REALTY & JK CHATS 2026",
    title: "410 чатов ЖК, Новостроек и Ремонта Москвы и СПб",
    sub: "ПИК, Самолёт, А101, ФСК, Setl, ЛСР — жильцы, ремонт, сдача",
    price: "149 ₽",
    priceAlt: "$1.49 · USDC на Base",
    badge: "ЖИЛЬЦЫ И РЕМОНТ · БЕЗ ЗАЯВОК",
    glowColor: "rgba(56, 189, 248, 0.45)",
    accentColor: "#38bdf8",
    nanoImage: toDataUri(NANO_REALTY),
    visualType: "nano"
  },
  {
    slug: "freelance-it-chats",
    kicker: "IT & FREELANCE CHATS 2026",
    title: "620+ чатов Фриланса, IT, Заказов и Разработки",
    sub: "Разработчики, дизайнеры, QA, SMM, проекты и вакансии в Telegram",
    price: "149 ₽",
    priceAlt: "$1.49 · USDC на Base",
    badge: "ТОЛЬКО ОТКРЫТЫЕ ГРУППЫ",
    glowColor: "rgba(34, 197, 94, 0.45)",
    accentColor: "#22c55e",
    nanoImage: toDataUri(NANO_FREELANCE),
    visualType: "nano"
  },
  {
    slug: "tg-chats",
    kicker: "TG CHAT VALIDATOR PRO",
    title: "1 608 живых открытых чатов Telegram",
    sub: "Селлеры WB/Ozon, закупки, карго, ИТ, недвижимость — без заявок в Excel",
    price: "490 ₽",
    priceAlt: "$9 · USDC на Base",
    badge: "1 608 ПРОВЕРЕННЫХ ГРУПП",
    glowColor: "rgba(14, 165, 233, 0.45)",
    accentColor: "#0ea5e9",
    nanoImage: toDataUri(NANO_TG_CHATS),
    visualType: "nano"
  },
  {
    slug: "data-clipper",
    kicker: "TABLE & TG-CHANNEL CLIPPER",
    title: "Калькулятор маржи WB/Ozon 2026 + Таблицы в Excel",
    sub: "Стресс-тест 120 товаров WB, выгрузка сайтов и каналов Telegram",
    price: "299 ₽",
    priceAlt: "$2.99 · USDC на Base",
    badge: "ФОРМУЛЫ 2026 · БЕЗ ПОДПИСКИ",
    glowColor: "rgba(16, 185, 129, 0.45)",
    accentColor: "#10b981",
    nanoImage: toDataUri(NANO_DATA_CLIPPER),
    visualType: "nano"
  },
  {
    slug: "audio-dub-studio",
    kicker: "AUDIO DUB STUDIO",
    title: "Скачать озвучку Яндекса и звук YouTube/VK в MP3",
    sub: "Дорожки по ролям, таймкод, BWF/ID3-метки, очередь до 200 файлов",
    price: "199 ₽",
    priceAlt: "$1.99 · USDC на Base",
    badge: "ЛОКАЛЬНО · ЧИСТЫЙ MP3",
    glowColor: "rgba(236, 72, 153, 0.45)",
    accentColor: "#ec4899",
    nanoImage: toDataUri(NANO_AUDIO),
    visualType: "nano"
  },
  {
    slug: "docsearch",
    kicker: "ARCHIVE STUDIO DOCSEARCH",
    title: "Поиск договоров, счетов и ИНН в архивах почты",
    sub: "ИНН, договоры, суммы и даты — точная цитата со ссылкой на файл на диске",
    price: "690 ₽",
    priceAlt: "$15 · USDC на Base",
    badge: "100% ЛОКАЛЬНО · СЕЙФ-АРХИВ",
    glowColor: "rgba(59, 130, 246, 0.45)",
    accentColor: "#3b82f6",
    nanoImage: toDataUri(NANO_DOCSEARCH),
    visualType: "nano"
  },
  {
    slug: "newsflow",
    kicker: "NEWSFLOW STUDIO",
    title: "Авто-сборщик дайджестов из Telegram и RSS",
    sub: "Дедупликация, расписание, экспорт в VK и Shorts без мусора",
    price: "390 ₽",
    priceAlt: "$12 · USDC на Base",
    badge: "КРИСТАЛЛ-ФИЛЬТР БЕЗ ДУБЛЕЙ",
    glowColor: "rgba(168, 85, 247, 0.45)",
    accentColor: "#a855f7",
    nanoImage: toDataUri(NANO_NEWSFLOW),
    visualType: "nano"
  },
  {
    slug: "live-radar",
    kicker: "LIVE RADAR 2026",
    title: "Сканер вилок и спредов Polymarket + TG Gifts",
    sub: "Скор, ликвидность, арбитраж Polymarket и TG Gifts без API-ключей",
    price: "390 ₽",
    priceAlt: "$14 · USDC на Base",
    badge: "ГОЛОГРАФИЧЕСКИЙ РАДАР",
    glowColor: "rgba(234, 179, 8, 0.45)",
    accentColor: "#eab308",
    nanoImage: toDataUri(NANO_LIVE_RADAR),
    visualType: "nano"
  },
  {
    slug: "base-tax-audit",
    kicker: "BASE WALLET GUARD & TAX",
    title: "Сканер опасных разрешений (Revoke) кошелька Base",
    sub: "Бессрочные approve, Revoke опасных доступов, FIFO для Koinly",
    price: "490 ₽",
    priceAlt: "$9 · USDC на Base",
    badge: "БРОНИРОВАННЫЙ ЩИТ BASE",
    glowColor: "rgba(37, 99, 235, 0.45)",
    accentColor: "#2563eb",
    nanoImage: toDataUri(NANO_BASE_TAX),
    visualType: "nano"
  },
  {
    slug: "algo-tycoon",
    kicker: "AI & MARKET TYCOON PRO",
    title: "AI & Market Tycoon Pro — Симулятор ИИ-стартапа",
    sub: "1 000 ₽ и одна стойка на старте: серверы, квантовый кластер, прибыль",
    price: "149 ₽",
    priceAlt: "$1.49 · USDC на Base",
    badge: "ИЗОМЕТРИЧЕСКИЙ 3D-ДАТАЦЕНТР",
    glowColor: "rgba(249, 115, 22, 0.45)",
    accentColor: "#f97316",
    nanoImage: toDataUri(NANO_ALGO_TYCOON),
    visualType: "nano"
  },
  {
    slug: "sni-whitelist",
    kicker: "SNI WHITELIST · LTE RU 2026",
    title: "1 384 домена Белых Списков SNI и VLESS",
    sub: "25 доменов с живым пингом из браузера, шаблоны Happ / v2rayNG / Sing-Box",
    price: "99 ₽",
    priceAlt: "$0.99 · USDC на Base",
    badge: "ЛАЗЕРНЫЙ ТУННЕЛЬ · 12 MS",
    glowColor: "rgba(16, 185, 129, 0.45)",
    accentColor: "#10b981",
    nanoImage: toDataUri(NANO_SNI_WHITELIST),
    visualType: "nano"
  },
  {
    slug: "wb-ozon-extension",
    kicker: "WB & OZON EXTENSION 2026",
    title: "Плагин WB и Ozon: Маржа 11.11 + Конкуренты в Excel",
    sub: "Чистая прибыль, комиссии и реклама 11.11 прямо на карточке товара",
    price: "199 ₽",
    priceAlt: "$1.99 · USDC на Base",
    badge: "ВИДЖЕТ ПРИБЫЛИ НА КАРТОЧКЕ",
    glowColor: "rgba(14, 165, 233, 0.45)",
    accentColor: "#0ea5e9",
    nanoImage: toDataUri(NANO_WB_OZON),
    visualType: "nano"
  }
];

function generate3dVisualSvg(type, accent) {
  if (type === "skyscrapers") {
    return `
    <svg viewBox="0 0 600 400" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="skyGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.9"/>
          <stop offset="100%" stop-color="#0284c7" stop-opacity="0.3"/>
        </linearGradient>
        <linearGradient id="bld1" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#1e293b"/>
          <stop offset="100%" stop-color="#334155"/>
        </linearGradient>
        <linearGradient id="bld2" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#334155"/>
          <stop offset="100%" stop-color="#475569"/>
        </linearGradient>
        <filter id="glow3d" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="16" result="blur"/>
          <feComposite in="SourceGraphic" in2="blur" operator="over"/>
        </filter>
      </defs>
      <!-- Base glow -->
      <circle cx="300" cy="220" r="180" fill="#38bdf8" opacity="0.25" filter="url(#glow3d)"/>
      <!-- City buildings 3D -->
      <polygon points="120,380 120,160 190,130 190,380" fill="url(#bld1)"/>
      <polygon points="190,130 240,150 240,380 190,380" fill="url(#bld2)"/>
      <!-- Tall tower center -->
      <polygon points="230,380 230,80 320,40 320,380" fill="url(#bld1)"/>
      <polygon points="320,40 390,70 390,380 320,380" fill="url(#bld2)"/>
      <!-- Right tower -->
      <polygon points="380,380 380,140 450,110 450,380" fill="url(#bld1)"/>
      <polygon points="450,110 500,135 500,380 450,380" fill="url(#bld2)"/>
      <!-- Illuminated windows -->
      <g fill="#fde047" opacity="0.85">
        <rect x="250" y="70" width="14" height="8" rx="2"/>
        <rect x="280" y="70" width="14" height="8" rx="2"/>
        <rect x="250" y="95" width="14" height="8" rx="2"/>
        <rect x="280" y="95" width="14" height="8" rx="2"/>
        <rect x="250" y="120" width="14" height="8" rx="2"/>
        <rect x="280" y="120" width="14" height="8" rx="2"/>
        <rect x="250" y="150" width="14" height="8" rx="2"/>
        <rect x="280" y="150" width="14" height="8" rx="2"/>
        <rect x="250" y="180" width="14" height="8" rx="2"/>
        <rect x="280" y="180" width="14" height="8" rx="2"/>
        <rect x="250" y="210" width="14" height="8" rx="2"/>
        <rect x="280" y="210" width="14" height="8" rx="2"/>
        <rect x="140" y="180" width="12" height="7" rx="2"/>
        <rect x="165" y="180" width="12" height="7" rx="2"/>
        <rect x="140" y="210" width="12" height="7" rx="2"/>
        <rect x="165" y="210" width="12" height="7" rx="2"/>
        <rect x="405" y="140" width="12" height="7" rx="2"/>
        <rect x="405" y="170" width="12" height="7" rx="2"/>
        <rect x="405" y="200" width="12" height="7" rx="2"/>
      </g>
      <!-- Floating golden 3D Key -->
      <g transform="translate(180, 100) rotate(-25)" filter="url(#glow3d)">
        <circle cx="40" cy="40" r="26" fill="none" stroke="#fbbf24" stroke-width="10"/>
        <rect x="62" y="35" width="65" height="10" rx="3" fill="#fbbf24"/>
        <rect x="105" y="45" width="8" height="16" rx="2" fill="#fbbf24"/>
        <rect x="119" y="45" width="8" height="22" rx="2" fill="#fbbf24"/>
      </g>
      <!-- Floating Telegram 3D Plane -->
      <g transform="translate(360, 180) rotate(15)" filter="url(#glow3d)">
        <circle cx="45" cy="45" r="42" fill="#0284c7" opacity="0.9"/>
        <polygon points="25,45 68,26 55,64 45,52" fill="#ffffff"/>
      </g>
    </svg>`;
  }

  if (type === "b2b-storefront") {
    return `
    <svg viewBox="0 0 600 400" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="glow3d" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="16" result="blur"/>
          <feComposite in="SourceGraphic" in2="blur" operator="over"/>
        </filter>
        <linearGradient id="storeGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#10b981" stop-opacity="0.9"/>
          <stop offset="100%" stop-color="#047857" stop-opacity="0.4"/>
        </linearGradient>
      </defs>
      <!-- Ambient halo -->
      <circle cx="300" cy="200" r="170" fill="#10b981" opacity="0.2" filter="url(#glow3d)"/>
      <!-- 3D Isometric Vitrine Store -->
      <g transform="translate(140, 60)">
        <!-- Roof awning -->
        <polygon points="160,20 280,70 120,130 0,80" fill="#10b981" opacity="0.95"/>
        <polygon points="0,80 120,130 120,150 0,100" fill="#047857"/>
        <polygon points="120,130 280,70 280,90 120,150" fill="#065f46"/>
        <!-- Main glass body -->
        <polygon points="15,105 115,148 115,280 15,235" fill="#1e293b" opacity="0.9" stroke="#34d399" stroke-width="2"/>
        <polygon points="115,148 265,90 265,225 115,280" fill="#0f172a" opacity="0.95" stroke="#34d399" stroke-width="2"/>
        <!-- Store shelf glow -->
        <line x1="30" y1="180" x2="105" y2="210" stroke="#6ee7b7" stroke-width="4"/>
        <line x1="125" y1="210" x2="250" y2="160" stroke="#6ee7b7" stroke-width="4"/>
      </g>
      <!-- Floating Excel spreadsheet 3D card -->
      <g transform="translate(320, 150) rotate(-10)" filter="url(#glow3d)">
        <rect x="0" y="0" width="180" height="120" rx="14" fill="#064e3b" stroke="#10b981" stroke-width="3" opacity="0.95"/>
        <rect x="15" y="15" width="26" height="26" rx="6" fill="#10b981"/>
        <text x="22" y="34" font-family="sans-serif" font-weight="900" font-size="16" fill="#ffffff">X</text>
        <line x1="50" y1="22" x2="160" y2="22" stroke="#6ee7b7" stroke-width="3"/>
        <line x1="50" y1="34" x2="130" y2="34" stroke="#34d399" stroke-width="2"/>
        <line x1="15" y1="58" x2="165" y2="58" stroke="#047857" stroke-width="2"/>
        <line x1="15" y1="80" x2="165" y2="80" stroke="#047857" stroke-width="2"/>
        <line x1="15" y1="102" x2="165" y2="102" stroke="#047857" stroke-width="2"/>
      </g>
      <!-- Floating Communication Badges: Phone, Email, TG -->
      <g transform="translate(100, 240)" filter="url(#glow3d)">
        <circle cx="30" cy="30" r="28" fill="#10b981"/>
        <path d="M22,18 C20,18 18,20 18,22 C18,31 25,38 34,38 C36,38 38,36 38,34 L35,28 C34,27 32,27 31,28 L29,29 C26,27 25,25 24,22 L26,20 C27,19 27,17 26,16 Z" fill="#ffffff"/>
      </g>
      <g transform="translate(430, 70)" filter="url(#glow3d)">
        <circle cx="30" cy="30" r="28" fill="#3b82f6"/>
        <rect x="16" y="20" width="28" height="20" rx="3" fill="none" stroke="#ffffff" stroke-width="2.5"/>
        <polyline points="16,21 30,31 44,21" fill="none" stroke="#ffffff" stroke-width="2.5"/>
      </g>
    </svg>`;
  }

  if (type === "laptop-matrix") {
    return `
    <svg viewBox="0 0 600 400" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="glow3d" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="16" result="blur"/>
          <feComposite in="SourceGraphic" in2="blur" operator="over"/>
        </filter>
        <linearGradient id="screenGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#052e16"/>
          <stop offset="100%" stop-color="#022c22"/>
        </linearGradient>
      </defs>
      <circle cx="300" cy="200" r="160" fill="#22c55e" opacity="0.22" filter="url(#glow3d)"/>
      <!-- 3D Open Laptop -->
      <g transform="translate(130, 70)">
        <!-- Screen Lid -->
        <polygon points="50,20 290,20 280,180 60,180" fill="#0f172a" stroke="#22c55e" stroke-width="3"/>
        <polygon points="62,32 278,32 270,170 70,170" fill="url(#screenGrad)"/>
        <!-- Code lines on screen -->
        <text x="85" y="60" font-family="monospace" font-weight="700" font-size="14" fill="#4ade80">&lt;div class="remote-it"&gt;</text>
        <text x="100" y="85" font-family="monospace" font-weight="700" font-size="14" fill="#86efac">const salary = 350000;</text>
        <text x="100" y="110" font-family="monospace" font-weight="700" font-size="14" fill="#38bdf8">orders.map(o =&gt; exportXLS);</text>
        <text x="85" y="135" font-family="monospace" font-weight="700" font-size="14" fill="#4ade80">&lt;/div&gt; // 600+ chats</text>
        <!-- Keyboard base -->
        <polygon points="60,180 280,180 340,260 0,260" fill="#1e293b" stroke="#334155" stroke-width="2"/>
        <polygon points="120,250 220,250 215,257 125,257" fill="#475569"/>
      </g>
      <!-- Floating 3D Code Brackets Glass Token -->
      <g transform="translate(70, 110) rotate(-15)" filter="url(#glow3d)">
        <rect x="0" y="0" width="70" height="70" rx="16" fill="#14532d" stroke="#22c55e" stroke-width="3" opacity="0.95"/>
        <text x="15" y="47" font-family="monospace" font-weight="900" font-size="34" fill="#86efac">&lt;/&gt;</text>
      </g>
      <!-- Floating Telegram 3D Plane -->
      <g transform="translate(430, 120) rotate(12)" filter="url(#glow3d)">
        <circle cx="40" cy="40" r="38" fill="#0ea5e9"/>
        <polygon points="22,40 62,24 50,58 40,48" fill="#ffffff"/>
      </g>
    </svg>`;
  }

  if (type === "calculator-margin") {
    return `
    <svg viewBox="0 0 600 400" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="glow3d" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="16" result="blur"/>
          <feComposite in="SourceGraphic" in2="blur" operator="over"/>
        </filter>
      </defs>
      <circle cx="300" cy="200" r="160" fill="#10b981" opacity="0.25" filter="url(#glow3d)"/>
      <!-- 3D Calculator Body -->
      <g transform="translate(190, 50)">
        <rect x="0" y="0" width="220" height="290" rx="28" fill="#0f172a" stroke="#10b981" stroke-width="3.5"/>
        <!-- Display screen -->
        <rect x="20" y="22" width="180" height="60" rx="12" fill="#064e3b" stroke="#34d399" stroke-width="2"/>
        <text x="32" y="60" font-family="monospace" font-weight="900" font-size="28" fill="#34d399">+38.4% MARGIN</text>
        <!-- Buttons grid -->
        <g fill="#1e293b" stroke="#334155" stroke-width="1.5">
          <rect x="20" y="100" width="48" height="38" rx="8"/>
          <rect x="86" y="100" width="48" height="38" rx="8"/>
          <rect x="152" y="100" width="48" height="38" rx="8"/>
          <rect x="20" y="150" width="48" height="38" rx="8"/>
          <rect x="86" y="150" width="48" height="38" rx="8"/>
          <rect x="152" y="150" width="48" height="38" rx="8"/>
          <rect x="20" y="200" width="48" height="38" rx="8"/>
          <rect x="86" y="200" width="48" height="38" rx="8"/>
          <rect x="152" y="200" width="48" height="38" rx="8"/>
        </g>
      </g>
      <!-- Big Dynamic Green Growth Arrow 3D -->
      <g transform="translate(360, 80) rotate(-20)" filter="url(#glow3d)">
        <polygon points="50,0 100,50 75,50 75,140 25,140 25,50 0,50" fill="#22c55e" stroke="#86efac" stroke-width="3"/>
      </g>
      <!-- 11.11 Red Sale Badge -->
      <g transform="translate(90, 160) rotate(-15)" filter="url(#glow3d)">
        <rect x="0" y="0" width="95" height="50" rx="12" fill="#dc2626" stroke="#f87171" stroke-width="2.5"/>
        <text x="14" y="34" font-family="sans-serif" font-weight="900" font-size="24" fill="#ffffff">11.11</text>
      </g>
    </svg>`;
  }

  if (type === "laser-tunnel") {
    return `
    <svg viewBox="0 0 600 400" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="glow3d" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="16" result="blur"/>
          <feComposite in="SourceGraphic" in2="blur" operator="over"/>
        </filter>
        <linearGradient id="laserGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#10b981" stop-opacity="0"/>
          <stop offset="50%" stop-color="#34d399" stop-opacity="1"/>
          <stop offset="100%" stop-color="#6ee7b7" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <circle cx="300" cy="200" r="160" fill="#10b981" opacity="0.25" filter="url(#glow3d)"/>
      <!-- Concentric Tunnel Rings in perspective -->
      <ellipse cx="300" cy="200" rx="260" ry="140" fill="none" stroke="#047857" stroke-width="3" opacity="0.4"/>
      <ellipse cx="300" cy="200" rx="190" ry="105" fill="none" stroke="#059669" stroke-width="3.5" opacity="0.6"/>
      <ellipse cx="300" cy="200" rx="130" ry="70" fill="none" stroke="#10b981" stroke-width="4" opacity="0.8"/>
      <ellipse cx="300" cy="200" rx="70" ry="38" fill="none" stroke="#34d399" stroke-width="4.5"/>
      <ellipse cx="300" cy="200" rx="25" ry="14" fill="#a7f3d0"/>
      <!-- High speed laser beam rays -->
      <line x1="300" y1="200" x2="30" y2="60" stroke="#34d399" stroke-width="3" opacity="0.8"/>
      <line x1="300" y1="200" x2="570" y2="60" stroke="#34d399" stroke-width="3" opacity="0.8"/>
      <line x1="300" y1="200" x2="60" y2="340" stroke="#34d399" stroke-width="3" opacity="0.8"/>
      <line x1="300" y1="200" x2="540" y2="340" stroke="#34d399" stroke-width="3" opacity="0.8"/>
      <!-- Center Shield Pierced by Beam -->
      <g transform="translate(250, 130)" filter="url(#glow3d)">
        <path d="M50,0 L100,20 L100,75 C100,110 50,135 50,135 C50,135 0,110 0,75 L0,20 Z" fill="#064e3b" stroke="#34d399" stroke-width="4" opacity="0.9"/>
        <text x="24" y="65" font-family="sans-serif" font-weight="900" font-size="20" fill="#a7f3d0">SNI</text>
        <text x="14" y="90" font-family="sans-serif" font-weight="800" font-size="14" fill="#34d399">WHITE</text>
      </g>
      <!-- Floating 12 ms Low Ping Badge -->
      <g transform="translate(100, 100) rotate(-10)" filter="url(#glow3d)">
        <rect x="0" y="0" width="125" height="48" rx="14" fill="#0f172a" stroke="#10b981" stroke-width="2.5"/>
        <circle cx="22" cy="24" r="7" fill="#22c55e"/>
        <text x="38" y="32" font-family="monospace" font-weight="900" font-size="20" fill="#ffffff">12 ms</text>
      </g>
      <!-- Floating 5G LTE Device Badge -->
      <g transform="translate(420, 240) rotate(8)" filter="url(#glow3d)">
        <rect x="0" y="0" width="115" height="48" rx="14" fill="#0f172a" stroke="#38bdf8" stroke-width="2.5"/>
        <text x="24" y="32" font-family="sans-serif" font-weight="900" font-size="18" fill="#38bdf8">5G · LTE</text>
      </g>
    </svg>`;
  }

  if (type === "browser-extension") {
    return `
    <svg viewBox="0 0 600 400" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="glow3d" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="16" result="blur"/>
          <feComposite in="SourceGraphic" in2="blur" operator="over"/>
        </filter>
      </defs>
      <circle cx="300" cy="200" r="160" fill="#0ea5e9" opacity="0.22" filter="url(#glow3d)"/>
      <!-- 3D Glass Browser Window -->
      <g transform="translate(90, 50)">
        <rect x="0" y="0" width="420" height="280" rx="18" fill="#0f172a" stroke="#38bdf8" stroke-width="3" opacity="0.95"/>
        <!-- Browser Top Bar -->
        <rect x="0" y="0" width="420" height="38" rx="18" fill="#1e293b"/>
        <circle cx="20" cy="19" r="5" fill="#ef4444"/>
        <circle cx="36" cy="19" r="5" fill="#f59e0b"/>
        <circle cx="52" cy="19" r="5" fill="#10b981"/>
        <rect x="80" y="9" width="260" height="20" rx="6" fill="#0f172a"/>
        <text x="95" y="24" font-family="monospace" font-size="11" fill="#94a3b8">wildberries.ru/catalog/sneakers</text>
        <!-- Product mock: Sneaker inside marketplace card -->
        <g transform="translate(40, 65)">
          <rect x="0" y="0" width="140" height="180" rx="12" fill="#1e293b"/>
          <path d="M20,120 C50,110 80,115 110,80 L125,100 C130,120 120,135 100,140 L30,140 Z" fill="#d946ef"/>
          <rect x="20" y="155" width="80" height="12" rx="4" fill="#a855f7"/>
        </g>
        <!-- Floating Emerald Calculation Widget Card -->
        <g transform="translate(190, 80)" filter="url(#glow3d)">
          <rect x="0" y="0" width="200" height="150" rx="16" fill="#064e3b" stroke="#10b981" stroke-width="3"/>
          <text x="18" y="32" font-family="sans-serif" font-weight="900" font-size="14" fill="#a7f3d0">ПРИБЫЛЬ С КАРТОЧКИ:</text>
          <text x="18" y="70" font-family="sans-serif" font-weight="900" font-size="28" fill="#34d399">+1 450 ₽</text>
          <line x1="18" y1="88" x2="182" y2="88" stroke="#047857" stroke-width="2"/>
          <rect x="18" y="102" width="164" height="34" rx="8" fill="#10b981"/>
          <text x="35" y="124" font-family="sans-serif" font-weight="800" font-size="13" fill="#ffffff">СКАЧАТЬ В EXCEL</text>
        </g>
      </g>
    </svg>`;
  }

  // Default tech studio placeholder with dynamic glyph
  return `
  <svg viewBox="0 0 600 400" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <filter id="glow3d" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="18" result="blur"/>
        <feComposite in="SourceGraphic" in2="blur" operator="over"/>
      </filter>
    </defs>
    <circle cx="300" cy="200" r="150" fill="${accent}" opacity="0.25" filter="url(#glow3d)"/>
    <g transform="translate(200, 90)" filter="url(#glow3d)">
      <polygon points="100,0 200,58 200,174 100,232 0,174 0,58" fill="#0f172a" stroke="${accent}" stroke-width="4"/>
      <polygon points="100,20 180,66 180,160 100,206 20,160 20,66" fill="#1e293b" opacity="0.8"/>
      <line x1="100" y1="20" x2="100" y2="206" stroke="${accent}" stroke-width="2"/>
      <line x1="20" y1="66" x2="180" y2="160" stroke="${accent}" stroke-width="1.5" opacity="0.6"/>
      <line x1="20" y1="160" x2="180" y2="66" stroke="${accent}" stroke-width="1.5" opacity="0.6"/>
    </g>
  </svg>`;
}

function renderCoverHtml(item, w, h) {
  const isOg = w > h;
  const pad = isOg ? 44 : 48;
  const visualContent = item.nanoImage
    ? `<div class="nano-box"><img src="${item.nanoImage}" alt="${item.title}" /></div>`
    : `<div class="vector-box">${generate3dVisualSvg(item.visualType, item.accentColor)}<div class="pbr-grain"></div></div>`;

  return `<!doctype html><html><head><meta charset="utf-8">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { width: ${w}px; height: ${h}px; overflow: hidden; background: #07090e; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #ffffff;
      display: flex;
      flex-direction: column;
      padding: ${pad}px;
      position: relative;
      background: radial-gradient(800px 500px at 50% -10%, ${item.glowColor} 0%, rgba(7, 9, 14, 0) 70%),
                  radial-gradient(700px 400px at 50% 110%, ${item.glowColor} 0%, rgba(7, 9, 14, 0) 65%),
                  #07090e;
    }
    .pbr-grain {
      position: absolute;
      inset: 0;
      pointer-events: none;
      background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 400 400' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.6' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.16'/%3E%3C/svg%3E");
      mix-blend-mode: overlay;
      border-radius: 20px;
    }
    .top-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 100%;
      margin-bottom: ${isOg ? 8 : 12}px;
      z-index: 10;
    }
    .kicker-pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.16);
      border-radius: 999px;
      padding: 6px 14px;
      font-size: ${isOg ? 12 : 13}px;
      font-weight: 800;
      letter-spacing: 0.12em;
      color: ${item.accentColor};
      text-transform: uppercase;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    }
    .kicker-pill::before {
      content: "";
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: ${item.accentColor};
      box-shadow: 0 0 10px ${item.accentColor};
    }
    .brand-mark {
      font-size: ${isOg ? 13 : 14}px;
      font-weight: 700;
      color: #94a3b8;
      letter-spacing: 0.02em;
    }
    .brand-mark b {
      color: #ffffff;
    }
    .hero-text {
      margin-top: ${isOg ? 4 : 8}px;
      margin-bottom: ${isOg ? 8 : 14}px;
      z-index: 10;
    }
    h1 {
      font-size: ${isOg ? 36 : 38}px;
      line-height: 1.1;
      font-weight: 900;
      letter-spacing: -0.03em;
      color: #ffffff;
      text-shadow: 0 4px 20px rgba(0,0,0,0.6);
      max-width: ${isOg ? "900px" : "700px"};
    }
    .sub {
      margin-top: ${isOg ? 6 : 8}px;
      font-size: ${isOg ? 15 : 16}px;
      line-height: 1.35;
      color: #cbd5e1;
      font-weight: 500;
      max-width: ${isOg ? "850px" : "660px"};
    }
    .visual-stage {
      flex: 1;
      position: relative;
      border-radius: 20px;
      border: 1px solid rgba(255, 255, 255, 0.12);
      background: rgba(15, 23, 42, 0.55);
      backdrop-filter: blur(20px);
      box-shadow: 0 30px 60px -20px rgba(0, 0, 0, 0.8),
                  inset 0 1px 1px rgba(255, 255, 255, 0.2);
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 5;
    }
    .nano-box {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      position: relative;
    }
    .nano-box img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      object-position: center;
      filter: saturate(1.1) contrast(1.05);
    }
    .nano-box::after {
      content: "";
      position: absolute;
      inset: 0;
      box-shadow: inset 0 0 40px rgba(7, 9, 14, 0.6);
    }
    .vector-box {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .bottom-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: ${isOg ? 12 : 18}px;
      z-index: 10;
    }
    .badge-pill {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      background: rgba(16, 185, 129, 0.14);
      border: 1px solid rgba(16, 185, 129, 0.35);
      border-radius: 999px;
      padding: ${isOg ? "8px 16px" : "10px 18px"};
      font-size: ${isOg ? 13 : 14}px;
      font-weight: 800;
      color: #34d399;
      letter-spacing: 0.05em;
      box-shadow: 0 4px 16px rgba(16, 185, 129, 0.2);
    }
    .price-box {
      text-align: right;
    }
    .price-main {
      font-size: ${isOg ? 32 : 36}px;
      font-weight: 900;
      letter-spacing: -0.04em;
      line-height: 1;
      color: #ffffff;
      text-shadow: 0 2px 14px rgba(255, 255, 255, 0.3);
    }
    .price-sub {
      margin-top: 4px;
      font-size: ${isOg ? 12 : 13}px;
      font-weight: 600;
      color: #94a3b8;
    }
  </style>
  </head>
  <body>
    <div class="top-bar">
      <div class="kicker-pill">${item.kicker}</div>
      <div class="brand-mark">Toolworks <b>· 2026</b></div>
    </div>
    <div class="hero-text">
      <h1>${item.title}</h1>
      <div class="sub">${item.sub}</div>
    </div>
    <div class="visual-stage">
      ${visualContent}
    </div>
    <div class="bottom-bar">
      <div class="badge-pill">${item.badge}</div>
      <div class="price-box">
        <div class="price-main">${item.price}</div>
        <div class="price-sub">${item.priceAlt}</div>
      </div>
    </div>
  </body>
  </html>`;
}

(async () => {
  fs.mkdirSync(OUT_COVERS, { recursive: true });
  fs.mkdirSync(OUT_OG, { recursive: true });

  const onlyIdx = process.argv.indexOf("--only");
  const only = onlyIdx !== -1 ? process.argv[onlyIdx + 1] : null;
  const items = only ? ITEMS.filter((i) => i.slug === only) : ITEMS;
  if (!items.length) {
    console.error("no such slug: " + only);
    process.exit(1);
  }
  console.log(`Rendering ${items.length} commercial 3D product cover(s) via Playwright Chromium...`);

  const browser = await chromium.launch();

  try {
    for (const item of items) {
      // 1. Render 800x800 square cover
      const pageSquare = await browser.newPage({
        viewport: { width: 800, height: 800 },
        deviceScaleFactor: 2
      });
      await pageSquare.setContent(renderCoverHtml(item, 800, 800), { waitUntil: "load" });
      await pageSquare.waitForTimeout(100);
      const coverOut = path.join(OUT_COVERS, item.slug + ".png");
      await pageSquare.screenshot({ path: coverOut, type: "png" });
      await pageSquare.close();

      // If wb-ozon-extension or sni-whitelist, duplicate aliases
      if (item.slug === "wb-ozon-extension") {
        fs.copyFileSync(coverOut, path.join(OUT_COVERS, "wb-ozon-extension-pro.png"));
      }
      if (item.slug === "sni-whitelist") {
        fs.copyFileSync(coverOut, path.join(OUT_COVERS, "sni-whitelist-pro.png"));
        fs.copyFileSync(coverOut, path.join(OUT_COVERS, "net-whitelist.png"));
      }

      // 2. Render 1200x630 OG social card
      const pageWide = await browser.newPage({
        viewport: { width: 1200, height: 630 },
        deviceScaleFactor: 2
      });
      await pageWide.setContent(renderCoverHtml(item, 1200, 630), { waitUntil: "load" });
      await pageWide.waitForTimeout(100);
      const ogOut = path.join(OUT_OG, item.slug + ".png");
      await pageWide.screenshot({ path: ogOut, type: "png" });
      await pageWide.close();

      if (item.slug === "wb-ozon-extension") {
        fs.copyFileSync(ogOut, path.join(OUT_OG, "wb-ozon-extension-pro.png"));
      }
      if (item.slug === "sni-whitelist") {
        fs.copyFileSync(ogOut, path.join(OUT_OG, "sni-whitelist-pro.png"));
        fs.copyFileSync(ogOut, path.join(OUT_OG, "net-whitelist.png"));
      }

      const sz800 = fs.statSync(coverOut).size;
      const sz1200 = fs.statSync(ogOut).size;
      console.log(`  [OK] ${item.slug.padEnd(22)} -> 800x800: ${(sz800 / 1024).toFixed(1)} KB | 1200x630: ${(sz1200 / 1024).toFixed(1)} KB`);
    }
  } finally {
    await browser.close();
  }

  console.log(`\nAll ${items.length} commercial cover(s) & OG images generated successfully!`);
})().catch(e => {
  console.error("Render failed:", e);
  process.exit(1);
});
