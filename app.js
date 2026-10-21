/* Albion Silber Tool – Oberfläche (Web/iPhone) */
(function () {
  "use strict";
  const C = window.Core;
  const VERSION = "1.2.0";
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
    sort: "qty", focus: false, chain: false, view: "silver",
    cItem: null, cGroup: "Tränke", cQty: 100, cCity: C.AUTO_CITY, cBuy: C.SAME_CITY, cBuyMode: "instant",
    cSell: C.AUTO_MARKET, cSellMode: "order", cFocus: false, cDaily: 0, cStation: 0,
    sMode: "safe", sBudget: 1000000, sFocus: 0, sFce: 0, sCity: "auto", sBuyMode: "instant", sChain: true,
    sMargin: 10, sDays: 1, sAge: 6, sGroups: ["Refining", "Tränke", "Essen"], sTiers: [4, 5, 6], sEnchs: [0, 1, 2],
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
  function setStatus(text, err) {
    document.querySelectorAll(".status").forEach((s) => { s.textContent = text || ""; s.classList.toggle("err", !!err); });
  }
  function progress(n, total) {
    document.querySelectorAll(".progress").forEach((p) => {
      p.classList.toggle("on", total > 0 && n < total);
      p.firstElementChild.style.width = total ? (100 * n / total) + "%" : "0";
    });
  }
  const qty = () => Math.max(0, Math.floor(Number(ui.qty) || 0));

  // ------------------------------------------------------------ Preise laden
  async function runJobs(jobs, done) {
    if (busy) { setStatus("Es läuft bereits ein Abruf …"); return; }
    busy = true; abort = new AbortController();
    $("load-btn").disabled = true; $("shop-reload").disabled = true; $("c-load").disabled = true; $("s-run").disabled = true;
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
      $("load-btn").disabled = false; $("shop-reload").disabled = false; $("c-load").disabled = false; $("s-run").disabled = false;
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
    if (ui.view === "craft") renderCraft();
    if (ui.view === "shop") renderShop();
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

  // ------------------------------------------------------------ Silber-Finder
  const S_GROUPS = ["Refining", "Tränke", "Essen", "Waffen", "Rüstung", "Nebenhand", "Taschen & Umhänge", "Sammlerausrüstung", "Werkzeuge"];
  let silver = null; // letztes Ergebnis

  function sCities() {
    const pool = ui.sMode === "bm" ? C.ROYAL_CITIES.concat(["Caerleon"]) : C.ROYAL_CITIES;
    return ui.sCity === "auto" ? pool : [ui.sCity];
  }
  function sIds() {
    return Object.keys(gd.recipes).filter((id) => {
      const r = gd.recipes[id];
      return ui.sGroups.includes(r.group) && ui.sTiers.includes(r.tier) && ui.sEnchs.includes(r.ench);
    });
  }
  function sOpts() {
    return { maxAge: Number(ui.sAge) || 6, daily: 0, fce: Number(ui.sFce) || 0, chain: ui.sChain, buyMode: ui.sBuyMode, sellMode: "instant" };
  }

  /** Alle Items bewerten: pro Item beste Stadt ohne und mit Fokus. */
  function silverEvaluate(ids) {
    const o = sOpts();
    const minM = Number(ui.sMargin) || 0;
    const withFocus = (Number(ui.sFocus) || 0) > 0;
    const items = [];
    const memos = {};
    for (const id of ids) {
      let bestNf = null, bestF = null;
      for (const city of sCities()) {
        const memo = (memos[city] = memos[city] || {});
        // Der Black Market kauft nur Ausrüstung – Ressourcen, Tränke und Essen bleiben in der Stadt
        const bmOk = ui.sMode === "bm" && !["Refining", "Tränke", "Essen"].includes(gd.recipes[id].group);
        const sellLocs = bmOk ? [city, C.BLACK_MARKET] : [city];
        const base = Object.assign({}, o, { city, buyCity: city, sellLocs, memo });
        const nf = C.evalCraft(gd, store, settings, id, Object.assign({}, base, { focus: false }));
        if (nf && nf.margin >= minM && (!bestNf || nf.profit > bestNf.profit)) bestNf = nf;
        if (withFocus) {
          const f = C.evalCraft(gd, store, settings, id, Object.assign({}, base, { focus: true }));
          if (f && f.margin >= minM && (!bestF || f.profit / Math.max(1, f.focusCost) > bestF.profit / Math.max(1, bestF.focusCost))) bestF = f;
        }
      }
      if (bestNf || bestF) items.push({ id, nf: bestNf, f: bestF });
    }
    return items;
  }

  function runSilver() {
    if (!ui.sGroups.length || !ui.sTiers.length || !ui.sEnchs.length) { setStatus("Bitte Gruppen, Tiers und Verzauberung wählen.", true); return; }
    const ids = sIds();
    if (ids.length > 4000 && !confirm(`${ids.length} Rezepte – das dauert etwas. Starten?`)) return;
    const mats = new Set();
    const addMats = (id, depth) => {
      const r = gd.recipes[id]; if (!r || depth > 8) return;
      for (const [rid] of r.res) {
        if (mats.has(rid)) continue;
        mats.add(rid);
        if (ui.sChain && gd.recipes[rid] && C.REFINING_CATS.has(gd.recipes[rid].cat)) addMats(rid, depth + 1);
      }
    };
    ids.forEach((id) => addMats(id, 0));
    const locs = sCities().concat(ui.sMode === "bm" ? [C.BLACK_MARKET] : []);
    runJobs([[[...new Set(ids.concat([...mats]))], locs]], async () => {
      // Verkaufszahlen nur für Items mit Gewinn laden
      const items = silverEvaluate(ids);
      const hist = {};
      for (const x of items) for (const ev of [x.nf, x.f]) if (ev && ev.profit > 0) (hist[ev.sellLoc] = hist[ev.sellLoc] || new Set()).add(ev.id);
      const jobs = Object.entries(hist).map(([loc, set]) => [[...set], [loc], "history"]);
      if (jobs.length) { busy = false; await runJobs(jobs, () => finishSilver(ids)); } else finishSilver(ids);
    });
  }

  function finishSilver(ids) {
    const items = silverEvaluate(ids);
    const res = C.planSilver(items, {
      budget: Number(ui.sBudget) || 0, focus: Number(ui.sFocus) || 0, days: Number(ui.sDays) || 1, unknownCap: 0,
    });
    const usedIds = new Set(res.plan.map((p) => p.ev.id));
    const more = items.filter((x) => !usedIds.has(x.id)).map((x) => x.nf || x.f).filter((ev) => ev && ev.profit > 0)
      .map((ev) => ({ ev, perDay: ev.per_day ? ev.profit * Math.floor(ev.per_day / ev.rec.amount) : null }))
      .sort((a, b) => (b.perDay || 0) - (a.perDay || 0)).slice(0, 20);
    silver = { plan: res.plan, more, budgetLeft: res.budgetLeft, focusLeft: res.focusLeft, checked: ids.length, found: items.length, at: Date.now() };
    storage.set("silver", null);
    renderSilver();
  }

  function renderSilverOpts() {
    [...$("s-mode").children].forEach((b) => b.classList.toggle("on", b.dataset.m === ui.sMode));
    $("s-mode-info").innerHTML = ui.sMode === "safe"
      ? "Alles in <b>einer Royal City</b>: Material kaufen, craften und sofort an Kaufgebote verkaufen. Kein Transport durch rote Zonen, kein Warten auf Käufer."
      : "Ausrüstung wird sofort an den <b>Black Market</b> (Caerleon) verkauft. Höhere Preise, aber Transport durch <b>rote Zone</b> – außer du craftest direkt in Caerleon.";
    const mini = (box, values, list, label) => {
      box.innerHTML = "";
      values.forEach((v) => box.append(el("button", {
        class: list.includes(v) ? "on" : "",
        on: { click: () => { const i = list.indexOf(v); if (i >= 0) list.splice(i, 1); else list.push(v); saveUi(); renderSilverOpts(); } },
      }, label(v))));
    };
    mini($("s-groups"), S_GROUPS, ui.sGroups, (g) => g);
    mini($("s-tiers"), TIERS, ui.sTiers, (t) => "T" + t);
    mini($("s-enchs"), ENCHS, ui.sEnchs, (e) => "." + e);
    const sel = $("s-city");
    sel.innerHTML = "";
    const pool = ui.sMode === "bm" ? C.ROYAL_CITIES.concat(["Caerleon"]) : C.ROYAL_CITIES;
    if (ui.sCity !== "auto" && !pool.includes(ui.sCity)) ui.sCity = "auto";
    sel.append(el("option", { value: "auto", textContent: "Beste Stadt je Item" }));
    pool.forEach((c) => sel.append(el("option", { value: c, textContent: c })));
    sel.value = ui.sCity;
    $("s-buymode").value = ui.sBuyMode; $("s-margin").value = ui.sMargin; $("s-days").value = ui.sDays;
    $("s-age").value = ui.sAge; $("s-chain").checked = ui.sChain;
    if (document.activeElement !== $("s-budget")) $("s-budget").value = ui.sBudget;
    $("s-focus").value = ui.sFocus; $("s-fce").value = ui.sFce;
    let n = 0;
    try { n = sIds().length; } catch (e) { /* noch keine Daten */ }
    $("s-opts-sum").textContent = `${n} Rezepte · ${ui.sCity === "auto" ? "beste Stadt" : ui.sCity}`;
  }

  function evWhere(ev) {
    const transport = ev.sellLoc === C.BLACK_MARKET && ev.city !== "Caerleon";
    return { text: `Craften & kaufen in ${ev.city} → Sofortverkauf ${ev.sellLoc === C.BLACK_MARKET ? "an Black Market" : "in " + ev.sellLoc}`, transport };
  }

  function silverCard(p, isPlan) {
    const ev = p.ev;
    const w = evWhere(ev);
    const fact = (label, value, cls) => el("div", {}, el("b", {}, label), el("span", { class: "num " + (cls || "") }, value));
    return el("div", { class: "stage " + marginTag(ev.margin, ev.profit), on: { click: () => openInCraft(p) } },
      el("div", { class: "h" },
        el("div", { class: "name" }, (isPlan ? `${S(p.pieces)} × ` : "") + gd.label(ev.id)),
        el("div", { class: "profit num pos" }, isPlan ? S(p.profit) : (p.perDay ? S(p.perDay) + "/Tag" : S(ev.profit)))),
      el("div", { class: "where" }, w.text, w.transport ? el("span", { class: "warn" }, "  🐎 Transport durch rote Zone") : null),
      el("div", { class: "facts" },
        isPlan ? fact("Einkauf", S(p.cost)) : fact("Gewinn/Craft", S(ev.profit), "pos"),
        fact("Marge", C.fmtNum(ev.margin) + " %", "pos"),
        fact("Verk./Tag", ev.per_day === null || ev.per_day === undefined ? "?" : C.fmtNum(ev.per_day, ev.per_day < 10 ? 1 : 0)),
        isPlan ? fact("Crafts", S(p.crafts) + (ev.rec.amount > 1 ? ` à ${ev.rec.amount}` : "")) : fact("Verkauf", S(ev.sellPrice)),
        fact("Fokus", ev.focus ? (isPlan ? S(p.focus) : "ja") : "–"),
        fact("Material", ev.buyMode === "order" ? "Kaufauftrag" : "Sofortkauf"),
      ),
      ev.selfMade.length ? el("div", { class: "small gold", style: "margin-top:6px" }, "★ Selbst refinen: " + ev.selfMade.map((i) => gd.label(i)).join(", ")) : null,
    );
  }

  function renderSilver() {
    renderSilverOpts();
    const t = $("s-tiles"), plan = $("s-plan"), more = $("s-more");
    t.innerHTML = ""; plan.innerHTML = ""; more.innerHTML = "";
    $("s-shop").style.display = "none"; $("s-more-h").style.display = "none";
    if (!silver) { $("s-info").textContent = "Budget eingeben und „Silber finden“ tippen."; return; }
    const P = silver.plan;
    const profit = P.reduce((a, p) => a + p.profit, 0), cost = P.reduce((a, p) => a + p.cost, 0);
    const focus = P.reduce((a, p) => a + p.focus, 0);
    const carried = P.filter((p) => evWhere(p.ev).transport).reduce((a, p) => a + p.pieces * p.ev.sellPrice, 0);
    t.append(
      tile(S(profit), "Gewinn mit diesem Plan", profit > 0 ? "good" : ""),
      tile(S(cost), "Einkauf nötig"),
      tile(cost ? C.fmtNum(profit / cost * 100) + " %" : "–", "Rendite aufs Budget", profit > 0 ? "good" : ""),
      ui.sMode === "bm" ? tile(S(carried), "Warenwert im Transport 🐎", carried ? "bad" : "") : tile(S(focus), "Fokus verbraucht"),
    );
    const age = Math.round((Date.now() - silver.at) / 60000);
    $("s-info").textContent = `${silver.checked} Rezepte geprüft · ${silver.found} erfüllen die Regeln · Plan mit ${P.length} Items` +
      ` · Stand vor ${age} min · Tippen öffnet den Rechner`;
    if (!P.length) {
      plan.append(el("div", { class: "empty" }, "Gerade nichts, das alle Sicherheitsregeln erfüllt. Tipp: Mindest-Marge senken, mehr Gruppen/Tiers wählen, „Ganze Kette“ einschalten oder Fokus eintragen."));
    }
    P.forEach((p) => plan.append(silverCard(p, true)));
    if (P.length) $("s-shop").style.display = "";
    if (silver.more.length) {
      $("s-more-h").style.display = "";
      silver.more.forEach((m) => more.append(silverCard(m, false)));
    }
  }

  function openInCraft(p) {
    const ev = p.ev;
    Object.assign(ui, {
      cItem: ev.id, cQty: p.pieces || ev.rec.amount * Math.max(1, Math.floor((ev.per_day || ev.rec.amount) / ev.rec.amount)),
      cCity: ev.city, cBuy: C.SAME_CITY, cBuyMode: ev.buyMode, cSell: ev.sellLoc, cSellMode: ev.sellMode,
      cFocus: ev.focus, cDaily: 0, cGroup: ev.rec.group,
    });
    saveUi();
    show("craft");
  }

  function silverToShop() {
    if (!silver || !silver.plan.length) return;
    addToShop(silver.plan.map((p) => ({ id: p.ev.id, crafts: p.crafts, city: p.ev.city, buy_city: p.ev.buyCity,
      buy_mode: p.ev.buyMode, focus: p.ev.focus, daily: 0, sell_loc: p.ev.sellLoc, sell_mode: p.ev.sellMode })));
    $("s-shop").textContent = "✔ Plan in der Einkaufsliste";
    setTimeout(() => { $("s-shop").textContent = "🛒 Ganzen Plan zur Einkaufsliste"; }, 1800);
  }

  // ------------------------------------------------------------ Crafting-Rechner
  const GROUPS = ["Tränke", "Essen", "Waffen", "Rüstung", "Nebenhand", "Taschen & Umhänge", "Sammlerausrüstung", "Werkzeuge", "Refining"];

  function cCities() {
    const rec = gd.recipes[ui.cItem];
    let city = ui.cCity;
    if (city === C.AUTO_CITY) city = C.bonusCityFor(settings, rec.cat) || (ui.cBuy !== C.SAME_CITY ? ui.cBuy : "Lymhurst");
    const buy = ui.cBuy === C.SAME_CITY ? city : ui.cBuy;
    const sellLocs = ui.cSell === C.AUTO_MARKET ? C.MARKETS : [ui.cSell === C.SAME_CITY ? city : ui.cSell];
    return { city, buy, sellLocs };
  }

  /** Alles für den gewählten Craft ausrechnen. */
  function craftCalc() {
    const rec = gd.recipes[ui.cItem];
    if (!rec) return null;
    const pieces = Math.max(1, Math.floor(Number(ui.cQty) || 1));
    const crafts = C.craftsFor(rec, pieces);
    const { city, buy, sellLocs } = cCities();
    const bonus = C.productionBonus(settings, city, rec.cat, ui.cFocus, Number(ui.cDaily) || 0);
    const rrr = C.returnRate(bonus);
    const kind = ui.cBuyMode === "instant" ? "sell" : "buy";
    const plan = C.buyPlan(rec, crafts, rrr);
    const prices = {};
    let buyCost = 0, buyOk = true;
    for (const pl of plan) {
      const [p, src, ts] = store.get(pl.id, buy, kind);
      pl.price = p !== null && src !== "alt" || src === "manuell" ? C.buyUnitCost(settings, p, ui.cBuyMode) : null;
      pl.src = src; pl.ts = ts; pl.raw = p;
      prices[pl.id] = pl.price;
      pl.cost = pl.price !== null ? pl.buy * pl.price : null;
      if (pl.cost === null) buyOk = false; else buyCost += pl.cost;
    }
    const best = C.bestSale(store, settings, ui.cItem, sellLocs, ui.cSellMode);
    const mode = best ? best.mode : (sellLocs[0] === C.BLACK_MARKET ? "instant" : ui.cSellMode);
    const res = C.calcCraft(rec, crafts, rrr, prices, best ? best.price : null, C.sellFee(settings, mode),
      Number(ui.cStation) || 0, ui.cFocus);
    return { rec, pieces, crafts, city, buy, sellLocs, bonus, rrr, plan, buyCost: buyOk ? buyCost : null, best, mode, res,
      sellLoc: best ? best.loc : sellLocs[0] };
  }

  function renderCraftSearch() {
    const g = $("c-groups");
    g.innerHTML = "";
    ["Alle"].concat(GROUPS).forEach((name) => g.append(el("button", {
      class: "chip" + ((ui.cGroup || "Tränke") === name ? " on" : ""),
      on: { click: () => { ui.cGroup = name; saveUi(); renderCraftSearch(); } },
    }, name)));
    const grp = (ui.cGroup || "Tränke") === "Alle" ? null : (ui.cGroup || "Tränke");
    const ids = gd.search($("c-search").value, grp).slice(0, 60);
    const box = $("c-results");
    box.innerHTML = "";
    if (!ids.length) box.append(el("div", { class: "empty" }, "Nichts gefunden"));
    ids.forEach((id) => box.append(el("div", {
      class: "shop-item", style: "cursor:pointer" + (id === ui.cItem ? ";color:var(--gold)" : ""),
      on: { click: () => selectCraft(id) },
    }, el("div", { class: "t", style: "font-weight:600" }, gd.label(id)),
      el("div", { class: "small muted" }, `${gd.recipes[id].amount} Stk/Craft`))));
  }

  function selectCraft(id) {
    ui.cItem = id; saveUi();
    renderCraftSearch(); renderCraft();
    $("c-calc").scrollIntoView({ behavior: "smooth", block: "start" });
    const r = gd.recipes[id];
    const { buy } = cCities();
    if (r.res.some((x) => store.get(x[0], buy, "sell")[0] === null)) loadCraft();
  }

  function loadCraft() {
    const k = craftCalc(); if (!k) return;
    runJobs([[k.rec.res.map((x) => x[0]), [k.buy]], [[ui.cItem], k.sellLocs], [[ui.cItem], k.sellLocs, "history"]], () => render());
  }

  function cPriceKey(which, k) {
    if (which === "prod") return [ui.cItem, k.sellLoc, k.mode === "instant" ? "buy" : "sell"];
    return [which, k.buy, ui.cBuyMode === "instant" ? "sell" : "buy"];
  }

  function editCraftPrice(which) {
    const k = craftCalc(); if (!k) return;
    const [item, loc, kind] = cPriceKey(which, k);
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
    renderCraft();
  }

  function resetCraftPrices(list) {
    const k = craftCalc(); if (!k) return;
    let n = 0;
    for (const which of list) {
      const [item, loc, kind] = cPriceKey(which, k);
      if (store.isManual(item, loc, kind)) { store.setManual(item, loc, kind, null); n++; }
    }
    setStatus(n ? `↺ ${n} manuelle(r) Preis(e) entfernt` : "Keine manuellen Preise vorhanden");
    renderCraft();
  }

  function renderCraftOpts() {
    const fill = (sel, values, cur) => { sel.innerHTML = ""; values.forEach((v) => sel.append(el("option", { value: v, textContent: v, selected: v === cur }))); };
    fill($("c-city"), [C.AUTO_CITY].concat(C.CITIES), ui.cCity);
    fill($("c-buy"), [C.SAME_CITY].concat(C.CITIES), ui.cBuy);
    fill($("c-sell"), [C.AUTO_MARKET, C.SAME_CITY].concat(C.MARKETS), ui.cSell);
    $("c-buy").options[0].textContent = "Wie Crafting-Stadt";
    $("c-sell").options[1].textContent = "Wie Crafting-Stadt";
    $("c-sellmode").value = ui.cSellMode; $("c-buymode").value = ui.cBuyMode;
    $("c-daily").value = ui.cDaily; $("c-station").value = ui.cStation; $("c-focus").checked = ui.cFocus;
  }

  function renderCraft() {
    if (!gd || !ui.cItem || !gd.recipes[ui.cItem]) { $("c-calc").style.display = "none"; return; }
    $("c-calc").style.display = "";
    const k = craftCalc();
    const rec = k.rec;
    renderCraftOpts();
    $("c-title").textContent = gd.label(ui.cItem);
    const bc = C.bonusCityFor(settings, rec.cat);
    $("c-hint").textContent = `${rec.amount} Stück pro Craft · ${bc ? "Bonusstadt: " + bc : "keine Bonusstadt"}`;
    if (document.activeElement !== $("c-qty")) $("c-qty").value = ui.cQty;
    $("c-crafts-info").textContent = `= ${S(k.crafts)} Crafts à ${rec.amount} Stück` +
      (k.crafts * rec.amount !== k.pieces ? ` → ergibt ${S(k.crafts * rec.amount)} Stück` : "");
    $("c-opts-sum").textContent = `${k.city}${k.buy !== k.city ? " · Kauf " + k.buy : ""} · ${ui.cSell === C.AUTO_MARKET ? "bester Markt" : k.sellLocs[0]}${ui.cFocus ? " · Fokus" : ""}`;

    // Materialien
    const box = $("c-mats");
    box.innerHTML = "";
    for (const pl of k.plan) {
      const rest = !pl.ret ? "keine Rückgabe" : `Rest ~${Math.round(pl.rest)}`;
      box.append(el("div", { class: "price" },
        el("div", { class: "t" },
          el("div", { class: "n" }, gd.label(pl.id)),
          el("div", { class: "small muted" }, `${pl.cnt} pro Craft · ohne Rückgabe ${S(pl.full)} · ${rest}`),
          el("div", { class: "small" }, `Stückpreis ${S(pl.price)} `, el("span", { class: "src " + (pl.src || "fehlt") },
            `${pl.src || "fehlt"}${pl.ts ? " · " + C.fmtAge(pl.ts) : ""}`), `  ·  Einkauf ${S(pl.cost)}`)),
        el("div", { style: "text-align:right" }, el("div", { class: "small muted" }, "KAUFEN"),
          el("div", { class: "v num", style: "font-size:20px;color:var(--gold-lt)" }, S(pl.buy))),
        el("button", { class: "icon-btn", on: { click: () => editCraftPrice(pl.id) } }, "✎"),
        el("button", { class: "icon-btn", on: { click: () => resetCraftPrices([pl.id]) } }, "↺"),
      ));
    }
    // Produkt
    let [pp, psrc, pts] = store.get(ui.cItem, k.sellLoc, k.mode === "instant" ? "buy" : "sell");
    if (k.best && psrc !== "manuell" && k.best.price !== pp) { pp = k.best.price; psrc = "Ø-Preis"; pts = null; }
    const vol = k.best ? k.best.info.per_day : null;
    box.append(el("div", { class: "price", style: "border-top:2px solid var(--gold-dk)" },
      el("div", { class: "t" },
        el("div", { class: "n" }, "➜ Verkauf: " + gd.label(ui.cItem)),
        el("div", { class: "small muted" }, `${k.sellLoc}${k.mode === "instant" ? " · Sofortverkauf" : ""} · Verkäufe/Tag ${vol === null ? "?" : C.fmtNum(vol, vol < 10 ? 1 : 0)}`),
        el("div", { class: "small" }, el("span", { class: "src " + (psrc || "fehlt") }, `${psrc || "fehlt"}${pts ? " · " + C.fmtAge(pts) : ""}`))),
      el("div", { style: "text-align:right" }, el("div", { class: "small muted" }, "Stückpreis"),
        el("div", { class: "v num", style: "font-size:20px" }, S(pp))),
      el("button", { class: "icon-btn", on: { click: () => editCraftPrice("prod") } }, "✎"),
      el("button", { class: "icon-btn", on: { click: () => resetCraftPrices(["prod"]) } }, "↺"),
    ));

    // Ergebnis
    const r = k.res, ok = r.complete;
    const rowsT = [
      ["Herstellen", `${S(k.crafts * rec.amount)} Stück (${S(k.crafts)} Crafts)`, true],
      ["Einkauf (Silber)", S(k.buyCost), true, "gold"],
      ["Rücklaufquote", `${C.fmtNum(k.rrr * 100)} % (Bonus ${Math.round(k.bonus)})`],
      ["Materialwert gesamt", r.missing.length ? "–" : S(r.gross)],
      ["– davon Rückgabe", r.missing.length ? "–" : S(r.returned), false, "pos"],
      ["+ Stationsgebühr", S(r.station)],
      ["Verkaufswert", k.best ? S(r.revenue_gross) : "–"],
      ["– Steuer/Gebühr", k.best ? S(r.fee) : "–", false, "neg"],
      ["= Gewinn", ok ? S(r.profit) : "–", true, ok ? (r.profit > 0 ? "pos" : "neg") : ""],
      ["Gewinn pro Stück", ok ? S(r.profit_each) : "–", false, ok ? (r.profit > 0 ? "pos" : "neg") : ""],
      ["Marge", ok ? C.fmtNum(r.margin) + " %" : "–", false, ok ? (r.profit > 0 ? "pos" : "neg") : ""],
      ["Fokus nötig", ui.cFocus ? S(r.focus) : "–"],
      ["Silber pro Fokus", ui.cFocus && ok && r.focus ? C.fmtNum(r.profit / r.focus) : "–"],
    ];
    const tbl = $("c-table");
    tbl.innerHTML = "";
    rowsT.forEach(([l, v, key, cls]) => tbl.append(el("tr", { class: key ? "key" : "" }, el("td", {}, l), el("td", { class: cls || "" }, v))));
    const b = $("c-banner");
    if (!ok) { b.className = "banner"; b.textContent = "Preise fehlen – „Live-Preise laden“ oder mit ✎ eintragen"; }
    else {
      b.className = "banner " + marginTag(r.margin, r.profit);
      b.innerHTML = `<span class="big num">${r.profit > 0 ? "▲" : "▼"} ${S(r.profit)} Silber</span>` +
        `${S(k.crafts * rec.amount)} × ${gd.name(ui.cItem)} · Marge ${C.fmtNum(r.margin)} % · Einkauf ${S(k.buyCost)}`;
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

  /** Ein Eintrag der Einkaufsliste – funktioniert für jedes Rezept (Refining, Tränke, Gear …). */
  function shopCalc(e) {
    const rec = gd.recipes[e.id];
    const rrr = C.returnRate(C.productionBonus(settings, e.city, rec.cat, e.focus, e.daily || 0));
    const kind = e.buy_mode === "instant" ? "sell" : "buy";
    const plan = C.buyPlan(rec, e.crafts, rrr);
    const prices = {};
    for (const pl of plan) {
      const [p, src] = store.get(pl.id, e.buy_city, kind);
      pl.price = (p !== null && src !== "alt") || src === "manuell" ? C.buyUnitCost(settings, p, e.buy_mode) : null;
      prices[pl.id] = pl.price;
    }
    const best = C.bestSale(store, settings, e.id, [e.sell_loc], e.sell_mode);
    const res = C.calcCraft(rec, e.crafts, rrr, prices, best ? best.price : null,
      C.sellFee(settings, best ? best.mode : e.sell_mode), e.station || 0, e.focus);
    return { rec, plan, profit: res.complete ? res.profit : null };
  }

  function renderShop() {
    const ent = $("shop-entries"), mats = $("shop-mats");
    ent.innerHTML = ""; mats.innerHTML = "";
    let totalCost = 0, totalProfit = 0, complete = true, pieces = 0;
    const agg = {};
    shop.forEach((e, i) => {
      if (!gd.recipes[e.id]) return;
      const k = shopCalc(e);
      pieces += e.crafts * k.rec.amount;
      if (k.profit !== null) totalProfit += k.profit; else complete = false;
      for (const pl of k.plan) {
        const key = pl.id + "|" + e.buy_city;
        const a = (agg[key] = agg[key] || { id: pl.id, city: e.buy_city, n: 0, cost: 0, missing: false });
        a.n += pl.buy;
        if (pl.price === null) a.missing = true; else a.cost += pl.buy * pl.price;
      }
      const amt = k.rec.amount;
      ent.append(el("div", { class: "shop-item" },
        el("div", { class: "t" },
          el("div", { style: "font-weight:700" }, `${S(e.crafts * amt)} × ${gd.label(e.id)}`),
          el("div", { class: "small muted" }, (amt > 1 ? `${S(e.crafts)} Crafts · ` : "") +
            `${e.city}${e.buy_city !== e.city ? " · Kauf " + e.buy_city : ""} → ${e.sell_loc}${e.focus ? " · ✦ Fokus" : ""}`)),
        el("div", { class: "num " + (k.profit !== null ? (k.profit > 0 ? "pos" : "neg") : "muted") },
          k.profit !== null ? S(k.profit) : "Preise fehlen"),
        el("button", { class: "icon-btn", on: { click: () => {
          const v = window.prompt(`Stückzahl (0 = entfernen)${amt > 1 ? " – " + amt + " Stück pro Craft" : ""}`, String(e.crafts * amt));
          if (v === null) return;
          const n = Math.floor(Number(v.replace(/[.\s]/g, "")) || 0);
          if (n <= 0) shop.splice(i, 1); else e.crafts = C.craftsFor(k.rec, n);
          saveShop(); renderShop();
        } } }, "✎"),
      ));
    });
    if (!shop.length) ent.append(el("div", { class: "empty" }, "Noch leer. Im Refining- oder Crafting-Rechner „Zur Einkaufsliste“ tippen."));
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
      tile(S(pieces), "Stück in der Liste"),
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
    if (view === "craft") { renderCraftSearch(); renderCraft(); }
    if (view === "silver") renderSilver();
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

    // Silber-Finder
    [...$("s-mode").children].forEach((b) => b.addEventListener("click", () => {
      ui.sMode = b.dataset.m; if (ui.sMode === "bm" && !ui.sGroups.some((g) => ["Waffen", "Rüstung", "Nebenhand"].includes(g))) ui.sGroups.push("Waffen", "Rüstung");
      saveUi(); silver = null; renderSilver();
    }));
    const sb = $("s-budget");
    sb.addEventListener("input", () => { ui.sBudget = sb.value; saveUi(); });
    [[500000, "500 k"], [1000000, "1 Mio"], [5000000, "5 Mio"], [10000000, "10 Mio"], [0, "∞"]].forEach(([v, l]) =>
      $("s-quick").append(el("button", { on: { click: () => { ui.sBudget = v; sb.value = v; saveUi(); } } }, l)));
    const sbind = (id, key, num) => $(id).addEventListener("change", (e) => {
      ui[key] = e.target.type === "checkbox" ? e.target.checked : num ? Number(e.target.value) || 0 : e.target.value;
      saveUi(); renderSilverOpts();
    });
    sbind("s-focus", "sFocus", true); sbind("s-fce", "sFce", true); sbind("s-city", "sCity"); sbind("s-buymode", "sBuyMode");
    sbind("s-margin", "sMargin", true); sbind("s-days", "sDays", true); sbind("s-age", "sAge", true); sbind("s-chain", "sChain");
    $("s-run").addEventListener("click", runSilver);
    $("s-shop").addEventListener("click", silverToShop);

    // Crafting
    let st = null;
    $("c-search").addEventListener("input", () => { clearTimeout(st); st = setTimeout(renderCraftSearch, 150); });
    const cq = $("c-qty");
    let qt = null;
    cq.addEventListener("input", () => { ui.cQty = cq.value; saveUi(); clearTimeout(qt); qt = setTimeout(renderCraft, 200); });
    [10, 50, 100, 500, 1000].forEach((v) => $("c-quick").append(el("button", { on: { click: () => { cq.value = v; ui.cQty = v; saveUi(); renderCraft(); } } }, S(v))));
    $("c-load").addEventListener("click", loadCraft);
    const cbind = (id, key, num) => $(id).addEventListener("change", (e) => {
      ui[key] = e.target.type === "checkbox" ? e.target.checked : num ? Number(e.target.value) || 0 : e.target.value;
      saveUi(); renderCraft();
    });
    cbind("c-city", "cCity"); cbind("c-buy", "cBuy"); cbind("c-sell", "cSell"); cbind("c-sellmode", "cSellMode");
    cbind("c-buymode", "cBuyMode"); cbind("c-daily", "cDaily", true); cbind("c-station", "cStation", true); cbind("c-focus", "cFocus");
    $("c-all-live").addEventListener("click", () => { const k = craftCalc(); if (k) resetCraftPrices(k.plan.map((p) => p.id).concat(["prod"])); });
    $("c-shop").addEventListener("click", () => {
      const k = craftCalc(); if (!k) return;
      addToShop([{ id: ui.cItem, crafts: k.crafts, city: k.city, buy_city: k.buy, buy_mode: ui.cBuyMode, focus: ui.cFocus,
        daily: Number(ui.cDaily) || 0, sell_loc: k.sellLoc, sell_mode: k.mode, station: Number(ui.cStation) || 0 }]);
      $("c-shop").textContent = "✔ Zur Einkaufsliste hinzugefügt";
      setTimeout(() => { $("c-shop").textContent = "🛒 Zur Einkaufsliste"; }, 1800);
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
      const res = await fetch("data/recipes_all.json");
      gd = new C.GameData(await res.json());
    } catch (e) {
      setStatus("Rezeptdaten konnten nicht geladen werden: " + e.message, true);
      return;
    }
    render();
    show(ui.view || "silver");
    setStatus(hasPrices() ? "Gespeicherte Preise vorhanden · beim Suchen/Laden werden sie aktualisiert" : "Bereit – Preise werden beim Suchen geladen");
    registerSW();
  }
  start();
})();
