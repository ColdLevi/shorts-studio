const HTML = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<style>
body{font-family:system-ui;padding:16px;background:var(--tg-theme-bg-color,#fff);color:var(--tg-theme-text-color,#000)}
label{display:block;margin:14px 0 6px;font-weight:600}
input{width:100%;box-sizing:border-box;padding:11px;font-size:16px;border-radius:10px;border:1px solid #8885;background:transparent;color:inherit}
button{margin-top:20px;width:100%;padding:13px;font-size:16px;border:0;border-radius:10px;background:var(--tg-theme-button-color,#2481cc);color:var(--tg-theme-button-text-color,#fff)}
</style></head>
<body><h3 id="q"></h3><form id="f"></form><button id="b">Send</button>
<script>
var tg = window.Telegram.WebApp; tg.ready(); tg.expand();
var d = {q: "Fill in the details", fields: ["Answer"]};
try {
  var p = new URLSearchParams(location.search).get("d");
  if (p) d = JSON.parse(decodeURIComponent(escape(atob(p.replace(/-/g, "+").replace(/_/g, "/")))));
} catch (e) {}
document.getElementById("q").textContent = d.q;
var f = document.getElementById("f");
d.fields.forEach(function (n) {
  var l = document.createElement("label"); l.textContent = n;
  var x = document.createElement("input"); x.name = n;
  var k = n.toLowerCase();
  x.type = k.indexOf("password") > -1 ? "password" : k.indexOf("email") > -1 ? "email" :
           (k.indexOf("birth") > -1 || k.indexOf("date") > -1) ? "date" : k.indexOf("phone") > -1 ? "tel" : "text";
  f.appendChild(l); f.appendChild(x);
});
document.getElementById("b").onclick = function () {
  var o = {};
  f.querySelectorAll("input").forEach(function (x) { o[x.name] = x.value; });
  tg.sendData(JSON.stringify(o));
};
</script></body></html>`;

export default function handler(req, res) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(HTML);
}
