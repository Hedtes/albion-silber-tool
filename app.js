/* Albion Silber Tool – Oberfläche (Web/iPhone) */
(function () {
  "use strict";
  const C = window.Core;
  const VERSION = "1.0.1";
  const $ = (id) => document.getElementById(id);
  const S = C.fmtSilver;
  const SLOW_DAYS = 7;
  const RES_COLORS = { ore: "#5d6b80", wood: "#8a5a32", fiber: "#4f7d3a", hide: "#a0603a", rock: "#7a746a" };
  const TIERS = [2, 3, 4, 5, 6, 7, 8], ENCHS = [0, 1, 2, 3, 4];

  // ------------------------------------------------------------ Speicher (mit Absicherung)
  const storage = {
    get(k, fallback) {
      try { const v = localStorage.getItem("ast_" + k); return v === null ? fallback : JSON.parse(v); }
      catch (e) { return fallback; }
    },
    set(k, v) { try { localStorage.setItem("ast_" + k, JSON.stringify(v)); } catch (e) { /* voll/gesperrt */ } },
  };

  const settings = Object.assign(JSON.parse(JSON.stringify(C.DEFAULT_SETTINGS)), storage.get("settings", {}));
  const store = new C.PriceStore(settings, storage);
  let gd = null;

  const ui = Object.assign({
    mode: "cat", cat: "ore", qty: 1000, city: C.AUTO_CITY, buy: C.SAME_CITY, sell: C.AUTO_MARKET,
    sellMode: "order", buyMode: "instant", daily: 0, fce: 0, minVol: 1, tiers: [4, 5, 6, 7, 8], enchs: [0, 1, 2, 3, 4],
    sort: "qty", focus: false, chain: false, view: "refine",
  }, storage.get("ui", {}));
  const saveUi = () => storage.set("ui", ui);
  let shop = storage.get("shop", []);
  const saveShop = () => storage.set("shop", shop);

  let rows = [];
  let busy = false, abort = null;
  let calcId = null, calcMode = "qty";

  // ------------------------------------------------------------ Kleinkram
  function el(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === "class") e.className = v;
      else if (k === "on") for (const [ev, fn] of Object.entries(v)) e.addEventListener(ev, fn);
      else if (k === "style") e.setAttribute("style", v);
      else e[k] = v;
    }
    for (const kid of kids.flat()) if (kid !== null && kid !== undefined) e.append(kid.nodeType ? kid : document.createTextNode(kid));
    return e;
  }
  const fmtDays = (d) => d < 0.1 ? "< 0,1 Tg." : C.fmtNum(d, d < 10 ? 1 : 0) + " Tg.";
  function marginTag(m, p) {
    if (p === null || p === undefined) return "dim";
    if (p <= 0) return "loss";
    if (m >= 30) return "top";
    if (m >= 10) return "good";
    return "ok";
  }
  function setStatus(text, err) { const s = $("status"); s.textContent = text || ""; s.classList.toggle("err", !!err); }
  function progress(n, total) {
    const p = $("progress");
    p.classList.toggle("on", total > 0 && n < total);
    p.firstElementChild.style.width = total ? (100 * n / total) + "%" : "0";
  }
  const qty = () => Math.max(0, Math.floor(Number(ui.qty) || 0));

  // ------------------------------------------------------------ Preise laden
  async function runJobs(jobs, done) {
    if (busy) { setStatus("Es läuft bereits ein Abruf …"); return; }
    busy = true; abort = new AbortController();
    $("load-btn").disabled = true; $("shop-reload").disabled = true;
    let errors = 0;
    try {
      for (let k = 0; k < jobs.length; k++) {
        const [ids, locs, kind] = jobs[k];
        if (!ids.length || !locs.length) continue;
        const what = kind === "history" ? "Verkaufszahlen" : "Live-Preise";
        const fn = kind === "history" ? store.fetchHistory.bind(store) : store.fetchPrices.bind(store);
        errors += await fn(ids, locs, (n, t) => { setStatus(`Lade ${what} … Teil ${k + 1}/${jobs.length}, ${n}/${t}`); progress(n, t); }, abort.signal);
      }
      const pr = store.lastPruned;
      if (errors) {
        const msg = store.lastError ? String(store.lastError.message || store.lastError) : "";
        setStatus(`${errors} Anfrage(n) fehlgeschlagen${msg ? " (" + msg + ")" : ""}. Internet prüfen oder später erneut laden.`, true);
      } else {
        setStatus("✔ Live-Preise aktualisiert" + (pr ? ` · ${pr} manuelle Preise durch neuere ersetzt` : ""));
      }
    } catch (e) {
      setStatus("Fehler beim Abruf: " + (e.message || e), true);
    } finally {
      busy = false; progress(0, 0);
      $("load-btn").disabled = false; $("shop-reload").disabled = false;
      if (done) await done();
    }
  }

  function cats() { return ui.mode === "all" ? C.REFINE_TYPES.map((t) => t[0]) : [ui.cat]; }

  function citiesFor(cat) {
    let rc = ui.city;
    if (rc === C.AUTO_CITY) rc = C.bonusCityFor(settings, cat) || C.ROYAL_CITIES[0];
    const bc = ui.buy === C.SAME_CITY ? rc : ui.buy;
    const sl = ui.sell === C.SAME_CITY ? rc : ui.sell;
    return [rc, bc, sl];
  }

  function loadRefine() {
    const buyJobs = {}, sellJobs = {};
    for (const cat of cats()) {
      const [, bc, sl] = citiesFor(cat);
      const ids = Object.keys(gd.recipes).filter((i) => gd.recipes[i].cat === cat);
      const b = (buyJobs[bc] = buyJobs[bc] || new Set());
      ids.forEach((i) => { b.add(i); gd.recipes[i].res.forEach((x) => b.add(x[0])); });
      const key = sl === C.AUTO_MARKET ? C.MARKETS.join("|") : sl;
      (sellJobs[key] = sellJobs[key] || new Set());
      ids.forEach((i) => sellJobs[key].add(i));
    }
    const jobs = Object.entries(buyJobs).map(([c, s]) => [[...s], [c]])
      .concat(Object.entries(sellJobs).map(([k, s]) => [[...s], k.split("|")]));
    runJobs(jobs, async () => {
      render();
      // Verkaufszahlen nur für Stufen, die in Frage kommen
      const hist = {};
      for (const r of rawRows()) {
        if (!r.sell_loc || r.profit_nf === null) continue;
        if (ui.mode === "all" && !((r.profit_nf || 0) > 0 || (r.profit_f || 0) > 0)) continue;
        const [, , sl] = citiesFor(r.cat);
        const key = sl === C.AUTO_MARKET ? C.MARKETS.join("|") : sl;
        (hist[key] = hist[key] || new Set()).add(r.id);
      }
      const hj = Object.entries(hist).map(([k, s]) => [[...s], k.split("|"), "history"]);
      if (hj.length) { busy = false; await runJobs(hj, () => render()); }
    });
  }

  // ------------------------------------------------------------ Berechnen
  function rawRows() {
    let out = [];
    for (const cat of cats()) {
      const [rc, bc, sl] = citiesFor(cat);
      out = out.concat(C.refineTable(gd, store, settings, cat, {
        tiers: ui.tiers, enchs: ui.enchs, city: rc, buyCity: bc, buyMode: ui.buyMode,
        sellLoc: sl, sellMode: ui.sellMode, daily: Number(ui.daily) || 0, fce: Number(ui.fce) || 0, chain: ui.chain,
      }));
    }
    return out;
  }

  function compute() {
    const fk = ui.focus ? "f" : "nf";
    let rs = rawRows();
    const n = qty();
    for (const r of rs) {
      r.qty = n;
      r.need = C.needs(r, n, ui.focus);
      r.days = r.per_day ? n / r.per_day : null;
    }
    if (ui.mode === "all") {
      rs = rs.filter((r) => (r["profit_" + fk] || 0) > 0 && C.volumeOk(r.per_day, Number(ui.minVol) || 0));
      const keys = {
        qty: (r) => r.need.profit || 0, unit: (r) => r["profit_" + fk] || 0,
        spf: (r) => r.spf || 0, margin: (r) => r["margin_" + fk] || 0,
      };
      rs.sort((a, b) => keys[ui.sort](b) - keys[ui.sort](a));
    }
    rows = rs;
  }

  // ------------------------------------------------------------ Darstellung Refining
  function renderChips() {
    const box = $("res-chips");
    box.innerHTML = "";
    for (const [cat, raw, prod] of C.REFINE_TYPES) {
      box.append(el("button", {
        class: "chip res" + (ui.mode === "cat" && ui.cat === cat ? " on" : ""),
        style: `background:${RES_COLORS[cat]}`,
        on: { click: () => { ui.mode = "cat"; ui.cat = cat; saveUi(); render(); if (!hasPrices()) loadRefine(); } },
      }, `${raw} → ${prod}`));
    }
    box.append(el("button", {
      class: "chip" + (ui.mode === "all" ? " on" : ""),
      on: { click: () => { ui.mode = "all"; saveUi(); render(); loadRefine(); } },
    }, "🔍 Profitabelstes finden"));
  }
  const hasPrices = () => rows.some((r) => r.profit_nf !== null);

  function renderOpts() {
    const fill = (sel, values, cur) => {
      sel.innerHTML = "";
      values.forEach((v) => sel.append(el("option", { value: v, textContent: v, selected: v === cur })));
    };
    fill($("o-city"), [C.AUTO_CITY].concat(C.CITIES), ui.city);
    fill($("o-buy"), [C.SAME_CITY].concat(C.CITIES), ui.buy);
    fill($("o-sell"), [C.AUTO_MARKET, C.SAME_CITY].concat(C.MARKETS), ui.sell);
    $("o-sellmode").value = ui.sellMode; $("o-buymode").value = ui.buyMode;
    $("o-daily").value = ui.daily; $("o-fce").value = ui.fce; $("o-minvol").value = ui.minVol;
    $("o-sort").value = ui.sort; $("o-focus").checked = ui.focus; $("o-chain").checked = ui.chain;
    const mini = (box, values, list, label) => {
      box.innerHTML = "";
      values.forEach((v) => box.append(el("button", {
        class: list.includes(v) ? "on" : "",
        on: { click: () => { const i = list.indexOf(v); if (i >= 0) list.splice(i, 1); else list.push(v); saveUi(); render(); } },
      }, label(v))));
    };
    mini($("o-tiers"), TIERS, ui.tiers, (t) => "T" + t);
    mini($("o-enchs"), ENCHS, ui.enchs, (e) => "." + e);
    const [rc, bc, sl] = citiesFor(ui.mode === "all" ? "ore" : ui.cat);
    $("opts-sum").textContent = ui.mode === "all" ? "" : `${rc}${bc !== rc ? " · Kauf " + bc : ""} · ${sl === C.AUTO_MARKET ? "bester Markt" : sl}`;
  }

  function tile(v, l, cls) { return el("div", { class: "tile" + (cls ? " " + cls : "") }, el("div", { class: "v num" }, v), el("div", { class: "l" }, l)); }

  function renderTiles() {
    const fk = ui.focus ? "f" : "nf";
    const t = $("tiles");
    t.innerHTML = "";
    const qp = rows.map((r) => r.need.profit).filter((v) => v !== null);
    const best = qp.length ? Math.max(...qp) : null;
    const priced = rows.filter((r) => r["profit_" + fk] !== null);
    const pos = priced.filter((r) => r["profit_" + fk] > 0).length;
    const spfs = rows.map((r) => r.spf).filter((v) => v !== null);
    t.append(
      tile(best === null ? "–" : S(best), `bester Gewinn für ${S(qty())} Stück`, best === null ? "" : best > 0 ? "good" : "bad"),
      tile(priced.length ? `${pos} / ${priced.length}` : "–", "profitable Stufen", pos ? "good" : priced.length ? "bad" : ""),
      tile(rows.length ? `${C.fmtNum(rows[0].rrr_nf * 100)} / ${C.fmtNum(rows[0].rrr_f * 100)} %` : "–", "Rücklaufquote ohne / mit Fokus"),
      tile(spfs.length ? C.fmtNum(Math.max(...spfs)) : "–", "bestes Silber pro Fokus", spfs.length && Math.max(...spfs) > 0 ? "good" : ""),
    );
  }

  function renderList() {
    const fk = ui.focus ? "f" : "nf";
    const list = $("list");
    list.innerHTML = "";
    if (!rows.length) {
      list.append(el("div", { class: "empty" }, ui.mode === "all"
        ? "Gerade keine profitablen Stufen. Tipp: „Mit Fokus rechnen“ einschalten, Kette nutzen oder Min. Verkäufe senken."
        : "Keine Stufen ausgewählt – Tiers/Verzauberung prüfen."));
      $("list-info").textContent = "";
      return;
    }
    const missing = rows.filter((r) => r.profit_nf === null).length;
    $("list-info").textContent = (ui.mode === "all" ? `${rows.length} profitable Stufen über alle Rohstoffe · ` : "") +
      (missing ? `${missing} Stufen ohne Preise · ` : "") + "Tippen öffnet den Rechner";
    for (const r of rows) {
      const p = r["profit_" + fk], m = r["margin_" + fk];
      const tag = marginTag(m, p);
      const nd = r.need;
      const where = `${r.city}${r.buy_city !== r.city ? " · Kauf " + r.buy_city : ""} → ${r.sell_loc || "–"}${r.sell_mode === "instant" ? " ⚡" : ""}`;
      const slow = r.days !== null && r.days > SLOW_DAYS;
      const fact = (label, value, cls) => el("div", {}, el("b", {}, label), el("span", { class: "num " + (cls || "") }, value));
      list.append(el("div", { class: "stage " + tag, on: { click: () => openCalc(r.id) } },
        el("div", { class: "h" },
          el("div", { class: "name" }, gd.label(r.id)),
          el("div", { class: "profit num " + (nd.profit === null ? "muted" : nd.profit > 0 ? "pos" : "neg") },
            nd.profit === null ? "Preise fehlen" : S(nd.profit))),
        el("div", { class: "where" }, where),
        el("div", { class: "facts" },
          fact("Kaufen", `${S(nd.raw)}${r.prev ? " + " + S(nd.prev) : ""}`),
          fact("Einkauf", S(nd.cost)),
          fact("Marge", m === null ? "–" : C.fmtNum(m) + " %", p === null ? "" : p > 0 ? "pos" : "neg"),
          fact("Stück o. Fokus", S(r.profit_nf), r.profit_nf > 0 ? "pos" : r.profit_nf !== null ? "neg" : ""),
          fact("Stück m. Fokus", S(r.profit_f), r.profit_f > 0 ? "pos" : r.profit_f !== null ? "neg" : ""),
          fact("Silber/Fokus", r.spf === null ? "–" : C.fmtNum(r.spf)),
          fact("Verkauf", S(r.sell_price)),
          fact("Verk./Tag", r.per_day === null ? "?" : C.fmtNum(r.per_day, r.per_day < 10 ? 1 : 0)),
          fact("Abverkauf", r.days === null ? "?" : (slow ? "⚠ " : "") + fmtDays(r.days), slow ? "warn" : ""),
        ),
        r["prev_self_" + fk] ? el("div", { class: "small gold", style: "margin-top:6px" }, "★ Vorstufe selbst refined ist günstiger") : null,
      ));
    }
  }

  function render() {
    if (!gd) return;
    compute();
    renderChips(); renderOpts(); renderTiles(); renderList();
    if ($("calc").classList.contains("on")) renderCalc();
    $("premium-badge").textContent = settings.premium ? "★ Premium · 4 %" : "ohne Premium · 8 %";
  }

  // ------------------------------------------------------------ Rechner
  function calcRow() {
    if (!calcId) return null;
    let r = rows.find((x) => x.id === calcId);
    if (r) return r;
    const rec = gd.recipes[calcId];
    if (!rec) return null;
    const [rc, bc, sl] = citiesFor(rec.cat);
    r = C.refineTable(gd, store, settings, rec.cat, {
      tiers: [rec.tier], enchs: [rec.ench], city: rc, buyCity: bc, buyMode: ui.buyMode, sellLoc: sl,
      sellMode: ui.sellMode, daily: Number(ui.daily) || 0, fce: Number(ui.fce) || 0, chain: ui.chain,
    }).find((x) => x.id === calcId);
    if (r) { r.qty = qty(); r.days = r.per_day ? r.qty / r.per_day : null; }
    return r || null;
  }

  function openCalc(id) {
    calcId = id;
    $("calc").classList.add("on");
    document.body.style.overflow = "hidden";
    renderCalc();
  }
  function closeCalc() { $("calc").classList.remove("on"); document.body.style.overflow = ""; }

  function calcAmount(r, focus) {
    if (calcMode === "qty") return qty();
    return C.refineAmount(r, Math.max(0, Number($("calc-have").value) || 0), focus);
  }

  function priceKeys(r) {
    const bkind = ui.buyMode === "instant" ? "sell" : "buy";
    const keys = { raw: [r.raw, r.buy_city, bkind] };
    if (r.prev) keys.prev = [r.prev, r.buy_city, bkind];
    let loc = r.sell_loc;
    if (!loc) { const [, , sl] = citiesFor(r.cat); loc = sl === C.AUTO_MARKET ? r.city : sl; }
    const mode = r.sell_mode || (loc === C.BLACK_MARKET ? "instant" : ui.sellMode);
    keys.prod = [r.id, loc, mode === "instant" ? "buy" : "sell"];
    return keys;
  }

  function editPrice(key) {
    const r = calcRow(); if (!r) return;
    const [item, loc, kind] = priceKeys(r)[key];
    const [cur] = store.get(item, loc, kind);
    const e = store.live[item + "|" + loc] || {};
    const liveTxt = e[kind] ? `Live: ${S(e[kind])} (${C.fmtAge(e[kind + "_ts"])} alt)` : "Live: keiner";
    const v = window.prompt(`${gd.label(item)} – ${loc}\n${kind === "buy" ? "Kaufgebot" : "Verkaufsangebot"} · ${liveTxt}\n\nPreis in Silber (leer = Live-Preis):`,
      cur === null ? "" : String(Math.round(cur)));
    if (v === null) return;
    const clean = v.replace(/[.\s]/g, "");
    if (clean === "") store.setManual(item, loc, kind, null);
    else if (/^\d+$/.test(clean)) store.setManual(item, loc, kind, Number(clean));
    else { alert("Bitte eine ganze Zahl eingeben."); return; }
    render();
  }

  function resetPrices(keys) {
    const r = calcRow(); if (!r) return;
    const all = priceKeys(r);
    let n = 0;
    for (const k of keys) {
      if (!all[k]) continue;
      const [item, loc, kind] = all[k];
      if (store.isManual(item, loc, kind)) { store.setManual(item, loc, kind, null); n++; }
    }
    setStatus(n ? `↺ ${n} manuelle(r) Preis(e) entfernt` : "Keine manuellen Preise vorhanden");
    render();
  }

  function renderCalc() {
    const r = calcRow();
    if (!r) { $("calc-title").textContent = "Refining-Rechner"; return; }
    $("calc-title").textContent = gd.label(r.id);
    $("calc-where").textContent = `Refining in ${r.city} · Einkauf in ${r.buy_city} · Verkauf in ${r.sell_loc || "–"}${r.sell_mode === "instant" ? " (Sofortverkauf)" : ""}`;
    $("calc-have-row").style.display = calcMode === "have" ? "" : "none";
    $("calc-have-label").textContent = `${gd.name(r.raw)} vorhanden`;
    [...$("calc-mode").children].forEach((b) => b.classList.toggle("on", b.dataset.m === calcMode));
    const days = r.per_day ? qty() / r.per_day : null;
    $("calc-qty-info").innerHTML = calcMode === "qty"
      ? `Menge: <b>${S(qty())} Stück</b> (Feld MENGE auf der Hauptseite)` +
        (days !== null ? ` · Markt nimmt das in ~${fmtDays(days)} ab${days > SLOW_DAYS ? ' <span class="warn">⚠ dauert lange</span>' : ""}` : "")
      : "Es wird berechnet, wie viel du aus deinen Rohstoffen herstellen kannst.";

    // Preise
    const pbox = $("calc-prices");
    pbox.innerHTML = "";
    const keys = priceKeys(r);
    const fk = ui.focus ? "f" : "nf";
    for (const [key, [item, loc, kind]] of Object.entries(keys)) {
      let [p, src, ts] = store.get(item, loc, kind);
      if (key === "prod" && r.sell_price !== null && src !== "manuell" && r.sell_price !== p) { p = r.sell_price; src = "Ø-Preis"; ts = null; }
      const lbl = { raw: "Rohstoff", prev: "Vorstufe", prod: "➜ Verkauf" }[key];
      pbox.append(el("div", { class: "price" },
        el("div", { class: "t" },
          el("div", { class: "n" }, gd.label(item)),
          el("div", { class: "small muted" }, `${lbl} · ${loc}`,
            key === "prev" && r["prev_self_" + fk] ? el("span", { class: "gold" }, " · ★ selbst refined günstiger") : null)),
        el("div", {},
          el("div", { class: "v num" }, S(p)),
          el("div", { class: "src " + (src || "fehlt") }, `${src || "fehlt"}${ts ? " · " + C.fmtAge(ts) : ""}`)),
        el("button", { class: "icon-btn", title: "Preis eingeben", on: { click: () => editPrice(key) } }, "✎"),
        el("button", { class: "icon-btn", title: "Live-Preis", on: { click: () => resetPrices([key]) } }, "↺"),
      ));
    }

    // Ergebnis
    const d = { nf: C.refineDetail(gd, settings, r, calcAmount(r, false), false), f: C.refineDetail(gd, settings, r, calcAmount(r, true), true) };
    const fields = [
      ["n", "Herstellen (Stück)", (v) => S(v), true], ["rrr", "Rücklaufquote", (v) => C.fmtNum(v * 100) + " %"],
      ["raw_buy", "Rohstoff kaufen", (v) => S(v)], ["prev_buy", "Vorstufe kaufen", (v) => v === null ? "–" : S(v)],
      ["cost_buy", "Einkauf (Silber)", (v) => S(v), true], ["gross", "Materialwert", (v) => S(v)],
      ["returned", "– davon Rückgabe", (v) => S(v)], ["revenue_gross", "Verkaufswert", (v) => S(v)],
      ["fee", "– Steuer/Gebühr", (v) => S(v)], ["profit", "= Gewinn", (v) => S(v), true],
      ["profit_each", "Gewinn pro Stück", (v) => S(v)], ["margin", "Marge", (v) => v === null ? "–" : C.fmtNum(v) + " %"],
      ["focus", "Fokus nötig", (v) => v === null ? "–" : S(v)], ["spf", "Silber pro Fokus", (v) => v === null ? "–" : C.fmtNum(v)],
    ];
    const tbl = $("calc-table");
    tbl.innerHTML = "";
    tbl.append(el("tr", {}, el("th", {}, ""), el("th", {}, "ohne Fokus"), el("th", {}, "mit Fokus")));
    for (const [k, label, f, key] of fields) {
      const cell = (x) => {
        const v = d[x][k];
        let cls = "";
        if (["profit", "profit_each", "margin"].includes(k) && d[x].profit !== null) cls = d[x].profit > 0 ? "pos" : "neg";
        if (k === "returned") cls = "pos";
        if (k === "fee") cls = "neg";
        return el("td", { class: cls }, v === null || v === undefined ? "–" : f(v));
      };
      tbl.append(el("tr", { class: key ? "key" : "" }, el("td", {}, label), cell("nf"), cell("f")));
    }
    const use = ui.focus ? d.f : d.nf;
    const b = $("calc-banner");
    if (use.profit === null) {
      b.className = "banner";
      b.textContent = "Preise fehlen – oben ✎ eintragen oder auf der Hauptseite „Live-Preise laden“";
    } else {
      b.className = "banner " + marginTag(use.margin, use.profit);
      b.innerHTML = `<span class="big num">${use.profit > 0 ? "▲" : "▼"} ${S(use.profit)} Silber</span>` +
        `${S(use.n)} × ${gd.name(r.id)} ${ui.focus ? "mit" : "ohne"} Fokus · Marge ${C.fmtNum(use.margin)} % · Einkauf ${S(use.cost_buy)}`;
    }
  }

  // ------------------------------------------------------------ Einkaufsliste
  function shopEntry(r, n) {
    return { id: r.id, crafts: n, city: r.city, buy_city: r.buy_city, buy_mode: ui.buyMode, focus: ui.focus,
      daily: Number(ui.daily) || 0, sell_loc: r.sell_loc || r.city, sell_mode: r.sell_mode || ui.sellMode };
  }
  function addToShop(entries) {
    const keys = ["id", "city", "buy_city", "buy_mode", "focus", "sell_loc"];
    for (const e of entries) {
      const same = shop.find((x) => keys.every((k) => x[k] === e[k]));
      if (same) same.crafts += e.crafts; else shop.push(e);
    }
    saveShop();
    setStatus(`🛒 ${entries.length} Eintrag/Einträge zur Einkaufsliste hinzugefügt`);
  }

  function shopRow(e) {
    const rec = gd.recipes[e.id];
    return C.refineTable(gd, store, settings, rec.cat, {
      tiers: [rec.tier], enchs: [rec.ench], city: e.city, buyCity: e.buy_city, buyMode: e.buy_mode,
      sellLoc: e.sell_loc, sellMode: e.sell_mode, daily: e.daily, fce: Number(ui.fce) || 0, chain: false,
    }).find((x) => x.id === e.id);
  }

  function renderShop() {
    const ent = $("shop-entries"), mats = $("shop-mats");
    ent.innerHTML = ""; mats.innerHTML = "";
    let totalCost = 0, totalProfit = 0, complete = true;
    const agg = {};
    shop.forEach((e, i) => {
      if (!gd.recipes[e.id]) return;
      const r = shopRow(e);
      const nd = r ? C.needs(r, e.crafts, e.focus) : null;
      if (nd && nd.profit !== null) totalProfit += nd.profit; else complete = false;
      if (r) {
        const add = (id, n, price) => {
          const k = id + "|" + e.buy_city;
          const a = (agg[k] = agg[k] || { id, city: e.buy_city, n: 0, cost: 0, missing: false });
          a.n += n;
          if (price === null || price === undefined) a.missing = true; else a.cost += n * price;
        };
        add(r.raw, nd.raw, r.raw_price);
        if (r.prev) add(r.prev, nd.prev, r[e.focus ? "prev_f" : "prev_nf"]);
      }
      ent.append(el("div", { class: "shop-item" },
        el("div", { class: "t" },
          el("div", { style: "font-weight:700" }, `${S(e.crafts)} × ${gd.label(e.id)}`),
          el("div", { class: "small muted" }, `${e.city}${e.buy_city !== e.city ? " · Kauf " + e.buy_city : ""} → ${e.sell_loc}${e.focus ? " · ✦ Fokus" : ""}`)),
        el("div", { class: "num " + (nd && nd.profit !== null ? (nd.profit > 0 ? "pos" : "neg") : "muted") },
          nd && nd.profit !== null ? S(nd.profit) : "Preise fehlen"),
        el("button", { class: "icon-btn", on: { click: () => {
          const v = window.prompt("Anzahl (0 = entfernen)", String(e.crafts));
          if (v === null) return;
          const n = Math.floor(Number(v.replace(/[.\s]/g, "")) || 0);
          if (n <= 0) shop.splice(i, 1); else e.crafts = n;
          saveShop(); renderShop();
        } } }, "✎"),
      ));
    });
    if (!shop.length) ent.append(el("div", { class: "empty" }, "Noch leer. Im Refining-Rechner „Zur Einkaufsliste“ tippen."));
    const list = Object.values(agg).sort((a, b) => a.city.localeCompare(b.city) || b.cost - a.cost);
    for (const a of list) {
      if (a.missing) complete = false; else totalCost += a.cost;
      mats.append(el("div", { class: "shop-item" },
        el("div", { class: "t" }, el("div", { style: "font-weight:700" }, `${S(a.n)} × ${gd.label(a.id)}`),
          el("div", { class: "small muted" }, a.city)),
        el("div", { class: "num" }, a.missing ? "Preis fehlt" : S(a.cost))));
    }
    const t = $("shop-tiles");
    t.innerHTML = "";
    t.append(
      tile(S(shop.reduce((x, e) => x + e.crafts, 0)), "Stück in der Liste"),
      tile(S(totalCost) + (complete ? "" : " *"), "Einkauf gesamt"),
      tile(shop.length ? S(totalProfit) : "–", "erwarteter Gewinn", totalProfit > 0 ? "good" : shop.length ? "bad" : ""),
      tile(String(list.length), "Materialien"),
    );
    renderShop.lastText = "Einkaufsliste – Albion Silber Tool\n\n" + list.map((a) => `${S(a.n)} × ${gd.label(a.id)} (${a.city})${a.missing ? "" : " – " + S(a.cost) + " Silber"}`).join("\n") +
      `\n\nEinkauf gesamt: ${S(totalCost)} Silber`;
  }

  // ------------------------------------------------------------ Einstellungen
  const SETTING_FIELDS = [
    ["premium", "Premium aktiv", "bool"], ["manual_until_newer", "Manuelle Preise ersetzen, sobald neuerer Live-Preis kommt", "bool"],
    ["quality", "Qualität für Preisabruf (1–5)", "num"], ["max_age_hours", "Max. Preisalter (Stunden)", "num"],
    ["price_basis", "Verkaufspreis-Basis", "basis"], ["history_days", "Verlauf: Anzahl Tage", "num"],
    ["base_bonus", "Basis-Produktionsbonus", "num"], ["focus_bonus", "Fokus-Bonus", "num"],
    ["refining_city_bonus", "Refining-Stadtbonus", "num"], ["sales_tax_premium", "Steuer mit Premium %", "num"],
    ["sales_tax_normal", "Steuer ohne Premium %", "num"], ["setup_fee", "Einstellgebühr Aufträge %", "num"],
  ];
  function renderSettings() {
    const g = $("settings-grid");
    g.innerHTML = "";
    for (const [k, label, type] of SETTING_FIELDS) {
      if (type === "bool") {
        const cb = el("input", { type: "checkbox", checked: !!settings[k], on: { change: () => { settings[k] = cb.checked; saveSettings(); } } });
        g.append(el("label", { class: "toggle full" }, el("span", {}, label), cb));
      } else if (type === "basis") {
        const sel = el("select", { on: { change: () => { settings[k] = sel.value; saveSettings(); } } },
          el("option", { value: "min", textContent: "vorsichtig (niedrigerer von aktuell / Ø)" }),
          el("option", { value: "avg", textContent: "Ø der letzten Tage" }),
          el("option", { value: "current", textContent: "aktueller Preis" }));
        sel.value = settings[k];
        g.append(el("div", { class: "field full" }, el("label", {}, label), sel));
      } else {
        const inp = el("input", { type: "number", inputMode: "decimal", value: settings[k],
          on: { change: () => { const v = Number(inp.value); if (!isNaN(v)) { settings[k] = v; saveSettings(); } } } });
        g.append(el("div", { class: "field" }, el("label", {}, label), inp));
      }
    }
    $("app-version").textContent = VERSION;
  }
  function saveSettings() { storage.set("settings", settings); render(); }

  // ------------------------------------------------------------ Navigation
  function show(view) {
    ui.view = view; saveUi();
    document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === "view-" + view));
    document.querySelectorAll("nav.tabs button").forEach((b) => b.classList.toggle("on", b.dataset.view === view));
    if (view === "shop") renderShop();
    if (view === "settings") renderSettings();
    window.scrollTo(0, 0);
  }

  // ------------------------------------------------------------ Ereignisse
  function wire() {
    document.querySelectorAll("nav.tabs button").forEach((b) => b.addEventListener("click", () => show(b.dataset.view)));
    const q = $("qty");
    q.value = ui.qty;
    let t = null;
    q.addEventListener("input", () => { ui.qty = q.value; saveUi(); clearTimeout(t); t = setTimeout(render, 200); });
    const quick = $("qty-quick");
    [100, 500, 1000, 5000, 10000].forEach((v) => quick.append(el("button", { on: { click: () => { q.value = v; ui.qty = v; saveUi(); render(); } } }, S(v))));
    $("load-btn").addEventListener("click", loadRefine);
    const bind = (id, key, num, evt) => $(id).addEventListener(evt || "change", (e) => {
      ui[key] = e.target.type === "checkbox" ? e.target.checked : num ? Number(e.target.value) || 0 : e.target.value;
      saveUi(); render();
    });
    bind("o-city", "city"); bind("o-buy", "buy"); bind("o-sell", "sell"); bind("o-sellmode", "sellMode"); bind("o-buymode", "buyMode");
    bind("o-daily", "daily", true); bind("o-fce", "fce", true); bind("o-minvol", "minVol", true); bind("o-sort", "sort");
    bind("o-focus", "focus"); bind("o-chain", "chain");
    $("one-city").addEventListener("click", () => {
      if (ui.city === C.AUTO_CITY && ui.mode === "cat") ui.city = C.bonusCityFor(settings, ui.cat) || ui.city;
      ui.buy = C.SAME_CITY; ui.sell = C.SAME_CITY; saveUi(); render();
    });
    $("auto-cities").addEventListener("click", () => { ui.city = C.AUTO_CITY; ui.buy = C.SAME_CITY; ui.sell = C.AUTO_MARKET; saveUi(); render(); });

    $("calc-close").addEventListener("click", closeCalc);
    [...$("calc-mode").children].forEach((b) => b.addEventListener("click", () => { calcMode = b.dataset.m; renderCalc(); }));
    $("calc-have").addEventListener("input", () => renderCalc());
    $("calc-all-live").addEventListener("click", () => resetPrices(["raw", "prev", "prod"]));
    $("calc-shop").addEventListener("click", () => {
      const r = calcRow(); if (!r) return;
      const n = calcAmount(r, ui.focus);
      if (n > 0) { addToShop([shopEntry(r, n)]); $("calc-shop").textContent = "✔ Zur Einkaufsliste hinzugefügt"; setTimeout(() => { $("calc-shop").textContent = "🛒 Diese Menge zur Einkaufsliste"; }, 1800); }
    });

    $("shop-reload").addEventListener("click", () => {
      const buy = {}, sell = {}, hist = {};
      for (const e of shop) {
        const rec = gd.recipes[e.id]; if (!rec) continue;
        (buy[e.buy_city] = buy[e.buy_city] || new Set());
        rec.res.forEach((x) => buy[e.buy_city].add(x[0]));
        (sell[e.sell_loc] = sell[e.sell_loc] || new Set()).add(e.id);
        (hist[e.sell_loc] = hist[e.sell_loc] || new Set()).add(e.id);
      }
      const jobs = Object.entries(buy).map(([c, s]) => [[...s], [c]])
        .concat(Object.entries(sell).map(([c, s]) => [[...s], [c]]))
        .concat(Object.entries(hist).map(([c, s]) => [[...s], [c], "history"]));
      runJobs(jobs, () => { renderShop(); render(); });
    });
    $("shop-share").addEventListener("click", async () => {
      const text = renderShop.lastText || "";
      try {
        if (navigator.share) await navigator.share({ title: "Einkaufsliste", text });
        else { await navigator.clipboard.writeText(text); setStatus("Einkaufsliste kopiert"); }
      } catch (e) { /* abgebrochen */ }
    });
    $("shop-clear").addEventListener("click", () => { if (shop.length && confirm("Einkaufsliste leeren?")) { shop = []; saveShop(); renderShop(); } });

    $("clear-manual").addEventListener("click", () => { if (confirm("Alle manuellen Preise löschen?")) { store.clearManual(); render(); } });
    $("clear-cache").addEventListener("click", () => { if (confirm("Gespeicherte Preise löschen?")) { store.live = {}; store.history = {}; store.save(); render(); } });
    $("reset-settings").addEventListener("click", () => {
      if (!confirm("Einstellungen auf Standard zurücksetzen?")) return;
      Object.assign(settings, JSON.parse(JSON.stringify(C.DEFAULT_SETTINGS)));
      saveSettings(); renderSettings();
    });
  }

  // ------------------------------------------------------------ Updates (Service Worker)
  function registerSW() {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("sw.js").then((reg) => {
      const ask = (w) => {
        $("toast-text").textContent = "Neue Version verfügbar";
        $("toast").classList.add("on");
        $("toast-btn").onclick = () => w.postMessage("skip");
      };
      if (reg.waiting && navigator.serviceWorker.controller) ask(reg.waiting);
      reg.addEventListener("updatefound", () => {
        const w = reg.installing;
        w && w.addEventListener("statechange", () => { if (w.state === "installed" && navigator.serviceWorker.controller) ask(w); });
      });
      document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") reg.update().catch(() => {}); });
    }).catch(() => {});
    let reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (!reloaded) { reloaded = true; location.reload(); } });
  }

  // ------------------------------------------------------------ Start
  async function start() {
    wire();
    try {
      const res = await fetch("data/refining.json");
      gd = new C.GameData(await res.json());
    } catch (e) {
      setStatus("Rezeptdaten konnten nicht geladen werden: " + e.message, true);
      return;
    }
    render();
    show(ui.view || "refine");
    if (!hasPrices()) setStatus("Tippe auf „Live-Preise laden“.");
    else setStatus("Gespeicherte Preise · für aktuelle Werte „Live-Preise laden“");
    registerSW();
  }
  start();
})();
