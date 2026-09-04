import { controlView, openView } from "@luon/webview";

export type Notice = {
  button?: string;
  message: string;
  title: string;
  tone?: "error" | "warning";
};

type PasswordResult<T> = {
  value?: T;
};

const toastTime = 4_500;

function html(value: string) {
  return value.replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function page(input: Notice, close: string) {
  const color = input.tone === "warning" ? "#f59e0b" : "#ef4444";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${html(input.title)}</title>
<style>
:root{color-scheme:dark;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif}
*{box-sizing:border-box}body{display:grid;min-height:100vh;margin:0;padding:28px;
place-items:center;background:#0b111b;color:#f8fafc}.card{width:100%;max-width:390px}
.mark{display:grid;width:42px;height:42px;margin-bottom:18px;border-radius:13px;
place-items:center;background:${color}22;color:${color};font-size:24px;font-weight:800}
h1{margin:0 0 10px;font-size:20px;line-height:1.35}p{margin:0;color:#aab6c5;
font-size:14px;line-height:1.65;white-space:pre-line}footer{display:flex;
justify-content:flex-end;margin-top:26px}button{min-width:92px;padding:10px 18px;
border:0;border-radius:10px;background:#e8eef7;color:#101722;font:inherit;
font-weight:700;cursor:pointer}button:focus-visible{outline:3px solid ${color}66}
</style>
</head>
<body><main class="card"><div class="mark">!</div><h1>${html(input.title)}</h1>
<p>${html(input.message)}</p><footer><button id="close" autofocus>
${html(input.button || "OK")}</button></footer></main>
<script>document.getElementById("close").onclick=async()=>{
  await fetch(${JSON.stringify(close)},{method:"POST"});
};</script></body></html>`;
}

function passwordPage(title: string, unlock: string, pin = false) {
  const label = pin ? "PIN" : "Password";
  const detail = pin
    ? "This .luon file has a 1 to 8 digit sharing PIN."
    : "This legacy .luon file is password protected.";
  const input = pin
    ? 'inputmode="numeric" pattern="[0-9]*" maxlength="8"'
    : 'maxlength="64"';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${html(title)}</title>
<style>
:root{color-scheme:dark;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif}
*{box-sizing:border-box}body{display:grid;min-height:100vh;margin:0;padding:28px;
place-items:center;background:#0b111b;color:#f8fafc}.card{width:100%;max-width:390px}
.mark{display:grid;width:42px;height:42px;margin-bottom:18px;border-radius:13px;
place-items:center;background:#f59e0b22;color:#f59e0b;position:relative}
.mark:before{position:absolute;width:13px;height:11px;border:2px solid #f59e0b;
border-bottom:0;border-radius:8px 8px 0 0;content:"";transform:translateY(-6px)}
.mark:after{position:absolute;width:20px;height:16px;border-radius:5px;
background:#f59e0b;content:"";transform:translateY(5px)}
h1{margin:0 0 7px;font-size:20px;line-height:1.35}p{margin:0 0 20px;color:#aab6c5;
font-size:13px;line-height:1.55}form{display:grid;gap:12px}input{width:100%;height:43px;
padding:0 12px;color:#f8fafc;border:1px solid #344153;border-radius:10px;
outline:0;background:#080d15;font:inherit}input:focus{border-color:#f59e0b99;
box-shadow:0 0 0 3px #f59e0b12}.error{min-height:18px;margin:0;color:#fda4af;
font-size:12px}footer{display:flex;justify-content:flex-end}button{min-width:92px;
padding:10px 18px;border:0;border-radius:10px;background:#e8eef7;color:#101722;
font:inherit;font-weight:700;cursor:pointer}button:disabled{cursor:wait;opacity:.7}
</style>
</head>
<body><main class="card"><div class="mark"></div><h1>${html(title)}</h1>
<p>${detail}</p><form id="form">
<input id="password" type="password" autocomplete="current-password"
placeholder="${label}" minlength="1" ${input} autofocus required>
<p class="error" id="error"></p>
<footer><button id="unlock">Unlock</button></footer></form></main>
<script>document.getElementById("form").onsubmit=async event=>{
event.preventDefault();const button=document.getElementById("unlock");
const field=document.getElementById("password");
const error=document.getElementById("error");
button.disabled=true;error.textContent="";try{const response=await fetch(
${JSON.stringify(unlock)},{method:"POST",headers:{"content-type":"application/json"},
body:JSON.stringify({password:field.value})});const value=await response.json();
if(!value.ok){error.textContent=value.message||"Incorrect password.";
field.select();button.disabled=false}}catch{
error.textContent="Unable to unlock this file.";
button.disabled=false}};</script></body></html>`;
}

function toastPage(input: Notice) {
  const color = input.tone === "warning" ? "#f59e0b" : "#ef4444";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${html(input.title)}</title>
<style>
:root{color-scheme:dark;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif}
*{box-sizing:border-box}body{display:grid;min-height:100vh;margin:0;padding:22px;
place-items:center;background:#0b111b;color:#f8fafc}.card{display:grid;width:100%;
grid-template-columns:34px minmax(0,1fr);align-items:center;gap:14px}.mark{display:grid;
width:34px;height:34px;border-radius:10px;place-items:center;background:${color}22;
color:${color};font-size:20px;font-weight:800}h1{margin:0 0 5px;font-size:15px;
line-height:1.35}p{margin:0;color:#aab6c5;font-size:12px;line-height:1.55;
white-space:pre-line}.bar{position:fixed;right:0;bottom:0;left:0;height:3px;
background:${color};transform-origin:left;animation:close ${toastTime}ms linear forwards}
@keyframes close{to{transform:scaleX(0)}}
</style>
</head>
<body><main class="card"><div class="mark">!</div><div>
<h1>${html(input.title)}</h1><p>${html(input.message)}</p></div></main>
<div class="bar"></div></body></html>`;
}

export async function showNotice(input: Notice) {
  const token = crypto.randomUUID();
  let dismissed = false;
  let done = () => {};
  const closed = new Promise<void>((resolve) => {
    done = resolve;
  });
  const server = Bun.serve({
    fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === `/${token}/close` && request.method === "POST") {
        dismissed = true;
        done();
        return Response.json({ ok: true });
      }
      if (url.pathname !== `/${token}/`) {
        return new Response("Not found", { status: 404 });
      }
      return new Response(page(input, `/${token}/close`), {
        headers: {
          "cache-control": "no-store",
          "content-type": "text/html; charset=utf-8",
        },
      });
    },
    hostname: "127.0.0.1",
    port: 0,
  });
  try {
    const child = await openView({
      alwaysOnTop: true,
      close: "quit",
      height: 320,
      maxHeight: 320,
      maxWidth: 460,
      minHeight: 320,
      minWidth: 460,
      resizable: false,
      title: "Luon",
      url: `http://127.0.0.1:${server.port}/${token}/`,
      width: 460,
    });
    await Promise.race([closed, child.exited]);
    if (dismissed) {
      controlView(child.pid, "close");
      await child.exited;
    }
  } catch {
    console.error(`${input.title}: ${input.message}`);
  } finally {
    server.stop(true);
  }
}

export async function showToast(input: Notice) {
  const server = Bun.serve({
    fetch() {
      return new Response(toastPage(input), {
        headers: {
          "cache-control": "no-store",
          "content-type": "text/html; charset=utf-8",
        },
      });
    },
    hostname: "127.0.0.1",
    port: 0,
  });
  try {
    const child = await openView({
      alwaysOnTop: true,
      close: "quit",
      height: 180,
      maxHeight: 180,
      maxWidth: 380,
      minHeight: 180,
      minWidth: 380,
      resizable: false,
      title: "Luon",
      url: `http://127.0.0.1:${server.port}/`,
      width: 380,
    });
    const exited = await Promise.race([
      child.exited.then(() => true),
      Bun.sleep(toastTime).then(() => false),
    ]);
    if (!exited) {
      controlView(child.pid, "close");
      await child.exited;
    }
  } catch {
    console.warn(`${input.title}: ${input.message}`);
  } finally {
    server.stop(true);
  }
}

export async function askPassword<T>(
  title: string,
  verify: (password: string) => Promise<T | undefined>,
  options: { pin?: boolean } = {},
) {
  const token = crypto.randomUUID();
  const result: PasswordResult<T> = {};
  let done = () => {};
  const closed = new Promise<void>((resolve) => {
    done = resolve;
  });
  const server = Bun.serve({
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === `/${token}/unlock` && request.method === "POST") {
        const body = await request.json().catch(() => ({})) as {
          password?: unknown;
        };
        const password = typeof body.password === "string"
          ? body.password.slice(0, options.pin ? 8 : 64)
          : "";
        result.value = password ? await verify(password) : undefined;
        if (!result.value) {
          return Response.json({
            message: `Incorrect ${options.pin ? "PIN" : "password"} or modified file.`,
            ok: false,
          });
        }
        done();
        return Response.json({ ok: true });
      }
      if (url.pathname !== `/${token}/`) {
        return new Response("Not found", { status: 404 });
      }
      return new Response(passwordPage(
        title,
        `/${token}/unlock`,
        options.pin,
      ), {
        headers: {
          "cache-control": "no-store",
          "content-type": "text/html; charset=utf-8",
        },
      });
    },
    hostname: "127.0.0.1",
    port: 0,
  });
  try {
    const child = await openView({
      alwaysOnTop: true,
      close: "quit",
      height: 360,
      maxHeight: 360,
      maxWidth: 460,
      minHeight: 360,
      minWidth: 460,
      resizable: false,
      title: "Luon",
      url: `http://127.0.0.1:${server.port}/${token}/`,
      width: 460,
    });
    await Promise.race([closed, child.exited]);
    if (result.value) {
      controlView(child.pid, "close");
      await child.exited;
    }
  } catch {
    return;
  } finally {
    server.stop(true);
  }
  return result.value;
}
