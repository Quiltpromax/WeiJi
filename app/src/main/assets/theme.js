(function () {
  "use strict";
  var key = "weiji-appearance-v1";
  var native = window.WeijiNative;
  var media = window.matchMedia("(prefers-color-scheme: dark)");
  var labels = { system: "跟随系统", light: "浅色", dark: "深色" };
  var mode = "system";
  try {
    var saved = native && native.getTheme ? native.getTheme() : localStorage.getItem(key);
    if (Object.prototype.hasOwnProperty.call(labels, saved)) mode = saved;
  } catch (_) {}

  function refresh() {
    var systemDark = media.matches;
    try {
      if (native && native.isSystemDark) systemDark = native.isSystemDark();
    } catch (_) {}
    var dark = mode === "dark" || (mode === "system" && systemDark);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = dark ? "#151c19" : "#f7f8f5";
    try {
      if (native && native.setTheme) native.setTheme(mode);
    } catch (_) {}
  }

  window.WeijiTheme = {
    getMode: function () { return mode; },
    getLabel: function () { return labels[mode]; },
    refresh: refresh,
    setMode: function (value) {
      if (!Object.prototype.hasOwnProperty.call(labels, value)) return false;
      try {
        if (native && native.setTheme) native.setTheme(value);
        else localStorage.setItem(key, value);
      } catch (_) { return false; }
      mode = value;
      refresh();
      return true;
    }
  };
  refresh();
  if (media.addEventListener) media.addEventListener("change", refresh);
  else if (media.addListener) media.addListener(refresh);
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) refresh();
  });
})();
