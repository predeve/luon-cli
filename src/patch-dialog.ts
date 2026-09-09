import { openView, controlView } from "@luon/webview";
import { join } from "node:path";
import { rm } from "node:fs/promises";
import patchIcon from "./patch.svg" with { type: "file" };
import { noticeHidden, patchLock, patchRoot, writeState } from "./patch-state";

const escape = (value: string) => value.replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[char]!));
export const patchStyle = `
:root{color-scheme:dark;font:14px system-ui;color:#eee;background:#18181b}
*{box-sizing:border-box}body{margin:0;padding:24px;
display:flex;flex-direction:column}h1{font-size:21px;margin:0 0 12px}
p{margin:0;color:#aaa;line-height:1.6;white-space:pre-line}
footer{padding-top:24px}.actions{display:flex;
justify-content:center;align-items:stretch;gap:8px}
button{font:inherit;border:0;border-radius:8px;cursor:pointer}
#update,#later{background:#8cb9ff;color:#111;padding:14px 0;
font-size:16px;font-weight:700;letter-spacing:.04em}
#update{width:128px}#later{padding-inline:16px;background:#f3ae69}
#update:hover{background:#b0ceff}#later:hover{background:#ffc58b}
#update:active{background:#72a6f5}#later:active{background:#e49b51}
label{display:flex;gap:8px;align-items:center;margin-top:20px;
color:#bbb;font-size:12px;cursor:pointer}input{accent-color:#8cb9ff}
small{display:block;color:#888;margin-top:10px;font-size:11px}
button:focus-visible,input:focus-visible{outline:2px solid #8cb9ff;
outline-offset:3px}
`;

export function patchPage(title: string, detail: string, token: string,
  automatic = false) {
  return `<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer"><title>Luon update</title>
<style>${patchStyle}</style><body><h1>${escape(title)}</h1><p>${escape(detail)}</p>
<footer><div class="actions"><button id="update">UPDATE</button>
<button id="later">Later</button></div>
<label><input id="snooze" type="checkbox">Do not show for 24 hours</label>
<label style="margin-top:10px"><input id="automatic" type="checkbox"
${automatic ? "checked" : ""}>Automatically update Luon</label>
<p id="error" role="alert" style="color:#f3ae69;font-size:12px"></p>
<small>This window closes in <span id="seconds">60</span> seconds.</small>
</footer>
<script>
let seconds=60;let sent=false;
async function choose(action){if(sent)return;sent=true;try{
const response=await fetch('/${token}/choose',{method:'POST',headers:{
'content-type':'application/json'},body:JSON.stringify({action,
snooze:document.getElementById('snooze').checked,
automatic:document.getElementById('automatic').checked})});
if(!response.ok)throw new Error((await response.json()).message);
}catch(error){sent=false;document.getElementById('error').textContent=
error.message||'Could not save settings.';}}
document.getElementById('later').onclick=()=>choose('later');
document.getElementById('update').onclick=()=>choose('update');
setInterval(()=>{seconds--;document.getElementById('seconds').textContent=seconds;
if(seconds<=0)choose('later');},1000);
</script></body></html>`;
}

export async function offerPatch(scope: string, title: string, detail: string,
  options: { manual?: boolean } = {}) {
  const key = new Bun.CryptoHasher("sha256").update(scope).digest("hex");
  const file = join(patchRoot, `notice-${key}.json`);
  if (!options.manual && await noticeHidden(file)) return false;
  const unlock = await patchLock("notice");
  if (!unlock) return false;
  let server: ReturnType<typeof Bun.serve> | undefined;
  let child: Awaited<ReturnType<typeof openView>> | undefined;
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const { readAuto, saveAuto } = await import("./auto-update");
  const automatic = await readAuto();
  const token = crypto.randomUUID();
  const result = Promise.withResolvers<{ update: boolean; snooze: boolean }>();
  try {
    if (!options.manual && await noticeHidden(file)) return false;
    for (let port = 6100; port <= 6999; port++) {
      try {
        server = Bun.serve({ hostname: "127.0.0.1", port,
          async fetch(request) {
            const url = new URL(request.url);
            if (request.method === "POST" && url.pathname === `/${token}/choose`
              && request.headers.get("origin") === url.origin) {
              const body = await request.json().catch(() => ({}));
              if (!["later", "update"].includes(body.action)) {
                return new Response(null, { status: 400 });
              }
              if (typeof body.automatic === "boolean"
                && body.automatic !== automatic.active) {
                try {
                  await saveAuto({ ...await readAuto(), active: body.automatic });
                } catch (error) {
                  return Response.json({ message: String(error) }, { status: 500 });
                }
              }
              result.resolve({ update: body.action === "update",
                snooze: body.snooze === true });
              return Response.json({ ok: true });
            }
            if (request.method !== "GET" || url.pathname !== `/${token}/`) {
              return new Response(null, { status: 404 });
            }
            return new Response(patchPage(title, detail, token, automatic.active), { headers: {
              "content-type": "text/html", "cache-control": "no-store",
              "content-security-policy": "default-src 'none'; "
                + "script-src 'unsafe-inline'; style-src 'unsafe-inline'; "
                + "connect-src 'self'; frame-ancestors 'none'",
            } });
          },
        });
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
      }
    }
    if (!server) return false;
    const { buildIcon } = await import("./icon");
    const icon = await buildIcon(patchIcon).catch((error) => {
      console.error("Update icon:", String(error));
      return undefined;
    });
    child = await openView({ url: `http://127.0.0.1:${server.port}/${token}/`,
      title: "Luon update", icon, width: 480, height: 292, minHeight: 240,
      resizable: false,
      close: "quit", mode: "dock", singleInstance: false });
    timer = setTimeout(() => result.resolve({ update: false, snooze: false }),
      60_000);
    const answer = await Promise.race([result.promise,
      child.exited.then(() => {
        closed = true;
        return { update: false, snooze: false };
      })]);
    if (!answer.update && answer.snooze) {
      await writeState(file, {
        until: Date.now() + 24 * 60 * 60 * 1000, snooze: true,
      });
    } else await rm(file, { force: true });
    return answer.update;
  } catch (error) {
    console.error("Update dialog:", String(error));
    return false;
  } finally {
    clearTimeout(timer);
    if (child && !closed) {
      try { controlView(child.pid, "close"); } catch {}
    }
    server?.stop(true);
    await unlock();
  }
}
