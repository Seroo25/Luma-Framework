// Gebetszeiten-Widget für Scriptable (iOS)
// Holt die Zeiten ausschließlich von islamsalzgitter.de (Gebetszeiten-App der Moschee)
// und zeigt "Aktuelles Gebet" + "Nächstes Gebet" im Liquid-Glass-Stil.
//
// Installation:
//   1. App "Scriptable" aus dem App Store laden (kostenlos).
//   2. Neues Script anlegen, diesen Code einfügen, "Gebetszeiten" nennen.
//   3. Homescreen lang drücken → "+" → Scriptable → Größe wählen:
//      Klein  = eine einzelne Kachel (Widget IST die Kachel, kein Rahmen drumherum).
//               Welche Kachel, legst du unter "Widget bearbeiten" → "Parameter" fest:
//               aktuell  → Aktuelles Gebet
//               nächstes → Nächstes Gebet (Standard, wenn leer)
//               datum    → Datum + islamisches Datum
//               Zwei kleine Widgets nebeneinander = die zwei Kacheln wie auf der Website.
//      Mittel = Datum + aktuelles & nächstes Gebet
//      Groß   = Datum + beide Karten + alle Gebetszeiten des Tages
//      Sperrbildschirm: Sperrbildschirm lang drücken → "Anpassen" → Sperrbildschirm
//               → Widget-Feld antippen → Scriptable → "rechteckig" (aktuelles + nächstes
//               Gebet mit Countdown) oder "rund" (nächstes Gebet); über der Uhr = eine Zeile.
//               Danach das Widget antippen und als Script "Gebetszeiten" wählen.
//   4. Widget lang drücken → "Widget bearbeiten" → Script: "Gebetszeiten".
//   Durchsichtiges Glas: Homescreen lang drücken → "Bearbeiten" → "Anpassen"
//   → Stil "Klar". Dann legt iOS echtes Liquid Glass hinter das Widget und
//   passt es automatisch an den Hintergrund an (wie bei den App-Symbolen).
//   In der Vorschau in der Scriptable-App sieht man das Glas nicht.

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

// Islamisches Datum: ±1 Tag Korrektur, falls die Moschee abweicht
const HIJRI_OFFSET = 0;

// Datumszeile oben anzeigen? (false = nur die Kacheln, sie füllen dann das ganze Widget)
const SHOW_HEADER = true;

// Liquid Glass: nur Weiß in verschiedenen Deckkräften.
// Im Homescreen-Stil "Klar" ersetzt iOS den Hintergrund durch echtes Glas.
const C = {
  bg: new Color("#000000", 0.18),
  cardHi: new Color("#ffffff", 0.22),
  card: new Color("#ffffff", 0.1),
  rowHi: new Color("#ffffff", 0.16),
  text: new Color("#ffffff", 1),
  sub: new Color("#ffffff", 0.75),
  faint: new Color("#ffffff", 0.55),
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

// ───────────────────────── Datum ─────────────────────────
const HIJRI_MONTHS = [
  "Muharram", "Safar", "Rabî^ al-Awwal", "Rabî^ ath-Thânî", "Jumâdâ al-Ûlâ", "Jumâdâ al-Âkhira",
  "Rajab", "Sha^bân", "Ramadân", "Shawwâl", "Dhû l-Qa^da", "Dhû l-Hijja",
];

function hijriParts(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate() + HIJRI_OFFSET, 12);
  try {
    const parts = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura", { day: "numeric", month: "numeric", year: "numeric" }).formatToParts(d);
    const get = (t) => Number(parts.find((p) => p.type === t).value);
    if (get("year") > 1400) return { day: get("day"), month: get("month"), year: get("year") };
  } catch (e) { /* Fallback unten */ }
  // Tabellarischer islamischer Kalender (falls Intl fehlt)
  const jd = Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5 + 2440588) + 1;
  let l = jd - 1948440 + 10632;
  const n = Math.floor((l - 1) / 10631);
  l = l - 10631 * n + 354;
  const j = Math.floor((10985 - l) / 5316) * Math.floor((50 * l) / 17719) + Math.floor(l / 5670) * Math.floor((43 * l) / 15238);
  l = l - Math.floor((30 - j) / 15) * Math.floor((17719 * j) / 50) - Math.floor(j / 16) * Math.floor((15238 * j) / 43) + 29;
  const month = Math.floor((24 * l) / 709);
  return { day: l - Math.floor((709 * month) / 24), month, year: 30 * n + j - 30 };
}

function hijriText(date) {
  const h = hijriParts(date);
  return `Tag von ${h.day}. ${HIJRI_MONTHS[h.month - 1]} ${h.year}`;
}

function dateText(date, format) {
  const df = new DateFormatter();
  df.locale = "de_DE";
  df.dateFormat = format;
  return df.string(date);
}

// ───────────────────────── Layout ─────────────────────────
const hhmm = (d) => dateText(d, "HH:mm");

// Schriftgrößen je Widget-Größe
const SIZES = {
  small:  { pad: 12, date: 12, hijri: 9,  label: 8, name: 14, time: 30, foot: 10, cardPad: 10, radius: 14, gap: 8 },
  medium: { pad: 12, date: 14, hijri: 10, label: 8, name: 15, time: 30, foot: 10, cardPad: 10, radius: 14, gap: 8 },
  large:  { pad: 16, date: 18, hijri: 12, label: 9, name: 17, time: 34, foot: 11, cardPad: 12, radius: 22, gap: 10 },
};

function baseWidget(S) {
  const w = new ListWidget();
  w.backgroundColor = C.bg;
  w.setPadding(S.pad, S.pad, S.pad, S.pad);
  w.url = SOURCE_URL;
  return w;
}

function addText(stack, str, font, color, scale = 0.6) {
  const t = stack.addText(str);
  t.font = font;
  t.textColor = color;
  t.lineLimit = 1;
  t.minimumScaleFactor = scale;
  return t;
}

function addHeader(w, S, now, family) {
  const head = w.addStack();
  head.layoutVertically();
  const row1 = head.addStack();
  row1.addSpacer();
  addText(row1, dateText(now, family === "small" ? "EEEE, d. MMM" : "EEEE, d. MMMM yyyy"), Font.boldRoundedSystemFont(S.date), C.text);
  row1.addSpacer();
  head.addSpacer(1);
  const row2 = head.addStack();
  row2.addSpacer();
  addText(row2, hijriText(now), Font.mediumSystemFont(S.hijri), C.sub);
  row2.addSpacer();
}

function addCard(parent, S, { label, item, endsAt, highlight }) {
  const card = parent.addStack();
  card.layoutVertically();
  card.cornerRadius = S.radius;
  card.setPadding(S.cardPad, S.cardPad + 2, S.cardPad, S.cardPad + 2);
  card.backgroundColor = highlight ? C.cardHi : C.card;

  const top = card.addStack();
  addText(top, label, Font.semiboldSystemFont(S.label), highlight ? C.sub : C.faint);
  top.addSpacer();
  card.addSpacer(); // Label oben, Rest unten – Kachel füllt die Höhe
  addText(card, NAMES[item.key], Font.semiboldRoundedSystemFont(S.name), C.text);
  addText(card, hhmm(item.date), Font.boldRoundedSystemFont(S.time), C.text);
  card.addSpacer(1);

  const footer = card.addStack();
  footer.centerAlignContent();
  if (endsAt) {
    addText(footer, `Endet · ${hhmm(endsAt)} Uhr`, Font.mediumSystemFont(S.foot), C.sub);
  } else {
    addText(footer, "in ", Font.mediumSystemFont(S.foot), C.sub);
    const d = footer.addDate(item.date);
    d.applyRelativeStyle(); // "in 1 Std., 32 Min."
    d.font = Font.mediumSystemFont(S.foot);
    d.textColor = C.sub;
    d.lineLimit = 1;
  }
  footer.addSpacer();
  return card;
}

function addDayList(w, S, data, now, current) {
  const today = timesFor(data, now);
  const list = w.addStack();
  list.layoutVertically();
  list.cornerRadius = S.radius;
  list.backgroundColor = C.card;
  list.setPadding(6, 6, 6, 6);
  ORDER.forEach((k, i) => {
    const active = current.key === k && current.date.getDate() === now.getDate();
    const row = list.addStack();
    row.setPadding(5, 10, 5, 10);
    row.cornerRadius = 10;
    row.centerAlignContent();
    if (active) row.backgroundColor = C.rowHi;
    const font = active ? Font.semiboldRoundedSystemFont(15) : Font.mediumRoundedSystemFont(15);
    addText(row, NAMES[k], font, active ? C.text : C.sub);
    row.addSpacer();
    addText(row, hhmm(at(now, today[i])), font, active ? C.text : C.sub);
  });
}

function errorWidget(S) {
  const w = baseWidget(S);
  w.addSpacer();
  const t = addText(w, "Gebetszeiten", Font.semiboldRoundedSystemFont(15), C.text);
  t.centerAlignText();
  w.addSpacer(4);
  const s = w.addText("Daten gerade nicht erreichbar");
  s.font = Font.mediumSystemFont(11);
  s.textColor = C.sub;
  s.centerAlignText();
  w.addSpacer();
  w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);
  return w;
}

let PARAM_OVERRIDE = null; // nur für die Vorschau in der App

// Kleines Widget = genau eine Kachel, randlos
function tileWidget(now, current, next) {
  const p = String(PARAM_OVERRIDE || args.widgetParameter || "").toLowerCase().trim();
  const mode = p.startsWith("akt") ? "current" : p.startsWith("dat") ? "date" : "next";
  const w = new ListWidget();
  w.backgroundColor = mode === "current" ? C.cardHi : C.card;
  w.setPadding(16, 16, 16, 16);
  w.url = SOURCE_URL;

  if (mode === "date") {
    addText(w, dateText(now, "EEEE").toUpperCase(), Font.semiboldSystemFont(11), C.sub);
    w.addSpacer();
    addText(w, dateText(now, "d"), Font.boldRoundedSystemFont(46), C.text);
    addText(w, dateText(now, "MMMM yyyy"), Font.semiboldRoundedSystemFont(15), C.text);
    w.addSpacer(4);
    const h = hijriParts(now);
    addText(w, `${h.day}. ${HIJRI_MONTHS[h.month - 1]} ${h.year}`, Font.mediumSystemFont(11), C.sub, 0.5);
  } else {
    const item = mode === "current" ? current : next;
    addText(w, mode === "current" ? "AKTUELLES GEBET" : "NÄCHSTES GEBET", Font.semiboldSystemFont(11), C.sub);
    w.addSpacer();
    addText(w, NAMES[item.key], Font.semiboldRoundedSystemFont(20), C.text);
    addText(w, hhmm(item.date), Font.boldRoundedSystemFont(44), C.text);
    w.addSpacer(2);
    if (mode === "current") {
      addText(w, `Endet · ${hhmm(next.date)} Uhr`, Font.mediumSystemFont(13), C.sub);
    } else {
      const r = w.addStack();
      const pre = r.addText("in ");
      pre.font = Font.mediumSystemFont(13);
      pre.textColor = C.sub;
      const d = r.addDate(item.date);
      d.applyRelativeStyle();
      d.font = Font.mediumSystemFont(13);
      d.textColor = C.sub;
      d.lineLimit = 1;
      d.minimumScaleFactor = 0.6;
    }
  }
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 30);
  w.refreshAfterDate = new Date(Math.min(next.date.getTime() + 30 * 1000, midnight.getTime()));
  return w;
}

// ───────────────────────── Sperrbildschirm ─────────────────────────
// iOS färbt Sperrbildschirm-Widgets selbst ein, daher nur Schrift (keine Farben/Kacheln).
function accessoryWidget(family, data, now) {
  const w = new ListWidget();
  w.url = SOURCE_URL;
  if (!data) {
    w.addText("Gebetszeiten –");
    return w;
  }
  const { current, next } = getState(data, now);
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 30);
  w.refreshAfterDate = new Date(Math.min(next.date.getTime() + 30 * 1000, midnight.getTime()));

  if (family === "accessoryInline") {
    // Zeile über der Uhr: "^Ishâ 18:05"
    w.addText(`${NAMES[next.key]} ${hhmm(next.date)}`);
    return w;
  }

  if (family === "accessoryCircular") {
    w.addAccessoryWidgetBackground = true;
    w.setPadding(0, 0, 0, 0);
    const col = w.addStack();
    col.layoutVertically();
    const r1 = col.addStack(); r1.addSpacer();
    addText(r1, NAMES[next.key], Font.semiboldRoundedSystemFont(11), C.sub, 0.5); r1.addSpacer();
    const r2 = col.addStack(); r2.addSpacer();
    addText(r2, hhmm(next.date), Font.boldRoundedSystemFont(16), C.text, 0.5); r2.addSpacer();
    return w;
  }

  // accessoryRectangular (breit, 2 Felder)
  w.setPadding(0, 0, 0, 0);
  addText(w, `${NAMES[current.key]} · endet ${hhmm(next.date)}`, Font.mediumSystemFont(12), C.sub, 0.7);
  addText(w, `${NAMES[next.key]}  ${hhmm(next.date)}`, Font.boldRoundedSystemFont(19), C.text, 0.7);
  const r = w.addStack();
  const pre = r.addText("in ");
  pre.font = Font.mediumSystemFont(12);
  pre.textColor = C.sub;
  const d = r.addDate(next.date);
  d.applyRelativeStyle();
  d.font = Font.mediumSystemFont(12);
  d.textColor = C.sub;
  d.lineLimit = 1;
  return w;
}

async function buildWidget(family) {
  const S = SIZES[family] || SIZES.medium;
  const now = new Date();
  const data = await loadData();
  if (String(family).startsWith("accessory")) return accessoryWidget(family, data, now);
  if (!data) return errorWidget(S);

  const { current, next } = getState(data, now);
  const w = baseWidget(S);

  if (SHOW_HEADER) {
    addHeader(w, S, now, family);
    w.addSpacer(S.gap);
  }

  if (family === "small") {
    return tileWidget(now, current, next);
  } else {
    const row = w.addStack();
    row.layoutHorizontally();
    addCard(row, S, { label: "AKTUELLES GEBET", item: current, endsAt: next.date, highlight: true });
    row.addSpacer(S.gap);
    addCard(row, S, { label: "NÄCHSTES GEBET", item: next });
    if (family === "large") {
      w.addSpacer(S.gap);
      addDayList(w, S, data, now, current);
    }
  }

  // Nach dem nächsten Gebet bzw. um Mitternacht (neues Datum) neu laden
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 30);
  w.refreshAfterDate = new Date(Math.min(next.date.getTime() + 30 * 1000, midnight.getTime()));
  return w;
}

// ───────────────────────── Start ─────────────────────────
if (config.runsInWidget) {
  Script.setWidget(await buildWidget(config.widgetFamily));
} else {
  // Vorschau in der App: Größe auswählen
  const a = new Alert();
  a.title = "Vorschau";
  ["Klein", "Mittel", "Groß", "Klein · aktuell", "Klein · datum", "Sperrbildschirm · rechteckig", "Sperrbildschirm · rund", "Sperrbildschirm · Zeile"].forEach((t) => a.addAction(t));
  a.addCancelAction("Abbrechen");
  const i = await a.presentSheet();
  if (i === 0) await (await buildWidget("small")).presentSmall();
  if (i === 1) await (await buildWidget("medium")).presentMedium();
  if (i === 2) await (await buildWidget("large")).presentLarge();
  if (i === 3) { PARAM_OVERRIDE = "aktuell"; await (await buildWidget("small")).presentSmall(); }
  if (i === 4) { PARAM_OVERRIDE = "datum"; await (await buildWidget("small")).presentSmall(); }
  if (i === 5) await (await buildWidget("accessoryRectangular")).presentAccessoryRectangular();
  if (i === 6) await (await buildWidget("accessoryCircular")).presentAccessoryCircular();
  if (i === 7) await (await buildWidget("accessoryInline")).presentAccessoryInline();
}
Script.complete();
