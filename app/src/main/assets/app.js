(function() {
  "use strict";
  const J = window.Journal, native = window.WeijiNative;
  const demoMode = !native && new URLSearchParams(location.search).get("demo") === "1";
  const storageKey = demoMode ? "weiji-demo-v1" : "weiji-state-v1";
  const $ = (s) => document.querySelector(s);
  const esc = (v) => String(v != null ? v : "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const icon = (name, cls = "") => '<svg class="icon '.concat(cls, '" aria-hidden="true"><use href="#i-').concat(name, '"/></svg>');
  const today = () => J.localDate();
  let settingsOpen = false;
  let pageTransition = null;
  const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
  let state = J.blank(), page = "home", weekOffset = 0, recordType = "all", search = "", recordFilter = null;
  let statsKey = "week", customRange = { start: J.weekStart(), end: today() }, trendTag = "";
  let formDraft = null, modalOnClose = null, toastTimeout, timerStart = null, locked = false, booted = false, imageBusy = false, pendingImageDraft = null, readFailed = false;
  const bridgeResult = (result) => {
    const r = JSON.parse(result);
    if (!r.ok) throw Error(r.error || "操作失败，请重试。");
    return r;
  };
  function readState() {
    if (native) return J.validateState(bridgeResult(native.readState()).state);
    const value = localStorage.getItem(storageKey);
    return value ? J.validateState(JSON.parse(value)) : demoMode ? J.demo() : J.blank();
  }
  function persist(next, recovery = false) {
    if (readFailed && !recovery) {
      toast("原数据读取失败，请先从备份恢复，避免覆盖原记录。");
      return false;
    }
    try {
      const clean = J.validateState(next);
      if (native) bridgeResult(native.writeState(JSON.stringify(clean)));
      else localStorage.setItem(storageKey, JSON.stringify(clean));
      state = clean;
      readFailed = false;
      return true;
    } catch (error) {
      toast(error.message === "QuotaExceededError" ? "存储空间不足，请先导出备份。" : error.message || "保存失败，请检查存储空间。");
      return false;
    }
  }
  function toast(text) {
    clearTimeout(toastTimeout);
    $("#toast").textContent = text;
    $("#toast").hidden = false;
    toastTimeout = setTimeout(() => {
      $("#toast").hidden = true;
    }, 3500);
  }
  function imageUrl(value) {
    return value.startsWith("data:") || value.startsWith("covers/") ? value : "images/" + value;
  }
  function chip(id) {
    const tag = state.tags.find((t) => t.id === id);
    if (!tag) return "";
    const p = J.tagStyle(tag);
    return '<span class="chip" style="--tag-bg:'.concat(p.bg, ";--tag-color:").concat(p.color, '">').concat(esc(tag.name), "</span>");
  }
  function empty(title, description, action = "add") {
    return '<div class="empty-state"><div class="empty-icon">'.concat(icon("leaf"), "</div><h3>").concat(title, "</h3><p>").concat(description, "</p>").concat(action ? '<button class="primary-button" data-action="'.concat(action, '">').concat(icon("plus"), "添加第一条记录</button>") : "", "</div>");
  }
  function recordCard(record) {
    const legacy = record.type === "legacy", views = record.views, image = [].concat(...views.map((v) => v.images))[0];
    const tags = [...new Set([].concat(...views.map((v) => v.tags)))];
    const title = legacy ? record.title || "旧观看记录" : views.length ? "个人活动 · ".concat(views[0].title || "已记录观看") : "个人活动";
    return '<button class="record-card" data-action="detail" data-id="'.concat(record.id, '" data-type="').concat(record.type, '"><div class="record-thumb ').concat(image ? "" : "activity", '">').concat(image ? '<img src="'.concat(esc(imageUrl(image)), '" alt="观看记录截图" loading="lazy">') : icon(legacy ? "play" : "heart"), '</div><div class="record-content"><div class="record-title">').concat(esc(title), '</div><div class="record-meta">').concat(J.dateLabel(record.date), " · ").concat(esc(record.time), " · ").concat(legacy ? "待补全活动" : views.length ? "".concat(views.length, " 条观看内容") : "仅活动", '</div><div class="record-tags">').concat(tags.slice(0, 3).map(chip).join("")).concat(tags.length > 3 ? '<span class="chip">+'.concat(tags.length - 3, "</span>") : "", '</div></div><div class="record-trailing">').concat(legacy ? "" : "".concat(record.duration, " 分钟")).concat(icon("chevron"), "</div></button>");
  }
  function elapsedMarkup() {
    const gap = J.sinceLastActivity(state);
    if (gap.status === "empty") return '<div class="elapsed-heading">'.concat(icon("clock"), '距上次活动</div><h2 class="elapsed-empty">还没有活动记录</h2><p class="elapsed-hint">记下第一次活动，这里就会显示间隔时间。</p><button class="elapsed-start" data-action="add">').concat(icon("plus"), "记录一次活动</button>");
    const last = "".concat(gap.record.date.replace(/-/g, "."), " ").concat(gap.record.time);
    if (gap.status === "future") return '<div class="elapsed-heading">'.concat(icon("clock"), '距上次活动</div><h2 class="elapsed-empty">请核对记录时间</h2><p class="elapsed-hint">上次记录的时间晚于当前时间。</p><button class="elapsed-last" data-action="detail" data-type="activity" data-id="').concat(gap.record.id, '">上次：').concat(last, " ").concat(icon("chevron"), "</button>");
    return '<div class="elapsed-heading">'.concat(icon("clock"), '距上次活动已过去</div><div class="elapsed-value"><strong id="elapsed-days">').concat(gap.days, '</strong><span>天</span></div><div class="elapsed-remainder">又 ').concat(gap.hours, " 小时 ").concat(gap.minutes, ' 分钟</div><button class="elapsed-last" data-action="detail" data-type="activity" data-id="').concat(gap.record.id, '">上次：').concat(last, " ").concat(icon("chevron"), "</button>");
  }
  function refreshElapsed() {
    if (page === "home" && !locked && $("#elapsed-card")) $("#elapsed-card").innerHTML = elapsedMarkup();
  }
  function renderHome() {
    const range = J.weekRange(weekOffset), summary = J.weeklySummary(state, range), preference = J.stats(state, range);
    const max = Math.max(3, ...summary.days.map((d) => d.count));
    const recent = J.allRecords(state).filter((r) => J.inRange(r, range)).slice(0, 3);
    $("#main").innerHTML = '<div class="page-intro home-intro"><h1 class="page-heading">自己的节奏，慢慢记录。</h1></div><section id="elapsed-card" class="elapsed-card" aria-label="距上次活动">'.concat(elapsedMarkup(), '</section>\n      <div class="week-selector"><div class="week-label"><strong>').concat(weekOffset === 0 ? "这一周" : "过往一周", "</strong><span>").concat(J.rangeLabel(range), "</span>").concat(weekOffset === 0 ? '<span class="badge">本周</span>' : "", '</div><div class="week-controls"><button data-action="prev-week" aria-label="上一周">').concat(icon("chevron", "flip"), '</button><button data-action="next-week" aria-label="下一周" ').concat(weekOffset === 0 ? "disabled" : "", ">").concat(icon("chevron"), '</button></div></div>\n      <div class="summary-grid"><div class="metric-card"><div class="metric-label">').concat(icon("heart"), '活动次数</div><div class="metric-value"><strong>').concat(summary.count, '</strong><span>次</span></div><div class="metric-foot">一条活动记录，计为一次</div></div><div class="metric-card purple"><div class="metric-label">').concat(icon("clock"), '累计时长</div><div class="metric-value"><strong>').concat(summary.minutes, '</strong><span>分钟</span></div><div class="metric-foot">平均每次 ').concat(summary.average, ' 分钟</div></div></div>\n      <section class="card"><div class="section-head"><h2>一周的节奏</h2><small>周一至周日</small></div><div class="week-chart" role="img" aria-label="本周每日活动次数：').concat(summary.days.map((d, i) => "周".concat("一二三四五六日"[i], " ").concat(d.count, " 次")).join("，"), '">').concat(summary.days.map((d, i) => '<div class="day-column '.concat(d.today ? "today" : "", '"><span class="day-value">').concat(d.count || "", '</span><div class="day-track"><div class="day-bar" style="height:').concat(d.count / max * 100, '%"></div></div><span class="day-caption">').concat("一二三四五六日"[i], '</span><span class="view-dot ').concat(d.views ? "" : "empty", '"></span></div>')).join(""), '</div><div class="chart-legend"><span class="legend-item"><span class="legend-dot"></span>活动次数</span><span class="legend-item"><span class="legend-dot purple"></span>当天有观看记录</span></div></section>\n      <button class="insight-card full-width" data-action="go-stats"><span class="insight-icon">').concat(icon("tag"), '</span><span style="text-align:left"><strong>').concat(preference.rows.length ? "这周，偏爱「".concat(esc(preference.rows[0].name), "」") : "看过的内容，也值得记下来", "</strong><p>").concat(preference.total ? "".concat(preference.total, " 条观看记录 · ").concat(preference.rows.length, " 种标签，看看你的偏好") : "自定义标签，让你的喜好慢慢浮现", "</p></span>").concat(icon("chevron"), '</button>\n      <section class="recent-section"><div class="section-head"><h2>最近的记录</h2><button class="text-button" data-action="go-records">查看全部 ').concat(icon("chevron"), "</button></div>").concat(recent.length ? recent.map(recordCard).join("") : empty("从一条小记录开始", "点底部中间的 ＋，记下今天的时间和内容。"), '</section>\n      <p class="privacy-footer">').concat(icon("lock"), "仅保存在本机 · 这是属于你的空间</p>");
  }
  function filteredRecords() {
    const keyword = search.toLocaleLowerCase();
    return J.allRecords(state).filter((r) => {
      if (recordType === "video" && !r.views.length) return false;
      if (recordType === "activity" && (r.type !== "activity" || r.views.length)) return false;
      if (recordType === "legacy" && r.type !== "legacy") return false;
      if (recordFilter && !r.views.some((v) => v.tags.includes(recordFilter.tagId) && J.inRange(v, recordFilter.range))) return false;
      const text = ["个人活动", r.note, ...[].concat(...r.views.map((v) => [v.title, v.note, ...v.tags.map((id) => {
        var _a;
        return ((_a = state.tags.find((t) => t.id === id)) == null ? void 0 : _a.name) || "";
      })]))].join(" ").toLocaleLowerCase();
      return !keyword || text.includes(keyword);
    });
  }
  function renderRecordList() {
    const records = filteredRecords(), groups = /* @__PURE__ */ new Map();
    records.forEach((r) => {
      if (!groups.has(r.date)) groups.set(r.date, []);
      groups.get(r.date).push(r);
    });
    $("#record-results").innerHTML = records.length ? [...groups].map(([date, items]) => '<div class="date-heading"><span>'.concat(J.dateLabel(date), ' <span class="subtle">').concat(date, "</span></span><span>").concat(items.length, " 条</span></div>").concat(items.map(recordCard).join(""))).join("") : empty(search || recordFilter ? "没有找到对应记录" : "这里会留下你的每一次记录", search || recordFilter ? "试试其他关键词，或清除筛选。" : "每条活动都可以补充观看内容，之后随时一起编辑。", search || recordFilter ? null : "add");
  }
  function renderRecords() {
    const filterTag = recordFilter && state.tags.find((t) => t.id === recordFilter.tagId);
    const legacyCount = state.views.filter((v) => !v.activityId).length;
    const filters = [["all", "全部"], ["video", "含观看"], ["activity", "仅活动"]];
    $("#main").innerHTML = '<div class="page-intro"><div class="eyebrow">YOUR PERSONAL TIMELINE</div><h1 class="page-heading">记录，慢慢积累。</h1><p class="subtitle">活动与观看内容，一起留下。</p></div>'.concat(legacyCount ? '<button class="legacy-banner" data-action="record-type" data-value="legacy">'.concat(legacyCount, " 条旧观看记录待补全活动 · 点击查看</button>") : "", '<div class="segmented" role="group" aria-label="记录筛选">').concat(filters.map(([key, label]) => '<button data-action="record-type" data-value="'.concat(key, '" class="').concat(recordType === key ? "active" : "", '">').concat(label, "</button>")).join(""), '</div><label class="search-field">').concat(icon("search"), '<input id="record-search" type="search" placeholder="搜索名称、备注或标签" aria-label="搜索记录" value="').concat(esc(search), '"></label>').concat(filterTag ? '<div class="filter-active"><span>「'.concat(esc(filterTag.name), "」 · ").concat(J.rangeLabel(recordFilter.range), '</span><button data-action="clear-filter">清除筛选</button></div>') : "", '<div id="record-results"></div>');
    $("#record-search").addEventListener("input", (event) => {
      search = event.target.value;
      renderRecordList();
    });
    renderRecordList();
  }
  function renderStats() {
    var _a;
    const range = J.getRange(statsKey, state, today(), customRange), summary = J.stats(state, range);
    if (trendTag && !state.tags.some((t) => t.id === trendTag)) trendTag = "";
    const series = J.trend(state, range, trendTag), points = series.buckets, max = Math.max(1, ...points.map((p) => p.count));
    const coords = points.map((p, i) => [points.length === 1 ? 150 : 12 + i / (points.length - 1) * 276, 95 - p.count / max * 72]);
    const path = coords.map((p, i) => "".concat(i ? "L" : "M").concat(p.join(","))).join(" ");
    const labels = points.length > 2 ? [points[0], points[Math.floor((points.length - 1) / 2)], points[points.length - 1]] : points;
    $("#main").innerHTML = '<div class="page-intro"><div class="eyebrow">GET TO KNOW YOUR TASTE</div><h1 class="page-heading">你的偏好，有迹可循。</h1><p class="subtitle">用标签，看看什么最吸引你。</p></div><div class="filter-chips" aria-label="统计日期范围">'.concat([["today", "今天"], ["week", "本周"], ["month", "本月"], ["all", "全部"], ["custom", "自选"]].map(([key, label]) => '<button data-action="stats-range" data-value="'.concat(key, '" class="').concat(statsKey === key ? "active" : "", '">').concat(label, "</button>")).join(""), "</div>").concat(statsKey === "custom" ? '<div class="custom-range"><input id="range-start" type="date" aria-label="开始日期" value="'.concat(customRange.start, '" min="2000-01-01" max="2100-12-31"><span>至</span><input id="range-end" type="date" aria-label="结束日期" value="').concat(customRange.end, '" min="2000-01-01" max="2100-12-31"></div>') : "", '<div class="stats-range-label">').concat(range.start, " 至 ").concat(range.end, '</div>\n      <div class="stats-summary"><div><strong>').concat(summary.total, "</strong><small>观看记录</small></div><div><strong>").concat(summary.rows.length, '</strong><small>出现的标签</small></div><div><strong class="top-name">').concat(esc(((_a = summary.rows[0]) == null ? void 0 : _a.name) || "—"), '</strong><small>最常看的类型</small></div></div>\n      <section class="card stats-card"><div class="section-head"><h2>标签偏好排行</h2><button class="text-button" data-action="manage-tags">管理标签 ').concat(icon("chevron"), "</button></div>").concat(summary.rows.length ? '<div class="tag-bars">'.concat(summary.rows.map((tag) => '<button class="tag-row" data-action="tag-records" data-id="'.concat(tag.id, '" style="--tag-color:').concat(J.tagStyle(tag).color, '"><div class="tag-row-head"><span class="tag-name"><span class="color-dot"></span>').concat(esc(tag.name), "</span><small><strong>").concat(tag.count, "</strong> 次 · ").concat(tag.percent, "% ").concat(icon("chevron").replace('class="icon', 'class="icon tag-chevron').replace("aria-hidden", 'style="width:10px;height:10px;vertical-align:middle" aria-hidden'), '</small></div><div class="tag-track"><div class="tag-fill" style="width:').concat(tag.percent, '%"></div></div></button>')).join(""), "</div>") : empty("偏好会从这里浮现", summary.total ? "这些观看记录还没有标签，编辑记录即可添加。" : "记录活动时添加观看内容，再贴上自己的标签。", null), '<p class="stats-note">次数 = 含该标签的观看记录数；占比 = 次数 ÷ 全部观看记录数。同一记录可以有多个标签，因此占比之和可能超过 100%。').concat(summary.untagged ? "<br>其中 ".concat(summary.untagged, " 条记录未添加标签，也计入观看总数。") : "", '</p></section>\n      <section class="card stats-card"><div class="section-head"><h2>偏好变化</h2><select class="trend-select" id="trend-tag" aria-label="查看某个标签的趋势"><option value="">全部观看</option>').concat(state.tags.map((t) => '<option value="'.concat(t.id, '" ').concat(trendTag === t.id ? "selected" : "", ">").concat(esc(t.name), "</option>")).join(""), '</select></div><svg class="trend-svg" viewBox="0 0 300 115" role="img" aria-label="').concat(series.weekly ? "每周" : "每日", "观看次数：").concat(points.map((p) => "".concat(p.date, " ").concat(p.count, "次")).join("，"), '"><path d="M12 95H288M12 59H288M12 23H288" stroke="#edf0e8" stroke-dasharray="3 5" fill="none"/><text x="0" y="25" font-size="8" fill="#a4ae9b">').concat(max, '</text><text x="0" y="98" font-size="8" fill="#a4ae9b">0</text>').concat(coords.length > 1 ? '<path d="'.concat(path, " L").concat(coords[coords.length - 1][0], ",95 L").concat(coords[0][0], ',95Z" fill="#e8f0e6"/>') : "", '<path d="').concat(path, '" fill="none" stroke="#83a38a" stroke-width="2.3" stroke-linejoin="round" stroke-linecap="round"/>').concat(coords.map((p, i) => '<circle cx="'.concat(p[0], '" cy="').concat(p[1], '" r="3" fill="#83a38a"><title>').concat(points[i].date, "：").concat(points[i].count, "次</title></circle>")).join(""), '</svg><div class="trend-labels">').concat(labels.map((p) => "<span>".concat(p.label, "</span>")).join(""), '</div><div class="trend-caption">所选范围 · ').concat(series.weekly ? "每周" : "每天", "观看记录次数").concat(series.truncated ? " · 展示最近 52 周" : "", '</div></section><p class="privacy-footer">').concat(icon("lock"), "统计在手机本地完成</p>");
    $("#trend-tag").addEventListener("change", (event) => {
      trendTag = event.target.value;
      renderStats();
    });
    if (statsKey === "custom") for (const id of ["range-start", "range-end"]) $("#" + id).addEventListener("change", () => {
      const start = $("#range-start").value, end = $("#range-end").value;
      if (!J.validDate(start) || !J.validDate(end) || start > end) {
        toast("请选择有效日期，开始日期不能晚于结束日期。");
        renderStats();
        return;
      }
      customRange = { start, end };
      renderStats();
    });
  }
  function syncSelection(immediate = false) {
    const selection = $(".nav-selection"), active = $(".bottom-nav .nav-item.active");
    if (!selection) return;
    if (immediate) selection.classList.remove("is-ready");
    if (active) {
      selection.style.width = active.offsetWidth + "px";
      selection.style.transform = "translate3d(" + active.offsetLeft + "px,0,0)";
      selection.style.opacity = "1";
    } else selection.style.opacity = "0";
    if (!selection.classList.contains("is-ready")) {
      void selection.offsetWidth;
      requestAnimationFrame(() => selection.classList.add("is-ready"));
    }
  }
  function syncNavigation() {
    document.querySelectorAll("[data-page]").forEach((button) => {
      const active = !settingsOpen && button.dataset.page === page;
      button.classList.toggle("active", active);
      button.setAttribute("aria-current", active ? "page" : "false");
    });
    const settingsButton = $(".nav-settings");
    settingsButton.classList.toggle("active", settingsOpen);
    settingsButton.setAttribute("aria-expanded", String(settingsOpen));
    syncSelection();
  }
  function render() {
    if (locked) return;
    syncNavigation();
    if (page === "home") renderHome();
    else if (page === "records") renderRecords();
    else renderStats();
    updateTimerBadge();
  }
  function finishPageTransition() {
    if (!pageTransition) return;
    const current = pageTransition;
    pageTransition = null;
    current.incoming.cancel();
    current.outgoing.cancel();
    current.layer.remove();
  }
  function navigate(next) {
    if (next === page) return;
    finishPageTransition();
    const main = $("#main"), previous = page;
    const canAnimate = !motionPreference.matches && typeof main.animate === "function";
    let layer = null, snapshot = null;
    if (canAnimate) {
      const bounds = main.getBoundingClientRect();
      const contentTop = $(".app-header").getBoundingClientRect().bottom;
      layer = document.createElement("div");
      layer.className = "page-transition-layer";
      layer.setAttribute("aria-hidden", "true");
      layer.setAttribute("inert", "");
      layer.style.left = bounds.left + "px";
      layer.style.width = bounds.width + "px";
      layer.style.top = contentTop + "px";
      snapshot = main.cloneNode(true);
      snapshot.removeAttribute("id");
      snapshot.className = "page-snapshot";
      snapshot.querySelectorAll("[id]").forEach((el) => el.removeAttribute("id"));
      snapshot.querySelectorAll("button,input,select,textarea,a").forEach((el) => el.setAttribute("tabindex", "-1"));
      snapshot.style.top = (bounds.top - contentTop) + "px";
      snapshot.style.width = bounds.width + "px";
      snapshot.style.padding = getComputedStyle(main).padding;
      layer.appendChild(snapshot);
      document.body.appendChild(layer);
    }
    page = next;
    render();
    window.scrollTo(0, 0);
    if (!layer) return;
    const order = { home:0, records:1, stats:2 };
    const direction = order[next] > order[previous] ? 1 : -1;
    try {
      const outgoing = snapshot.animate([
        { opacity:1, transform:"translateX(0)" },
        { opacity:0, transform:"translateX(" + (-14 * direction) + "px)" }
      ], { duration:180, easing:"cubic-bezier(.4,0,.6,1)", fill:"both" });
      const incoming = main.animate([
        { opacity:0, transform:"translateX(" + (22 * direction) + "px)" },
        { opacity:1, transform:"translateX(0)" }
      ], { duration:420, easing:"cubic-bezier(.22,.8,.2,1)", fill:"both" });
      const current = { incoming, outgoing, layer };
      pageTransition = current;
      outgoing.onfinish = () => layer.remove();
      incoming.onfinish = () => {
        if (pageTransition === current) finishPageTransition();
      };
    } catch (_) {
      layer.remove();
      main.getAnimations().forEach((animation) => animation.cancel());
    }
  }
  window.addEventListener("resize", () => {
    finishPageTransition();
    syncSelection(true);
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) finishPageTransition();
  });
  if (motionPreference.addEventListener) motionPreference.addEventListener("change", finishPageTransition);
  else if (motionPreference.addListener) motionPreference.addListener(finishPageTransition);
  function sheet(title, content, onClose = null) {
    finishPageTransition();
    modalOnClose = onClose;
    const previousSheet = $(".sheet");
    const sameTitle = previousSheet && previousSheet.getAttribute("aria-label") === title;
    $("#modal-root").innerHTML = '<div class="modal-backdrop"><section class="sheet" role="dialog" aria-modal="true" aria-label="'.concat(esc(title), '"><div class="sheet-handle"></div><div class="sheet-heading"><h2>').concat(title, '</h2><button class="icon-button" data-action="close" aria-label="关闭">').concat(icon("close"), "</button></div>").concat(content, "</section></div>");
    if (sameTitle) {
      $(".sheet").classList.add("no-entrance");
      $(".modal-backdrop").classList.add("no-entrance");
    }
    syncNavigation();
    document.body.style.overflow = "hidden";
    $(".modal-backdrop").addEventListener("click", (event) => {
      if (event.target === event.currentTarget) closeModal();
    });
  }
  function closeModal() {
    const close = modalOnClose;
    modalOnClose = null;
    $("#modal-root").innerHTML = "";
    document.body.style.overflow = "";
    settingsOpen = false;
    syncNavigation();
    if (close) close();
  }
  function confirmSheet(title, text, onYes, onNo = null) {
    sheet(title, '<div class="confirm-box"><p>'.concat(text, '</p><div class="confirm-actions"><button class="secondary-button" id="confirm-no">取消</button><button class="danger-button" id="confirm-yes">确认</button></div></div>'), onNo);
    $("#confirm-no").onclick = () => closeModal();
    $("#confirm-yes").onclick = () => {
      modalOnClose = null;
      onYes();
    };
  }
  function captureForm() {
    if (!formDraft || !$("#record-form")) return;
    const get = (id) => {
      var _a;
      return (_a = $("#" + id)) == null ? void 0 : _a.value;
    };
    formDraft.date = get("form-date");
    formDraft.time = get("form-time");
    formDraft.note = get("form-note") || "";
    formDraft.duration = get("form-duration");
    const v = currentView();
    if (v) {
      v.title = get("form-title") || "";
      v.note = get("form-view-note") || "";
      v.date = get("form-view-date");
      v.time = get("form-view-time");
    }
  }
  const currentView = () => (formDraft == null ? void 0 : formDraft.views[formDraft.activeView]) || null;
  const copyView = (v) => ({ ...v, tags: [...v.tags], images: [...v.images] });
  function cleanupDraft() {
    if (native && formDraft) try {
      native.cleanupImages();
    } catch (_) {
    }
    formDraft = null;
    imageBusy = false;
    pendingImageDraft = null;
  }
  function openForm(type = "activity", existing = null) {
    const legacy = type === "legacy" ? existing : null, a = legacy ? null : existing;
    formDraft = { id: (a == null ? void 0 : a.id) || null, legacyId: (legacy == null ? void 0 : legacy.id) || null, date: (a == null ? void 0 : a.date) || (legacy == null ? void 0 : legacy.date) || today(), time: (a == null ? void 0 : a.time) || (legacy == null ? void 0 : legacy.time) || J.localTime(), duration: (a == null ? void 0 : a.duration) || "", note: (a == null ? void 0 : a.note) || "", views: legacy ? [copyView(legacy)] : a ? J.viewsFor(state, a.id).map(copyView) : [], activeView: 0 };
    renderForm();
  }
  function renderTagPicker() {
    if (!$("#tag-picker") || !formDraft) return;
    const v = currentView();
    if (!v) return;
    $("#tag-picker").innerHTML = state.tags.length ? state.tags.map((tag) => {
      const p = J.tagStyle(tag), selected = v.tags.includes(tag.id);
      return '<button type="button" class="tag-choice '.concat(selected ? "selected" : "", '" data-action="toggle-tag" data-id="').concat(tag.id, '" style="--tag-bg:').concat(p.bg, ";--tag-color:").concat(p.color, '">').concat(selected ? icon("check") : '<span class="color-dot"></span>').concat(esc(tag.name), "</button>");
    }).join("") : '<div class="tag-empty-hint">还没有标签，在下面创建你自己的分类。</div>';
  }
  function renderImages() {
    if (!$("#form-images") || !formDraft) return;
    const v = currentView();
    if (!v) return;
    $("#form-images").innerHTML = v.images.map((image, i) => '<div class="image-cell"><img src="'.concat(esc(imageUrl(image)), '" alt="已添加截图 ').concat(i + 1, '"><button type="button" class="image-remove" data-action="remove-image" data-index="').concat(i, '" aria-label="移除截图 ').concat(i + 1, '" ').concat(imageBusy ? "disabled" : "", ">").concat(icon("close"), "</button></div>")).join("") + (v.images.length < 12 ? '<button type="button" class="image-add" data-action="pick-images" '.concat(imageBusy ? "disabled" : "", ">").concat(icon("image"), "<span>").concat(imageBusy ? "处理中…" : "添加截图", "</span></button>") : "");
  }
  function renderForm() {
    const d = formDraft, v = currentView();
    sheet(d.legacyId ? "补全这条记录" : d.id ? "编辑活动与观看" : "记录一次活动", '<form id="record-form"><p class="form-note">活动信息必填，观看内容选填。保存后可随时补充或一起修改。</p>'.concat(d.legacyId ? '<div class="legacy-notice">旧观看内容和截图已保留。请选择已有活动，或填写信息新建活动。</div><label class="field"><span class="field-label">归入哪条活动</span><select id="legacy-target"><option value="">新建一条活动</option>'.concat([...state.activities].sort(J.sortRecords).map((a) => '<option value="'.concat(a.id, '" ').concat(d.id === a.id ? "selected" : "", ">").concat(a.date, " ").concat(a.time, " · ").concat(a.duration, " 分钟</option>")).join(""), "</select></label>") : "", '<div class="form-section-heading"><h3>').concat(icon("heart"), '活动信息</h3><span class="required-badge">必填</span></div><div class="field-row"><label class="field"><span class="field-label">活动日期</span><input id="form-date" type="date" value="').concat(d.date, '" required min="2000-01-01" max="').concat(today(), '"></label><label class="field"><span class="field-label">开始时间</span><input id="form-time" type="time" value="').concat(d.time, '" required></label></div>\n      <label class="field"><span class="field-label">持续时长 <small>分钟 · 必填</small></span><input id="form-duration" type="number" min="0.1" max="1440" step="0.1" inputmode="decimal" value="').concat(d.duration, '" placeholder="例如 15" required></label><div class="timer-box">').concat(icon("clock"), '<strong id="timer-display">00:00</strong><button type="button" data-action="timer">').concat(timerStart ? "结束并填入" : "开始计时", '</button></div><label class="field"><span class="field-label">活动备注 <small>选填</small></span><textarea id="form-note" maxlength="4000" placeholder="留下想记住的一点感受…">').concat(esc(d.note), '</textarea></label>\n      <section class="view-form-section"><div class="form-section-heading"><h3>').concat(icon("play"), '观看内容</h3><span class="optional-badge">选填</span></div>').concat(v ? '<div class="view-tabs">'.concat(d.views.map((_, i) => '<button type="button" data-action="select-view" data-index="'.concat(i, '" class="').concat(d.activeView === i ? "active" : "", '" ').concat(imageBusy ? "disabled" : "", ">内容 ").concat(i + 1, "</button>")).join(""), '</div><div class="field-row"><label class="field"><span class="field-label">观看日期</span><input id="form-view-date" type="date" value="').concat(v.date, '" required min="2000-01-01" max="').concat(today(), '"></label><label class="field"><span class="field-label">观看时间</span><input id="form-view-time" type="time" value="').concat(v.time, '" required></label></div><label class="field"><span class="field-label">视频名称 <small>选填</small></span><input id="form-title" maxlength="120" placeholder="给看过的内容起个名字" value="').concat(esc(v.title), '"></label><div class="field-label">内容标签 <small>可多选 · 自定义分类</small></div><div id="tag-picker" class="tag-picker"></div><div class="new-tag-row"><input id="new-tag" placeholder="输入新标签" maxlength="24" aria-label="新标签名称"><button type="button" data-action="create-tag">创建</button></div><div class="field-label">视频截图 <small>每条内容最多 12 张</small></div><div id="form-images" class="image-grid"></div><label class="field"><span class="field-label">观看备注 <small>选填</small></span><textarea id="form-view-note" maxlength="4000" placeholder="记下喜欢的氛围、节奏…">').concat(esc(v.note), '</textarea></label><div class="view-form-actions"><button type="button" class="text-button danger" data-action="remove-view" ').concat(imageBusy || d.legacyId && v.id === d.legacyId ? "disabled" : "", '>移除这条观看内容</button><button type="button" class="text-button" data-action="add-view" ').concat(imageBusy ? "disabled" : "", ">＋ 再添一条</button></div>") : '<p class="form-note">没有观看内容也可以直接保存活动。想记录时，添加名称、标签或截图即可。</p><button type="button" class="secondary-button full-width" data-action="add-view">'.concat(icon("plus"), "添加观看内容</button>"), '</section><div id="form-error" class="validation-error" role="alert"></div><button type="submit" class="primary-button full-width" id="save-record">').concat(icon("check"), '保存整条记录</button><p class="privacy-footer">').concat(icon("lock"), "仅保存到你的设备</p></form>"), cleanupDraft);
    if (v) {
      renderTagPicker();
      renderImages();
      $("#new-tag").addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          createTag();
        }
      });
    }
    if (d.legacyId) $("#legacy-target").onchange = (event) => {
      if (imageBusy) {
        event.target.value = d.id || "";
        toast("图片正在处理，请稍等。");
        return;
      }
      captureForm();
      const legacy = d.views.find((x) => x.id === d.legacyId), a = state.activities.find((x) => x.id === event.target.value);
      Object.assign(d, { id: (a == null ? void 0 : a.id) || null, date: (a == null ? void 0 : a.date) || legacy.date, time: (a == null ? void 0 : a.time) || legacy.time, duration: (a == null ? void 0 : a.duration) || "", note: (a == null ? void 0 : a.note) || "", views: [...a ? J.viewsFor(state, a.id).map(copyView) : [], legacy] });
      d.activeView = d.views.length - 1;
      renderForm();
    };
    $("#record-form").addEventListener("submit", (event) => {
      event.preventDefault();
      saveForm();
    });
    updateTimer();
  }
  function saveForm() {
    if (imageBusy) {
      toast("图片正在处理，请稍等。");
      return;
    }
    captureForm();
    const d = formDraft;
    if (!J.validDate(d.date) || d.date > today() || !/^([01]\d|2[0-3]):[0-5]\d$/.test(d.time)) {
      $("#form-error").textContent = "请填写有效的日期和时间。";
      return;
    }
    if (!Number.isFinite(Number(d.duration)) || Number(d.duration) < 0.1 || Number(d.duration) > 1440) {
      $("#form-error").textContent = "活动时长必填，请输入 0.1 到 1440 分钟。";
      return;
    }
    if (d.views.some((v) => !J.validDate(v.date) || v.date > today() || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v.time))) {
      $("#form-error").textContent = "请核对每条观看内容的日期和时间。";
      return;
    }
    if (d.views.some((v) => !v.title.trim() && !v.note.trim() && !v.tags.length && !v.images.length)) {
      $("#form-error").textContent = "观看内容请至少填写名称、标签、截图或备注之一；不需要时可移除。";
      return;
    }
    try {
      if (persist(J.saveSession(state, d))) {
        if (recordType === "legacy") recordType = "all";
        closeModal();
        render();
        toast("活动与观看内容已一起保存。");
      }
    } catch (error) {
      $("#form-error").textContent = error.message;
    }
  }
  function createTag() {
    const v = currentView();
    if (!v) return;
    const name = $("#new-tag").value.trim();
    if (!name) {
      toast("先输入标签名称。");
      return;
    }
    const existing = state.tags.find((t) => t.name.toLocaleLowerCase() === name.toLocaleLowerCase());
    if (existing) {
      if (!v.tags.includes(existing.id)) v.tags.push(existing.id);
      $("#new-tag").value = "";
      renderTagPicker();
      toast("已选中已有标签。");
      return;
    }
    const tag = { id: J.uid("tag"), name, color: state.tags.length % J.PALETTE.length };
    if (persist({ ...state, tags: [...state.tags, tag] })) {
      v.tags.push(tag.id);
      $("#new-tag").value = "";
      renderTagPicker();
      toast("新标签已创建。");
    }
  }
  async function pickImages() {
    const v = currentView();
    if (!v || imageBusy) return;
    captureForm();
    if (native) {
      try {
        imageBusy = true;
        pendingImageDraft = v;
        renderImages();
        bridgeResult(native.pickImages(12 - v.images.length));
      } catch (error) {
        imageBusy = false;
        pendingImageDraft = null;
        renderImages();
        toast(error.message);
      }
      return;
    }
    $("#image-input").value = "";
    $("#image-input").click();
  }
  async function compressImage(file) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw Error("请选择 JPG、PNG 或 WebP 图片。");
    if (file.size > 20 * 1024 * 1024) throw Error("单张图片不能超过 20 MB。");
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const ratio = Math.min(1, 1600 / Math.max(image.width, image.height)), canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * ratio));
      canvas.height = Math.max(1, Math.round(image.height * ratio));
      const context = canvas.getContext("2d");
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/jpeg", 0.88);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  $("#image-input").addEventListener("change", async (event) => {
    const activeDraft = currentView();
    if (!activeDraft) return;
    imageBusy = true;
    renderImages();
    let added = 0;
    try {
      for (const file of [...event.target.files].slice(0, 12 - activeDraft.images.length)) {
        const image = await compressImage(file);
        if (currentView() !== activeDraft) return;
        activeDraft.images.push(image);
        added++;
      }
    } catch (error) {
      toast(error.message);
    } finally {
      imageBusy = false;
      renderImages();
      if (added) toast("已添加 ".concat(added, " 张截图。"));
    }
  });
  function detail(type, id) {
    const legacy = type === "legacy", r = state[legacy ? "views" : "activities"].find((x) => x.id === id);
    if (!r) return;
    const views = legacy ? [r] : J.viewsFor(state, id);
    sheet("记录详情", '<div class="detail-hero"><div class="empty-icon">'.concat(icon(legacy ? "play" : "heart"), "</div><h3>").concat(legacy ? "旧观看记录" : "个人活动", "</h3><p>").concat(r.date, " · ").concat(r.time).concat(legacy ? " · 待补全活动" : " · 持续 ".concat(r.duration, " 分钟"), "</p></div>").concat(!legacy && r.note ? '<div class="detail-note">'.concat(esc(r.note), "</div>") : "").concat(legacy ? '<div class="legacy-notice">这条旧记录尚未绑定活动，观看内容和截图已保留。补全后可一起编辑。</div>' : "", '<div class="form-section-heading"><h3>').concat(icon("play"), '观看内容</h3><span class="optional-badge">').concat(views.length, " 条</span></div>").concat(views.length ? views.map((v) => '<section class="detail-view"><h4>'.concat(esc(v.title || "未命名的观看内容"), '</h4><p class="subtle">').concat(v.date, " · ").concat(v.time, '</p><div class="record-tags">').concat(v.tags.map(chip).join("") || '<span class="subtle">暂未添加标签</span>', "</div>").concat(v.note ? '<div class="detail-note">'.concat(esc(v.note), "</div>") : "").concat(v.images.length ? '<div class="detail-images">'.concat(v.images.map((image, i) => '<button data-action="view-image" data-id="'.concat(v.id, '" data-index="').concat(i, '" aria-label="放大截图 ').concat(i + 1, '"><img src="').concat(esc(imageUrl(image)), '" alt="截图 ').concat(i + 1, '" loading="lazy"></button>')).join(""), "</div>") : "", "</section>")).join("") : '<p class="form-note">尚未填写观看内容，点击编辑即可补充。</p>', '<div class="detail-actions"><button class="secondary-button" id="edit-record">').concat(icon("edit").replace('class="icon"', 'class="icon" style="width:14px;height:14px;vertical-align:middle"'), " ").concat(legacy ? "补全活动信息" : "编辑整条记录", '</button><button class="danger-button" id="delete-record">删除记录</button></div>'));
    $("#edit-record").onclick = () => openForm(type, r);
    $("#delete-record").onclick = () => confirmSheet("删除这条记录？", legacy ? "将删除这条旧观看记录及其截图，删除后无法撤销。" : "将删除这次活动".concat(views.length ? "以及其中的观看内容和截图" : "", "，删除后无法撤销。只想移除观看内容时，可在编辑页面操作。"), () => {
      if (persist(J.deleteRecord(state, type, id))) {
        closeModal();
        if (native) native.cleanupImages();
        render();
        toast("记录已删除。");
      }
    }, () => detail(type, id));
  }
  function manageTags() {
    sheet("管理我的标签", '<p class="form-note">标签可以改名和换色。删除标签会移除记录上的该标签，观看记录仍保留。</p><div id="tag-management"></div><div class="new-tag-row"><input id="manage-new-tag" placeholder="新的分类名称" maxlength="24" aria-label="新标签"><button id="manage-add">创建标签</button></div><p class="form-note">改名后点击右侧的 ✓ 保存；点击色点切换颜色。</p>');
    renderTagManagement();
    $("#manage-add").onclick = () => {
      const name = $("#manage-new-tag").value.trim();
      if (!name) return;
      if (state.tags.some((t) => t.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
        toast("这个标签已经存在。");
        return;
      }
      if (persist({ ...state, tags: [...state.tags, { id: J.uid("tag"), name, color: state.tags.length % J.PALETTE.length }] })) {
        $("#manage-new-tag").value = "";
        renderTagManagement();
        render();
      }
    };
  }
  function renderTagManagement() {
    $("#tag-management").innerHTML = state.tags.map((tag) => {
      const p = J.tagStyle(tag);
      return '<div class="tag-management-row" data-tag-id="'.concat(tag.id, '"><button class="color-button" data-action="tag-color" data-id="').concat(tag.id, '" style="--tag-color:').concat(p.color, ";--tag-bg:").concat(p.bg, '" aria-label="切换 ').concat(esc(tag.name), ' 的颜色"></button><input value="').concat(esc(tag.name), '" maxlength="24" aria-label="标签名称"><button class="icon-button" data-action="tag-rename" data-id="').concat(tag.id, '" aria-label="保存标签名称">').concat(icon("check"), '</button><button class="icon-button danger" data-action="tag-delete" data-id="').concat(tag.id, '" aria-label="删除标签">').concat(icon("trash"), "</button></div>");
    }).join("") || '<div class="empty-state"><p>还没有标签，先创建一个吧。</p></div>';
  }
  function hasPin() {
    return native ? JSON.parse(native.getStatus()).hasPin : !!localStorage.getItem("weiji-pin-v1");
  }
  function appearance() {
    const theme = window.WeijiTheme;
    sheet("外观与深色模式", '<div class="segmented appearance-options" role="group" aria-label="外观模式">' +
      [["system", "跟随系统"], ["light", "浅色"], ["dark", "深色"]].map(([value, label]) =>
        '<button data-action="set-appearance" data-value="' + value + '" aria-pressed="' + (theme.getMode() === value) + '" class="' + (theme.getMode() === value ? 'active' : '') + '">' + label + '</button>'
      ).join('') + '</div><p class="appearance-note">跟随系统：与手机的深色模式同步切换。<br>选择浅色或深色后，会记住你的选择。</p><button class="secondary-button full-width" data-action="settings">返回设置</button>');
  }
  function settings() {
    settingsOpen = true;
    sheet("你的私人空间", '<div class="settings-group"><button class="settings-row" data-action="appearance">' + icon("moon") + '<span><strong>外观与深色模式</strong><small>' + window.WeijiTheme.getLabel() + ' · 夜间使用更舒适</small></span>' + icon("chevron") + '</button></div><div class="settings-group"><button class="settings-row" data-action="manage-tags">'.concat(icon("tag"), "<span><strong>管理标签</strong><small>为你的喜好起一个名字</small></span>").concat(icon("chevron"), '</button><button class="settings-row" data-action="pin-settings">').concat(icon("lock"), "<span><strong>").concat(hasPin() ? "修改或关闭密码锁" : "设置密码锁", "</strong><small>打开应用时输入 4–8 位数字</small></span>").concat(icon("chevron"), '</button></div><div class="settings-group"><button class="settings-row" data-action="export">').concat(icon("download"), "<span><strong>导出备份</strong><small>保存一个 .json 文件，含记录、标签和截图</small></span>").concat(icon("chevron"), '</button><button class="settings-row" data-action="import">').concat(icon("upload"), "<span><strong>恢复备份</strong><small>选择之前从微记导出的 .json 文件</small></span>").concat(icon("chevron"), '</button><div class="backup-explainer"><strong>备份是什么？</strong><br>一个 .json 文件，里面已包含全部记录、标签和截图。把文件留在手机，或传到新手机，再用「恢复备份」选择这个文件。<br>恢复会替换当前记录；密码锁设置不包含在备份里。</div></div><div class="settings-group"><button class="settings-row" data-action="help">').concat(icon("list"), "<span><strong>使用与统计说明</strong><small>间隔天数、计数、图片与备份步骤</small></span>").concat(icon("chevron"), '</button></div><div class="setting-description">微记 1.2.1 · 个人记录<br>数据保存在本机，应用不需要网络权限。<br>备份为普通文件，请存放在你自己的位置。</div>'));
  }
  async function hashPin(pin, salt) {
    const bytes = new TextEncoder().encode(salt + ":" + pin);
    if (!crypto.subtle) throw Error("当前预览环境不支持密码锁，请在 APK 中使用。");
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
  }
  async function verifyPin(pin) {
    if (native) return bridgeResult(native.unlock(pin));
    const saved = JSON.parse(localStorage.getItem("weiji-pin-v1") || "null");
    if (saved && await hashPin(pin, saved.salt) !== saved.hash) throw Error("密码不正确，请再试一次。");
    return { ok: true };
  }
  function pinSettings() {
    const exists = hasPin();
    sheet(exists ? "修改密码锁" : "设置密码锁", '<form id="pin-form">'.concat(exists ? '<label class="field"><span class="field-label">当前密码</span><input id="old-pin" type="password" inputmode="numeric" pattern="[0-9]{4,8}" maxlength="8" required autocomplete="current-password"></label>' : "", '<label class="field"><span class="field-label">新密码 <small>').concat(exists ? "留空并保存即可关闭密码锁" : "4–8 位数字", '</small></span><input id="new-pin" type="password" inputmode="numeric" pattern="[0-9]{4,8}" maxlength="8" autocomplete="new-password" ').concat(exists ? "" : "required", '></label><label class="field"><span class="field-label">再次输入新密码</span><input id="confirm-pin" type="password" inputmode="numeric" maxlength="8" autocomplete="new-password"></label><p class="form-note">请记住密码。密码锁用于限制打开应用；导出的备份文件不包含密码。</p><div id="pin-error" class="validation-error" role="alert"></div><button type="submit" class="primary-button full-width">保存设置</button></form>'));
    $("#pin-form").onsubmit = async (event) => {
      var _a;
      event.preventDefault();
      const old = ((_a = $("#old-pin")) == null ? void 0 : _a.value) || "", pin = $("#new-pin").value;
      if (pin !== $("#confirm-pin").value) {
        $("#pin-error").textContent = "两次输入的新密码不一致。";
        return;
      }
      if (pin && !/^\d{4,8}$/.test(pin)) {
        $("#pin-error").textContent = "请使用 4–8 位数字。";
        return;
      }
      try {
        if (native) bridgeResult(native.setPin(old, pin));
        else {
          await verifyPin(old);
          if (pin) {
            const salt = J.uid("salt");
            localStorage.setItem("weiji-pin-v1", JSON.stringify({ salt, hash: await hashPin(pin, salt) }));
          } else localStorage.removeItem("weiji-pin-v1");
        }
        settings();
        toast(pin ? "密码锁已设置。" : "密码锁已关闭。");
      } catch (error) {
        $("#pin-error").textContent = error.message;
      }
    };
  }
  function showLock() {
    finishPageTransition();
    var _a;
    if (!hasPin()) return;
    locked = true;
    closeModal();
    $(".app-shell").style.visibility = "hidden";
    (_a = $(".timer-floating")) == null ? void 0 : _a.remove();
    $("#modal-root").innerHTML = '<div class="lock-screen"><form class="lock-card" id="unlock-form"><div class="brand-mark">'.concat(icon("leaf"), '</div><h1>微记</h1><p>这里，是属于你的私人空间。</p><input id="unlock-pin" type="password" inputmode="numeric" pattern="[0-9]{4,8}" minlength="4" maxlength="8" placeholder="••••" aria-label="输入密码" autocomplete="current-password" required><button class="primary-button full-width" type="submit">').concat(icon("lock"), '解锁</button><div class="lock-error" id="unlock-error" role="alert"></div></form></div>');
    $("#unlock-form").onsubmit = async (event) => {
      event.preventDefault();
      try {
        await verifyPin($("#unlock-pin").value);
        locked = false;
        $("#modal-root").innerHTML = "";
        $(".app-shell").style.visibility = "";
        boot();
      } catch (error) {
        $("#unlock-error").textContent = error.message;
        $("#unlock-pin").value = "";
      }
    };
  }
  async function exportBackup() {
    try {
      if (readFailed) throw Error("原数据读取失败，无法导出完整备份。请先使用已有备份恢复。");
      if (native) {
        bridgeResult(native.writeState(JSON.stringify(state)));
        bridgeResult(native.exportBackup());
        return;
      }
      const backupState = JSON.parse(JSON.stringify(state)), images = {}, mapping = /* @__PURE__ */ new Map();
      for (const r of backupState.views) for (let i = 0; i < r.images.length; i++) {
        const value = r.images[i];
        if (!mapping.has(value)) {
          const name = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("") + ".jpg";
          let data = value;
          if (!value.startsWith("data:image/jpeg;base64,")) {
            const image = new Image();
            image.src = imageUrl(value);
            await image.decode();
            const c = document.createElement("canvas");
            c.width = image.width;
            c.height = image.height;
            const ctx = c.getContext("2d");
            ctx.fillStyle = "#fff";
            ctx.fillRect(0, 0, c.width, c.height);
            ctx.drawImage(image, 0, 0);
            data = c.toDataURL("image/jpeg", 0.88);
          }
          images[name] = data.split(",")[1];
          mapping.set(value, name);
        }
        r.images[i] = mapping.get(value);
      }
      const blob = new Blob([JSON.stringify({ format: "weiji-backup", version: 1, exportedAt: (/* @__PURE__ */ new Date()).toISOString(), state: backupState, images }, null, 2)], { type: "application/json" });
      if (blob.size > 80 * 1024 * 1024) throw Error("备份超过 80 MB，请减少截图后重试。");
      const url = URL.createObjectURL(blob), a = document.createElement("a");
      a.href = url;
      a.download = "微记-备份-".concat(today(), ".json");
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1e4);
      toast("备份已导出，包含记录和截图。");
    } catch (error) {
      toast(error.message);
    }
  }
  function beginImport() {
    confirmSheet("恢复备份", "接下来请选择之前从微记导出的 .json 备份文件。确认并恢复后，里面的记录、标签和截图会替换当前的 ".concat(state.activities.length, " 条活动记录和 ").concat(state.views.length, " 条观看记录。密码锁设置保留。"), () => {
      closeModal();
      if (native) {
        try {
          bridgeResult(native.importBackup());
        } catch (error) {
          toast(error.message);
        }
      } else {
        $("#backup-input").value = "";
        $("#backup-input").click();
      }
    }, settings);
  }
  $("#backup-input").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      if (file.size > 80 * 1024 * 1024) throw Error("备份不能超过 80 MB。");
      const backup = JSON.parse(await file.text());
      if (backup.format !== "weiji-backup" || backup.version !== 1) throw Error("请选择微记导出的备份文件。");
      const next = J.validateState(backup.state);
      for (const r of next.views) r.images = r.images.map((value) => {
        var _a;
        if (!/^[a-f0-9]{32}\.jpg$/.test(value)) return value;
        const data = (_a = backup.images) == null ? void 0 : _a[value];
        if (typeof data !== "string" || !data) throw Error("备份缺少截图，原记录已保留。");
        return "data:image/jpeg;base64," + data;
      });
      if (persist(next, true)) {
        render();
        toast("备份已恢复。");
      }
    } catch (error) {
      toast(error.message.startsWith("Unexpected") ? "备份文件损坏或格式不正确。" : error.message);
    }
  });
  function help() {
    sheet("使用与统计说明", '<div class="help-copy"><p><strong>距上次活动多久</strong><br>从最近一条活动记录的开始时间算起，每满 24 小时算一天，剩余小时和分钟单独显示。修改或删除活动会重新计算；补充或修改观看内容不会重置这个间隔；只有活动的开始时间决定间隔。</p><p><strong>一条活动，观看内容选填</strong><br>活动日期、开始时间和持续分钟必填，备注选填。观看内容可不填，也可添加一条或多条，每条可保存观看时间、名称、标签、截图和备注。保存后点记录详情 → 编辑整条记录，就能一起修改或后补观看内容。观看时间默认使用活动时间，也可以单独调整。<br>删除整条记录会同时删除活动及其中的观看内容。编辑时仅移除观看内容，会保留活动及其时长。<br>旧版没有绑定的观看记录会显示为「待补全活动」，仍计入观看统计；可选择归入已有活动或新建活动，原有内容与截图保留。</p><p><strong>标签次数与占比</strong><br>一个标签在同一条观看记录里计一次。占比分母是所选日期范围内全部观看记录，包括没有标签的记录。多标签占比之和可能超过 100%。</p><p><strong>每周与趋势</strong><br>周一至周日为一周。偏好变化使用所选日期范围；范围超过 14 天时按周汇总，最多展示最近 52 周。</p><p><strong>计时与图片</strong><br>计时可以在关闭添加窗口后继续，点击底部计时条返回。图片会复制到应用中，缩放到最长边 1600 像素，以节省空间。</p><p><strong>导出备份得到什么</strong><br>设置 → 导出备份 → 选择保存位置。得到一个名为「微记-备份-'.concat(today(), ".json」的文件，里面包含全部活动、观看记录、标签、备注和截图。截图已放在这个文件里，密码锁设置不包含在备份里。</p><p><strong>怎么导入备份</strong><br>把这个 .json 文件放到要使用的手机上，打开微记 → 设置 → 恢复备份 → 确认 → 选择该文件。应用验证文件后恢复记录、标签和截图，并重新生成统计。恢复会替换当前数据，不与现有记录合并；旧版微记备份也能恢复。</p><p><strong>本机存储</strong><br>卸载应用会清除本机数据，换手机或卸载前请导出备份。密码锁不会加密备份文件。单个备份最大 80 MB。</p></div>"));
  }
  function setTimer(value) {
    timerStart = value;
    if (value) localStorage.setItem("weiji-timer-v1", String(value));
    else localStorage.removeItem("weiji-timer-v1");
    updateTimer();
    updateTimerBadge();
  }
  function elapsed() {
    return timerStart ? Math.max(0, Math.floor((Date.now() - timerStart) / 1e3)) : 0;
  }
  function timeText() {
    const sec = elapsed();
    return "".concat(J.pad(Math.floor(sec / 60)), ":").concat(J.pad(sec % 60));
  }
  function updateTimer() {
    if ($("#timer-display")) $("#timer-display").textContent = timeText();
    if ($("#timer-badge-time")) $("#timer-badge-time").textContent = timeText();
  }
  function updateTimerBadge() {
    var _a;
    (_a = $(".timer-floating")) == null ? void 0 : _a.remove();
    if (!timerStart || locked) return;
    const button = document.createElement("button");
    button.className = "timer-floating";
    button.dataset.action = "return-timer";
    button.innerHTML = "".concat(icon("clock"), '计时中 <span id="timer-badge-time">').concat(timeText(), "</span> · 点击返回");
    document.body.appendChild(button);
  }
  function toggleTimer() {
    if (timerStart) {
      const minutes = Math.max(0.1, Math.round(elapsed() / 60 * 10) / 10);
      $("#form-duration").value = Math.min(1440, minutes);
      captureForm();
      setTimer(null);
      renderForm();
      toast("时长已填入，点击保存即可。");
    } else {
      setTimer(Date.now());
      $("#form-date").value = today();
      $("#form-time").value = J.localTime();
      captureForm();
      renderForm();
    }
  }
  function returnTimer() {
    if (formDraft) closeModal();
    openForm("activity");
    const start = new Date(timerStart);
    formDraft.date = J.localDate(start);
    formDraft.time = J.localTime(start);
    renderForm();
  }
  document.addEventListener("click", (event) => {
    var _a;
    const button = event.target.closest("button");
    if (!button || button.disabled || locked) return;
    if (button.dataset.page) {
      navigate(button.dataset.page);
      return;
    }
    const { action, id, value, type, index } = button.dataset;
    switch (action) {
      case "add":
        openForm();
        break;
      case "close":
        closeModal();
        break;
      case "appearance":
        appearance();
        break;
      case "set-appearance":
        if (window.WeijiTheme.setMode(value)) appearance();
        else toast("外观设置保存失败，请重试。");
        break;
      case "settings":
        settings();
        break;
      case "go-stats":
        statsKey = "week";
        navigate("stats");
        break;
      case "go-records":
        navigate("records");
        break;
      case "prev-week":
        weekOffset--;
        renderHome();
        break;
      case "next-week":
        if (weekOffset < 0) weekOffset++;
        renderHome();
        break;
      case "record-type":
        recordType = value;
        renderRecords();
        break;
      case "clear-filter":
        recordFilter = null;
        renderRecords();
        break;
      case "stats-range":
        statsKey = value;
        renderStats();
        break;
      case "tag-records":
        recordFilter = { tagId: id, range: J.getRange(statsKey, state, today(), customRange) };
        recordType = "video";
        search = "";
        navigate("records");
        break;
      case "add-view": {
        if (!formDraft || imageBusy) break;
        captureForm();
        formDraft.views.push({ id: null, date: formDraft.date || today(), time: formDraft.time || J.localTime(), title: "", note: "", tags: [], images: [] });
        formDraft.activeView = formDraft.views.length - 1;
        renderForm();
        break;
      }
      case "select-view":
        if (formDraft && !imageBusy) {
          captureForm();
          formDraft.activeView = Number(index);
          renderForm();
        }
        break;
      case "remove-view":
        if (formDraft && !imageBusy && (!formDraft.legacyId || ((_a = currentView()) == null ? void 0 : _a.id) !== formDraft.legacyId)) {
          captureForm();
          formDraft.views.splice(formDraft.activeView, 1);
          formDraft.activeView = Math.max(0, Math.min(formDraft.activeView, formDraft.views.length - 1));
          renderForm();
        }
        break;
      case "toggle-tag": {
        const v = currentView();
        if (v) {
          v.tags = v.tags.includes(id) ? v.tags.filter((x) => x !== id) : [...v.tags, id];
          renderTagPicker();
        }
        break;
      }
      case "create-tag":
        createTag();
        break;
      case "pick-images":
        pickImages();
        break;
      case "remove-image":
        if (currentView() && !imageBusy) {
          currentView().images.splice(Number(index), 1);
          renderImages();
        }
        break;
      case "detail":
        detail(type, id);
        break;
      case "view-image": {
        const r = state.views.find((x) => x.id === id);
        if (!r) return;
        const viewer = document.createElement("div");
        viewer.className = "image-viewer";
        viewer.innerHTML = '<img src="'.concat(esc(imageUrl(r.images[Number(index)])), '" alt="放大的截图"><button class="icon-button" aria-label="关闭图片">').concat(icon("close"), "</button>");
        viewer.onclick = () => viewer.remove();
        document.body.appendChild(viewer);
        break;
      }
      case "manage-tags":
        manageTags();
        break;
      case "tag-color": {
        const next = { ...state, tags: state.tags.map((t) => t.id === id ? { ...t, color: (t.color + 1) % J.PALETTE.length } : t) };
        if (persist(next)) {
          renderTagManagement();
          render();
        }
        break;
      }
      case "tag-rename": {
        const name = button.closest(".tag-management-row").querySelector("input").value.trim();
        if (!name) {
          toast("标签名称不能为空。");
          return;
        }
        if (state.tags.some((t) => t.id !== id && t.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
          toast("已有同名标签。");
          return;
        }
        if (persist({ ...state, tags: state.tags.map((t) => t.id === id ? { ...t, name } : t) })) {
          renderTagManagement();
          render();
          toast("名称已保存。");
        }
        break;
      }
      case "tag-delete": {
        const tag = state.tags.find((t) => t.id === id);
        confirmSheet("删除这个标签？", "「".concat(esc(tag.name), "」会从相关记录中移除，观看记录仍然保留。"), () => {
          if (persist(J.deleteTag(state, id))) {
            manageTags();
            render();
          }
        }, manageTags);
        break;
      }
      case "pin-settings":
        pinSettings();
        break;
      case "export":
        exportBackup();
        break;
      case "import":
        beginImport();
        break;
      case "help":
        help();
        break;
      case "timer":
        toggleTimer();
        break;
      case "return-timer":
        returnTimer();
        break;
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") window.JournalApp.back();
  });
  $("#exit-demo").onclick = () => {
    location.href = location.pathname;
  };
  window.JournalApp = {
    onImages(result) {
      imageBusy = false;
      if (!currentView() || currentView() !== pendingImageDraft) {
        pendingImageDraft = null;
        if (native) native.cleanupImages();
        return;
      }
      pendingImageDraft = null;
      if (result.error) {
        renderImages();
        toast(result.error);
        return;
      }
      const v = currentView();
      v.images.push(...result.images.slice(0, 12 - v.images.length));
      renderImages();
      if (result.images.length) toast("已添加 ".concat(result.images.length, " 张截图。"));
    },
    onNativeResult(result) {
      if (result.error) {
        toast(result.error);
        return;
      }
      if (result.action === "import") {
        state = readState();
        readFailed = false;
        render();
      }
      toast(result.action === "import" ? "备份已恢复。" : result.action === "export" ? "备份已导出，包含记录和截图。" : "操作已完成。");
    },
    validateBackup(text) {
      try {
        return { ok: true, state: J.validateState(JSON.parse(text)) };
      } catch (error) {
        return { ok: false, error: error.message };
      }
    },
    lock() {
      if (native && hasPin()) {
        native.lock();
        showLock();
      }
    },
    back() {
      if ($(".image-viewer")) {
        $(".image-viewer").remove();
        return true;
      }
      if (locked) return false;
      if ($("#modal-root").firstChild) {
        closeModal();
        return true;
      }
      if (page !== "home") {
        navigate("home");
        return true;
      }
      return false;
    }
  };
  function boot() {
    try {
      state = readState();
      readFailed = false;
      timerStart = Number(localStorage.getItem("weiji-timer-v1")) || null;
      booted = true;
      render();
    } catch (error) {
      readFailed = true;
      $("#main").innerHTML = '<div class="error-state">数据读取失败：'.concat(esc(error.message), "<br>为保护已有记录，已暂停写入。请检查存储空间，或从设置恢复备份。</div>");
    }
  }
  if (demoMode) $("#demo-banner").hidden = false;
  try {
    if (hasPin()) showLock();
    else boot();
  } catch (error) {
    $("#main").innerHTML = '<div class="error-state">'.concat(esc(error.message), "</div>");
  }
  setInterval(updateTimer, 1e3);
  setInterval(refreshElapsed, 6e4);
  if (!native) document.addEventListener("visibilitychange", () => {
    if (document.hidden && booted && hasPin()) showLock();
  });
})();

// Capture taps before actions replace a button; dragging a list cancels its pressed state.
(function () {
  "use strict";
  var pressed = null, originX = 0, originY = 0, lastHaptic = 0, pressTimer;
  function clearPress() {
    if (pressed) pressed.classList.remove("is-pressed");
    pressed = null;
    clearTimeout(pressTimer);
  }
  document.addEventListener("pointerdown", function (event) {
    clearPress();
    if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
    var button = event.target.closest("button:not(:disabled)");
    if (!button) return;
    pressed = button;
    originX = event.clientX;
    originY = event.clientY;
    button.classList.add("is-pressed");
    pressTimer = setTimeout(clearPress, 3000);
  }, { passive: true });
  document.addEventListener("pointermove", function (event) {
    if (pressed && (Math.abs(event.clientX - originX) > 10 || Math.abs(event.clientY - originY) > 10)) clearPress();
  }, { passive: true });
  document.addEventListener("pointerup", clearPress, { passive: true });
  document.addEventListener("pointercancel", clearPress, { passive: true });
  window.addEventListener("blur", clearPress);
  document.addEventListener("visibilitychange", clearPress);
  document.addEventListener("click", function (event) {
    var button = event.target.closest("button:not(:disabled)");
    if (!button || !event.isTrusted || Date.now() - lastHaptic < 65) return;
    lastHaptic = Date.now();
    try {
      if (window.WeijiNative && window.WeijiNative.haptic) window.WeijiNative.haptic();
    } catch (_) {}
  }, true);
})();
