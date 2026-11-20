// Gebetszeiten-Widget für Scriptable (iOS)
// Holt die Zeiten ausschließlich von islamsalzgitter.de (Gebetszeiten-App der Moschee)
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

// ───────────────────────── Daten von der Moschee ─────────────────────────
// Die Gebetszeiten-App der Seite lädt ihre Zeiten von hier:
const DATA_URL = "https://www.islamsalzgitter.de/wp-admin/admin-ajax.php?action=ptcms_load";
// Format: base["MM-DD"] = [Fajr, Shurûq, Dhuhr, ^Asr, Maghrib, ^Ishâ] in Minuten ab 00:00

const fm = FileManager.local();
const cachePath = fm.joinPath(fm.documentsDirectory(), "gebetszeiten-asz.json");
const MAX_AGE = 24 * 60 * 60 * 1000; // einmal täglich neu laden

function readCache() {
  try { return fm.fileExists(cachePath) ? JSON.parse(fm.readString(cachePath)) : null; }
  catch (e) { return null; }
}

async function loadData() {
  const cache = readCache();
  if (cache && Date.now() - cache.savedAt < MAX_AGE) return cache.data;
  try {
    const req = new Request(DATA_URL);
    req.timeoutInterval = 20;
    const j = await req.loadJSON();
    if (j && j.success && j.data && j.data.base) {
      fm.writeString(cachePath, JSON.stringify({ savedAt: Date.now(), data: j.data }));
      return j.data;
    }
  } catch (e) { /* offline → letzter Stand */ }
  return cache ? cache.data : null; // ganzes Jahr ist zwischengespeichert
}

const pad = (n) => String(n).padStart(2, "0");
const isDay = (k) => /^\d{4}-\d{2}-\d{2}$/.test(k);
const valid = (v) => Array.isArray(v) && v.length >= 6 && v.slice(0, 6).every((x) => typeof x === "number");

// Falls die App Sonderzeiten für einzelne Tage (JJJJ-MM-TT) speichert, haben die Vorrang
function overrideFor(data, d) {
  const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  for (const v of Object.values(data)) {
    if (v && typeof v === "object" && !Array.isArray(v) && valid(v[key]) && Object.keys(v).some(isDay)) return v[key];
  }
  return null;
}

// Sommerzeit: Enthalten die Tabellenwerte sie nicht schon, wird +60 Min. gerechnet
function dstShift(data, d) {
  const b = data.base;
  const tableHasDst = b["07-01"] && b["01-01"] && b["07-01"][2] - b["01-01"][2] > 30;
  if (tableHasDst) return 0;
  const jan = new Date(d.getFullYear(), 0, 1).getTimezoneOffset();
  return d.getTimezoneOffset() < jan ? 60 : 0;
}

function timesFor(data, d) {
  const ov = overrideFor(data, d);
  if (ov) return ov.slice(0, 6);
  let v = data.base[`${pad(d.getMonth() + 1)}-${pad(d.getDate())}`];
  if (!valid(v)) v = data.base["02-28"]; // 29. Februar ohne Eintrag
  const shift = dstShift(data, d);
  return v.slice(0, 6).map((x) => x + shift);
}

// ───────────────────────── Aktuelles / nächstes Gebet ─────────────────────────
function at(base, minutes, dayShift = 0) {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + dayShift);
  d.setMinutes(minutes);
  return d;
}

function getState(data, now) {
  const dayOffset = (n) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + n, 12);
  const today = timesFor(data, now);
  const list = ORDER.map((k, i) => ({ key: k, date: at(now, today[i]) }));
  let idx = -1;
  for (let i = 0; i < list.length; i++) if (list[i].date <= now) idx = i;

  if (idx === -1) {
    // nach Mitternacht vor Fajr: ^Ishâ von gestern läuft noch
    return { current: { key: "isha", date: at(now, timesFor(data, dayOffset(-1))[5], -1) }, next: list[0] };
  }
  if (idx === list.length - 1) {
    return { current: list[idx], next: { key: "fajr", date: at(now, timesFor(data, dayOffset(1))[0], 1) } };
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
  const data = await loadData();
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
}
Script.complete();
