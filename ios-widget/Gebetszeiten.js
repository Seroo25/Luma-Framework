// Gebetszeiten-Widget für Scriptable (iOS)
// Zeigt "Aktuelles Gebet" und "Nächstes Gebet" wie auf islamsalzgitter.de/gebetszeiten
//
// Installation:
//   1. App "Scriptable" aus dem App Store laden (kostenlos).
//   2. Neues Script anlegen, diesen Code einfügen, "Gebetszeiten" nennen.
//   3. Homescreen lang drücken → "+" → Scriptable → Widget "Mittel" (beide Karten)
//      oder "Klein" (nur nächstes Gebet) hinzufügen.
//   4. Widget lang drücken → "Widget bearbeiten" → Script: "Gebetszeiten".

// ───────────────────────── Einstellungen ─────────────────────────
const CONFIG = {
  // Zuerst wird versucht, die Zeiten direkt von der Moschee-Seite zu lesen.
  sourceUrl: "https://www.islamsalzgitter.de/gebetszeiten/",

  // Fallback: eigene Berechnung (falls die Seite nicht lesbar ist / offline).
  latitude: 52.1508,   // Salzgitter
  longitude: 10.3593,
  fajrAngle: 18,
  ishaAngle: 17,
  asrFactor: 1,        // 1 = Standard (Schafi'i), 2 = Hanafi
  // Feinkorrektur in Minuten, damit die Berechnung zur Moschee passt
  // (abgeglichen mit Fr. 20.11.2026: Asr 14:08, Maghrib 16:23).
  offsets: { fajr: 0, sunrise: 0, dhuhr: 0, asr: 9, maghrib: 3, isha: 0 },
};

const NAMES = {
  fajr: "Fajr",
  sunrise: "Shurûq",
  dhuhr: "Dhuhr",
  asr: "^Asr",
  maghrib: "Maghrib",
  isha: "^Ishâ",
};
const ORDER = ["fajr", "sunrise", "dhuhr", "asr", "maghrib", "isha"];

const COLORS = {
  bg: new Color("#0b171c"),
  card: new Color("#16262d"),
  gradTop: new Color("#5aa8b8"),
  gradBottom: new Color("#2f5f6b"),
  label: new Color("#d6e9ee"),
  accent: new Color("#5bb5c8"),
  white: new Color("#f2fafc"),
  muted: new Color("#8fb3bd"),
};

// ───────────────────────── Datenquelle 1: Website ─────────────────────────
const PATTERNS = {
  fajr: "(?:Fa[dg]?sch?r|Fajr|Fadjr|Sabah|Morgengebet)",
  sunrise: "(?:Sonnenaufgang|Shur[uû]q|Schuruk|Shuruk|G[üu]ne[sş])",
  dhuhr: "(?:Dhuhr|Zuhr|Zohr|Duhr|[ÖO][gğ]le|Mittagsgebet)",
  asr: "(?:\\^?\\s?[ʿ'`]?Asr|[İI]kindi|Nachmittagsgebet)",
  maghrib: "(?:Maghrib|Magrib|Ak[sş]am|Abendgebet)",
  isha: "(?:\\^?\\s?[ʿ'`]?Isc?h[aâ]'?|Yats[ıi]|Nachtgebet)",
};

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

function parseSite(html) {
  const text = htmlToText(html);
  const result = {};
  for (const key of ORDER) {
    const re = new RegExp(PATTERNS[key] + "[^0-9]{0,60}?(\\d{1,2})[:.](\\d{2})", "i");
    const m = text.match(re);
    if (!m) return null;
    result[key] = Number(m[1]) * 60 + Number(m[2]);
  }
  // Plausibilitätsprüfung: Zeiten müssen aufsteigend sein
  for (let i = 1; i < ORDER.length; i++) {
    if (result[ORDER[i]] <= result[ORDER[i - 1]]) return null;
  }
  return result;
}

// ───────────────────────── Datenquelle 2: Berechnung ─────────────────────────
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

function sunPos(jd) {
  const D = jd - 2451545;
  const g = (357.529 + 0.98560028 * D) % 360;
  const q = (280.459 + 0.98564736 * D) % 360;
  const L = (q + 1.915 * Math.sin(rad(g)) + 0.02 * Math.sin(rad(2 * g))) % 360;
  const e = 23.439 - 0.00000036 * D;
  const RA = deg(Math.atan2(Math.cos(rad(e)) * Math.sin(rad(L)), Math.cos(rad(L)))) / 15;
  const decl = deg(Math.asin(Math.sin(rad(e)) * Math.sin(rad(L))));
  let eq = q / 15 - (((RA % 24) + 24) % 24);
  eq = ((((eq + 12) % 24) + 24) % 24) - 12;
  return { decl, eq };
}

function calculate(date) {
  const { latitude: lat, longitude: lng } = CONFIG;
  const tz = -date.getTimezoneOffset() / 60;
  const jd = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 864e5 + 2440587.5 - lng / 360;
  const noon = (t) => 12 - sunPos(jd + t / 24).eq;
  const atAngle = (angle, t, before) => {
    const s = sunPos(jd + t / 24);
    const v = deg(Math.acos(
      (-Math.sin(rad(angle)) - Math.sin(rad(s.decl)) * Math.sin(rad(lat))) /
      (Math.cos(rad(s.decl)) * Math.cos(rad(lat)))
    )) / 15;
    return noon(t) + (before ? -v : v);
  };
  const asrAngle = (t) => {
    const s = sunPos(jd + t / 24);
    return -deg(Math.atan(1 / (CONFIG.asrFactor + Math.tan(rad(Math.abs(lat - s.decl))))));
  };
  const local = (h) => h + tz - lng / 15;
  const hours = {
    fajr: local(atAngle(CONFIG.fajrAngle, 5, true)),
    sunrise: local(atAngle(0.833, 6, true)),
    dhuhr: local(noon(12)),
    asr: local(atAngle(asrAngle(13), 13, false)),
    maghrib: local(atAngle(0.833, 18, false)),
    isha: local(atAngle(CONFIG.ishaAngle, 18, false)),
  };
  // Hohe Breiten (Sommer): Sonne erreicht den Winkel nicht → "Angle-Based"-Regel
  const night = 24 - (hours.maghrib - hours.sunrise);
  const maxFajr = (CONFIG.fajrAngle / 60) * night;
  const maxIsha = (CONFIG.ishaAngle / 60) * night;
  if (isNaN(hours.fajr) || hours.sunrise - hours.fajr > maxFajr) hours.fajr = hours.sunrise - maxFajr;
  if (isNaN(hours.isha) || hours.isha - hours.maghrib > maxIsha) hours.isha = hours.maghrib + maxIsha;
  const res = {};
  for (const k of ORDER) res[k] = Math.round(hours[k] * 60) + (CONFIG.offsets[k] || 0);
  return res;
}

// ───────────────────────── Cache & Laden ─────────────────────────
const fm = FileManager.local();
const cachePath = fm.joinPath(fm.documentsDirectory(), "gebetszeiten-cache.json");
const dayKey = (d) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

function readCache() {
  try { return fm.fileExists(cachePath) ? JSON.parse(fm.readString(cachePath)) : {}; }
  catch (e) { return {}; }
}

async function timesForToday(now) {
  const key = dayKey(now);
  const cache = readCache();
  if (cache[key]) return cache[key];
  try {
    const req = new Request(CONFIG.sourceUrl);
    req.timeoutInterval = 10;
    const parsed = parseSite(await req.loadString());
    if (parsed) {
      fm.writeString(cachePath, JSON.stringify({ [key]: parsed }));
      return parsed;
    }
  } catch (e) { /* offline → Berechnung */ }
  return calculate(now);
}

function toDate(base, minutes, dayShift = 0) {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + dayShift);
  d.setMinutes(minutes);
  return d;
}

async function getState() {
  const now = new Date();
  const today = await timesForToday(now);
  const list = ORDER.map((k) => ({ key: k, date: toDate(now, today[k]) }));

  let idx = -1;
  for (let i = 0; i < list.length; i++) if (list[i].date <= now) idx = i;

  let current, next;
  if (idx === -1) {
    // nach Mitternacht, vor Fajr → ^Ishâ von gestern läuft noch
    const y = calculate(new Date(now.getTime() - 864e5));
    current = { key: "isha", date: toDate(now, y.isha, -1) };
    next = list[0];
  } else if (idx === list.length - 1) {
    current = list[idx];
    const tomorrow = calculate(new Date(now.getTime() + 864e5));
    next = { key: "fajr", date: toDate(now, tomorrow.fajr, 1) };
  } else {
    current = list[idx];
    next = list[idx + 1];
  }
  return { current, next };
}

// ───────────────────────── Widget-Layout ─────────────────────────
const fmt = (d) => {
  const df = new DateFormatter();
  df.dateFormat = "HH:mm";
  return df.string(d);
};

function addCard(parent, opts) {
  const card = parent.addStack();
  card.layoutVertically();
  card.cornerRadius = 18;
  card.setPadding(12, 12, 12, 12);
  if (opts.highlight) {
    const g = new LinearGradient();
    g.colors = [COLORS.gradTop, COLORS.gradBottom];
    g.locations = [0, 1];
    g.startPoint = new Point(0, 0);
    g.endPoint = new Point(1, 1);
    card.backgroundGradient = g;
  } else {
    card.backgroundColor = COLORS.card;
  }

  const label = card.addText(opts.label);
  label.font = Font.semiboldSystemFont(10);
  label.textColor = opts.highlight ? COLORS.label : COLORS.accent;

  card.addSpacer(4);
  const name = card.addText(NAMES[opts.item.key]);
  name.font = Font.boldSystemFont(17);
  name.textColor = opts.highlight ? COLORS.white : COLORS.accent;
  name.lineLimit = 1;

  const time = card.addText(fmt(opts.item.date));
  time.font = Font.heavySystemFont(32);
  time.textColor = COLORS.white;
  time.minimumScaleFactor = 0.7;

  card.addSpacer();
  const footer = card.addStack();
  footer.centerAlignContent();
  if (opts.endsAt) {
    const t = footer.addText(`Endet · ${fmt(opts.endsAt)} Uhr`);
    t.font = Font.mediumSystemFont(11);
    t.textColor = COLORS.label;
  } else {
    const t = footer.addText("in ");
    t.font = Font.mediumSystemFont(11);
    t.textColor = COLORS.muted;
    const rel = footer.addDate(opts.item.date);
    rel.applyTimerStyle();
    rel.font = Font.mediumSystemFont(11);
    rel.textColor = COLORS.muted;
  }
  footer.addSpacer();
  return card;
}

async function buildWidget() {
  const { current, next } = await getState();
  const family = config.widgetFamily || "medium";

  const w = new ListWidget();
  w.backgroundColor = COLORS.bg;
  w.setPadding(10, 10, 10, 10);
  w.url = CONFIG.sourceUrl;

  if (family === "small") {
    addCard(w, { label: "NÄCHSTES GEBET", item: next });
  } else {
    const row = w.addStack();
    row.layoutHorizontally();
    addCard(row, { label: "AKTUELLES GEBET", item: current, endsAt: next.date, highlight: true });
    row.addSpacer(10);
    addCard(row, { label: "NÄCHSTES GEBET", item: next });
  }

  // Direkt nach dem nächsten Gebetswechsel neu laden
  w.refreshAfterDate = new Date(next.date.getTime() + 30 * 1000);
  return w;
}

const widget = await buildWidget();
if (config.runsInWidget) {
  Script.setWidget(widget);
} else {
  await widget.presentMedium();
}
Script.complete();
