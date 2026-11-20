// Diagnose 2: liest den Code der Gebetszeiten-App (Plugin "gebetszeiten-asz")
// und sucht die Adresse, von der die Zeiten geladen werden.
const BASE = "https://www.islamsalzgitter.de/wp-admin/admin-ajax.php";
const out = [];

async function get(url) {
  const r = new Request(url);
  r.timeoutInterval = 20;
  r.headers = { "X-Requested-With": "XMLHttpRequest", "Referer": "https://www.islamsalzgitter.de/gebetszeiten/" };
  const body = await r.loadString();
  return { status: r.response.statusCode, type: (r.response.headers || {})["Content-Type"] || "", body };
}

let js = "";
try {
  const res = await get(BASE + "?action=ptcms_app");
  js = res.body;
  out.push(`APP: Status ${res.status}, ${res.type}, ${js.length} Zeichen`);
} catch (e) {
  out.push("APP FEHLER: " + e);
}

const uniq = (arr) => [...new Set(arr)];
out.push("ACTIONS:\n" + uniq([...js.matchAll(/action["']?\s*[:=]\s*["'`]?([a-z0-9_]+)/gi)].map((m) => m[1])).join("\n"));
out.push("PTCMS-NAMEN:\n" + uniq([...js.matchAll(/ptcms_[a-z0-9_]+/gi)].map((m) => m[0])).join("\n"));
out.push("URLS:\n" + uniq([...js.matchAll(/["'`]((?:https?:)?\/\/[^"'`\s]+|\/wp-[^"'`\s]+|[^"'`\s]*\.json[^"'`\s]*)["'`]/gi)].map((m) => m[1])).join("\n"));

const snippets = [];
for (const m of js.matchAll(/fetch\s*\(|\$\.(?:ajax|get|post|getJSON)\s*\(|XMLHttpRequest|admin-ajax|wp-json/g)) {
  snippets.push(js.slice(Math.max(0, m.index - 200), m.index + 400).replace(/\s+/g, " "));
  if (snippets.length >= 8) break;
}
out.push("AUFRUFE IM CODE:\n" + snippets.join("\n---\n"));
out.push("CODE ANFANG:\n" + js.slice(0, 1500).replace(/\s+/g, " "));

// Gefundene Actions direkt ausprobieren
const actions = uniq([...js.matchAll(/ptcms_[a-z0-9_]+/gi)].map((m) => m[0])).filter((a) => !/app$|manifest$/.test(a)).slice(0, 8);
for (const a of actions) {
  try {
    const res = await get(`${BASE}?action=${a}`);
    out.push(`TEST ${a}: Status ${res.status}, ${res.type}\n${res.body.slice(0, 600).replace(/\s+/g, " ")}`);
  } catch (e) {
    out.push(`TEST ${a}: FEHLER ${e}`);
  }
}

const report = out.join("\n\n────────\n\n");
Pasteboard.copy(report);
const a = new Alert();
a.title = "Diagnose 2 kopiert";
a.message = "Bericht ist in der Zwischenablage – bitte im Chat einfügen.";
a.addAction("OK");
await a.present();
await QuickLook.present(report);
Script.complete();
