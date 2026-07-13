ˇ/**
 * Dhurta Setu ‚¨ Admin Favicon & App Update Script
 * ‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨
 * node update-favicons.js              ‚  download missing favicons only
 * node update-favicons.js --all        ‚  re-download ALL (full refresh)
 * node update-favicons.js --retry      ‚  retry only previously failed domains
 * node update-favicons.js --report     ‚  audit report, no downloads
 * node update-favicons.js --trending   ‚  suggest/add trending apps
 * node update-favicons.js --add        ‚  interactive: add a new app manually
 */

const fs    = require('fs');
const path  = require('path');
const https = require('https');
const http  = require('http');

const FAV_DIR    = path.join(__dirname, 'favicons');
const LOG_PATH   = path.join(FAV_DIR, 'update-log.json');
const DATA_FILES = ['data1.js','data2.js','data3.js','workspace.js'];

const FORCE_ALL   = process.argv.includes('--all');
const REPORT_ONLY = process.argv.includes('--report');
const RETRY_ONLY  = process.argv.includes('--retry');
const ADD_TRENDING= process.argv.includes('--trending');
const ADD_APP     = process.argv.includes('--add');

if(!fs.existsSync(FAV_DIR)) fs.mkdirSync(FAV_DIR);

/* ‚¨‚¨ Slug ‚¨‚¨ */
function slug(url){ return url.split('/')[0].replace(/[^a-z0-9.-]/gi,'_'); }

/* ‚¨‚¨ Extract apps from data files ‚¨‚¨ */
function extractApps(){
  const apps = [];
  DATA_FILES.forEach(file=>{
    const full = path.join(__dirname, file);
    if(!fs.existsSync(full)){ console.warn(`  ‚a†  Missing data file: ${file}`); return; }
    const src = fs.readFileSync(full,'utf8');
    const re  = /\{[^}]*?name\s*:\s*"([^"]+)"[^}]*?url\s*:\s*"([^"]+)"[^}]*?\}/g;
    let m;
    while((m=re.exec(src))!==null) apps.push({ name:m[1], url:m[2] });
  });
  return apps;
}

/* ‚¨‚¨ Load update log ‚¨‚¨ */
function loadLog(){
  try{ return JSON.parse(fs.readFileSync(LOG_PATH,'utf8')); }catch{ return []; }
}
function saveLog(log){
  if(log.length>24) log=log.slice(0,24);
  fs.writeFileSync(LOG_PATH, JSON.stringify(log,null,2));
}

/* ‚¨‚¨ Download with multi-source fallback chain ‚¨‚¨ */
function downloadFav(domain, destPath){
  return new Promise(resolve=>{
    /* 7-source chain ‚¨ try each until one gives a real image */
    const sources = [
      `https://icons.duckduckgo.com/ip3/${domain}.ico`,
      `https://www.google.com/s2/favicons?domain=${domain}&sz=64`,
      `https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://${domain}&size=64`,
      `https://favicons.githubusercontent.com/${domain}`,
      `https://${domain}/favicon.ico`,
      `https://${domain}/favicon.png`,
      `https://logo.clearbit.com/${domain}`,
    ];
    let attempt = 0;

    function tryNext(){
      if(attempt >= sources.length){ resolve({ ok:false }); return; }
      const srcUrl = sources[attempt++];
      const lib    = srcUrl.startsWith('https') ? https : http;
      try{
        const req = lib.get(srcUrl, { timeout:7000,
          headers:{ 'User-Agent':'Mozilla/5.0 DhurtaOmniAdmin/1.0' }
        }, res=>{
          /* follow single redirect */
          if((res.statusCode===301||res.statusCode===302) && res.headers.location){
            res.resume();
            const redir = res.headers.location;
            const rlib  = redir.startsWith('https') ? https : http;
            try{
              rlib.get(redir,{timeout:7000},res2=>{
                collectBody(res2, destPath, tryNext, resolve);
              }).on('error',tryNext).on('timeout',function(){ this.destroy(); tryNext(); });
            }catch{ tryNext(); }
            return;
          }
          if(res.statusCode!==200){ res.resume(); tryNext(); return; }
          collectBody(res, destPath, tryNext, resolve);
        });
        req.on('error', tryNext);
        req.on('timeout', ()=>{ req.destroy(); tryNext(); });
      }catch{ tryNext(); }
    }

    function collectBody(res, destPath, tryNext, resolve){
      const chunks=[];
      res.on('data',c=>chunks.push(c));
      res.on('end',()=>{
        const buf = Buffer.concat(chunks);
        if(buf.length < 150){ tryNext(); return; } /* skip blank placeholders */
        /* reject HTML error pages */
        const head = buf.slice(0,15).toString('ascii').toLowerCase();
        if(head.startsWith('<!doctype')||head.startsWith('<html')){ tryNext(); return; }
        fs.writeFileSync(destPath, buf);
        resolve({ ok:true, bytes:buf.length });
      });
      res.on('error', tryNext);
    }

    tryNext();
  });
}

/* ‚¨‚¨ Progress bar ‚¨‚¨ */
function bar(done,total,width=24){
  const filled = Math.round(done/total*width);
  return '[' + '‚∆'.repeat(filled) + '‚'.repeat(width-filled) + `] ${done}/${total}`;
}

/* ‚¨‚¨ Core download loop ‚¨‚¨ */
async function runDownload(targets, label){
  let downloaded=0, skipped=0, failed=0;
  const failedApps=[];

  for(let i=0;i<targets.length;i++){
    const {name,url} = targets[i];
    const domain     = url.split('/')[0];
    const dest       = path.join(FAV_DIR, slug(url)+'.png');

    if(!FORCE_ALL && !RETRY_ONLY && fs.existsSync(dest)){ skipped++; continue; }

    process.stdout.write(`\r  ${bar(i+1,targets.length)} ${name.padEnd(26).slice(0,26)} `);

    const res = await downloadFav(domain, dest);
    if(res.ok){ downloaded++; }
    else       { failed++; failedApps.push({name,url}); }

    await new Promise(r=>setTimeout(r,70)); /* polite rate limit */
  }

  process.stdout.write('\n');
  return { downloaded, skipped, failed, failedApps };
}

/* ‚¨‚¨ Trending apps list ‚¨ admin curates monthly ‚¨‚¨ */
const TRENDING_APPS = [
  /* Uncomment / add entries each month. Format:
     { name:"AppName", url:"domain.com", cat:"Category", desc:"Short description.", r:4.5, p:1 }
     p:1 = priority wall,  p:0 = drawer only
  */
  // { name:"Perplexity Pages", url:"perplexity.ai/pages",  cat:"AI Tools",      desc:"Create and share AI-generated web pages.", r:4.7, p:0 },
  // { name:"Bolt.new",         url:"bolt.new",             cat:"No-Code & Low-Code", desc:"AI-powered full-stack web app builder.", r:4.8, p:1 },
  // { name:"v0 by Vercel",     url:"v0.dev",               cat:"AI Tools",      desc:"Generate UI components with AI.", r:4.7, p:0 },
  // { name:"Lovable",          url:"lovable.dev",          cat:"No-Code & Low-Code", desc:"AI builds your web app from a prompt.", r:4.7, p:0 },
];

/* ‚¨‚¨ Add app to data file ‚¨‚¨ */
function addAppToData(app){
  const target = app.p===1 ? 'data1.js' : 'data2.js';
  const filePath= path.join(__dirname, target);
  let src = fs.readFileSync(filePath,'utf8');

  /* check duplicate */
  if(src.includes(`url:"${app.url}"`)){
    console.log(`  ‚a†  Already exists: ${app.name} (${app.url})`);
    return false;
  }

  /* find last id in file */
  const ids = [...src.matchAll(/id\s*:\s*(\d+)/g)].map(m=>parseInt(m[1]));
  const nextId = ids.length ? Math.max(...ids)+1 : 1;

  const entry = `{id:${nextId},name:"${app.name}",url:"${app.url}",desc:"${app.desc}",r:${app.r},cat:"${app.cat}",p:${app.p||0}}`;

  /* insert before closing ]; */
  src = src.replace(/\];\s*$/, `,\n${entry}\n];\n`);
  fs.writeFileSync(filePath, src);
  console.log(`  ‚S& Added ${app.name} (id:${nextId}) ‚  ${target}`);
  return true;
}

/* ‚¨‚¨ Interactive --add ‚¨‚¨ */
async function interactiveAdd(){
  const readline = require('readline');
  const rl = readline.createInterface({ input:process.stdin, output:process.stdout });
  const ask = q => new Promise(r=>rl.question(q,r));

  console.log('\n  ‚¨‚¨ Add New App ‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨');
  const name = (await ask('  Name       : ')).trim();
  const url  = (await ask('  URL (domain): ')).trim().replace(/^https?:\/\//,'');
  const cat  = (await ask('  Category   : ')).trim()||'Utilities & Tools';
  const desc = (await ask('  Description: ')).trim()||`${name} ‚¨ web app.`;
  const r    = parseFloat((await ask('  Rating (1-5): ')).trim())||4.5;
  const pStr = (await ask('  Priority wall? (y/n): ')).trim().toLowerCase();
  rl.close();

  const app = { name, url, cat, desc, r, p: pStr==='y'?1:0 };
  console.log('');
  addAppToData(app);

  /* download favicon immediately */
  console.log(`  Fetching favicon for ${url}‚¨¶`);
  const dest = path.join(FAV_DIR, slug(url)+'.png');
  const res  = await downloadFav(url.split('/')[0], dest);
  console.log(res.ok ? `  ‚S& Favicon saved (${(res.bytes/1024).toFixed(1)}KB)` : '  ‚a†  Favicon not found ‚¨ letter avatar will show');
}

/* ‚¨‚¨ MAIN ‚¨‚¨ */
async function main(){
  console.log('\n‚"‚"ê‚"ê‚"ê‚"ê‚"ê‚"ê‚"ê‚"ê‚"ê‚"ê‚"ê‚"ê‚"ê‚"ê‚"ê‚"ê‚"ê‚"ê‚"ê‚"ê‚"ê‚"ê‚"ê‚"ê‚"ê‚"ê‚"ê‚"ê‚"ê‚"ê‚"ê‚"ê‚"ê‚"ê‚"ê‚"ê‚"ê‚"ê‚"ê‚"ê‚"ê‚"ê‚"ê‚"ê‚"ê‚"ê‚"');
  console.log('‚"   Dhurta Setu ‚¨ Admin Update Tool           ‚"');
  console.log('‚"a‚"ê‚"ê‚"ê‚"ê‚"ê‚"ê‚"ê‚"ê‚"ê‚"ê‚"ê‚"ê‚"ê‚"ê‚"ê‚"ê‚"ê‚"ê‚"ê‚"ê‚"ê‚"ê‚"ê‚"ê‚"ê‚"ê‚"ê‚"ê‚"ê‚"ê‚"ê‚"ê‚"ê‚"ê‚"ê‚"ê‚"ê‚"ê‚"ê‚"ê‚"ê‚"ê‚"ê‚"ê‚"ê‚"ê‚"ù');
  console.log(`  Date : ${new Date().toLocaleString('en-IN')}`);

  /* --add mode */
  if(ADD_APP){ await interactiveAdd(); return; }

  /* --report mode */
  const apps   = extractApps();
  const seen   = new Set();
  const unique = apps.filter(a=>{ const s=slug(a.url); if(seen.has(s)) return false; seen.add(s); return true; });

  if(REPORT_ONLY){
    const missing = unique.filter(a=>!fs.existsSync(path.join(FAV_DIR,slug(a.url)+'.png')));
    const log     = loadLog();
    const lastRun = log[0];
    console.log(`\n  ‚¨‚¨ Audit Report ‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨`);
    console.log(`  Total apps    : ${apps.length}`);
    console.log(`  Unique domains: ${unique.length}`);
    console.log(`  Cached favicons: ${unique.length - missing.length}`);
    console.log(`  Missing        : ${missing.length}`);
    if(lastRun) console.log(`  Last update    : ${new Date(lastRun.date).toLocaleString('en-IN')} (${lastRun.downloaded} downloaded, ${lastRun.failed} failed)`);
    if(missing.length){
      console.log('\n  Missing:');
      missing.forEach(a=>console.log(`    ‚S ${a.name.padEnd(30)} ${a.url}`));
    }
    return;
  }

  /* --retry mode ‚¨ load failed from last log */
  if(RETRY_ONLY){
    const log = loadLog();
    const lastFailed = log.flatMap(e=>e.failedApps||[]);
    const dedupFailed= [...new Set(lastFailed)];
    if(!dedupFailed.length){ console.log('\n  ‚S& No failed entries in log. Nothing to retry.\n'); return; }
    const targets = dedupFailed.map(url=>({
      name: unique.find(a=>a.url===url)?.name || url.split('/')[0],
      url
    }));
    console.log(`\n  ‚¨‚¨ Retrying ${targets.length} failed favicons ‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨`);
    /* delete old failed files so they re-download */
    targets.forEach(({url})=>{
      const p=path.join(FAV_DIR,slug(url)+'.png');
      if(fs.existsSync(p)) fs.unlinkSync(p);
    });
    const r = await runDownload(targets,'retry');
    console.log(`\n  ‚¨‚¨ Result ‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨`);
    console.log(`  ‚S& Recovered : ${r.downloaded}`);
    console.log(`  ‚ùR Still failing: ${r.failed}`);
    if(r.failedApps.length){
      console.log('\n  Still failing (letter-avatar will show):');
      r.failedApps.forEach(a=>console.log(`    ‚S ${a.name} ‚¨ ${a.url}`));
    }
    const log2 = loadLog();
    log2.unshift({ date:new Date().toISOString(), mode:'retry', ...r, failedApps:r.failedApps.map(a=>a.url) });
    saveLog(log2);
    return;
  }

  /* normal / --all download */
  const modeLabel = FORCE_ALL ? 'FULL RE-DOWNLOAD' : 'MISSING ONLY';
  console.log(`\n  Mode: ${modeLabel}`);
  console.log(`  Apps: ${unique.length} unique domains\n`);

  const r = await runDownload(unique, modeLabel);

  console.log(`\n  ‚¨‚¨ Summary ‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨`);
  console.log(`  ‚S& Downloaded  : ${r.downloaded}`);
  console.log(`  ‚è≠  Skipped    : ${r.skipped} (already cached)`);
  console.log(`  ‚ùR Failed      : ${r.failed}`);
  if(r.failedApps.length){
    console.log('\n  Failed (run --retry to attempt again):');
    r.failedApps.forEach(a=>console.log(`    ‚S ${a.name.padEnd(28)} ${a.url}`));
  }

  /* --trending */
  if(ADD_TRENDING){
    console.log('\n  ‚¨‚¨ Trending Apps ‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨‚¨');
    if(!TRENDING_APPS.length){
      console.log('  No trending apps configured. Edit TRENDING_APPS in update-favicons.js');
    } else {
      let added=0;
      TRENDING_APPS.forEach(a=>{ if(addAppToData(a)) added++; });
      if(added){ console.log(`\n  Downloading ${added} new favicons‚¨¶`); await runDownload(TRENDING_APPS.filter(a=>a),'trending'); }
    }
  }

  const log = loadLog();
  log.unshift({ date:new Date().toISOString(), mode:FORCE_ALL?'full':'missing', total:unique.length, ...r, failedApps:r.failedApps.map(a=>a.url) });
  saveLog(log);
  console.log('\n  xù Log ‚  favicons/update-log.json');
  console.log('  Done.\n');
}

main().catch(e=>{ console.error('\n  ‚S Fatal:', e.message); process.exit(1); });

