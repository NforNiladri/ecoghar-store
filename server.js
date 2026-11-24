const express=require("express"),bcrypt=require("bcryptjs"),crypto=require("crypto"),path=require("path");
const {createClient}=require("@libsql/client"),{JWT}=require("google-auth-library");
const E=process.env,PORT=E.PORT||3000,PROD=E.NODE_ENV==="production";

/* ---- database: Turso (free hosted SQLite) in production, a local file for testing ---- */
const db=createClient({url:E.TURSO_DATABASE_URL||"file:"+(E.DATABASE_PATH||path.join(__dirname,"ecoghar.db")),authToken:E.TURSO_AUTH_TOKEN});
const all=async(sql,args=[])=>{const r=await db.execute({sql,args});return r.rows.map(x=>Object.fromEntries(r.columns.map((c,i)=>[c,x[i]])))};
const get=async(sql,args)=>(await all(sql,args))[0];
const run=async(sql,args=[])=>{const r=await db.execute({sql,args});return {id:Number(r.lastInsertRowid),changes:r.rowsAffected}};

const CAT={puretap:["PureTap filter",1399],biobin:["BioBin composter",1699],wattsmart:["WattSmart meter",999],duo:["Eco-Kitchen Duo",2799],trio:["Smart EcoHome Trio",3599],cart:["PureTap cartridges (2-pack)",499],powder:["BioBin compost powder (1 kg)",249]};
const STAT=["New","Paid","Shipped","Delivered","Cancelled"];
const str=(v,n)=>typeof v==="string"?v.trim().slice(0,n):"";
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/,sha=s=>crypto.createHash("sha256").update(s).digest("hex"),iso=t=>new Date(t||Date.now()).toISOString();
const DUMMY=bcrypt.hashSync("not-a-real-password",12);

async function setup(){
  await db.batch([
    "CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,phone TEXT,pass TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'customer',created INTEGER NOT NULL)",
    "CREATE TABLE IF NOT EXISTS sessions(h TEXT PRIMARY KEY,uid INTEGER NOT NULL,exp INTEGER NOT NULL)",
    "CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY,uid INTEGER NOT NULL,item TEXT NOT NULL,qty INTEGER NOT NULL,amount INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'New',address TEXT,note TEXT,created INTEGER NOT NULL)",
    "CREATE TABLE IF NOT EXISTS posts(id INTEGER PRIMARY KEY,slug TEXT UNIQUE NOT NULL,title TEXT NOT NULL,excerpt TEXT,body TEXT,status TEXT NOT NULL DEFAULT 'draft',created INTEGER NOT NULL,updated INTEGER NOT NULL)"],"write");
  /* admin account comes from the environment, never from the code */
  if(E.ADMIN_EMAIL&&E.ADMIN_PASSWORD){
    const em=E.ADMIN_EMAIL.toLowerCase();
    if(E.ADMIN_PASSWORD.length<10)console.error("ADMIN_PASSWORD must be at least 10 characters.");
    else if(!await get("SELECT 1 x FROM users WHERE email=?",[em])){await run("INSERT INTO users(name,email,phone,pass,role,created) VALUES('EcoGhar Admin',?,'',?,'admin',?)",[em,bcrypt.hashSync(E.ADMIN_PASSWORD,12),Date.now()]);console.log("Admin account created for",em)}
  }else console.warn("Set ADMIN_EMAIL and ADMIN_PASSWORD to create the admin account.");
}

/* ---- Google Sheets mirror (optional) ---- */
let jwt=null;
function sheetsOn(){if(!E.SHEET_ID||!E.GOOGLE_SERVICE_ACCOUNT_JSON)return false;if(!jwt){const k=JSON.parse(E.GOOGLE_SERVICE_ACCOUNT_JSON);jwt=new JWT({email:k.client_email,key:k.private_key,scopes:["https://www.googleapis.com/auth/spreadsheets"]})}return true}
async function sheets(method,url,data){return (await jwt.request({url:"https://sheets.googleapis.com/v4/spreadsheets/"+E.SHEET_ID+url,method,data})).data}
function mirror(tab,row){try{if(!sheetsOn())return;sheets("POST","/values/"+encodeURIComponent(tab+"!A1")+":append?valueInputOption=RAW",{values:[row]}).catch(e=>console.error("Sheet append failed:",e.message))}catch(e){console.error("Sheets error:",e.message)}}
const orderList=()=>all("SELECT o.*,u.name,u.email,u.phone FROM orders o JOIN users u ON u.id=o.uid ORDER BY o.created DESC");
const orderRow=o=>[o.id,iso(o.created),o.name,o.email,o.phone,CAT[o.item]?CAT[o.item][0]:o.item,o.qty,o.amount,o.status,o.address||"",o.note||""];
async function syncAll(){
  if(!sheetsOn())throw new Error("Google Sheets isn’t configured on the server.");
  const tabs={Users:[["ID","Name","Email","Phone","Joined"]].concat((await all("SELECT * FROM users ORDER BY id")).map(u=>[u.id,u.name,u.email,u.phone,iso(u.created)])),
    Orders:[["ID","Date","Customer","Email","Phone","Item","Qty","Amount","Status","Address","Note"]].concat((await orderList()).reverse().map(orderRow)),
    Blog:[["ID","Title","Status","Updated"]].concat((await all("SELECT * FROM posts ORDER BY id")).map(p=>[p.id,p.title,p.status,iso(p.updated)]))};
  for(const t in tabs){await sheets("POST","/values/"+encodeURIComponent(t)+":clear",{});await sheets("PUT","/values/"+encodeURIComponent(t+"!A1")+"?valueInputOption=RAW",{values:tabs[t]})}
}

/* ---- app + security ---- */
const app=express();
if(PROD)app.set("trust proxy",1);
app.disable("x-powered-by");
const ah=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(e=>{console.error(e);res.status(500).json({error:"Something went wrong on our side. Please try again."})});
app.use((req,res,next)=>{res.set({"X-Content-Type-Options":"nosniff","X-Frame-Options":"DENY","Referrer-Policy":"strict-origin-when-cross-origin","Content-Security-Policy":"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"});next()});
app.get("/healthz",(req,res)=>res.send("ok"));
app.use(express.json({limit:"50kb"}));
const hits=new Map();setInterval(()=>hits.clear(),36e5).unref();
const limit=(max,ms)=>(req,res,next)=>{const k=req.ip+req.path,n=Date.now(),a=(hits.get(k)||[]).filter(t=>n-t<ms);if(a.length>=max)return res.status(429).json({error:"Too many attempts. Please try again later."});a.push(n);hits.set(k,a);next()};
const cookie=(req,n)=>{const m=(req.headers.cookie||"").split(/;\s*/).find(c=>c.startsWith(n+"="));return m?m.slice(n.length+1):null};
async function startSession(res,uid){const t=crypto.randomBytes(32).toString("hex");await run("DELETE FROM sessions WHERE exp<?",[Date.now()]);await run("INSERT INTO sessions(h,uid,exp) VALUES(?,?,?)",[sha(t),uid,Date.now()+6048e5]);res.append("Set-Cookie","sid="+t+"; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800"+(PROD?"; Secure":""))}
app.use(ah(async(req,res,next)=>{req.user=null;const t=cookie(req,"sid");if(t&&(req.path.startsWith("/api")||req.path==="/admin"))req.user=(await get("SELECT u.id,u.name,u.email,u.phone,u.role FROM sessions s JOIN users u ON u.id=s.uid WHERE s.h=? AND s.exp>?",[sha(t),Date.now()]))||null;next()}));
const need=(req,res,next)=>req.user?next():res.status(401).json({error:"Please sign in."});
const admin=(req,res,next)=>req.user&&req.user.role==="admin"?next():res.status(req.user?403:401).json({error:"Admins only."});

/* ---- accounts ---- */
app.post("/api/register",limit(10,9e5),ah(async(req,res)=>{
  const name=str(req.body.name,80),email=str(req.body.email,120).toLowerCase(),phone=str(req.body.phone,15).replace(/\D/g,""),pw=typeof req.body.password==="string"?req.body.password:"";
  if(!name||!EMAIL.test(email)||phone.length!==10||pw.length<8||pw.length>72)return res.status(400).json({error:"Enter your name, a valid email, a 10-digit phone number and a password of 8 to 72 characters."});
  if(await get("SELECT 1 x FROM users WHERE email=?",[email]))return res.status(409).json({error:"That email is already registered. Try signing in."});
  const id=(await run("INSERT INTO users(name,email,phone,pass,role,created) VALUES(?,?,?,?,'customer',?)",[name,email,phone,bcrypt.hashSync(pw,12),Date.now()])).id;
  await startSession(res,id);mirror("Users",[id,name,email,phone,iso()]);
  res.json({user:{id,name,email,phone,role:"customer"}});
}));
app.post("/api/login",limit(10,9e5),ah(async(req,res)=>{
  const email=str(req.body.email,120).toLowerCase(),pw=typeof req.body.password==="string"?req.body.password:"",u=await get("SELECT * FROM users WHERE email=?",[email]),ok=bcrypt.compareSync(pw,u?u.pass:DUMMY);
  if(!u||!ok)return res.status(401).json({error:"Wrong email or password."});
  await startSession(res,u.id);res.json({user:{id:u.id,name:u.name,email:u.email,phone:u.phone,role:u.role}});
}));
app.post("/api/logout",ah(async(req,res)=>{const t=cookie(req,"sid");if(t)await run("DELETE FROM sessions WHERE h=?",[sha(t)]);res.append("Set-Cookie","sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");res.json({ok:true})}));
app.get("/api/me",(req,res)=>res.json({user:req.user}));
app.get("/api/catalog",(req,res)=>res.json(Object.keys(CAT).map(k=>({key:k,name:CAT[k][0],price:CAT[k][1]}))));

/* ---- customer orders ---- */
app.post("/api/orders",need,ah(async(req,res)=>{
  const it=CAT[req.body.item],qty=Math.floor(+req.body.qty),address=str(req.body.address,300),note=str(req.body.note,200);
  if(!it||!(qty>=1&&qty<=20)||address.length<10)return res.status(400).json({error:"Choose a product, a quantity from 1 to 20 and enter your full delivery address."});
  const amount=it[1]*qty,created=Date.now(),id=(await run("INSERT INTO orders(uid,item,qty,amount,address,note,created) VALUES(?,?,?,?,?,?,?)",[req.user.id,req.body.item,qty,amount,address,note,created])).id;
  mirror("Orders",orderRow({id,created,name:req.user.name,email:req.user.email,phone:req.user.phone,item:req.body.item,qty,amount,status:"New",address,note}));
  res.json({order:{id,item:it[0],qty,amount,status:"New"}});
}));
app.get("/api/orders/mine",need,ah(async(req,res)=>res.json((await all("SELECT id,item,qty,amount,status,created FROM orders WHERE uid=? ORDER BY created DESC",[req.user.id])).map(o=>Object.assign(o,{name:CAT[o.item]?CAT[o.item][0]:o.item})))));

/* ---- public blog ---- */
app.get("/api/posts",ah(async(req,res)=>res.json(await all("SELECT slug,title,excerpt,body,created AS ts FROM posts WHERE status='published' ORDER BY created DESC"))));

/* ---- admin ---- */
app.get("/api/admin/summary",admin,ah(async(req,res)=>{
  const list=await orderList(),live=list.filter(o=>o.status!=="Cancelled"),now=Date.now(),by={},st={};
  let rev=0,units=0,m30=0;live.forEach(o=>{rev+=o.amount;units+=o.qty;if(now-o.created<2592e6)m30+=o.amount;const b=by[o.item]||(by[o.item]={name:CAT[o.item]?CAT[o.item][0]:o.item,revenue:0,units:0});b.revenue+=o.amount;b.units+=o.qty});
  STAT.forEach(s=>st[s]=list.filter(o=>o.status===s).length);
  res.json({revenue:rev,last30:m30,orders:live.length,units,customers:(await get("SELECT COUNT(*) c FROM users WHERE role='customer'")).c,byProduct:Object.values(by).sort((a,b)=>b.revenue-a.revenue),status:st,
    due:list.filter(o=>o.status==="Delivered"&&now-o.created>=5184e6).map(o=>({id:o.id,name:o.name,phone:o.phone,item:CAT[o.item]?CAT[o.item][0]:o.item,created:o.created}))});
}));
app.get("/api/admin/orders",admin,ah(async(req,res)=>res.json((await orderList()).map(o=>Object.assign(o,{itemName:CAT[o.item]?CAT[o.item][0]:o.item})))));
app.patch("/api/admin/orders/:id",admin,ah(async(req,res)=>{if(!STAT.includes(req.body.status))return res.status(400).json({error:"Unknown status."});await run("UPDATE orders SET status=? WHERE id=?",[req.body.status,+req.params.id]);res.json({ok:true})}));
app.get("/api/admin/users",admin,ah(async(req,res)=>res.json(await all("SELECT u.id,u.name,u.email,u.phone,u.role,u.created,(SELECT COUNT(*) FROM orders o WHERE o.uid=u.id) orders FROM users u ORDER BY u.id DESC"))));
const slugify=s=>s.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,60)||"post-"+Date.now().toString(36);
const postData=b=>({title:str(b.title,120),excerpt:str(b.excerpt,200),body:typeof b.body==="string"?b.body.slice(0,40000):"",status:b.status==="published"?"published":"draft"});
app.get("/api/admin/posts",admin,ah(async(req,res)=>res.json(await all("SELECT * FROM posts ORDER BY created DESC"))));
app.post("/api/admin/posts",admin,ah(async(req,res)=>{const p=postData(req.body);if(!p.title)return res.status(400).json({error:"Add a title."});let s=slugify(p.title);if(await get("SELECT 1 x FROM posts WHERE slug=?",[s]))s+="-"+Date.now().toString(36).slice(-3);const n=Date.now();res.json({id:(await run("INSERT INTO posts(slug,title,excerpt,body,status,created,updated) VALUES(?,?,?,?,?,?,?)",[s,p.title,p.excerpt,p.body,p.status,n,n])).id})}));
app.put("/api/admin/posts/:id",admin,ah(async(req,res)=>{const p=postData(req.body);if(!p.title)return res.status(400).json({error:"Add a title."});await run("UPDATE posts SET title=?,excerpt=?,body=?,status=?,updated=? WHERE id=?",[p.title,p.excerpt,p.body,p.status,Date.now(),+req.params.id]);res.json({ok:true})}));
app.delete("/api/admin/posts/:id",admin,ah(async(req,res)=>{await run("DELETE FROM posts WHERE id=?",[+req.params.id]);res.json({ok:true})}));
app.post("/api/admin/sync",admin,async(req,res)=>{try{await syncAll();res.json({ok:true})}catch(e){res.status(400).json({error:e.message})}});
app.get("/api/admin/export.csv",admin,ah(async(req,res)=>{
  const safe=v=>{v=String(v==null?"":v);return /^[=+\-@\t\r]/.test(v)?"'"+v:v};
  const rows=[["ID","Date","Customer","Email","Phone","Item","Qty","Amount","Status","Address","Note"]].concat((await orderList()).reverse().map(orderRow));
  res.set({"Content-Type":"text/csv; charset=utf-8","Content-Disposition":'attachment; filename="ecoghar-orders.csv"'}).send(rows.map(r=>r.map(v=>'"'+safe(v).replace(/"/g,'""')+'"').join(",")).join("\n"));
}));

/* ---- pages ---- */
app.get("/admin",(req,res)=>req.user&&req.user.role==="admin"?res.sendFile(path.join(__dirname,"private","admin.html")):res.redirect("/login.html?next=/admin"));
app.use(express.static(path.join(__dirname,"public")));
app.use((err,req,res,next)=>res.status(400).json({error:"Bad request."}));
setup().then(()=>app.listen(PORT,()=>console.log("EcoGhar running on port "+PORT))).catch(e=>{console.error("Could not start:",e.message);process.exit(1)});
