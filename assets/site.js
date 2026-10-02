(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const smoothstep = (p, e0, e1) => { const t = clamp((p - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } }
  };
  const RM = matchMedia('(prefers-reduced-motion: reduce)');

  /* ================= Seeded splitting ================= */
  function rng(seed) {
    let s = seed >>> 0;
    return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  }

  function split(el, text, seed) {
    const band = el.closest('.band');
    const fx = band ? [...band.classList].find(c => c.startsWith('fx-')) : null;
    const spread = band ? parseFloat(band.dataset.spread || '0.5') : 0.5;
    const r = rng(seed);
    el.textContent = '';
    const sr = document.createElement('span');
    sr.className = 'sr';
    sr.textContent = text.replace(/\|/g, ' ');
    const vis = document.createElement('span');
    vis.className = 'vis';
    vis.setAttribute('aria-hidden', 'true');
    // "|" in the copy marks a designed line break
    const words = text.replace(/\|/g, ' | ').split(/ +/).filter(Boolean);
    const totalChars = text.replace(/[ |]/g, '').length;
    let ci = 0;
    words.forEach((word, wi) => {
      if (word === '|') { vis.appendChild(document.createElement('br')); return; }
      const w = document.createElement('span');
      w.className = 'w';
      if (fx === 'fx-drift' || fx === 'fx-rise') {
        w.style.setProperty('--th', (wi / Math.max(1, words.length) * 0.45).toFixed(3));
      }
      [...word].forEach(ch => {
        const c = document.createElement('span');
        c.className = 'c';
        c.textContent = ch;
        if (fx === 'fx-scatter') {
          c.style.setProperty('--th', (r() * 0.55).toFixed(3));
          c.style.setProperty('--jx', ((r() - 0.5) * 220).toFixed(1) + 'px');
          c.style.setProperty('--jy', ((r() - 0.5) * 160).toFixed(1) + 'px');
          c.style.setProperty('--jr', ((r() - 0.5) * 80).toFixed(1) + 'deg');
        } else if (fx === 'fx-grid') {
          c.style.setProperty('--th', (ci / totalChars * spread + r() * 0.06).toFixed(3));
          c.style.setProperty('--jx', ((ci % 2 ? 1 : -1) * (30 + r() * 60)).toFixed(1) + 'px');
        }
        ci++;
        w.appendChild(c);
      });
      vis.appendChild(w);
      if (wi < words.length - 1) vis.appendChild(document.createTextNode(' '));
    });
    el.append(sr, vis);
  }

  /* ================= i18n ================= */
  const DICT = window.I18N || {};
  let lang = 'es';
  const t = k => (DICT[lang] && DICT[lang][k] !== undefined ? DICT[lang][k] : (DICT.es && DICT.es[k]) || '');

  function applyLang(next) {
    lang = DICT[next] ? next : 'es';
    document.documentElement.lang = lang;
    $$('[data-i18n]').forEach(el => {
      const val = t(el.dataset.i18n);
      if (el.classList.contains('split')) return;
      if (typeof val === 'string' && val) el.textContent = val;
    });
    $$('[data-i18n-ph]').forEach(el => { el.placeholder = t(el.dataset.i18nPh); });
    $$('[data-i18n-list]').forEach(ul => {
      const items = t(ul.dataset.i18nList);
      if (!Array.isArray(items)) return;
      ul.textContent = '';
      items.forEach(s => { const li = document.createElement('li'); li.textContent = s; ul.appendChild(li); });
    });
    $$('.split').forEach((el, i) => split(el, t(el.dataset.i18n), 1337 + i * 97));
    $$('.cv-link,[data-cv]').forEach(a => a.setAttribute('href', t('cv.file')));
    document.title = t('meta.title');
    const md = $('meta[name="description"]'); if (md) md.setAttribute('content', t('meta.desc'));
    $$('.lang button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
    bands.forEach(b => { b.op = -1; b.k = -1; });
    if (scrubOn) updateCaptions(shown);
    suite.relabel();
    store.set('lang', lang);
  }

  /* ================= Hero scrub ================= */
  const hero = $('#hero');
  const stage = $('.stage', hero);
  const video = $('#hero-video');
  const posterLayer = $('.poster', hero);
  const loader = $('.loader', hero);
  const ring = $('.ring', hero);
  const hudText = $('.hud-text', hero);
  const bands = $$('.band', hero).map((el, i, all) => ({
    el, a: parseFloat(el.dataset.a), b: parseFloat(el.dataset.b),
    ramp: el.dataset.ramp ? parseFloat(el.dataset.ramp) : null,
    first: i === 0, last: i === all.length - 1, op: -1, k: -1, live: null
  }));

  const VIDEO_URL = 'assets/hero-scrub.mp4';
  const VIDEO_BYTES = 9222158;
  const POSTER_URL = 'assets/img/hero-poster.jpg';
  const ENDING_URL = 'assets/img/hero-ending.jpg';

  let target = 0, shown = 0, rafId = null, lastTick = 0;
  let heroOnScreen = true, scrubOn = false, heroInit = false, videoFailed = false;
  let loadK = 0, loadStart = 0, loadRaf = null;
  let seekBusy = false, pendingTime = null;
  let lastHud = '', lastHudAt = 0, posterState = '';

  function heroProgress() {
    const range = hero.offsetHeight - innerHeight;
    if (range <= 0) return 0;
    return clamp(-hero.getBoundingClientRect().top / range, 0, 1);
  }

  function requestSeek(time) {
    if (!video.duration || videoFailed) return;
    const tt = clamp(time, 0, video.duration - 0.04);
    if (seekBusy) { pendingTime = tt; return; }
    seekBusy = true;
    video.currentTime = tt;
  }
  video.addEventListener('seeked', () => {
    seekBusy = false;
    if (pendingTime !== null) { const tt = pendingTime; pendingTime = null; requestSeek(tt); }
  });
  video.addEventListener('error', () => { seekBusy = false; pendingTime = null; failVideo(); });

  function updateCaptions(p) {
    for (const b of bands) {
      const f = Math.min(0.02, (b.b - b.a) / 3);
      let op;
      if (b.first) op = 1 - smoothstep(p, b.b - f, b.b);
      else if (b.last) op = smoothstep(p, b.a, b.a + f);
      else op = smoothstep(p, b.a, b.a + f) * (1 - smoothstep(p, b.b - f, b.b));
      const ramp = b.ramp || Math.min(0.04, (b.b - b.a) * 0.35);
      let k = clamp((p - b.a) / ramp, 0, 1);
      if (b.first) k = Math.max(k, loadK);
      if (Math.abs(op - b.op) > 0.004 || (op === 0) !== (b.op === 0) || (op === 1) !== (b.op === 1)) {
        b.op = op;
        b.el.style.opacity = op.toFixed(3);
      }
      if (Math.abs(k - b.k) > 0.008 || (k === 1 && b.k !== 1) || (k === 0 && b.k !== 0)) {
        b.k = k;
        b.el.style.setProperty('--k', k.toFixed(3));
      }
      const live = op > 0.5;
      if (live !== b.live) { b.live = live; b.el.classList.toggle('live', live); }
    }
    if (videoFailed) {
      const want = p > 0.62 ? 'end' : 'start';
      if (want !== posterState) {
        posterState = want;
        posterLayer.style.backgroundImage = `url('${want === 'end' ? ENDING_URL : POSTER_URL}')`;
      }
    }
  }

  function updateHud(p, now) {
    if (now - lastHudAt < 100) return;
    const txt = 'scan ' + String(Math.round(p * 100)).padStart(3, '0') + '%';
    if (txt === lastHud) return;
    lastHud = txt; lastHudAt = now;
    hudText.textContent = txt;
  }

  let cueGone = false;
  function tick(now) {
    const dt = Math.min(100, now - (lastTick || now));
    lastTick = now;
    const kk = 0.14;
    shown += (target - shown) * (1 - Math.pow(1 - kk, dt / 16.667));
    if (Math.abs(target - shown) < 0.0005) {
      shown = target; rafId = null; lastTick = 0;
    } else {
      rafId = requestAnimationFrame(tick);
    }
    if (video.duration) requestSeek(shown * video.duration);
    updateCaptions(shown);
    updateHud(shown, now);
    const gone = shown > 0.03;
    if (gone !== cueGone) { cueGone = gone; loader.classList.toggle('gone', gone); }
  }

  function onScroll() {
    target = heroProgress();
    if (rafId === null && heroOnScreen) rafId = requestAnimationFrame(tick);
  }

  new IntersectionObserver(es => {
    heroOnScreen = es[0].isIntersecting;
    if (heroOnScreen && scrubOn) onScroll();
  }).observe(hero);

  function loadRamp(now) {
    if (!loadStart) loadStart = now;
    const x = clamp((now - loadStart) / 1400, 0, 1);
    loadK = 1 - Math.pow(1 - x, 3);
    if (scrubOn) updateCaptions(shown);
    loadRaf = x < 1 ? requestAnimationFrame(loadRamp) : null;
  }

  function initHeroOnce() {
    if (heroInit) return;
    heroInit = true;
    posterLayer.style.backgroundImage = `url('${POSTER_URL}')`;
    posterState = 'start';
    let started = false;
    const startBlobFetch = () => {
      if (started) return;
      started = true;
      loadHeroBlob().catch(failVideo);
    };
    const img = new Image();
    img.onload = startBlobFetch;
    img.onerror = startBlobFetch;
    img.src = POSTER_URL;
    setTimeout(startBlobFetch, 4000);
  }

  async function loadHeroBlob() {
    if (location.protocol === 'file:') throw new Error('file protocol');
    const ctrl = new AbortController();
    let watchdog = setTimeout(() => ctrl.abort(), 20000);
    const res = await fetch(VIDEO_URL, { priority: 'low', signal: ctrl.signal });
    if (!res.ok || !res.body) throw new Error('video ' + res.status);
    const total = Number(res.headers.get('Content-Length')) || VIDEO_BYTES;
    const reader = res.body.getReader();
    const chunks = [];
    let got = 0, lastRing = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      clearTimeout(watchdog);
      watchdog = setTimeout(() => ctrl.abort(), 20000);
      chunks.push(value);
      got += value.length;
      const frac = Math.min(1, got / total);
      const now = performance.now();
      if (now - lastRing > 100 || frac === 1) {
        lastRing = now;
        ring.style.setProperty('--ld', Math.round(126 * (1 - frac)));
      }
    }
    clearTimeout(watchdog);
    ring.style.setProperty('--ld', 0);
    video.src = URL.createObjectURL(new Blob(chunks, { type: 'video/mp4' }));
    video.load();
    video.addEventListener('canplay', () => {
      requestSeek(heroProgress() * video.duration);
      stage.classList.add('video-ready');
    }, { once: true });
  }

  function failVideo() {
    if (videoFailed) return;
    videoFailed = true;
    stage.classList.add('video-failed');
    if (scrubOn) updateCaptions(shown);
  }

  const GATES = [
    '(max-width: 720px)',
    '(orientation: portrait) and (max-width: 1024px)',
    '(orientation: portrait) and (pointer: coarse)',
    '(orientation: landscape) and (pointer: coarse) and (max-height: 560px)',
    '(prefers-reduced-motion: reduce)'
  ];
  const MQLS = GATES.map(q => matchMedia(q));

  function enableScrub() {
    if (scrubOn) return;
    scrubOn = true;
    initHeroOnce();
    addEventListener('scroll', onScroll, { passive: true });
    bands.forEach(b => { b.op = -1; b.k = -1; b.live = null; });
    target = shown = heroProgress();
    updateCaptions(shown);
    if (!loadRaf && loadK < 1) { loadStart = 0; loadRaf = requestAnimationFrame(loadRamp); }
    onScroll();
  }
  function disableScrub() {
    if (!scrubOn) return;
    scrubOn = false;
    removeEventListener('scroll', onScroll);
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; lastTick = 0; }
  }
  function applyHeroMode() {
    if (MQLS.some(m => m.matches)) disableScrub();
    else enableScrub();
  }
  MQLS.forEach(m => m.addEventListener('change', applyHeroMode));

  /* ================= Environment particles ================= */
  const env = (() => {
    const cv = $('#env');
    const ctx = cv.getContext('2d');
    let w = 0, h = 0, dpr = 1, pts = [], raf = null, last = 0, running = false;
    function resize() {
      dpr = Math.min(2, devicePixelRatio || 1);
      w = innerWidth; h = innerHeight;
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.min(90, Math.round(w * h / 18000));
      const r = rng(42);
      pts = Array.from({ length: n }, () => ({
        x: r() * w, y: r() * h, rad: 0.5 + r() * 1.3,
        vy: -(0.04 + r() * 0.16), vx: (r() - 0.5) * 0.06,
        a: 0.12 + r() * 0.38, ph: r() * Math.PI * 2, warm: r() < 0.04
      }));
      draw(0);
    }
    function draw(time) {
      ctx.clearRect(0, 0, w, h);
      for (const p of pts) {
        const tw = 0.65 + 0.35 * Math.sin(time / 1800 + p.ph);
        ctx.globalAlpha = p.a * tw;
        ctx.fillStyle = p.warm ? '#ff5a5f' : '#7fe7ff';
        ctx.beginPath(); ctx.arc(p.x, p.y, p.rad, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    function frame(now) {
      raf = requestAnimationFrame(frame);
      if (now - last < 33) return;
      const dt = Math.min(100, now - (last || now)) / 16.667;
      last = now;
      if (hero.getBoundingClientRect().bottom > innerHeight && scrubOn) return; // hero stage covers the screen
      for (const p of pts) {
        p.y += p.vy * dt; p.x += p.vx * dt;
        if (p.y < -4) { p.y = h + 4; } if (p.x < -4) p.x = w + 4; if (p.x > w + 4) p.x = -4;
      }
      draw(now);
    }
    return {
      start() { if (running || RM.matches) return; running = true; last = 0; raf = requestAnimationFrame(frame); },
      stop() { running = false; if (raf) cancelAnimationFrame(raf); raf = null; },
      resize
    };
  })();
  addEventListener('resize', () => env.resize(), { passive: true });

  /* ================= Reveal choreography ================= */
  const revealed = new WeakSet();
  const forced = new Set();
  function settle(el, delayMs) {
    setTimeout(() => el.classList.add('settled'), delayMs + 1100);
  }
  const io = new IntersectionObserver(entries => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const el = e.target;
      io.unobserve(el);
      revealed.add(el);
      forced.delete(el);
      el.classList.add('in');
      const d = parseFloat(getComputedStyle(el).getPropertyValue('--d')) || 0;
      settle(el, d * 1000 + (el.classList.contains('flow') ? 1200 : 0));
    }
  }, { rootMargin: '0px 0px -12% 0px', threshold: 0.12 });

  function initReveals() {
    // stagger siblings that share a parent
    const groups = new Map();
    $$('.reveal').forEach(el => {
      const p = el.parentElement;
      if (!groups.has(p)) groups.set(p, []);
      groups.get(p).push(el);
    });
    groups.forEach(list => list.forEach((el, i) => el.style.setProperty('--d', (i * 0.11).toFixed(2) + 's')));
    $$('.flow .flow-node').forEach((n, i) => n.style.setProperty('--i', i));
    $$('.reveal, .scanline').forEach(el => io.observe(el));
  }

  /* ================= Scroll-linked page details ================= */
  const nav = $('.nav');
  const timeline = $('#timeline');
  let navSolid = null, tlDraw = -1, pageRaf = null;
  function pageScroll() {
    pageRaf = null;
    const solid = hero.getBoundingClientRect().bottom < 80;
    if (solid !== navSolid) { navSolid = solid; nav.classList.toggle('solid', solid); }
    if (!RM.matches && timeline) {
      const r = timeline.getBoundingClientRect();
      const d = clamp((innerHeight * 0.62 - r.top) / r.height, 0, 1);
      if (Math.abs(d - tlDraw) > 0.002 || (d === 1 && tlDraw !== 1)) {
        tlDraw = d;
        timeline.style.setProperty('--draw', d.toFixed(4));
      }
    }
  }
  addEventListener('scroll', () => { if (!pageRaf) pageRaf = requestAnimationFrame(pageScroll); }, { passive: true });

  // active nav link
  const navLinks = $$('.nav-links a');
  const navIO = new IntersectionObserver(es => {
    es.forEach(e => {
      if (!e.isIntersecting) return;
      navLinks.forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#' + e.target.id));
    });
  }, { rootMargin: '-45% 0px -50% 0px' });
  ['hero', 'perfil', 'capas', 'suite', 'experiencia', 'framework', 'stack', 'faq', 'contacto'].forEach(id => { const s = document.getElementById(id); if (s) navIO.observe(s); });

  /* ================= The interactive moment: run the suite ================= */
  const suite = (() => {
    const btn = $('#hold');
    const con = $('#console');
    const foot = $('#console-foot span');
    const label = $('.hold-label span:last-child', btn);
    const lines = $$('.ln', con);
    const HOLD_MS = 2600;
    let p = 0, holding = false, done = false, raf = null, last = 0, lastP = -1;
    const runState = lines.map(() => false);
    let footKey = 'suite.idle';

    function setFoot(key) { if (key !== footKey) { footKey = key; foot.textContent = t(key); } }
    function render() {
      if (Math.abs(p - lastP) > 0.003 || p === 0 || p === 1) {
        lastP = p;
        btn.style.setProperty('--p', p.toFixed(3));
      }
      const n = lines.length;
      lines.forEach((ln, i) => {
        const on = p >= (i + 0.6) / (n + 0.4);
        if (on !== runState[i]) { runState[i] = on; ln.classList.toggle('run', on); }
      });
      setFoot(done ? 'suite.done' : (p > 0.02 ? 'suite.running' : 'suite.idle'));
    }
    function loop(now) {
      const dt = Math.min(100, now - (last || now));
      last = now;
      if (holding) p = Math.min(1, p + dt / HOLD_MS);
      else if (!done) p = Math.max(0, p - (dt / 900) * (0.35 + p)); // eases back down, never snaps
      if (p >= 1 && !done) finish();
      render();
      if ((holding && !done) || (!holding && !done && p > 0)) raf = requestAnimationFrame(loop);
      else { raf = null; last = 0; }
    }
    function kick() { if (!raf) { last = 0; raf = requestAnimationFrame(loop); } }
    function finish() {
      done = true; holding = false; p = 1;
      btn.classList.remove('holding');
      btn.classList.add('done');
      con.classList.add('done');
      label.textContent = t('suite.btnDone');
    }
    function reset() {
      done = false; p = 0;
      btn.classList.remove('done');
      con.classList.remove('done');
      label.textContent = t('suite.btn');
      render();
    }
    function start() {
      if (done) reset();
      holding = true;
      btn.classList.add('holding');
      kick();
    }
    function stop() {
      if (!holding) return;
      holding = false;
      btn.classList.remove('holding');
      kick();
    }
    btn.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      btn.setPointerCapture && btn.setPointerCapture(e.pointerId);
      start();
    });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(ev => btn.addEventListener(ev, stop));
    btn.addEventListener('keydown', e => {
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); if (!e.repeat) start(); }
    });
    btn.addEventListener('keyup', e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); stop(); } });
    btn.addEventListener('click', e => e.preventDefault());
    btn.addEventListener('contextmenu', e => e.preventDefault());
    return {
      complete() { holding = false; if (!done) finish(); render(); },
      reset() { holding = false; reset(); },
      relabel() { label.textContent = t(done ? 'suite.btnDone' : 'suite.btn'); foot.textContent = t(footKey); }
    };
  })();

  /* ================= Contact ================= */
  const form = $('#form');
  const err = $('#form-error');
  form.addEventListener('submit', e => {
    e.preventDefault();
    const name = form.name.value.trim();
    const email = form.email.value.trim();
    const company = form.company.value.trim();
    const msg = form.message.value.trim();
    $$('.invalid', form).forEach(x => x.classList.remove('invalid'));
    let bad = null;
    if (!name) bad = ['f-name', 'form.errName'];
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) bad = ['f-email', 'form.errEmail'];
    else if (msg.length < 3) bad = ['f-msg', 'form.errMsg'];
    if (bad) {
      const f = document.getElementById(bad[0]);
      f.classList.add('invalid'); f.focus();
      err.textContent = t(bad[1]);
      return;
    }
    err.textContent = '';
    const body = `${msg}\n\n${name}${company ? ' · ' + company : ''}\n${email}`;
    location.href = 'mailto:carlosriosdev@gmail.com?subject=' + encodeURIComponent(t('form.subject') + ': ' + name) + '&body=' + encodeURIComponent(body);
    form.classList.add('sent');
    setTimeout(() => $('#form-ok').focus(), 300);
  });

  const toast = $('#toast');
  let toastTimer = null;
  function showToast(text) {
    toast.textContent = text;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
  }
  $('#copy-email').addEventListener('click', async () => {
    const mail = 'carlosriosdev@gmail.com';
    try { await navigator.clipboard.writeText(mail); showToast(t('contact.copied')); }
    catch (e) { location.href = 'mailto:' + mail; }
  });

  /* ================= Language toggle ================= */
  $$('.lang button').forEach(b => b.addEventListener('click', () => applyLang(b.dataset.lang)));

  /* ================= Reduced motion, live in both directions ================= */
  function pinToFinalStates() {
    document.documentElement.classList.add('pinned');
    $$('.reveal, .scanline').forEach(el => {
      if (!el.classList.contains('in')) { forced.add(el); el.classList.add('in', 'settled'); }
    });
    if (timeline) timeline.style.setProperty('--draw', '1');
    tlDraw = 1;
    env.stop();
    suite.complete();
  }
  function unpinFinalStates() {
    document.documentElement.classList.remove('pinned');
    forced.forEach(el => { el.classList.remove('in', 'settled'); io.observe(el); });
    forced.clear();
    tlDraw = -1;
    pageScroll();
    suite.reset();
    env.start();
  }
  RM.addEventListener('change', e => {
    if (e.matches) pinToFinalStates();
    else { unpinFinalStates(); applyHeroMode(); }
  });

  /* ================= Hidden tab ================= */
  document.addEventListener('visibilitychange', () => {
    const hidden = document.hidden;
    document.body.classList.toggle('paused', hidden);
    if (hidden) env.stop(); else env.start();
  });

  /* ================= Boot ================= */
  const saved = store.get('lang');
  const initial = saved || ((navigator.language || 'es').toLowerCase().startsWith('es') ? 'es' : 'en');
  applyLang(initial);
  initReveals();
  env.resize();
  applyHeroMode();
  pageScroll();
  if (RM.matches) pinToFinalStates(); else env.start();
})();
