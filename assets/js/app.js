/* =============================================================================
   SDK SMP — общий скрипт для всех страниц. Без библиотек и трекеров.
   Модули сами проверяют, есть ли их разметка на странице.
   ============================================================================= */
(function () {
  "use strict";

  var CFG = window.MT_CONFIG || {};
  var SERVER = CFG.server || {};
  var API = CFG.api || {};
  var LINKS = CFG.links || {};
  var PAY = LINKS.pay || {};

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function setText(sel, value) { $$(sel).forEach(function (el) { el.textContent = value; }); }

  /* ---------- тост ---------- */
  var toastEl = $("#toast");
  var toastTimer = 0;
  function toast(message) {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove("is-on"); }, 2600);
  }

  /* ---------- буфер обмена ---------- */
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(function () { return true; }).catch(function () { return legacyCopy(text); });
    }
    return Promise.resolve(legacyCopy(text));
  }
  function legacyCopy(text) {
    try {
      var area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.top = "-1000px";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      var ok = document.execCommand("copy");
      document.body.removeChild(area);
      return ok;
    } catch (err) {
      return false;
    }
  }

  /* ---------- данные из конфига ---------- */
  function fillStatic() {
    setText('[data-server="name"]', SERVER.name || "Minecraft-сервер");
    setText("[data-ip]", SERVER.ip || "укажите-ip");
    setText('[data-server="version"]', SERVER.version || "—");
    setText('[data-server="mode"]', SERVER.mode || "—");
    setText('[data-server="maxSlots"]', SERVER.maxSlots || "—");
    setText("[data-year]", new Date().getFullYear());
  }

  /* ---------- ссылки: пустые не уводят в никуда ---------- */
  function bindLink(el, url, emptyMessage) {
    if (url) {
      el.setAttribute("href", url);
      if (/^https?:/i.test(url)) {
        el.setAttribute("target", "_blank");
        el.setAttribute("rel", "noopener noreferrer");
      }
      el.removeAttribute("aria-disabled");
      return;
    }
    el.setAttribute("href", "#");
    el.setAttribute("aria-disabled", "true");
    el.addEventListener("click", function (event) {
      event.preventDefault();
      toast(emptyMessage);
    });
  }

  function applyLinks() {
    $$("[data-link]").forEach(function (el) {
      bindLink(el, LINKS[el.getAttribute("data-link")], "Ссылка ещё не настроена — укажите её в assets/js/config.js");
    });
    $$("[data-pay]").forEach(function (el) {
      bindLink(el, PAY[el.getAttribute("data-pay")], "Оплата ещё не подключена — добавьте ссылку кассы в config.js");
    });
  }

  /* ---------- копирование произвольного текста ---------- */
  $$("[data-copy-text]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var value = btn.getAttribute("data-copy-text") || "";
      copyText(value).then(function (ok) {
        toast(ok ? "Скопировано: " + value : "Не удалось скопировать");
      });
    });
  });

  /* ---------- копирование IP ---------- */
  $$("[data-copy-ip]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      copyText(SERVER.ip || "").then(function (ok) {
        toast(ok ? "IP скопирован" : "Не удалось скопировать — выделите IP вручную");
      });
    });
  });

  /* ---------- мобильное меню ---------- */
  (function mobileNav() {
    var burger = $(".burger");
    var nav = $("#menu");
    if (!burger || !nav) return;
    function close() {
      nav.classList.remove("is-open");
      burger.setAttribute("aria-expanded", "false");
      burger.setAttribute("aria-label", "Открыть меню");
    }
    burger.addEventListener("click", function () {
      var open = nav.classList.toggle("is-open");
      burger.setAttribute("aria-expanded", String(open));
      burger.setAttribute("aria-label", open ? "Закрыть меню" : "Открыть меню");
    });
    $$("a", nav).forEach(function (a) { a.addEventListener("click", close); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
  })();

  /* ---------- появление секций ---------- */
  (function reveal() {
    var items = $$("[data-reveal]");
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!items.length) return;
    if (reduce || !("IntersectionObserver" in window)) {
      items.forEach(function (el) { el.classList.add("is-in"); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-in");
        io.unobserve(entry.target);
      });
    }, { rootMargin: "0px 0px -8% 0px" });
    items.forEach(function (el) { io.observe(el); });
  })();

  /* ---------- статус сервера (только на главной) ---------- */
  (function statusModule() {
    if (!$('[data-live="status-text"]')) return;

    var timer = 0;
    var busy = false;
    var interval = Math.max(15000, Number(API.intervalMs) || 60000);
    var timeout = Math.max(1000, Number(API.timeoutMs) || 3500);

    function endpoint() {
      var proxy = String(API.proxy || "").replace(/\/+$/, "");
      if (proxy) return proxy + "/status";
      return String(API.directStatus || "https://api.mcstatus.io/v2/status/java/") + encodeURIComponent(SERVER.ip || "");
    }

    function normalize(raw) {
      if (!raw || typeof raw !== "object") return { online: null };
      var players = raw.players || {};
      var version = null;
      if (typeof raw.version === "string") version = raw.version;
      else if (raw.version && typeof raw.version === "object") version = raw.version.name_clean || raw.version.name || null;
      return {
        online: raw.online === true ? true : raw.online === false ? false : null,
        count: Number.isFinite(players.online) ? players.online : null,
        max: Number.isFinite(players.max) ? players.max : null,
        version: version
      };
    }

    function getStatus() {
      var controller = new AbortController();
      var kill = setTimeout(function () { controller.abort(); }, timeout);
      return fetch(endpoint(), {
        signal: controller.signal,
        cache: "no-store",
        headers: { Accept: "application/json" }
      })
        .then(function (res) {
          if (!res.ok) throw new Error("http " + res.status);
          return res.json();
        })
        .then(normalize)
        .finally(function () { clearTimeout(kill); });
    }

    function render(data) {
      var state = data.online === true ? "online" : data.online === false ? "offline" : "unknown";
      var dot = $('[data-live="dot"]');
      if (dot) dot.setAttribute("data-state", state);

      setText('[data-live="status-text"]',
        state === "online" ? "Сервер онлайн" :
        state === "offline" ? "Сервер офлайн" : "Нет данных API");

      setText('[data-live="players"]', state === "online" && data.count !== null ? data.count : "—");
      setText('[data-live="max"]', data.max !== null && data.max !== undefined ? data.max : (SERVER.maxSlots || "—"));
      if (data.version) setText('[data-live="version"]', data.version);

      var updated = $('[data-live="updated"]');
      if (updated) {
        var now = new Date();
        updated.textContent = now.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
        updated.setAttribute("datetime", now.toISOString());
      }
    }

    function refresh() {
      if (busy || document.hidden) return;
      busy = true;
      getStatus()
        .then(render)
        .catch(function () { render({ online: null, count: null, max: null, version: null }); })
        .finally(function () {
          busy = false;
          clearTimeout(timer);
          timer = setTimeout(refresh, interval);
        });
    }

    render({ online: null, count: null, max: null, version: null });
    refresh();

    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) refresh();
    });
  })();

  /* ---------- галерея и лайтбокс ---------- */
  (function lightbox() {
    var shots = $$(".gallery button.shot");
    var dialog = $("#lightbox");
    if (!shots.length || !dialog || typeof dialog.showModal !== "function") return;

    var img = $("#lb-img");
    var source = $("#lb-src");
    var caption = $("#lb-cap");
    var counter = $("#lb-count");
    var index = 0;
    var touchX = null;

    function open(i) {
      index = (i + shots.length) % shots.length;
      var shot = shots[index];
      var thumb = shot.querySelector("img");
      if (source) source.setAttribute("srcset", shot.getAttribute("data-webp") || "");
      img.setAttribute("src", shot.getAttribute("data-jpg") || "");
      img.setAttribute("alt", thumb ? thumb.getAttribute("alt") || "" : "");
      if (caption) caption.textContent = shot.getAttribute("data-caption") || "";
      counter.textContent = (index + 1) + " / " + shots.length;
      if (!dialog.open) dialog.showModal();
    }

    shots.forEach(function (shot, i) {
      shot.addEventListener("click", function () { open(i); });
    });

    var closeBtn = $("[data-lb-close]", dialog);
    if (closeBtn) closeBtn.addEventListener("click", function () { dialog.close(); });
    var prev = $("[data-lb-prev]", dialog);
    var next = $("[data-lb-next]", dialog);
    if (prev) prev.addEventListener("click", function () { open(index - 1); });
    if (next) next.addEventListener("click", function () { open(index + 1); });

    dialog.addEventListener("keydown", function (event) {
      if (event.key === "ArrowLeft") { event.preventDefault(); open(index - 1); }
      else if (event.key === "ArrowRight") { event.preventDefault(); open(index + 1); }
    });

    dialog.addEventListener("click", function (event) {
      if (event.target === dialog) dialog.close();
    });

    var frame = $(".lb__frame", dialog);
    if (frame) {
      frame.addEventListener("pointerdown", function (event) { touchX = event.clientX; });
      frame.addEventListener("pointerup", function (event) {
        if (touchX === null) return;
        var delta = event.clientX - touchX;
        touchX = null;
        if (Math.abs(delta) < 50) return;
        open(index + (delta < 0 ? 1 : -1));
      });
      frame.addEventListener("pointercancel", function () { touchX = null; });
    }
  })();

  /* ---------- заявка: текст в буфер, отправка в Telegram ---------- */
  (function applyForm() {
    var form = $("#apply-form");
    if (!form) return;
    var statusEl = $("#form-status");

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      if (!form.checkValidity()) {
        form.reportValidity();
        if (statusEl) statusEl.textContent = "Заполните ник, возраст и источник.";
        return;
      }
      var data = new FormData(form);
      var text = "Заявка на сервер «" + (SERVER.name || "") + "»\n" +
        "Ник: " + String(data.get("nick") || "").trim() + "\n" +
        "Возраст: " + String(data.get("age") || "").trim() + "\n" +
        "Откуда узнал(а): " + String(data.get("source") || "").trim() + "\n" +
        "IP: " + (SERVER.ip || "");

      copyText(text).then(function (ok) {
        if (statusEl) {
          statusEl.textContent = ok
            ? "Текст заявки скопирован. Вставьте его в чат Telegram — там её увидит модератор."
            : "Скопировать не удалось. Выделите текст заявки вручную или напишите в Telegram.";
        }
        toast(ok ? "Заявка скопирована — вставьте в Telegram" : "Скопируйте текст вручную");
        if (LINKS.telegram) window.open(LINKS.telegram, "_blank", "noopener");
      });
    });
  })();

  fillStatic();
  applyLinks();
})();
