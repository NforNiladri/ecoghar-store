var WA="917384507092";
function el(t,p,k){var e=document.createElement(t);if(p)for(var a in p){if(a==="text")e.textContent=p[a];else if(a==="class")e.className=p[a];else if(a.slice(0,2)==="on")e.addEventListener(a.slice(2),p[a]);else e.setAttribute(a,p[a])}(k||[]).forEach(function(c){if(c!=null)e.appendChild(typeof c==="string"?document.createTextNode(c):c)});return e}
function $(i){return document.getElementById(i)}
function money(n){return "₹"+Math.round(n).toLocaleString("en-IN")}
function fmtDate(ts){return new Date(ts).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"})}
function api(path,opt){opt=opt||{};var o={method:opt.method||"GET",credentials:"same-origin",headers:{"Content-Type":"application/json"}};if(opt.body)o.body=JSON.stringify(opt.body);return fetch("/api"+path,o).then(function(r){return r.json().catch(function(){return{}}).then(function(j){if(!r.ok){var e=new Error(j.error||"Something went wrong.");e.status=r.status;throw e}return j})})}
function bodyTo(n,body){n.textContent="";String(body||"").split(/\n{2,}/).forEach(function(b){b=b.trim();if(!b)return;if(b.indexOf("## ")===0)n.appendChild(el("h3",{text:b.slice(3)}));else n.appendChild(el("p",{text:b,style:"white-space:pre-line"}))})}
function safeNext(){var n=new URLSearchParams(location.search).get("next");return n&&n.charAt(0)==="/"&&n.charAt(1)!=="/"&&n.charAt(1)!=="\\"?n:null}
