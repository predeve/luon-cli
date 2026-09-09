import { updateList, type UpdateApp } from "./update-list";
import { openView, controlView } from "@luon/webview";
import patchIcon from "./patch.svg" with { type: "file" };
import { patchStyle } from "./patch-dialog";
import { readAuto, saveAuto, type AutoConfig } from "./auto-update";

const escape = (s: string) => s.replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;").replaceAll('"', "&quot;");
const choices = (value = "default", local = false) => [
  ["default", local ? "Use global / app setting" : "Use app default"],
  ["next-launch", "Next launch only"], ["restart", "Scheduled restart"],
].map(([key, label]) => `<option value="${key}"
  ${value === key ? "selected" : ""}>${label}</option>`).join("");

export function autoPage(config: AutoConfig, token: string,
  apps: UpdateApp[] = []) {
  return `<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Automatic updates</title><style>${patchStyle}
body{overflow:auto} .app-row{border-top:1px solid #48484e;padding:12px 0}
.app-row small{display:block;color:#aaa} input[type=time],input[type=number]{
background:#25252b;color:#eee;border:1px solid #48484e;padding:8px;width:100px}
select{max-width:260px;font:inherit;color:#eee;background:#25252b;border:1px solid #48484e;
border-radius:8px;padding:8px 12px;margin-left:auto}
#status{font-size:12px;color:#f3ae69;margin-top:12px}
</style><body><h1>Automatic updates</h1>
<p>Download updates ahead of time. Restart only in the allowed local time window.</p>
<label><input id="active" type="checkbox" ${config.active ? "checked" : ""}>
Automatically update Luon</label>
<label>Check every<select id="hours">
${[1, 6, 24].map(h => `<option value="${h}" ${h === config.hours
  ? "selected" : ""}>${h} hour${h === 1 ? "" : "s"}</option>`).join("")}
</select></label>
<label><input id="apps" type="checkbox" ${config.apps ? "checked" : ""}>
Include installed apps</label>
<label>Apply updates<select id="apply">${choices(config.restart?.apply)}</select></label>
<label>Window starts (device time)<input id="at" type="time"
value="${config.restart?.at ?? "05:00"}"></label>
<label>Spread over (minutes)<input id="spread" type="number" min="1" max="240"
value="${config.restart?.spread ?? 30}"></label>
<p>Each device and app uses a different time. Busy apps wait for unlock;
missed windows wait until the next day. Downloads continue while locked.</p>
<details><summary>Per-app settings (${apps.length})</summary>
${apps.map(app => {
  const value = config.overrides?.[app.id];
  return `<section class="app-row" data-app="${escape(app.id)}">
<b>${escape(app.title)}</b><small>${escape(app.state)}</small>
<label>Apply<select class="apply">${choices(value?.apply, true)}</select></label>
<label>Start (blank = inherit)<input class="at" type="time"
value="${value?.at ?? ""}"></label>
<label>Minutes (blank = inherit)<input class="spread" type="number"
min="1" max="240" value="${value?.spread ?? ""}"></label></section>`;
}).join("")}</details>
<footer><div class="actions"><button id="update">Save</button>
<button id="later">Cancel</button></div></footer>
<p id="status" role="alert"></p><script>
const overrides=${JSON.stringify(config.overrides ?? {}).replaceAll('<', '\\u003c')};
const save=document.getElementById('update');
save.onclick=async()=>{save.disabled=true;try{
for(const row of document.querySelectorAll('[data-app]')){
const at=row.querySelector('.at').value;
const spread=row.querySelector('.spread').value;
overrides[row.dataset.app]={apply:row.querySelector('.apply').value,
...(at?{at}:{}),...(spread?{spread:Number(spread)}:{})};
}
const response=await fetch('/${token}/save',{method:'POST',
headers:{'content-type':'application/json'},body:JSON.stringify({
active:document.getElementById('active').checked,
apps:document.getElementById('apps').checked,
hours:Number(document.getElementById('hours').value),overrides,
restart:{apply:document.getElementById('apply').value,
at:document.getElementById('at').value,
spread:Number(document.getElementById('spread').value)}})});
if(!response.ok)throw new Error((await response.json()).message);
}catch(error){document.getElementById('status').textContent=error.message;
save.disabled=false;}};
document.getElementById('later').onclick=()=>fetch('/${token}/close',{
method:'POST'});
</script></body></html>`;
}

export async function openAuto() {
  const token = crypto.randomUUID();
  let server: ReturnType<typeof Bun.serve> | undefined;
  let child: Awaited<ReturnType<typeof openView>> | undefined;
  const closed = Promise.withResolvers<void>();
  try {
    for (let port = 6100; port <= 6999; port++) {
      try {
        server = Bun.serve({ hostname: "127.0.0.1", port,
          async fetch(request) {
            const url = new URL(request.url);
            if (request.method === "GET" && url.pathname === `/${token}/`) {
              return new Response(autoPage(await readAuto(), token, await updateList()), { headers: {
                "content-type": "text/html", "cache-control": "no-store",
                "content-security-policy": "default-src 'none'; "
                  + "style-src 'unsafe-inline'; script-src 'unsafe-inline'; "
                  + "connect-src 'self'; frame-ancestors 'none'",
              } });
            }
            if (request.method !== "POST"
              || request.headers.get("origin") !== url.origin) {
              return new Response(null, { status: 403 });
            }
            if (url.pathname === `/${token}/save`) {
              try { await saveAuto(await request.json()); }
              catch (error) {
                return Response.json({ message: String(error) }, { status: 400 });
              }
            } else if (url.pathname !== `/${token}/close`) {
              return new Response(null, { status: 404 });
            }
            closed.resolve();
            return Response.json({ ok: true });
          },
        });
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
      }
    }
    if (!server) throw new Error("No free port for update settings.");
    const { buildIcon } = await import("./icon");
    child = await openView({ title: "Automatic updates",
      url: `http://127.0.0.1:${server.port}/${token}/`,
      icon: await buildIcon(patchIcon).catch(() => undefined),
      width: 620, height: 740, resizable: true, close: "quit",
      mode: "dock", singleInstance: false });
    await Promise.race([closed.promise, child.exited]);
  } finally {
    if (child) { try { controlView(child.pid, "close"); } catch {} }
    server?.stop(true);
  }
}
