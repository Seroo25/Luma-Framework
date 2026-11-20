// Gebetszeiten-Widget für Scriptable (iOS)
// Holt die Zeiten ausschließlich von islamsalzgitter.de/gebetszeiten
// und zeigt "Aktuelles Gebet" + "Nächstes Gebet" im Liquid-Glass-Stil.
//
// Installation:
//   1. App "Scriptable" aus dem App Store laden (kostenlos).
//   2. Neues Script anlegen, diesen Code einfügen, "Gebetszeiten" nennen.
//   3. Homescreen lang drücken → "+" → Scriptable → Größe "Mittel" (beide Karten)
//      oder "Klein" (nur nächstes Gebet) hinzufügen.
//   4. Widget lang drücken → "Widget bearbeiten" → Script: "Gebetszeiten".
//   Tipp: Mit dem Homescreen-Stil "Klar" (Liquid Glass) legt iOS das Glas
//   automatisch hinter das Widget.

const SOURCE_URL = "https://www.islamsalzgitter.de/gebetszeiten/";

const NAMES = {
  fajr: "Fajr",
  sunrise: "Shurûq",
  dhuhr: "Dhuhr",
  asr: "^Asr",
  maghrib: "Maghrib",
  isha: "^Ishâ",
};
const ORDER = ["fajr", "sunrise", "dhuhr", "asr", "maghrib", "isha"];

// Liquid-Glass-Farben: weiß auf Glas, dezente Abstufungen
const C = {
  bgTop: new Color("#3a342e", 0.55),
  bgBottom: new Color("#0e0d0c", 0.75),
  cardHi: new Color("#ffffff", 0.2),
  card: new Color("#ffffff", 0.08),
  text: new Color("#ffffff", 1),
  sub: new Color("#ffffff", 0.72),
  faint: new Color("#ffffff", 0.5),
};

// ───────────────────────── Website auslesen ─────────────────────────
const PATTERNS = {
  fajr: "(?:Fa[dg]?sch?r|Fajr|Fadjr|Sabah|Morgengebet)",
  sunrise: "(?:Sonnenaufgang|Shur[uû]q|Schuruk|Shuruk|G[üu]ne[sş])",
  dhuhr: "(?:Dhuhr|Zuhr|Zohr|Duhr|[ÖO][gğ]le|Mittagsgebet)",
  asr: "(?:\\^?\\s?[ʿ'`]?Asr|[İI]kindi|Nachmittagsgebet)",
  maghrib: "(?:Maghrib|Magrib|Ak[sş]am|Abendgebet)",
  isha: "(?:\\^?\\s?[ʿ'`]?Isc?h[aâ]'?|Yats[ıi]|Nachtgebet)",
};
const KEY_BY_NAME = (name) => ORDER.find((k) => new RegExp("^" + PATTERNS[k] + "$", "i").test(name.trim()));

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#0?39;|&rsquo;/g, "'");
}

const toMin = (h, m) => Number(h) * 60 + Number(m);

function parse(text) {
  text = text.replace(/\s+/g, " ");
  const times = {};
  for (const key of ORDER) {
    const m = text.match(new RegExp(PATTERNS[key] + "[^0-9]{0,60}?(\\d{1,2})[:.](\\d{2})", "i"));
    if (!m) return null;
    times[key] = toMin(m[1], m[2]);
  }
  for (let i = 1; i < ORDER.length; i++) {
    if (times[ORDER[i]] <= times[ORDER[i - 1]]) return null;
  }
  // Karte "Nächstes Gebet" der Seite (liefert nach ^Ishâ das Fajr von morgen)
  const n = text.match(/N[äa]chstes Gebet\s*(.{2,20}?)\s*(\d{1,2})[:.](\d{2})/i);
  const next = n ? { key: KEY_BY_NAME(n[1]) || "fajr", min: toMin(n[2], n[3]) } : null;
  return { times, next };
}

// Variante 1: HTML direkt laden
async function loadViaRequest() {
  const req = new Request(SOURCE_URL);
  req.timeoutInterval = 15;
  return htmlToText(await req.loadString());
}

// Variante 2: Seite im unsichtbaren Browser rendern (falls Zeiten per JavaScript kommen)
async function loadViaWebView() {
  const wv = new WebView();
  await wv.loadURL(SOURCE_URL);
  return await wv.evaluateJavaScript(`
    (function wait(n){
      const t = document.body ? document.body.innerText : "";
      if (/\\d{1,2}:\\d{2}/.test(t) || n <= 0) { completion(t); }
      else { setTimeout(() => wait(n - 1), 500); }
    })(16);
  `, true);
}

// ───────────────────────── Cache (letzte erfolgreiche Abfrage) ─────────────────────────
const fm = FileManager.local();
const cachePath = fm.joinPath(fm.documentsDirectory(), "gebetszeiten-cache.json");
const dayKey = (d) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

function readCache() {
  try { return fm.fileExists(cachePath) ? JSON.parse(fm.readString(cachePath)) : null; }
  catch (e) { return null; }
}

let lastRawText = "";

async function fetchData(now) {
  const cache = readCache();
  const needsNext = cache && cache.day === dayKey(now) && now.getHours() * 60 + now.getMinutes() >= cache.data.times.isha;
  if (cache && cache.day === dayKey(now) && !needsNext) return cache.data;

  for (const loader of [loadViaRequest, loadViaWebView]) {
    try {
      lastRawText = await loader();
      const data = parse(lastRawText);
      if (data) {
        fm.writeString(cachePath, JSON.stringify({ day: dayKey(now), data }));
        return data;
      }
    } catch (e) { /* nächste Variante */ }
  }
  return cache && cache.day === dayKey(now) ? cache.data : null;
}

// ───────────────────────── Aktuelles / nächstes Gebet ─────────────────────────
function at(base, minutes, dayShift = 0) {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + dayShift);
  d.setMinutes(minutes);
  return d;
}

function getState(data, now) {
  const list = ORDER.map((k) => ({ key: k, date: at(now, data.times[k]) }));
  let idx = -1;
  for (let i = 0; i < list.length; i++) if (list[i].date <= now) idx = i;

  if (idx === -1) {
    // nach Mitternacht vor Fajr: ^Ishâ läuft noch
    return { current: { key: "isha", date: at(now, data.times.isha, -1) }, next: list[0] };
  }
  if (idx === list.length - 1) {
    // nach ^Ishâ: Fajr von morgen aus der "Nächstes Gebet"-Karte der Seite
    const fajr = data.next && data.next.key === "fajr" && data.next.min < data.times.dhuhr ? data.next.min : data.times.fajr;
    return { current: list[idx], next: { key: "fajr", date: at(now, fajr, 1) } };
  }
  return { current: list[idx], next: list[idx + 1] };
}

// ───────────────────────── Layout ─────────────────────────
const hhmm = (d) => {
  const df = new DateFormatter();
  df.dateFormat = "HH:mm";
  return df.string(d);
};

function baseWidget() {
  const w = new ListWidget();
  const g = new LinearGradient();
  g.colors = [C.bgTop, C.bgBottom];
  g.locations = [0, 1];
  g.startPoint = new Point(0, 0);
  g.endPoint = new Point(1, 1);
  w.backgroundGradient = g;
  w.setPadding(10, 10, 10, 10);
  w.url = SOURCE_URL;
  return w;
}

function addText(stack, str, font, color) {
  const t = stack.addText(str);
  t.font = font;
  t.textColor = color;
  t.lineLimit = 1;
  t.minimumScaleFactor = 0.6;
  return t;
}

function addCard(parent, { label, item, endsAt, highlight }) {
  const card = parent.addStack();
  card.layoutVertically();
  card.cornerRadius = 20;
  card.setPadding(11, 12, 11, 12);
  card.backgroundColor = highlight ? C.cardHi : C.card;

  addText(card, label, Font.semiboldSystemFont(9), C.faint);
  card.addSpacer(3);
  addText(card, NAMES[item.key], Font.semiboldRoundedSystemFont(16), C.text);
  addText(card, hhmm(item.date), Font.boldRoundedSystemFont(34), C.text);
  card.addSpacer();

  const footer = card.addStack();
  footer.centerAlignContent();
  if (endsAt) {
    addText(footer, `Endet · ${hhmm(endsAt)} Uhr`, Font.mediumSystemFont(11), C.sub);
  } else {
    addText(footer, "in ", Font.mediumSystemFont(11), C.sub);
    const d = footer.addDate(item.date);
    d.applyTimerStyle();
    d.font = Font.mediumSystemFont(11);
    d.textColor = C.sub;
  }
  footer.addSpacer();
  return card;
}

function errorWidget() {
  const w = baseWidget();
  w.addSpacer();
  const t = addText(w, "Gebetszeiten", Font.semiboldRoundedSystemFont(15), C.text);
  t.centerAlignText();
  w.addSpacer(4);
  const s = w.addText("Seite gerade nicht erreichbar");
  s.font = Font.mediumSystemFont(11);
  s.textColor = C.sub;
  s.centerAlignText();
  w.addSpacer();
  w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);
  return w;
}

async function buildWidget() {
  const now = new Date();
  const data = await fetchData(now);
  if (!data) return errorWidget();

  const { current, next } = getState(data, now);
  const w = baseWidget();

  if (config.widgetFamily === "small") {
    addCard(w, { label: "NÄCHSTES GEBET", item: next });
  } else {
    const row = w.addStack();
    row.layoutHorizontally();
    addCard(row, { label: "AKTUELLES GEBET", item: current, endsAt: next.date, highlight: true });
    row.addSpacer(8);
    addCard(row, { label: "NÄCHSTES GEBET", item: next });
  }

  w.refreshAfterDate = new Date(next.date.getTime() + 30 * 1000);
  return w;
}

// ───────────────────────── Start ─────────────────────────
const widget = await buildWidget();
if (config.runsInWidget) {
  Script.setWidget(widget);
} else {
  await widget.presentMedium();
  // Hilfe zur Fehlersuche: Wenn nichts gelesen werden konnte, Seitentext anzeigen
  if (!readCache() && lastRawText) await QuickLook.present(lastRawText.replace(/\s+/g, " ").slice(0, 4000));
}
Script.complete();
