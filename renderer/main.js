import { initTerminal, destroyTerminal } from './terminal.js';

// ── SOUND ─────────────────────────────────────────────────
const DONE_SOUNDS = ['done-boing.wav', 'done-notification.wav', 'done-coin.wav'];

let soundEnabled = true;

function playSound(file, volume = 0.65) {
    if (!soundEnabled) return;
    try {
        const audio = new Audio(`file://${window.scc.assetsPath}/sounds/${file}`);
        audio.volume = volume;
        audio.play().catch(() => {});
    } catch (_) {}
}

// ── STARFIELD ─────────────────────────────────────────────
(() => {
    const c = document.getElementById('stars'), ctx = c.getContext('2d');
    const resize = () => { c.width = innerWidth; c.height = innerHeight; };
    resize(); addEventListener('resize', resize);

    const stars = Array.from({length:400}, () => ({
        x: Math.random()*innerWidth, y: Math.random()*innerHeight,
        r: Math.random()*1.3+0.1,
        b: Math.random()*0.5+0.2,
        p: Math.random()*Math.PI*2,
        s: 0.003+Math.random()*0.006,
        vx: (Math.random()-0.5)*0.04,
        vy: (Math.random()-0.5)*0.04
    }));

    (function draw() {
        ctx.clearRect(0,0,c.width,c.height);
        stars.forEach(s => {
            s.x += s.vx; s.y += s.vy; s.p += s.s;
            if (s.x < 0) s.x = c.width; if (s.x > c.width) s.x = 0;
            if (s.y < 0) s.y = c.height; if (s.y > c.height) s.y = 0;
            ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI*2);
            ctx.fillStyle = `rgba(180,210,255,${s.b*(0.6+0.4*Math.sin(s.p))})`; ctx.fill();
        });
        requestAnimationFrame(draw);
    })();
})();

// ── THEME SYSTEM ──────────────────────────────────────────
const THEMES = ['cyan-cockpit', 'amber', 'solarized', 'native'];
const THEME_LABELS = { 'cyan-cockpit': 'CYAN', 'amber': 'AMBER', 'solarized': 'SOL', 'native': 'OS' };

let currentTheme = 'cyan-cockpit';

function applyTheme(theme) {
    document.body.className = document.body.className
        .replace(/\btheme-\S+/g, '').trim();
    if (theme !== 'cyan-cockpit') {
        document.body.classList.add('theme-' + theme);
    }
    currentTheme = theme;
    const btn = document.getElementById('themeBtn');
    if (btn) btn.textContent = THEME_LABELS[theme] || 'THEME';
}

document.getElementById('themeBtn').addEventListener('click', async () => {
    const idx = (THEMES.indexOf(currentTheme) + 1) % THEMES.length;
    const next = THEMES[idx];
    applyTheme(next);
    const cfg = await window.scc.readConfig();
    cfg.theme = next;
    await window.scc.writeConfig(cfg);
});

document.getElementById('soundBtn').addEventListener('click', async () => {
    soundEnabled = !soundEnabled;
    document.getElementById('soundBtn').textContent = soundEnabled ? 'SFX ON' : 'SFX OFF';
    const cfg = await window.scc.readConfig();
    cfg.soundEnabled = soundEnabled;
    await window.scc.writeConfig(cfg);
});

// ── CONFIG ───────────────────────────────────────────────
const SIZES = { S:{w:260,h:170}, M:{w:420,h:280}, L:{w:640,h:440} };

const MODELS = ['Haiku','Sonnet','Opus'];

// Default projects — IPC config can override
const DEFAULT_PROJECTS = [
    { title:'Life OS',        model:'Opus',   logFile:'life-os.log',         path:'/Users/janua/Documents/LifeOS' },
    { title:'MicroBlooming',  model:'Sonnet', logFile:'microblooming.log',   path:'/Users/janua/projects/Microblooming' },
    { title:'REPLAI',         model:'Haiku',  logFile:'replai.log',          path:'/Users/janua/Documents/REPLAI' },
    { title:'InvAIce',        model:'Haiku',  logFile:'invaice.log',         path:'/Users/janua/Documents/InvAIce' },
    { title:'XTC-STUDIO',     model:'Sonnet', logFile:'xtc-studio.log',      path:'/Users/janua/Documents/XTC-STUDIO' },
    { title:'DoorsOfHarmony', model:'Sonnet', logFile:'doors-of-harmony.log',path:'/Users/janua/projects/DoorsOfHarmony' },
    { title:'LifeOS-Dev',     model:'Sonnet', logFile:'lifeos-dev.log',       path:'/Users/janua/Documents/lifeos-backend' },
    { title:'EmpathyEngine',  model:'Sonnet', logFile:'empathy-engine.log',  path:'/Users/janua/Documents/empathy-engine' },
];

// ── STATE ────────────────────────────────────────────────
let wins        = [];
let projects    = [];   // master project list (shown in ledger even when no window open)
let zTop        = 10;
let idSeq       = 1;
let dragCtx     = null; // { type:'move'|'resize', data, handle, sx,sy,ox,oy,ow,oh }

// ── HELPERS ──────────────────────────────────────────────
function setTxt(el,v) { el.textContent = String(v); }
function mClass(m)    { return { Haiku:'haiku', Sonnet:'sonnet', Opus:'opus' }[m]||'sonnet'; }
function nextModel(m) { const i = MODELS.indexOf(m); return MODELS[(i+1)%MODELS.length]; }

// ── CREATE WINDOW ────────────────────────────────────────
function mkWin(cfg) {
    const id     = cfg.id     || ('w'+(idSeq++));
    const title  = cfg.title  || 'Untitled';
    const model  = cfg.model  || 'Sonnet';
    const log    = cfg.logFile|| '';
    const path   = cfg.path   || '';
    const x      = cfg.x      ?? scatter();
    const y      = cfg.y      ?? scatter(true);
    const width  = cfg.width  || SIZES.M.w;
    const height = cfg.height || SIZES.M.h;
    const state  = cfg.state  || 'normal';
    const zi     = cfg.zIndex || (++zTop);

    const el = document.createElement('div');
    el.className = 'panel';
    el.id = id;
    el.style.cssText = `left:${x}px;top:${y}px;width:${width}px;height:${height}px;z-index:${zi}`;

    // Header
    const hdr = document.createElement('div'); hdr.className = 'panel-header';

    const dot = document.createElement('div'); dot.className = 'ph-dot';

    const titleEl = document.createElement('div'); titleEl.className = 'ph-title'; setTxt(titleEl, title);

    // Model badge — clickable
    const modelWrap = document.createElement('div'); modelWrap.style.position = 'relative';
    const modelBadge = document.createElement('div');
    modelBadge.className = 'ph-model ' + mClass(model);
    setTxt(modelBadge, model);

    const picker = document.createElement('div'); picker.className = 'model-picker';
    MODELS.forEach(m => {
        const btn = document.createElement('button');
        btn.className = 'mp-opt ' + mClass(m); setTxt(btn, m);
        btn.addEventListener('click', e => {
            e.stopPropagation();
            setModel(data, m);
            picker.classList.remove('show');
        });
        picker.appendChild(btn);
    });
    modelWrap.append(modelBadge, picker);

    modelBadge.addEventListener('click', e => {
        e.stopPropagation();
        document.querySelectorAll('.model-picker').forEach(p => p.classList.remove('show'));
        picker.classList.toggle('show');
    });

    const btns = document.createElement('div'); btns.className = 'ph-btns';
    const minBtn   = mkPB('_','pb min','Minimise');
    const maxBtn   = mkPB('□','pb max','Fullscreen');
    const closeBtn = mkPB('✕','pb close','Close');
    btns.append(minBtn, maxBtn, closeBtn);
    hdr.append(dot, titleEl, modelWrap, btns);

    // Body
    const body    = document.createElement('div'); body.className = 'panel-body';

    // Footer
    const footer = document.createElement('div'); footer.className = 'panel-footer';
    const pathEl = document.createElement('div'); pathEl.className = 'pf-path'; setTxt(pathEl, '~/logs/'+(log||'—'));
    const dotEl  = document.createElement('div'); dotEl.className  = 'pf-dot no'; setTxt(dotEl, '●');
    footer.append(pathEl, dotEl);

    // Resize handles
    ['n','s','e','w','nw','ne','sw','se'].forEach(dir => {
        const h = document.createElement('div');
        h.className = `resize-handle rh-${dir}`;
        h.dataset.dir = dir;
        el.appendChild(h);
    });

    el.append(hdr, body, footer);
    if (state === 'minimized')  el.classList.add('minimized');
    if (state === 'fullscreen') applyFS(el, true);

    // Snake border: start in running state
    el.dataset.snake = 'running';

    document.body.appendChild(el);

    // Clear any existing children safely and mount terminal
    while (body.firstChild) body.removeChild(body.firstChild);
    const termContainer = document.createElement('div');
    termContainer.style.cssText = 'width:100%;height:100%;';
    body.appendChild(termContainer);

    requestAnimationFrame(() => {
        initTerminal(id, termContainer, path || '', (winId, snakeState) => {
            const win = wins.find(w => w.id === winId);
            if (win && win.element) {
                win.element.dataset.snake = snakeState;
                if (snakeState === 'done') {
                    playSound(DONE_SOUNDS[Math.floor(Math.random() * DONE_SOUNDS.length)], 0.55);
                }
            }
        }).catch(err =>
            console.error('[scc] terminal init failed for', id, err)
        );
    });

    const data = {
        id, title, model, logFile:log, path,
        x, y, width, height, state, zIndex:zi,
        element:el, message:'', lastLines:cfg.lastLines||[], _sig:'',
    };
    wins.push(data);
    bindWin(data);
    refreshLedger();
    return data;
}

function mkPB(lbl,cls,title) {
    const b=document.createElement('button'); b.className=cls; b.title=title; setTxt(b,lbl); return b;
}

function scatter(vert) {
    const n = wins.length;
    return vert ? 50 + (n%5)*28 : 50 + (n%7)*32;
}

// ── MODEL SWITCH ─────────────────────────────────────────
function setModel(data, model) {
    data.model = model;
    const badge = data.element.querySelector('.ph-model');
    badge.className = 'ph-model ' + mClass(model);
    setTxt(badge, model);
    // Update matching project entry
    const proj = projects.find(p => p.title === data.title);
    if (proj) proj.model = model;
    refreshLedger();
}

// ── WINDOW EVENTS ─────────────────────────────────────────
function bindWin(data) {
    const el  = data.element;
    const hdr = el.querySelector('.panel-header');

    // Move drag (header only)
    hdr.addEventListener('mousedown', e => {
        if (e.target.closest('.ph-btns') || e.target.closest('.model-picker') || e.target.closest('.ph-model')) return;
        focus(data);
        if (data.state === 'fullscreen') return;
        dragCtx = { type:'move', data, sx:e.clientX, sy:e.clientY, ox:data.x, oy:data.y };
        e.preventDefault();
    });

    // Double-click header → fullscreen
    hdr.addEventListener('dblclick', e => {
        if (e.target.closest('.ph-btns') || e.target.closest('.ph-model')) return;
        toggleFS(data);
    });

    el.addEventListener('mousedown', e => {
        // Resize handle
        const rh = e.target.closest('.resize-handle');
        if (rh) {
            focus(data);
            if (data.state !== 'normal') return;
            dragCtx = {
                type:'resize', data, handle:rh.dataset.dir,
                sx:e.clientX, sy:e.clientY,
                ox:data.x, oy:data.y, ow:data.width, oh:data.height,
            };
            e.preventDefault(); e.stopPropagation(); return;
        }
        focus(data);
    });

    el.querySelector('.pb.min').addEventListener('click', e => { e.stopPropagation(); toggleMin(data); });
    el.querySelector('.pb.max').addEventListener('click', e => { e.stopPropagation(); toggleFS(data); });
    el.querySelector('.pb.close').addEventListener('click', e => { e.stopPropagation(); rmWin(data.id); });
}

function focus(data) {
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('focused'));
    data.element.classList.add('focused');
    data.zIndex = ++zTop; data.element.style.zIndex = data.zIndex;
    refreshLedger();
}

function toggleMin(data) {
    if (data.state==='minimized') {
        data.state='normal'; data.element.classList.remove('minimized'); restoreGeo(data);
    } else {
        if (data.state==='fullscreen') applyFS(data.element,false);
        data.state='minimized'; data.element.classList.add('minimized');
    }
    refreshLedger();
}

function toggleFS(data) {
    if (data.state==='fullscreen') {
        data.state='normal'; applyFS(data.element,false); restoreGeo(data);
    } else {
        data.state='fullscreen'; data.element.classList.remove('minimized'); applyFS(data.element,true);
    }
    refreshLedger();
}

function applyFS(el, on) {
    if (on) {
        el.style.cssText += ';left:0;top:0;width:100vw;height:100vh;border-radius:0;z-index:500';
    } else {
        el.style.borderRadius=''; el.style.zIndex = zTop;
    }
}

function restoreGeo(data) {
    const s=data.element.style;
    s.left=data.x+'px'; s.top=data.y+'px'; s.width=data.width+'px'; s.height=data.height+'px';
}

function resizeWin(data, size) {
    if (size==='XL') { toggleFS(data); return; }
    if (data.state!=='normal') { if(data.state==='fullscreen')applyFS(data.element,false); data.element.classList.remove('minimized'); data.state='normal'; }
    data.width=SIZES[size].w; data.height=SIZES[size].h; restoreGeo(data);
}

function rmWin(id) {
    const idx=wins.findIndex(w=>w.id===id); if(idx<0) return;
    destroyTerminal(id);
    wins[idx].element.remove(); wins.splice(idx,1);
    refreshLedger();
}

// ── DRAG / RESIZE ─────────────────────────────────────────
const MIN_W=200, MIN_H=120;

document.addEventListener('mousemove', e => {
    if (!dragCtx) return;
    const dx = e.clientX-dragCtx.sx, dy = e.clientY-dragCtx.sy;

    if (dragCtx.type==='move') {
        dragCtx.data.element.style.left = (dragCtx.ox+dx)+'px';
        dragCtx.data.element.style.top  = (dragCtx.oy+dy)+'px';
    }

    if (dragCtx.type==='resize') {
        const { handle, ox, oy, ow, oh } = dragCtx;
        let nx=ox, ny=oy, nw=ow, nh=oh;

        if (handle.includes('e')) nw = Math.max(MIN_W, ow+dx);
        if (handle.includes('s')) nh = Math.max(MIN_H, oh+dy);
        if (handle.includes('w')) { nw=Math.max(MIN_W,ow-dx); nx=ox+ow-nw; }
        if (handle.includes('n')) { nh=Math.max(MIN_H,oh-dy); ny=oy+oh-nh; }

        const s = dragCtx.data.element.style;
        s.left=nx+'px'; s.top=ny+'px'; s.width=nw+'px'; s.height=nh+'px';
    }
});

document.addEventListener('mouseup', () => {
    if (!dragCtx) return;
    if (dragCtx.type==='move') {
        const el=dragCtx.data.element;
        dragCtx.data.x=parseInt(el.style.left)||0;
        dragCtx.data.y=parseInt(el.style.top)||0;
        if (dragCtx.data.state==='fullscreen') { dragCtx.data.state='normal'; applyFS(el,false); restoreGeo(dragCtx.data); }
    }
    if (dragCtx.type==='resize') {
        const d=dragCtx.data, el=d.element;
        d.x=parseInt(el.style.left)||0; d.y=parseInt(el.style.top)||0;
        d.width=parseInt(el.style.width)||MIN_W; d.height=parseInt(el.style.height)||MIN_H;
    }
    dragCtx=null;
});

// Close any open model picker on outside click
document.addEventListener('click', () => {
    document.querySelectorAll('.model-picker').forEach(p => p.classList.remove('show'));
});

// ── LOG RENDERING ─────────────────────────────────────────
function renderLines(data,lines) {
    const el=data.element.querySelector('.panel-content'); if(!el) return;
    while(el.firstChild) el.removeChild(el.firstChild);
    for (const line of lines) {
        const d=document.createElement('div'); d.className='log-line';
        if(/error|Error|ERROR/.test(line)) d.classList.add('error');
        else if(/warn|Warn|WARN/.test(line)) d.classList.add('warn');
        else if(/\binfo\b|INFO/.test(line)) d.classList.add('info');
        d.textContent=line; el.appendChild(d);
    }
    el.scrollTop=el.scrollHeight;
}

// ── LEDGER ────────────────────────────────────────────────
function refreshLedger() {
    const ledger=document.getElementById('ledger');
    while(ledger.firstChild) ledger.removeChild(ledger.firstChild);

    projects.forEach(proj => {
        const win = wins.find(w=>w.title===proj.title);

        const row=document.createElement('div');
        row.className='ledger-row'+(win&&win.element.classList.contains('focused')?' active':'');

        // Status
        const status=document.createElement('div');
        status.className='lr-status offline';
        setTxt(status, 'OFFLINE');

        // Name
        const name=document.createElement('div'); name.className='lr-name'; setTxt(name,proj.title);

        // Last message
        const msg=document.createElement('div'); msg.className='lr-msg';
        setTxt(msg, win?win.message||'open':'click model to launch');

        // Model picker
        const mwrap=document.createElement('div'); mwrap.className='lr-model-wrap';
        const mbtn=document.createElement('button');
        mbtn.className='lr-model-btn '+mClass(proj.model);
        setTxt(mbtn,proj.model);

        const mpick=document.createElement('div'); mpick.className='model-picker';
        mpick.style.right='auto'; mpick.style.left='0';
        MODELS.forEach(m=>{
            const b=document.createElement('button'); b.className='mp-opt '+mClass(m); setTxt(b,m);
            b.addEventListener('click',e=>{
                e.stopPropagation();
                proj.model=m;
                mbtn.className='lr-model-btn '+mClass(m); setTxt(mbtn,m);
                if(win) setModel(win,m);
                mpick.classList.remove('show');
                // If no window open, opening one now
                if(!win) openProjectWindow(proj);
            });
            mpick.appendChild(b);
        });
        mwrap.append(mbtn,mpick);
        mbtn.addEventListener('click',e=>{
            e.stopPropagation();
            document.querySelectorAll('.model-picker').forEach(p=>p.classList.remove('show'));
            mpick.classList.toggle('show');
            // If offline and no window, hint to pick a model
        });

        // Size actions (only if window is open)
        const actions=document.createElement('div'); actions.className='lr-actions';
        if (win) {
            ['S','M','L','⛶'].forEach((lbl,si)=>{
                const b=document.createElement('button'); b.className='la-btn'; setTxt(b,lbl);
                b.addEventListener('click',e=>{
                    e.stopPropagation();
                    resizeWin(win,['S','M','L','XL'][si]);
                    focus(win);
                });
                actions.appendChild(b);
            });
            const cx=document.createElement('button'); cx.className='la-btn close'; setTxt(cx,'✕');
            cx.addEventListener('click',e=>{ e.stopPropagation(); rmWin(win.id); });
            actions.appendChild(cx);
        } else {
            // No window open — show OPEN button
            const openBtn=document.createElement('button'); openBtn.className='la-btn'; setTxt(openBtn,'OPEN');
            openBtn.addEventListener('click',e=>{ e.stopPropagation(); openProjectWindow(proj); });
            actions.appendChild(openBtn);
        }

        row.append(status,name,msg,mwrap,actions);
        row.addEventListener('click',()=>{
            if(win){ if(win.state==='minimized') toggleMin(win); focus(win); }
            else openProjectWindow(proj);
        });
        ledger.appendChild(row);
    });
}

function openProjectWindow(proj) {
    const existing=wins.find(w=>w.title===proj.title);
    if(existing){ focus(existing); return; }
    const w=mkWin({
        title:proj.title, model:proj.model,
        logFile:proj.logFile, path:proj.path,
    });
    focus(w);
}

// ── TILE ──────────────────────────────────────────────────
document.getElementById('tileBtn').addEventListener('click',()=>{
    const n=wins.length; if(!n) return;
    const cols=Math.ceil(Math.sqrt(n)), rows=Math.ceil(n/cols);
    const PAD=12, W=innerWidth, H=innerHeight-240;
    const cw=Math.floor((W-PAD*(cols+1))/cols);
    const ch=Math.floor((H-PAD*(rows+1))/rows);
    wins.forEach((w,i)=>{
        const col=i%cols, row=Math.floor(i/cols);
        if(w.state==='fullscreen') applyFS(w.element,false);
        w.element.classList.remove('minimized');
        w.state='normal';
        w.x=PAD+col*(cw+PAD); w.y=PAD+row*(ch+PAD);
        w.width=cw; w.height=ch;
        restoreGeo(w);
    });
});

// ── COMMAND CENTER TOGGLE ─────────────────────────────────
function toggleCmd() { document.getElementById('cmdBar').classList.toggle('collapsed'); }
document.getElementById('cmdHandle').addEventListener('click',toggleCmd);

// ── KEYBOARD ──────────────────────────────────────────────
let claudeShortcut = { ctrl: true, shift: true, key: 'C' };

document.addEventListener('keydown',e=>{
    if(e.target.tagName==='INPUT'||e.target.tagName==='SELECT') return;
    if(e.code==='Space'){ e.preventDefault(); toggleCmd(); }
    if(e.key==='Escape') { wins.filter(w=>w.state==='fullscreen').forEach(w=>toggleFS(w)); closeAbout(); }

    if (e.ctrlKey  === (claudeShortcut.ctrl  || false) &&
        e.shiftKey === (claudeShortcut.shift || false) &&
        e.altKey   === (claudeShortcut.alt   || false) &&
        e.key === claudeShortcut.key) {
        e.preventDefault();
        const focused = wins.find(w => w.element && w.element.classList.contains('focused'));
        if (focused) window.scc.termInput(focused.id, 'claude\n');
    }
});

// ── ADD PROJECT MODAL ─────────────────────────────────────
document.getElementById('addBtn').addEventListener('click',()=>{
    document.getElementById('modal').classList.add('show');
    setTimeout(()=>document.getElementById('mName').focus(),40);
});
document.getElementById('mCancel').addEventListener('click',closeModal);
document.getElementById('modal').addEventListener('click',e=>{ if(e.target===document.getElementById('modal')) closeModal(); });
document.getElementById('mOk').addEventListener('click',confirmModal);
document.getElementById('mName').addEventListener('keydown',e=>{ if(e.key==='Enter') confirmModal(); if(e.key==='Escape') closeModal(); });

// ── SHORTCUTS MODAL ───────────────────────────────────────
document.getElementById('shortcutsBtn').addEventListener('click',()=>{
    document.getElementById('shortcutsModal').classList.add('show');
});
document.getElementById('shortcutsClose').addEventListener('click',()=>{
    document.getElementById('shortcutsModal').classList.remove('show');
});
document.getElementById('shortcutsModal').addEventListener('click',e=>{
    if(e.target===document.getElementById('shortcutsModal'))
        document.getElementById('shortcutsModal').classList.remove('show');
});

// ── ABOUT MODAL ───────────────────────────────────────────
const ABOUT_JOKES = [
    'Why do developers prefer dark mode?\nLight attracts bugs.',
    'A QA engineer walks into a bar.\nOrders 0 beers. Orders 999999 beers. Orders -1 beers.',
    'git commit -m "fix"\ngit commit -m "fix2"\ngit commit -m "PLEASE WORK"',
    'It works on my machine.\n[ ships machine to client ]',
    'sudo make me a sandwich.\n-- Every developer at 2am',
    'There are 10 types of people:\nthose who get binary and those who do not.',
    'Senior dev tip:\nif it is stupid but it works, it is still stupid and you got lucky.',
    'The cloud is just someone else computer.\nAnd that computer is also someone else computer.'
];

const MANIFESTO =
    'Built for developers who run too many projects at once.\n' +
    'Because your terminal deserves to look like a cockpit.\n' +
    'Free forever. No VC. No ads. Just vibes and code.\n' +
    '-- Janua';

function openAbout() {
    document.getElementById('aboutJoke').textContent =
        ABOUT_JOKES[Math.floor(Math.random() * ABOUT_JOKES.length)];
    document.getElementById('aboutManifesto').textContent = MANIFESTO;
    document.getElementById('aboutModal').classList.add('show');
}

function closeAbout() {
    document.getElementById('aboutModal').classList.remove('show');
}

document.getElementById('aboutBtn').addEventListener('click', openAbout);
document.getElementById('aboutClose').addEventListener('click', closeAbout);
document.getElementById('aboutModal').addEventListener('click', e => {
    if (e.target === document.getElementById('aboutModal')) closeAbout();
});

async function confirmModal(){
    const name=document.getElementById('mName').value.trim();
    if(!name){ document.getElementById('mName').focus(); return; }
    const proj={
        title:name, model:document.getElementById('mModel').value,
        logFile:document.getElementById('mLog').value.trim(),
        path:document.getElementById('mPath').value.trim(),
    };
    projects.push(proj);
    openProjectWindow(proj);
    closeModal();
    const cfg = await window.scc.readConfig();
    cfg.projects = projects.map(p => ({ title: p.title, path: p.path || '', model: p.model }));
    await window.scc.writeConfig(cfg);
}

function closeModal(){
    document.getElementById('modal').classList.remove('show');
    ['mName','mLog','mPath'].forEach(id=>{ document.getElementById(id).value=''; });
}

// Apply nano background image from CSS variable
(() => {
    const nanoBg = getComputedStyle(document.documentElement).getPropertyValue('--nano-bg').trim();
    if (nanoBg && nanoBg !== 'none') {
        document.getElementById('cmdContent').style.backgroundImage = nanoBg;
    }
})();

// ── LEFT PANEL: HYPERDRIVE + BRAIN MODE ──────────────────
(() => {
    const zone = document.querySelector('.nano-side:first-child');
    const wc = document.createElement('canvas');
    wc.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;';
    wc.width = 520; wc.height = 200;
    zone.appendChild(wc);
    const ctx = wc.getContext('2d');
    const W = 520, H = 200, CX = W/2, CY = H/2;

    const MESSAGES = [
        'ADHD MODE', 'ACTIVATED',
        'HYPERFOCUS', 'ENGAGED',
        'CHAOS ENGINE', 'RUNNING',
        'SUPERSONIC', 'BRAIN ONLINE',
        'TURBO CORTEX', 'UNLEASHED'
    ];
    let msgIdx = 0, msgTimer = 0, msgPulse = 0;

    const warpStars = Array.from({length:120}, () => ({
        x:(Math.random()-0.5)*W, y:(Math.random()-0.5)*H,
        z:Math.random()*W, pz:0
    }));
    function resetStar(s){ s.x=(Math.random()-0.5)*W; s.y=(Math.random()-0.5)*H; s.z=W; s.pz=s.z; }

    function warpLoop() {
        ctx.fillStyle = 'rgba(0,4,14,0.22)';
        ctx.fillRect(0,0,W,H);

        warpStars.forEach(s => {
            s.pz = s.z; s.z -= 7;
            if (s.z <= 0) { resetStar(s); return; }
            const sx = (s.x/s.z)*W+CX, sy = (s.y/s.z)*H+CY;
            const px = (s.x/s.pz)*W+CX, py = (s.y/s.pz)*H+CY;
            if (sx<0||sx>W||sy<0||sy>H) { resetStar(s); return; }
            const t = 1-s.z/W;
            const bright = Math.floor(t*255);
            ctx.strokeStyle = `rgba(${bright},${Math.floor(bright*0.7)},255,${t})`;
            ctx.lineWidth = Math.max(0.4, t*2.2);
            ctx.beginPath(); ctx.moveTo(px,py); ctx.lineTo(sx,sy); ctx.stroke();
        });

        // center glow ring
        msgPulse += 0.04;
        const glow = ctx.createRadialGradient(CX,CY,8,CX,CY,60);
        glow.addColorStop(0, `rgba(0,200,255,${0.12+0.06*Math.sin(msgPulse)})`);
        glow.addColorStop(1, 'transparent');
        ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(CX,CY,60,0,Math.PI*2); ctx.fill();

        // message text
        msgTimer++;
        if (msgTimer > 220) { msgTimer = 0; msgIdx = (msgIdx+2) % MESSAGES.length; }
        const alpha = msgTimer < 30 ? msgTimer/30 : msgTimer > 190 ? (220-msgTimer)/30 : 1;
        ctx.save();
        ctx.shadowColor = '#0cf'; ctx.shadowBlur = 18;
        ctx.textAlign = 'center'; ctx.fillStyle = `rgba(0,230,255,${alpha})`;
        ctx.font = 'bold 13px "Orbitron", monospace';
        ctx.letterSpacing = '4px';
        ctx.fillText(MESSAGES[msgIdx], CX, CY-10);
        ctx.font = 'bold 11px "Orbitron", monospace';
        ctx.fillStyle = `rgba(180,240,255,${alpha*0.8})`;
        ctx.fillText(MESSAGES[msgIdx+1], CX, CY+10);
        ctx.restore();

        requestAnimationFrame(warpLoop);
    }
    warpLoop();
})();

// ── RIGHT PANEL: COCKPIT INSTRUMENTS ─────────────────────
(() => {
    const zone = document.querySelector('.nano-side:last-child');
    const wc = document.createElement('canvas');
    wc.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;';
    wc.width = 520; wc.height = 200;
    zone.appendChild(wc);
    const ctx = wc.getContext('2d');
    const W = 520, H = 200;
    let t = 0;

    // LEDs
    const leds = Array.from({length:16}, (_, i) => ({
        x: 18 + i*30, y: 16,
        color: ['#0f0','#0f0','#ff0','#f80','#f00','#0f0','#0ff','#0f0',
                '#f00','#ff0','#0f0','#0f0','#f80','#0ff','#f00','#0f0'][i],
        phase: Math.random()*Math.PI*2,
        rate:  0.04 + Math.random()*0.08
    }));

    // Rolling number displays (3 blocks)
    const counters = [
        { x:20,  y:40, label:'PWR', val:0, speed:7,   max:9999 },
        { x:195, y:40, label:'FREQ',val:0, speed:13,  max:9999 },
        { x:370, y:40, label:'VEC', val:0, speed:3,   max:9999 }
    ];

    // Toggle switches
    const toggles = [
        { x:30,  y:115, label:'THRUST',  state:1, flip:0, rate:320 },
        { x:110, y:115, label:'SHIELD',  state:1, flip:0, rate:480 },
        { x:190, y:115, label:'HYPDRV',  state:1, flip:0, rate:190 },
        { x:270, y:115, label:'NAVCOMP', state:0, flip:0, rate:560 },
        { x:350, y:115, label:'COMMS',   state:1, flip:0, rate:410 },
        { x:430, y:115, label:'LIFE-SP', state:1, flip:0, rate:700 }
    ];

    // Analog gauge
    const gauge = { x:460, y:110, r:32, val:0.6, target:0.6, label:'FLUX' };

    // Waveform
    const wave = { points: Array(80).fill(0), phase:0 };

    function drawLED(led) {
        const on = 0.5 + 0.5*Math.sin(led.phase + t*led.rate);
        const hex = led.color;
        ctx.beginPath(); ctx.arc(led.x, led.y, 5, 0, Math.PI*2);
        ctx.fillStyle = on > 0.4 ? hex : '#111';
        ctx.shadowColor = hex; ctx.shadowBlur = on > 0.4 ? 8 : 0;
        ctx.fill(); ctx.shadowBlur = 0;
        ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 0.5; ctx.stroke();
    }

    function drawCounter(c) {
        c.val = (c.val + c.speed) % (c.max+1);
        const str = String(Math.floor(c.val)).padStart(4,'0');
        // box
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.strokeStyle = 'rgba(0,255,100,0.3)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.roundRect(c.x, c.y, 115, 36, 2); ctx.fill(); ctx.stroke();
        // label
        ctx.fillStyle = 'rgba(0,200,80,0.45)'; ctx.font = '7px "Orbitron",monospace';
        ctx.textAlign = 'left'; ctx.fillText(c.label, c.x+4, c.y+10);
        // digits
        ctx.fillStyle = '#0f0'; ctx.font = 'bold 19px "Courier New",monospace';
        ctx.shadowColor = '#0f0'; ctx.shadowBlur = 6;
        ctx.fillText(str, c.x+10, c.y+30);
        ctx.shadowBlur = 0;
    }

    function drawToggle(tog) {
        tog.flip++;
        if (tog.flip > tog.rate) { tog.state = 1 - tog.state; tog.flip = 0; }
        const on = tog.state === 1;
        const bx = tog.x, by = tog.y;
        // base
        ctx.fillStyle = '#1a1a1a';
        ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.roundRect(bx, by, 48, 52, 3); ctx.fill(); ctx.stroke();
        // slot
        ctx.fillStyle = '#0a0a0a';
        ctx.beginPath(); ctx.roundRect(bx+17, by+4, 14, 34, 4); ctx.fill();
        // lever
        const ly = on ? by+6 : by+22;
        const lg = ctx.createLinearGradient(bx+16, ly, bx+32, ly+14);
        lg.addColorStop(0, on ? '#aaa' : '#888');
        lg.addColorStop(1, on ? '#555' : '#333');
        ctx.fillStyle = lg;
        ctx.beginPath(); ctx.roundRect(bx+16, ly, 16, 14, 3); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.stroke();
        // indicator dot
        ctx.beginPath(); ctx.arc(bx+24, by+44, 4, 0, Math.PI*2);
        ctx.fillStyle = on ? '#0f0' : '#500';
        ctx.shadowColor = on ? '#0f0' : '#f00'; ctx.shadowBlur = on ? 7 : 3;
        ctx.fill(); ctx.shadowBlur = 0;
        // label
        ctx.fillStyle = 'rgba(200,220,255,0.3)'; ctx.font = '5.5px "Orbitron",monospace';
        ctx.textAlign = 'center'; ctx.fillText(tog.label, bx+24, by+62);
    }

    function drawGauge(g) {
        g.target = 0.3 + 0.5*Math.sin(t*0.007) + 0.1*Math.sin(t*0.023);
        g.val += (g.target - g.val) * 0.02;
        const startA = Math.PI*0.75, endA = Math.PI*2.25;
        const sweep = startA + g.val*(endA-startA);
        // track
        ctx.beginPath(); ctx.arc(g.x, g.y, g.r, startA, endA);
        ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 5; ctx.stroke();
        // fill
        const gc = ctx.createLinearGradient(g.x-g.r, g.y, g.x+g.r, g.y);
        gc.addColorStop(0,'#0f0'); gc.addColorStop(0.6,'#ff0'); gc.addColorStop(1,'#f00');
        ctx.beginPath(); ctx.arc(g.x, g.y, g.r, startA, sweep);
        ctx.strokeStyle = gc; ctx.lineWidth = 5; ctx.stroke();
        // needle
        const nx = g.x + Math.cos(sweep)*g.r*0.7;
        const ny = g.y + Math.sin(sweep)*g.r*0.7;
        ctx.beginPath(); ctx.moveTo(g.x,g.y); ctx.lineTo(nx,ny);
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
        // center dot
        ctx.beginPath(); ctx.arc(g.x,g.y,4,0,Math.PI*2);
        ctx.fillStyle = '#ccc'; ctx.fill();
        // label
        ctx.fillStyle = 'rgba(200,220,255,0.4)'; ctx.font = '7px "Orbitron",monospace';
        ctx.textAlign = 'center'; ctx.fillText(g.label, g.x, g.y+g.r+12);
    }

    function drawWaveform() {
        wave.phase += 0.08;
        wave.points.shift();
        wave.points.push(Math.sin(wave.phase)*14 + Math.sin(wave.phase*2.3)*6 + (Math.random()-0.5)*3);
        const wx = 20, wy = 175, ww = 480, wh = 20;
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.beginPath(); ctx.roundRect(wx, wy-wh, ww, wh*2, 2); ctx.fill();
        ctx.beginPath();
        wave.points.forEach((p,i) => {
            const px = wx + (i/wave.points.length)*ww;
            const py = wy + p;
            i===0 ? ctx.moveTo(px,py) : ctx.lineTo(px,py);
        });
        ctx.strokeStyle = 'rgba(0,255,180,0.7)'; ctx.lineWidth = 1.2;
        ctx.shadowColor = '#0fb'; ctx.shadowBlur = 4; ctx.stroke(); ctx.shadowBlur = 0;
        // label
        ctx.fillStyle = 'rgba(0,255,180,0.3)'; ctx.font = '6px "Orbitron",monospace';
        ctx.textAlign = 'left'; ctx.fillText('SIG', wx+2, wy-wh+8);
    }

    function cockpitLoop() {
        t++;
        ctx.clearRect(0,0,W,H);
        // dark panel bg
        ctx.fillStyle = 'rgba(4,8,18,0.92)';
        ctx.fillRect(0,0,W,H);
        // subtle grid
        ctx.strokeStyle = 'rgba(0,60,100,0.18)'; ctx.lineWidth = 0.5;
        for(let i=0;i<W;i+=20){ ctx.beginPath();ctx.moveTo(i,0);ctx.lineTo(i,H);ctx.stroke(); }
        for(let j=0;j<H;j+=20){ ctx.beginPath();ctx.moveTo(0,j);ctx.lineTo(W,j);ctx.stroke(); }

        leds.forEach(drawLED);
        counters.forEach(drawCounter);
        toggles.forEach(drawToggle);
        drawGauge(gauge);
        drawWaveform();

        requestAnimationFrame(cockpitLoop);
    }
    cockpitLoop();
})();

// ── SHUTDOWN SOUND ────────────────────────────────────────
window.scc.onAppClosing(() => {
    playSound('shutdown.wav', 0.7);
});

// ── INIT ──────────────────────────────────────────────────
(async () => {
    playSound('startup.wav', 0.6);
    const ap = window.scc.assetsPath;
    document.getElementById('nanoLeft').style.backgroundImage  = `url('file://${ap}/images/nano-left.png')`;
    document.getElementById('nanoRight').style.backgroundImage = `url('file://${ap}/images/nano-right.png')`;
    const cfg = await window.scc.readConfig();

    if (cfg.theme) applyTheme(cfg.theme);

    if (cfg.soundEnabled === false) {
        soundEnabled = false;
        const btn = document.getElementById('soundBtn');
        if (btn) btn.textContent = 'SFX OFF';
    }

    if (cfg.claudeShortcut) {
        const parts = cfg.claudeShortcut.split('+');
        claudeShortcut = {
            ctrl:  parts.includes('Ctrl'),
            shift: parts.includes('Shift'),
            alt:   parts.includes('Alt'),
            key:   parts[parts.length - 1]
        };
    }

    if (cfg.projects && cfg.projects.length) {
        cfg.projects.forEach(p => {
            if (!projects.find(q => q.title === p.title)) projects.push(p);
        });
    }
    if (!projects.length) {
        DEFAULT_PROJECTS.forEach(p => projects.push({...p}));
    }
    refreshLedger();

    window.scc.onConfigChanged(newCfg => {
        if (newCfg.projects) {
            projects.length = 0;
            newCfg.projects.forEach(p => projects.push(p));
            refreshLedger();
        }
    });
})();
