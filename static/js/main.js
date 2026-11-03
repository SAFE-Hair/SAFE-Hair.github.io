(() => {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const INK = "#161616";

  /* ---------------- utilities ---------------- */
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  function setupCanvas(canvas) {
    const ctx = canvas.getContext("2d");
    const state = { w: 0, h: 0, dpr: 1 };
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      state.dpr = Math.min(window.devicePixelRatio || 1, 2);
      state.w = r.width;
      state.h = r.height;
      canvas.width = Math.round(r.width * state.dpr);
      canvas.height = Math.round(r.height * state.dpr);
      ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    };
    resize();
    return { ctx, state, resize };
  }

  function onVisible(el, cb) {
    let visible = false;
    new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      cb(visible);
    }).observe(el);
    return () => visible;
  }

  /* ---------------- strand integration ----------------
     Strands are grown from fixed scalp roots by forward integration,
     mirroring x_{t+1} = x_t + l_t * d_t from the paper. */
  function integrateStrand(s, head, opt, out) {
    const { cx, cy, R } = head;
    const T = opt.T;
    const seg = (s.len * opt.lengthScale) / T;
    let px = cx + Math.cos(s.a) * R;
    let py = cy + Math.sin(s.a) * R;
    let dx = Math.cos(s.a + (s.attachJitter || 0));
    let dy = Math.sin(s.a + (s.attachJitter || 0));
    out[0] = px; out[1] = py;
    let inside = 0;
    const minR = R * (opt.clearance || 1.035);
    for (let t = 1; t <= T; t++) {
      const u = t / T;
      const g = opt.gravity * (0.35 + u);
      dx = dx * (1 - g);
      dy = dy * (1 - g) + g;

      const ang = opt.curl * s.curlAmp * Math.sin(t * s.curlFreq + s.phase)
                + opt.wind * Math.sin(opt.time * 0.8 + s.phase + t * 0.18) * u;
      const c = Math.cos(ang), sn = Math.sin(ang);
      const ndx = dx * c - dy * sn;
      const ndy = dx * sn + dy * c;

      const nl = Math.hypot(ndx, ndy) || 1;
      dx = ndx / nl; dy = ndy / nl;
      px += dx * seg;
      py += dy * seg;

      const rx = px - cx, ry = py - cy;
      const rd = Math.hypot(rx, ry);
      if (rd < minR) {
        if (opt.collision) {
          px = cx + (rx / rd) * minR;
          py = cy + (ry / rd) * minR;
          const nx = rx / rd, ny = ry / rd;
          const dn = dx * nx + dy * ny;
          if (dn < 0) { dx -= dn * nx; dy -= dn * ny; }
          const l2 = Math.hypot(dx, dy) || 1;
          dx /= l2; dy /= l2;
        } else if (rd < R) {
          inside++;
        }
      }
      out[t * 2] = px; out[t * 2 + 1] = py;
    }
    return inside;
  }

  /* ---------------- METHOD DEMO (the live thing) ---------------- */
  function initDemo() {
    const canvas = document.getElementById("demo-canvas");
    if (!canvas) return;
    const { ctx, state, resize } = setupCanvas(canvas);
    const $ = (id) => document.getElementById(id);
    const inputs = {
      length: $("demo-length"), curl: $("demo-curl"),
      collision: $("demo-collision"), attach: $("demo-attach"), guides: $("demo-guides"),
    };
    const penEl = $("demo-pen"), legend = $("demo-legend");
    const T = 32;
    const G = 7;
    const guideColors = ["#2c5fb3", "#b5542a", "#2f7d5b", "#7a4fa3", "#a8862a", "#3a8aa0", "#9b3f5c"];
    let strands = [], head = {};
    const buf = new Float32Array((T + 1) * 2);

    function build() {
      const { w, h } = state;
      head = { cx: w / 2, cy: h * 0.4, R: Math.min(w, h) * 0.2 };
      strands = [];
      const n = 120;
      for (let i = 0; i < n; i++) {
        const a = -Math.PI - 0.3 + (Math.PI + 0.6) * (i + rand(-0.3, 0.3)) / (n - 1);
        const gid = clamp(Math.floor(((a + Math.PI + 0.3) / (Math.PI + 0.6)) * G), 0, G - 1);
        strands.push({
          a, gid,
          len: head.R * rand(1.5, 2.1),
          curlAmp: rand(0.3, 0.6), curlFreq: rand(0.45, 0.8), phase: rand(0, Math.PI * 2),
          flip: rand(-2.4, 2.4),
          tone: rand(0, 1),
          guide: false,
        });
      }
      for (let g = 0; g < G; g++) {
        const members = strands.filter((s) => s.gid === g);
        if (members.length) members[(members.length / 2) | 0].guide = true;
      }
    }

    function draw(now) {
      const time = now / 1000;
      const { w, h } = state;
      ctx.clearRect(0, 0, w, h);
      const opt = {
        T, lengthScale: +inputs.length.value, gravity: 0.085, curl: +inputs.curl.value * 1.6,
        wind: reduceMotion ? 0 : 0.07, time, collision: inputs.collision.checked,
      };
      const attach = inputs.attach.checked;
      const byGuide = inputs.guides.checked;

      ctx.beginPath();
      ctx.arc(head.cx, head.cy, head.R, 0, Math.PI * 2);
      ctx.fillStyle = "#e4e1db";
      ctx.fill();

      let inside = 0, total = 0;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (const s of strands) {
        s.attachJitter = attach ? 0 : s.flip;
        inside += integrateStrand(s, head, opt, buf);
        total += T;
        ctx.beginPath();
        ctx.moveTo(buf[0], buf[1]);
        for (let t = 1; t <= T; t++) ctx.lineTo(buf[t * 2], buf[t * 2 + 1]);
        if (byGuide) {
          ctx.strokeStyle = guideColors[s.gid];
          ctx.globalAlpha = s.guide ? 1 : 0.45;
          ctx.lineWidth = s.guide ? 2.6 : 1.1;
        } else {
          ctx.strokeStyle = `hsla(28, 22%, ${18 + s.tone * 16}%, 0.85)`;
          ctx.globalAlpha = 1;
          ctx.lineWidth = 1.2;
        }
        ctx.stroke();
        if (s.guide && byGuide) {
          ctx.fillStyle = "#fff";
          for (let t = 4; t <= T; t += 4) {
            ctx.beginPath();
            ctx.arc(buf[t * 2], buf[t * 2 + 1], 2, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      ctx.globalAlpha = 1;

      ctx.fillStyle = INK;
      for (const s of strands) {
        ctx.beginPath();
        ctx.arc(head.cx + Math.cos(s.a) * head.R, head.cy + Math.sin(s.a) * head.R, 1.8, 0, Math.PI * 2);
        ctx.fill();
      }

      const pen = (100 * inside) / total;
      penEl.textContent = pen.toFixed(1) + "%";
      legend.classList.toggle("warn", pen > 0.05);
    }

    let raf = 0;
    const isVisible = onVisible(canvas, (v) => {
      if (v && !raf) raf = requestAnimationFrame(loop);
    });
    function loop(now) {
      draw(now);
      raf = isVisible() && !reduceMotion ? requestAnimationFrame(loop) : 0;
    }
    build();
    draw(performance.now());
    Object.values(inputs).forEach((el) => el.addEventListener("input", () => { if (reduceMotion) draw(performance.now()); }));
    window.addEventListener("resize", () => { resize(); build(); draw(performance.now()); });
  }

  /* ---------------- REVEAL + COUNTERS ---------------- */
  function initReveal() {
    const targets = document.querySelectorAll("[data-reveal]");
    const reveal = (el) => {
      el.classList.add("is-in");
      el.querySelectorAll(".counter").forEach(animateCounter);
    };
    if (!("IntersectionObserver" in window)) { targets.forEach(reveal); return; }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        reveal(e.target);
        io.unobserve(e.target);
      });
    }, { rootMargin: "0px 0px -10% 0px", threshold: 0.08 });
    targets.forEach((el) => io.observe(el));
    window.addEventListener("load", () => setTimeout(() => {
      targets.forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.top < innerHeight && r.bottom > 0 && !el.classList.contains("is-in")) reveal(el);
      });
    }, 2500));
  }

  function animateCounter(el) {
    const to = parseFloat(el.dataset.to), dec = +el.dataset.dec || 0;
    if (reduceMotion) { el.textContent = to.toFixed(dec); return; }
    const dur = 1400, t0 = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - t0) / dur);
      el.textContent = (to * (1 - Math.pow(1 - p, 3))).toFixed(dec);
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /* ---------------- BAR CHART ---------------- */
  const DATA = {
    main: [
      ["Perm", [5.82, 61.4, 42.7, 0.781, 8.6]],
      ["NeuralHDHair", [4.36, 71.8, 56.2, 0.824, 6.1]],
      ["Hairstep", [4.48, 70.6, 59.4, 0.872, 7.2]],
      ["DiffLocks", [3.91, 76.5, 63.8, 0.847, 5.4]],
      ["Im2Haircut", [3.74, 77.9, 66.1, 0.861, 4.8]],
      ["SAFE-Hair (ours)", [3.28, 81.7, 69.8, 0.884, 3.9], true],
    ],
    ablation: [
      ["w/o Scalp UV", [3.91, 77.8, 63.5, 0.857, 5.1]],
      ["w/o Rectified Flow", [3.67, 78.9, 64.1, 0.866, 4.8]],
      ["w/o Latent Scalp Field", [3.58, 79.6, 66.0, 0.871, 4.6]],
      ["w/o Length Factorization", [3.49, 80.2, 67.1, 0.876, 4.4]],
      ["w/o Directions", [3.43, 80.8, 68.2, 0.879, 6.7]],
      ["Full SAFE-Hair", [3.28, 81.7, 69.8, 0.884, 3.9], true],
    ],
  };
  const LOWER_BETTER = [true, false, false, false, true];
  const DECIMALS = [2, 1, 1, 3, 1];

  function initChart() {
    const barsEl = document.getElementById("bars");
    if (!barsEl) return;
    let set = "main", metric = 0;

    function render() {
      const rows = DATA[set];
      const vals = rows.map((r) => r[1][metric]);
      const lo = Math.min(...vals), hi = Math.max(...vals);
      const span = hi - lo || 1;
      if (!barsEl.children.length || barsEl.dataset.set !== set) {
        barsEl.innerHTML = rows.map(([name, , ours]) => `
          <div class="bar-row${ours ? " ours" : ""}">
            <div class="bar-name" title="${name}">${name}</div>
            <div class="bar-track"><div class="bar-fill"></div></div>
            <div class="bar-val"></div>
          </div>`).join("") +
          `<p class="bars-hint"></p>`;
        barsEl.dataset.set = set;
      }
      const rowEls = barsEl.querySelectorAll(".bar-row");
      rows.forEach((r, i) => {
        const v = r[1][metric];
        const pct = 14 + 86 * (v - lo) / span;
        const fill = rowEls[i].querySelector(".bar-fill");
        requestAnimationFrame(() => { fill.style.width = pct + "%"; });
        rowEls[i].querySelector(".bar-val").textContent = v.toFixed(DECIMALS[metric]);
      });
      barsEl.querySelector(".bars-hint").textContent =
        (LOWER_BETTER[metric] ? "Lower is better" : "Higher is better") + ". Bars are scaled to the range of this metric.";
    }

    const bindTabs = (id, cb) => {
      const root = document.getElementById(id);
      const buttons = root.querySelectorAll("button");
      buttons.forEach((b) => b.addEventListener("click", () => {
        buttons.forEach((x) => { x.classList.toggle("active", x === b); x.setAttribute("aria-pressed", String(x === b)); });
        cb(b);
        render();
      }));
    };
    bindTabs("chart-dataset", (b) => { set = b.dataset.set; });
    bindTabs("chart-metric", (b) => { metric = +b.dataset.metric; });

    if (!("IntersectionObserver" in window)) { render(); return; }
    new IntersectionObserver(([e], obs) => {
      if (e.isIntersecting) { render(); obs.disconnect(); }
    }, { threshold: 0.2 }).observe(barsEl);
  }

  /* ---------------- LIGHTBOX ---------------- */
  function initLightbox() {
    const box = document.getElementById("lightbox");
    const img = document.getElementById("lightbox-img");
    const close = () => { box.classList.remove("open"); box.setAttribute("aria-hidden", "true"); };
    document.querySelectorAll(".zoomable").forEach((el) => el.addEventListener("click", () => {
      img.src = el.currentSrc || el.src;
      img.alt = el.alt;
      box.classList.add("open");
      box.setAttribute("aria-hidden", "false");
    }));
    box.addEventListener("click", close);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  }

  /* ---------------- BIBTEX ---------------- */
  function initCopy() {
    const btn = document.getElementById("copy-bib");
    if (!btn) return;
    btn.addEventListener("click", async () => {
      const text = document.getElementById("bib-text").textContent;
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        const ta = Object.assign(document.createElement("textarea"), { value: text });
        document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove();
      }
      btn.textContent = "Copied";
      btn.classList.add("done");
      setTimeout(() => { btn.textContent = "Copy"; btn.classList.remove("done"); }, 1600);
    });
  }

  initDemo();
  initReveal();
  initChart();
  initLightbox();
  initCopy();
})();
