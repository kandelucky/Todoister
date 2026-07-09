/* ============================================================
   i18n — small language engine for Todoister
   Languages: lang/<code>.json (flat key → string).
   Usage:
     await I18N.init();          // before app start
     I18N.t("nav.inbox")          // → text in the current language
     I18N.t("pill.pending", {n}) // → variable interpolation {n}
     I18N.apply(root)             // fill data-i18n / -ph / -title in the DOM
     I18N.setLang("ka")           // switch language (saved in localStorage)
     I18N.onChange(fn)            // for React: listen for language changes
   ============================================================ */
(function () {
  var LANGS = ["en", "ka"];      // available languages (toggle in this order)
  var DEFAULT = "en";            // default (English first)

  var dict = {};
  var lang = DEFAULT;
  var listeners = [];

  try {
    var saved = localStorage.getItem("lang");
    if (saved && LANGS.indexOf(saved) >= 0) lang = saved;
  } catch (e) {}

  function fetchDict(l) {
    return fetch("lang/" + l + ".json", { cache: "no-cache" })
      .then(function (r) {
        if (!r.ok) throw new Error("lang load failed: " + l);
        return r.json();
      });
  }

  function t(key, vars) {
    var s = (dict && dict[key] != null) ? dict[key] : key;
    if (vars) {
      for (var k in vars) {
        if (Object.prototype.hasOwnProperty.call(vars, k)) {
          s = s.split("{" + k + "}").join(String(vars[k]));
        }
      }
    }
    return s;
  }

  // Return an array from a comma-separated key (date names, etc.)
  function list(key) {
    var s = t(key);
    return s.split(",");
  }

  function apply(root) {
    var r = root || document;
    r.querySelectorAll("[data-i18n]").forEach(function (el) {
      el.textContent = t(el.getAttribute("data-i18n"));
    });
    r.querySelectorAll("[data-i18n-ph]").forEach(function (el) {
      el.setAttribute("placeholder", t(el.getAttribute("data-i18n-ph")));
    });
    r.querySelectorAll("[data-i18n-title]").forEach(function (el) {
      el.setAttribute("title", t(el.getAttribute("data-i18n-title")));
    });
    r.querySelectorAll("[data-i18n-html]").forEach(function (el) {
      el.innerHTML = t(el.getAttribute("data-i18n-html"));
    });
  }

  function applyDir() {
    var dir = t("_meta.dir") || "ltr";
    document.documentElement.setAttribute("lang", lang);
    document.documentElement.setAttribute("dir", dir);
  }

  function init() {
    return fetchDict(lang).then(function (d) {
      dict = d;
      applyDir();
      return lang;
    }).catch(function () {
      // fallback: default language
      if (lang !== DEFAULT) {
        return fetchDict(DEFAULT).then(function (d) { dict = d; lang = DEFAULT; applyDir(); return lang; });
      }
    });
  }

  function setLang(l) {
    if (LANGS.indexOf(l) < 0 || l === lang) return Promise.resolve(lang);
    return fetchDict(l).then(function (d) {
      dict = d;
      lang = l;
      try { localStorage.setItem("lang", l); } catch (e) {}
      applyDir();
      listeners.forEach(function (fn) { try { fn(lang); } catch (e) {} });
      return lang;
    });
  }

  // switch to the next language (in toggle order)
  function toggle() {
    var i = LANGS.indexOf(lang);
    return setLang(LANGS[(i + 1) % LANGS.length]);
  }

  function onChange(fn) {
    listeners.push(fn);
    return function () { listeners = listeners.filter(function (x) { return x !== fn; }); };
  }

  window.I18N = {
    t: t,
    list: list,
    apply: apply,
    init: init,
    setLang: setLang,
    toggle: toggle,
    onChange: onChange,
    langs: LANGS,
    get lang() { return lang; },
    name: function (l) {
      // from the current dict we only know the current language's name; others — the code
      return l === lang ? (dict["_meta.name"] || l) : l;
    }
  };
})();
