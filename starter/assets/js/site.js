/* ============================================================
   Site — site behaviours. Vanilla JS, no dependencies.
   Every module is optional: each checks for its own markup and
   returns quietly if the current page doesn't contain it.
   ============================================================ */
(function () {
  "use strict";
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var $  = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* Each page normally has exactly one nav, CTA, swatch strip and so on, so
     binding the first match would be enough. The single-file preview bundle
     puts all five pages in one document, where that would wire only the first
     copy — so every module below binds ALL of its instances, scoping lookups
     to the containing page section when there is one. */
  function pageRootOf(el) { return el.closest(".pv") || document; }

  /* ---------- mobile nav ---------- */
  (function nav() {
    $$(".nav-toggle").forEach(function (toggle) {
      var root = pageRootOf(toggle);
      var drawer = root.querySelector(".nav-drawer");
      if (!drawer) return;
      function set(open) {
        toggle.setAttribute("aria-expanded", String(open));
        drawer.setAttribute("data-open", String(open));
        document.body.style.overflow = open ? "hidden" : "";
      }
      toggle.addEventListener("click", function () {
        set(toggle.getAttribute("aria-expanded") !== "true");
      });
      $$("a", drawer).forEach(function (a) {
        a.addEventListener("click", function () { set(false); });
      });
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && toggle.getAttribute("aria-expanded") === "true") { set(false); toggle.focus(); }
      });
      window.addEventListener("resize", function () {
        if (window.innerWidth > 760) set(false);
      });
    });
  })();

  /* ---------- reveal on scroll ---------- */
  (function reveal() {
    var els = $$("[data-reveal]");
    if (!els.length) return;
    if (reduce || !("IntersectionObserver" in window)) {
      els.forEach(function (el) { el.classList.add("in"); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        var d = parseInt(e.target.getAttribute("data-reveal-delay") || "0", 10);
        setTimeout(function () { e.target.classList.add("in"); }, d);
        io.unobserve(e.target);
      });
    }, { threshold: 0.15, rootMargin: "0px 0px -8% 0px" });
    els.forEach(function (el) { io.observe(el); });
  })();

  /* ---------- heated buttons track the cursor ---------- */
  document.addEventListener("pointermove", function (e) {
    var b = e.target.closest && e.target.closest(".btn--heat");
    if (!b) return;
    var r = b.getBoundingClientRect();
    b.style.setProperty("--mx", (e.clientX - r.left) + "px");
    b.style.setProperty("--my", (e.clientY - r.top) + "px");
  });

  /* ---------- CTA: plasma-cut headline ----------
     The FORGE hero's treatment applied to "Set up a call". Runs only while
     the band is on screen, so it costs nothing on the rest of the page. */
  (function ctaCut() {
    if (reduce) return;                         /* CSS already shows the finished state */
    $$(".cta-band .cut-row").forEach(function (row) { runCut(row); });

    function runCut(row) {
    var CUT_SPEED = 0.9,      /* cut progress per second  -> ~1.1s sweep */
        COOL_RATE = 0.5,      /* heat lost per second     -> ~2s to cool */
        REPEAT_S  = 9,        /* pause before the next cut */
        cut = 1, heat = 0, cutting = false, visible = false,
        idle = 0, raf = null, last = 0;

    function paint() {
      row.style.setProperty("--cut", (cut * 100).toFixed(2) + "%");
      row.style.setProperty("--heat", heat.toFixed(3));
      row.style.setProperty("--cutting", cutting ? "1" : "0");
    }
    function start() { cut = 0; heat = 1; cutting = true; idle = 0; last = 0; }

    function loop(now) {
      raf = requestAnimationFrame(loop);
      if (!visible) return;
      var dt = last ? Math.min((now - last) / 1000, 0.05) : 0;
      last = now;
      if (cutting) {
        cut += CUT_SPEED * dt;
        if (cut >= 1) { cut = 1; cutting = false; idle = 0; }
      } else {
        if (heat > 0) heat = Math.max(0, heat - COOL_RATE * dt);
        /* the pause runs on the same clamped frame clock as the cut and the
           cool — on wall-clock it could lap them whenever frames are starved */
        idle += dt;
        if (idle > REPEAT_S) start();
      }
      paint();
    }

    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (es) {
        var nowVisible = es[0].isIntersecting;
        if (nowVisible && !visible) { start(); last = 0; }   /* re-cut on re-entry */
        visible = nowVisible;
      }, { threshold: 0.35 }).observe(row);
    } else { visible = true; start(); }

    raf = requestAnimationFrame(loop);
    }
  })();

  /* ---------- services: spark field on the fabrication band ---------- */
  (function sparks() {
    if (reduce) return;
    $$(".spark-canvas").forEach(function (cv) { runSparks(cv); });

    function runSparks(cv) {
    var ctx = cv.getContext("2d"), parts = [], w = 0, h = 0,
        DPR = Math.min(window.devicePixelRatio || 1, 2), raf = null, visible = false;

    function size() {
      var r = cv.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return false;
      if (r.width === w && r.height === h) return true;
      w = r.width; h = r.height;
      cv.width = w * DPR; cv.height = h * DPR;
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      return true;
    }
    function emit(n) {
      var ox = w * 0.18, oy = h * 0.44;
      for (var i = 0; i < n; i++) {
        var a = Math.random() * Math.PI * 2, s = 1 + Math.random() * 5.5;
        parts.push({ x: ox + (Math.random() - .5) * 40, y: oy + (Math.random() - .5) * 40,
                     vx: Math.cos(a) * s * 1.2, vy: Math.sin(a) * s - 1.5,
                     life: 1, decay: .012 + Math.random() * .022, r: .5 + Math.random() * 1.5 });
      }
      if (parts.length > 700) parts.splice(0, parts.length - 700);
    }
    function loop() {
      raf = requestAnimationFrame(loop);
      if (!visible || !size()) return;
      if (Math.random() < .5) emit(3);
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = "lighter";
      for (var i = parts.length - 1; i >= 0; i--) {
        var p = parts[i];
        p.vy += .12; p.vx *= .988; p.vy *= .994;
        p.x += p.vx; p.y += p.vy; p.life -= p.decay;
        if (p.life <= 0 || p.y > h + 30) { parts.splice(i, 1); continue; }
        var l = p.life, col = l > .7 ? "255,255,255" : (l > .38 ? "255,179,92" : "255,90,31");
        var g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 5);
        g.addColorStop(0, "rgba(" + col + "," + l + ")");
        g.addColorStop(1, "rgba(" + col + ",0)");
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 5, 0, 6.283); ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";
    }
    /* only burn frames while the band is actually on screen */
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (es) { visible = es[0].isIntersecting; },
        { threshold: 0.05 }).observe(cv);
    } else { visible = true; }
    window.addEventListener("resize", size);
    size(); loop();
    }
  })();

  /* ---------- services: upholstery colour swatches ---------- */
  (function swatches() {
    $$("[data-swatches]").forEach(function (strip) {
      var root = pageRootOf(strip);
      var media = root.querySelector("#uph-media");
      var img = media && media.querySelector("img");
      var names = $$("[data-swatch-name]", root);
      var cap   = root.querySelector("[data-swatch-cap]");

      /* warm the other photographs once the strip is hovered, so the first
         swap is instant without paying for six images on page load */
      var warmed = false;
      strip.addEventListener("pointerenter", function () {
        if (warmed) return;
        warmed = true;
        $$(".swatch", strip).forEach(function (b) {
          if (b.dataset.img) { var p = new Image(); p.src = b.dataset.img; }
        });
      });

      $$(".swatch", strip).forEach(function (b) {
        b.addEventListener("click", function () {
          $$(".swatch", strip).forEach(function (o) { o.setAttribute("aria-pressed", "false"); });
          b.setAttribute("aria-pressed", "true");
          names.forEach(function (n) { n.textContent = b.getAttribute("aria-label"); });
          if (cap && b.dataset.cap) cap.innerHTML = b.dataset.cap;
          if (!img || !b.dataset.img || img.getAttribute("src") === b.dataset.img) return;

          /* decode before swapping so the crossfade never shows an empty frame */
          var next = new Image();
          next.src = b.dataset.img;
          var show = function () {
            img.style.opacity = "0";
            setTimeout(function () {
              img.src = b.dataset.img;
              if (b.dataset.alt) img.alt = b.dataset.alt;
              img.style.opacity = "1";
            }, reduce ? 0 : 180);
          };
          if (next.decode) { next.decode().then(show).catch(show); }
          else if (next.complete) { show(); }
          else { next.onload = show; next.onerror = show; }
        });
      });
    });
  })();

  /* ---------- services: powder coat picker ---------- */
  (function coats() {
    $$("[data-coats]").forEach(function (picker) {
      var root = pageRootOf(picker);
      var half = root.querySelector(".svc-half--coat");
      var name = root.querySelector("[data-coat-name]");
      $$(".coat-sw", picker).forEach(function (b) {
        b.addEventListener("click", function () {
          $$(".coat-sw", picker).forEach(function (o) { o.setAttribute("aria-pressed", "false"); });
          b.setAttribute("aria-pressed", "true");
          if (half) half.style.setProperty("--coat", b.dataset.color);
          if (name) name.textContent = b.getAttribute("aria-label");
        });
      });
    });
  })();

  /* ---------- gallery ---------- */
  (function gallery() {
    var grid = $("#masonry");
    if (!grid || !window.CMS_GALLERY) return;
    var data = window.CMS_GALLERY,
        cats = window.CMS_CATEGORIES || [],
        groups = window.CMS_GROUPS || [],
        bar = $("#gal-filters"),
        subBar = $("#gal-subfilters"),
        countEl = $("#gal-count"),
        emptyEl = $("#gal-empty"),
        base = grid.getAttribute("data-base") || "assets/gallery-thumbs/",
        full = grid.getAttribute("data-full") || "assets/gallery/",
        ext = grid.getAttribute("data-ext") || ".webp",
        inline = window.FLCC_INLINE || null,   /* preview bundle: id -> data URI */
        current = "all", shown = [];

    function src(id, big) {
      if (inline && inline[id]) return inline[id];
      return (big ? full : base) + id + ext;
    }

    /* A filter id is either "all", a group id, or a single category id.
       Resolve any of them to the list of categories it covers. */
    function groupOf(id) {
      for (var i = 0; i < groups.length; i++) if (groups[i].id === id) return groups[i];
      return null;
    }
    function catsFor(id) {
      if (id === "all") return null;                       /* null = everything */
      var g = groupOf(id);
      return g ? g.cats : [id];
    }
    function countFor(id) {
      var list = catsFor(id);
      if (!list) return data.length;
      return data.filter(function (d) { return list.indexOf(d.cat) > -1; }).length;
    }
    /* which group, if any, owns this single category */
    function ownerOf(catId) {
      for (var i = 0; i < groups.length; i++)
        if (groups[i].cats.indexOf(catId) > -1) return groups[i];
      return null;
    }
    function labelFor(id) {
      if (id === "all") return "All Work";
      var g = groupOf(id);
      if (g) return g.label;
      for (var i = 0; i < cats.length; i++) if (cats[i].id === id) return cats[i].label;
      return id;
    }

    function chip(id, label) {
      var b = document.createElement("button");
      b.className = "gal-filter";
      b.type = "button";
      b.setAttribute("aria-pressed", "false");
      b.dataset.cat = id;
      b.innerHTML = label + ' <i>' + countFor(id) + '</i>';
      b.addEventListener("click", function () { setCat(id); });
      return b;
    }

    /* Tier 1: the three trades the Services page sells, plus shop shots.
       A trade spans several photo categories, so "Fabrication" is not the
       same as "Boat Fabrication" — see CMS_GROUPS in gallery.js. */
    if (bar) {
      bar.appendChild(chip("all", "All Work"));
      groups.forEach(function (g) {
        if (countFor(g.id)) bar.appendChild(chip(g.id, g.label));
      });
    }

    /* Tier 2: sub-categories, revealed only while a multi-category group
       is active. Keeps the sticky bar to one row the rest of the time. */
    function renderSubs(id) {
      if (!subBar) return;
      subBar.innerHTML = "";
      var g = groupOf(id) || ownerOf(id);
      if (!g || g.cats.length < 2) { subBar.hidden = true; return; }
      subBar.hidden = false;
      subBar.appendChild(chip(g.id, "All " + g.label));
      g.cats.forEach(function (c) { if (countFor(c)) subBar.appendChild(chip(c, labelFor(c))); });
      $$(".gal-filter", subBar).forEach(function (b) {
        b.setAttribute("aria-pressed", String(b.dataset.cat === id));
      });
    }

    /* Bring the filter bar up under the sticky header so the first rows of
       results are visible without scrolling. Measured from a non-sticky
       sentinel — the bar's own offset freezes once it sticks. */
    function scrollToResults(instant) {
      var anchor = document.getElementById("gal-anchor");
      if (!anchor) return;
      var navH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--nav-h")) || 68;
      var target = Math.max(0, anchor.getBoundingClientRect().top + window.scrollY - navH);
      if (Math.abs(window.scrollY - target) < 4) return;
      window.scrollTo({ top: target, behavior: (instant || reduce) ? "auto" : "smooth" });
    }

    function setCat(id, opts) {
      current = id;
      var owner = groupOf(id) ? id : (ownerOf(id) ? ownerOf(id).id : null);
      $$(".gal-filter", bar).forEach(function (b) {
        b.setAttribute("aria-pressed", String(b.dataset.cat === id || b.dataset.cat === owner));
      });
      renderSubs(id);
      render();
      if (!opts || opts.scroll !== false) scrollToResults(opts && opts.instant);
      try { history.replaceState(null, "", id === "all" ? location.pathname : "#" + id); } catch (e) {}
    }

    function render() {
      var want = catsFor(current);
      shown = want ? data.filter(function (d) { return want.indexOf(d.cat) > -1; }) : data.slice();
      grid.innerHTML = "";
      shown.forEach(function (d, i) {
        var fig = document.createElement("button");
        fig.className = "tile";
        fig.type = "button";
        fig.setAttribute("aria-label", "Open image: " + d.alt);
        fig.dataset.i = i;
        var im = document.createElement("img");
        im.src = src(d.f, false);
        im.alt = d.alt;
        im.loading = i < 12 ? "eager" : "lazy";
        im.decoding = "async";
        var cap = document.createElement("figcaption");
        cap.textContent = d.alt;
        fig.appendChild(im); fig.appendChild(cap);
        fig.addEventListener("click", function () { open(+fig.dataset.i); });
        grid.appendChild(fig);
        if (reduce) { fig.classList.add("in"); }
        else { setTimeout(function () { fig.classList.add("in"); }, Math.min(i, 18) * 32); }
      });
      if (countEl) countEl.textContent = shown.length + (shown.length === 1 ? " project" : " projects");
      if (emptyEl) emptyEl.setAttribute("data-show", String(shown.length === 0));
    }

    /* lightbox */
    var lb = $("#lb"), lbImg = $("#lb-img"), lbCap = $("#lb-cap"), idx = 0, lastFocus = null;
    function open(i) {
      if (!lb) return;
      idx = i; lastFocus = document.activeElement;
      paint(); lb.setAttribute("data-open", "true");
      document.body.style.overflow = "hidden";
      var c = $(".lb-close", lb); if (c) c.focus();
    }
    function close() {
      if (!lb) return;
      lb.setAttribute("data-open", "false");
      document.body.style.overflow = "";
      if (lastFocus) lastFocus.focus();
    }
    function paint() {
      var d = shown[idx]; if (!d) return;
      lbImg.src = src(d.f, true); lbImg.alt = d.alt;
      lbCap.textContent = d.alt + "  ·  " + (idx + 1) + " / " + shown.length;
    }
    function step(n) { idx = (idx + n + shown.length) % shown.length; paint(); }
    if (lb) {
      $(".lb-close", lb).addEventListener("click", close);
      $(".lb-prev", lb).addEventListener("click", function () { step(-1); });
      $(".lb-next", lb).addEventListener("click", function () { step(1); });
      lb.addEventListener("click", function (e) { if (e.target === lb) close(); });
      document.addEventListener("keydown", function (e) {
        if (lb.getAttribute("data-open") !== "true") return;
        if (e.key === "Escape") close();
        if (e.key === "ArrowRight") step(1);
        if (e.key === "ArrowLeft") step(-1);
      });
    }

    /* A deep link may name a trade group ("#fabrication") or a single
       category ("#gates"). Both are valid entry points. */
    function isFilter(id) {
      return id === "all" ||
             groups.some(function (g) { return g.id === id; }) ||
             cats.some(function (c) { return c.id === id; });
    }
    function applyHash(opts) {
      var h = (location.hash || "").replace("#", "");
      if (h && isFilter(h)) { setCat(h, opts); return true; }
      return false;
    }
    /* exposed so the single-file preview bundle can re-apply the hash when it
       switches pages without a real navigation */
    grid.FLCC_applyHash = applyHash;

    /* Arriving on a deep link ("See Fabrication Work") should OPEN at the
       results — filter bar parked under the sticky header, first rows of
       thumbnails already in view. Jump rather than animate: the page should
       simply start there instead of visibly travelling down from the top. */
    if (applyHash({ instant: true })) {
      /* Re-assert once layout settles. The anchor sits above the masonry so
         only the page header can move it, but a late web font re-flows that
         header. Abandon if the visitor has taken over the scroll. */
      var owned = true;
      var release = function () { owned = false; };
      ["wheel", "touchstart", "keydown", "pointerdown"].forEach(function (e) {
        window.addEventListener(e, release, { passive: true, once: true });
      });
      var settle = function () { if (owned) scrollToResults(true); };
      window.addEventListener("load", settle, { once: true });
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(settle);
      setTimeout(function () { release(); }, 1200);
    } else {
      render();
    }
  })();

  /* ---------- forms: validate, then send ----------
     The contact form (data-netlify) posts to Netlify Forms. Other forms
     (none left) only validate and show their message. */
  (function forms() {
    $$("form[data-form]").forEach(function (form) {
      /* the status pill may sit inside the form (contact) or as a sibling
         just after it (footer newsletter, where the form is a flex row) */
      var status = $(".form-status", form) ||
                   (form.parentElement ? $(".form-status", form.parentElement) : null);
      form.setAttribute("novalidate", "");
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        /* validate the form's actual controls — not only those wrapped in
           .field, or a bare input (the footer newsletter) validates nothing */
        var ok = true;
        $$("input,textarea,select", form).forEach(function (input) {
          if (input.disabled || input.type === "submit" || input.type === "button") return;
          var valid = input.checkValidity();
          var f = input.closest(".field");
          if (f) f.setAttribute("data-invalid", String(!valid));
          if (!valid && ok) { input.focus(); ok = false; }
        });
        if (!status) return;
        if (!ok) {
          status.setAttribute("data-state", "err");
          status.textContent = "Please check the highlighted fields and try again.";
          return;
        }
        function done() {
          status.setAttribute("data-state", "ok");
          status.textContent = form.dataset.success || "Thanks, we got your message. We'll get back to you soon.";
          form.reset();
          $$(".field", form).forEach(function (f) { f.setAttribute("data-invalid", "false"); });
        }
        /* only the contact form is a Netlify form; others just show the message */
        if (form.getAttribute("data-send") !== "netlify") { done(); return; }
        /* Netlify uses a field named "subject" as the email subject line */
        var subj = form.elements["subject"];
        if (subj && !form.hasAttribute("data-keep-subject")) {
          var who = (form.elements["name"] || {}).value || "";
          var what = (form.elements["service"] || {}).value || "";
          subj.value = "New request" + (who ? " from " + who.trim() : "") + (what ? ": " + what : "");
        }
        var body = new URLSearchParams(new FormData(form)).toString();
        status.setAttribute("data-state", "ok");
        status.textContent = "Sending...";
        fetch("/", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: body
        }).then(function (r) {
          if (!r.ok) throw new Error("bad status");
          done();
        }).catch(function () {
          status.setAttribute("data-state", "err");
          status.textContent = form.dataset.error || "Something went wrong. Please call us instead.";
        });
      });
      $$("input,textarea,select", form).forEach(function (input) {
        input.addEventListener("blur", function () {
          var f = input.closest(".field");
          if (f && input.value) f.setAttribute("data-invalid", String(!input.checkValidity()));
        });
      });
    });
  })();

  /* ---------- drop-down menus ---------- */
  (function subnav() {
    $$(".nav-item.has-sub").forEach(function (item) {
      var btn = $(".sub-toggle", item);
      function set(open) { item.classList.toggle("open", open); btn.setAttribute("aria-expanded", String(open)); }
      btn.addEventListener("click", function (e) { e.stopPropagation(); set(!item.classList.contains("open")); });
      document.addEventListener("click", function (e) { if (!item.contains(e.target)) set(false); });
      document.addEventListener("keydown", function (e) { if (e.key === "Escape") set(false); });
    });
  })();

  /* ---------- mark current page in the nav ---------- */
  (function currentPage() {
    var here = location.pathname.split("/").pop() || "index.html";
    $$(".nav-links a, .nav-drawer a").forEach(function (a) {
      var href = (a.getAttribute("href") || "").split("/").pop();
      if (href && href === here) a.setAttribute("aria-current", "page");
    });
    $$(".nav-item .nav-sub a[aria-current]").forEach(function (a) { a.closest(".nav-item").classList.add("has-current"); });
  })();
})();
