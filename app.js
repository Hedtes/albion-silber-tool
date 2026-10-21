/* Albion Silber Tool – Oberfläche (Web/iPhone) */
(function () {
  "use strict";
  const C = window.Core;
  const VERSION = "1.4.0";
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
    aKind: "potion", aBase: "T4_POTION_HEAL", aEnch: 0, aQty: 100, aInput: "qty", aBudget: 1000000, aCity: C.AUTO_CITY, aBuy: C.SAME_CITY,
    aSell: C.AUTO_MARKET, aSellMode: "order", aBuyMode: "instant", aDaily: 0, aFocus: false,
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
    $("load-btn").disabled = true; $("shop-reload").disabled = true; $("c-load").disabled = true; $("s-run").disabled = true; $("a-load").disabled = true;
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
      $("load-btn").disabled = false; $("shop-reload").disabled = false; $("c-load").disabled = false; $("s-run").disabled = false; $("a-load").disabled = false;
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
    if (ui.view === "alch") renderAlch();
    if (ui.view === "shop") { if ((ui.listPane || "shop") === "book") renderBook(); else renderShop(); }
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

  // ------------------------------------------------------------ Tränke & Essen (billigster Weg)
  let alchData = { alts: {}, names: {} };
  const aCat = () => ui.aKind === "food" ? "food" : "potion";
  const aVariants = (base) => [0, 1, 2, 3].map((e) => (e ? base + "@" + e : base)).filter((id) => gd.recipes[id]);
  const aId = () => {
    if (!ui.aBase || !gd.recipes[ui.aBase]) return null;
    const v = aVariants(ui.aBase);
    return v.find((id) => gd.recipes[id].ench === ui.aEnch) || v[0];
  };
  function aOpts(id) {
    const rec = gd.recipes[id];
    let city = ui.aCity;
    if (city === C.AUTO_CITY) city = C.bonusCityFor(settings, rec.cat) || "Brecilien";
    const buyCity = ui.aBuy === C.SAME_CITY ? city : ui.aBuy;
    const sellLocs = ui.aSell === C.AUTO_MARKET ? C.MARKETS : [ui.aSell === C.SAME_CITY ? city : ui.aSell];
    return { city, buyCity, buyMode: ui.aBuyMode, maxAge: settings.max_age_hours, alts: alchData.alts,
      focus: ui.aFocus, daily: Number(ui.aDaily) || 0, sellLocs, sellMode: ui.aSellMode };
  }
  const aQty = () => Math.max(1, Math.floor(Number(ui.aQty) || 1));
  const aBudget = () => Math.max(0, Math.floor(Number(ui.aBudget) || 0));

  /**
   * Stückzahl für die Rechnung: entweder direkt eingegeben oder aus dem Silber-Einsatz:
   * die größte Menge, deren Einkauf (über den billigsten Weg) ins Budget passt.
   */
  function aPieces(id, o) {
    if (ui.aInput !== "budget") return { pieces: aQty() };
    const rec = gd.recipes[id];
    const budget = aBudget();
    const costOf = (n) => C.cheapPlan(gd, store, settings, id, n * rec.amount, o).buyCost;
    const one = costOf(1);
    if (one === null) return { pieces: rec.amount, unknown: true };
    if (one > budget) return { pieces: 0, tooSmall: one };
    let lo = 1, hi = 2;
    while (hi < 1e6) { const c = costOf(hi); if (c === null || c > budget) break; lo = hi; hi *= 2; }
    while (hi - lo > 1) { const mid = Math.floor((lo + hi) / 2); const c = costOf(mid); if (c !== null && c <= budget) lo = mid; else hi = mid; }
    return { pieces: lo * rec.amount };
  }

  function renderAlchSearch() {
    [...$("a-kind").children].forEach((b) => b.classList.toggle("on", b.dataset.k === (ui.aKind || "potion")));
    const words = $("a-search").value.toLowerCase().split(/\s+/).filter(Boolean);
    const ids = Object.keys(gd.recipes).filter((id) => {
      const r = gd.recipes[id];
      if (r.cat !== aCat() || r.ench !== 0) return false;
      const hay = (gd.name(id) + " t" + r.tier).toLowerCase();
      return words.every((w) => hay.includes(w));
    }).sort((a, b) => gd.name(a).localeCompare(gd.name(b), "de") || gd.recipes[a].tier - gd.recipes[b].tier);
    const box = $("a-results");
    box.innerHTML = "";
    ids.slice(0, 80).forEach((id) => box.append(el("div", {
      class: "shop-item", style: "cursor:pointer" + (id === ui.aBase ? ";color:var(--gold)" : ""),
      on: { click: () => { ui.aBase = id; ui.aEnch = 0; saveUi(); renderAlchSearch(); renderAlch(); loadAlch(); $("a-calc").scrollIntoView({ behavior: "smooth" }); } },
    }, el("div", { class: "t", style: "font-weight:600" }, gd.label(id)),
      el("div", { class: "small muted" }, `${gd.recipes[id].amount} Stk/Craft · bis .${aVariants(id).length - 1}`))));
    if (!ids.length) box.append(el("div", { class: "empty" }, "Nichts gefunden"));
  }

  function alchItemsToLoad(variants) {
    const items = new Set();
    const walk = (id, depth) => {
      if (items.has(id) || depth > 6) return;
      items.add(id);
      (alchData.alts[id] || []).forEach((a) => a.res.forEach((r) => walk(r[0], depth + 1)));
      const r = gd.recipes[id];
      if (r && depth > 0 && (r.cat === "food" || r.cat === "potion") && r.ench === 0) r.res.forEach((x) => walk(x[0], depth + 1));
    };
    variants.forEach((v) => gd.recipes[v].res.forEach((x) => walk(x[0], 1)));
    return [...items];
  }

  function loadAlch() {
    const id = aId(); if (!id) return;
    const variants = aVariants(ui.aBase);
    const o = aOpts(id);
    runJobs([[alchItemsToLoad(variants), [o.buyCity]], [variants, o.sellLocs], [variants, o.sellLocs, "history"]], () => render());
  }

  function aEditPrice(item, loc, kind, current) {
    const [cur] = store.get(item, loc, kind);
    const e = store.live[item + "|" + loc] || {};
    const liveTxt = e[kind] ? `Live: ${S(e[kind])} (${C.fmtAge(e[kind + "_ts"])} alt)` : "Live: keiner";
    const what = kind === "buy" ? "Kaufgebot (Sofortverkauf)" : "Verkaufsangebot";
    const start = current !== undefined && current !== null ? current : cur;
    const v = window.prompt(`${gd.label(item)} – ${loc}\n${what} · ${liveTxt}\n\nPreis in Silber (leer = Live-Preis):`, start === null ? "" : String(Math.round(start)));
    if (v === null) return;
    const clean = v.replace(/[.\s]/g, "");
    if (clean === "") store.setManual(item, loc, kind, null);
    else if (/^\d+$/.test(clean)) store.setManual(item, loc, kind, Number(clean));
    else return;
    renderAlch();
  }

  function renderAlchQuick() {
    const box = $("a-quick");
    const budgetMode = ui.aInput === "budget";
    const key = budgetMode ? "b" : "q";
    if (box.dataset.mode === key) return;
    box.dataset.mode = key;
    box.innerHTML = "";
    const vals = budgetMode ? [[100000, "100 k"], [500000, "500 k"], [1000000, "1 Mio"], [5000000, "5 Mio"], [10000000, "10 Mio"]]
      : [[10, "10"], [50, "50"], [100, "100"], [500, "500"], [1000, "1.000"]];
    vals.forEach(([v, l]) => box.append(el("button", { on: { click: () => {
      $("a-qty").value = v;
      if (ui.aInput === "budget") ui.aBudget = v; else ui.aQty = v;
      saveUi(); renderAlch();
    } } }, l)));
  }

  function aResetPrice(item, loc, kind) {
    if (store.isManual(item, loc, kind)) { store.setManual(item, loc, kind, null); setStatus("↺ Wieder Live-Preis"); }
    else setStatus("Hier ist kein manueller Preis gesetzt");
    renderAlch();
  }

  /** Verkaufspreis des Produkts anzeigen und ändern. */
  function renderAlchSale(id, o, plan) {
    const box = $("a-sale");
    box.innerHTML = "";
    const loc = plan.best ? plan.best.loc : o.sellLocs[0];
    const mode = plan.best ? plan.best.mode : (loc === C.BLACK_MARKET ? "instant" : o.sellMode);
    const kind = mode === "instant" ? "buy" : "sell";
    let [p, src, ts] = store.get(id, loc, kind);
    if (plan.best && src !== "manuell" && plan.best.price !== p) { p = plan.best.price; src = "Ø-Preis"; ts = null; }
    const vol = plan.best ? plan.best.info.per_day : null;
    box.append(el("div", { class: "price", style: "padding:0" },
      el("div", { class: "t" },
        el("div", { class: "n" }, "Verkaufspreis " + gd.label(id)),
        el("div", { class: "small muted" }, `${loc} · ${mode === "instant" ? "Sofortverkauf an Kaufgebot" : "Verkaufsauftrag"}` +
          ` · Verkäufe/Tag ${vol === null || vol === undefined ? "?" : C.fmtNum(vol, vol < 10 ? 1 : 0)}`),
        el("div", { class: "small" }, el("span", { class: "src " + (src || "fehlt") }, `${src || "fehlt"}${ts ? " · " + C.fmtAge(ts) : ""}`))),
      el("div", { class: "v num", style: "font-size:22px" }, S(p)),
      el("button", { class: "icon-btn", title: "Preis ändern", on: { click: () => {
        // bei „bester Markt“ den Markt festhalten, damit der eigene Preis auch dort gilt
        if (ui.aSell === C.AUTO_MARKET) { ui.aSell = loc; saveUi(); }
        aEditPrice(id, loc, kind, p);
      } } }, "✎"),
      el("button", { class: "icon-btn", title: "Live-Preis", on: { click: () => aResetPrice(id, loc, kind) } }, "↺"),
    ));
    if (src === "manuell") box.append(el("div", { class: "small", style: "color:var(--manual);margin-top:6px" }, "Eigener Preis aktiv – gilt, bis ein neuerer Live-Preis geladen wird oder du ↺ tippst."));
  }

  function renderAlchOpts(o) {
    const fill = (sel, values, cur, rename) => {
      sel.innerHTML = "";
      values.forEach((v) => sel.append(el("option", { value: v, textContent: (rename && rename[v]) || v, selected: v === cur })));
    };
    fill($("a-city"), [C.AUTO_CITY].concat(C.CITIES), ui.aCity);
    fill($("a-buy"), [C.SAME_CITY].concat(C.CITIES), ui.aBuy, { [C.SAME_CITY]: "Wie Crafting-Stadt" });
    fill($("a-sell"), [C.AUTO_MARKET, C.SAME_CITY].concat(C.CITIES), ui.aSell, { [C.SAME_CITY]: "Wie Crafting-Stadt" });
    $("a-sellmode").value = ui.aSellMode; $("a-buymode").value = ui.aBuyMode;
    $("a-daily").value = ui.aDaily; $("a-focus").checked = ui.aFocus;
    $("a-opts-sum").textContent = `${o.city}${o.buyCity !== o.city ? " · Kauf " + o.buyCity : ""} · ${ui.aSell === C.AUTO_MARKET ? "bester Markt" : o.sellLocs[0]}${ui.aFocus ? " · Fokus" : ""}`;
  }

  function describeNode(node, qty, solver, depth) {
    const lines = [];
    if (!node || node.how !== "craft" || qty <= 0) return lines;
    const crafts = Math.ceil(qty / node.alt.amount);
    const parts = node.alt.res.map(([rid, cnt, ret]) => `${S(buyAmount2(cnt, crafts, node.rrr, ret))} × ${gd.label(rid)}`);
    const isShred = node.alt.res.length === 1 && node.alt.amount > 1;
    const srcQty = isShred ? buyAmount2(node.alt.res[0][1], crafts, node.rrr, node.alt.res[0][2]) : 0;
    lines.push(el("div", { class: "step" }, isShred
      ? `${S(srcQty)} × ${gd.label(node.alt.res[0][0])} ${node.item === "T1_FISHCHOPS" ? "zerkleinern" : "schreddern"} → ${S(crafts * node.alt.amount)} × ${gd.label(node.item)} (je ${node.alt.amount}${node.alt.res[0][2] ? ", mit Rückgabe" : ""})`
      : `${S(crafts * node.alt.amount)} × ${gd.label(node.item)} herstellen aus ${parts.join(" + ")}`));
    // Alternativen bei Umwandlungen zeigen
    const alts = alchData.alts[node.item] || [];
    if (alts.length > 1) {
      const ranked = alts.map((a) => {
        const c = solver.cheapest(a.res[0][0], 9);
        return c.unit === null ? null : { src: a.res[0][0], per: c.unit * a.res[0][1] / a.amount };
      }).filter(Boolean).sort((x, y) => x.per - y.per);
      if (ranked.length > 1) {
        lines.push(el("div", { class: "step muted" }, "Pro Stück " + gd.name(node.item) + ": " +
          ranked.slice(0, 3).map((r, i) => `${i === 0 ? "✔ " : ""}${gd.label(r.src)} ${C.fmtNum(r.per)}`).join(" · ") +
          ` (${ranked.length} Quellen mit Preis)`));
      }
    }
    node.alt.res.forEach(([rid, cnt, ret], i) => {
      describeNode(node.children[i], buyAmount2(cnt, crafts, node.rrr, ret), solver, depth + 1).forEach((l) => lines.push(l));
    });
    return lines;
  }
  const buyAmount2 = (cnt, crafts, rrr, ret) => C.buyAmount(cnt, crafts, rrr, !!ret)[0];

  function renderAlch() {
    const id = aId();
    if (!gd || !id) { $("a-calc").style.display = "none"; return; }
    $("a-calc").style.display = "";
    const o = aOpts(id);
    renderAlchOpts(o);
    const rec = gd.recipes[id];
    $("a-title").textContent = gd.label(ui.aBase).replace(/ \(T\d\)$/, "") + ` · T${rec.tier}`;
    const eb = $("a-enchs");
    eb.innerHTML = "";
    aVariants(ui.aBase).forEach((v) => {
      const e = gd.recipes[v].ench;
      eb.append(el("button", { class: e === rec.ench ? "on" : "", on: { click: () => { ui.aEnch = e; saveUi(); renderAlch(); } } }, "." + e));
    });
    const budgetMode = ui.aInput === "budget";
    [...$("a-input").children].forEach((bt) => bt.classList.toggle("on", bt.dataset.i === (budgetMode ? "budget" : "qty")));
    $("a-qty-label").textContent = budgetMode ? "SILBER-EINSATZ · so viel willst du ausgeben" : "HERSTELLEN · Stück";
    if (document.activeElement !== $("a-qty")) $("a-qty").value = budgetMode ? ui.aBudget : ui.aQty;
    renderAlchQuick();
    const pc = aPieces(id, o);
    const plan = C.cheapPlan(gd, store, settings, id, Math.max(pc.pieces, rec.amount), o);
    if (budgetMode) {
      $("a-crafts-info").textContent = pc.unknown ? "Erst Live-Preise laden – dann rechnet das Tool die Menge aus." :
        pc.tooSmall ? `Zu wenig: ein Craft kostet schon ${S(pc.tooSmall)} Silber.` :
        `Für ${S(aBudget())} Silber: ${S(plan.pieces)} Stück (${S(plan.crafts)} Crafts) · Einkauf ${S(plan.buyCost)} · übrig ${S(aBudget() - (plan.buyCost || 0))}`;
    } else {
      $("a-crafts-info").textContent = `= ${S(plan.crafts)} Crafts à ${rec.amount} Stück` + (plan.pieces !== aQty() ? ` → ergibt ${S(plan.pieces)} Stück` : "") +
        ` · Rücklaufquote ${C.fmtNum(plan.rrr * 100)} %`;
    }

    // Banner
    const b = $("a-banner"), r = plan.res;
    if (!plan.complete) { b.className = "banner"; b.textContent = "Preise fehlen – „Live-Preise laden“ (es werden auch alle Tierteile/Fische geprüft)"; }
    else {
      b.className = "banner " + marginTag(r.margin, r.profit);
      b.innerHTML = `<span class="big num">${r.profit > 0 ? "▲" : "▼"} ${S(r.profit)} Silber</span>` +
        `${S(plan.pieces)} × ${gd.label(id)} · Marge ${C.fmtNum(r.margin)} % · Einkauf ${S(plan.buyCost)}`;
    }

    renderAlchSale(id, o, plan);

    // Stufenvergleich
    const tbl = $("a-compare");
    tbl.innerHTML = "";
    tbl.append(el("tr", {}, el("th", {}, ""), el("th", {}, "Kosten / Verkauf"), el("th", {}, "Gewinn/Stk"),
      el("th", {}, budgetMode ? "fürs Budget" : "Gewinn gesamt")));
    aVariants(ui.aBase).forEach((v) => {
      const vo = aOpts(v);
      const p = v === id ? plan : C.cheapPlan(gd, store, settings, v, Math.max(aPieces(v, vo).pieces, gd.recipes[v].amount), vo);
      const ok = p.complete;
      const cls = ok ? (p.res.profit > 0 ? "pos" : "neg") : "";
      tbl.append(el("tr", { class: "click" + (v === id ? " sel key" : ""), on: { click: () => { ui.aEnch = gd.recipes[v].ench; saveUi(); renderAlch(); } } },
        el("td", { style: "font-weight:800" }, "." + gd.recipes[v].ench),
        el("td", {}, `${p.unitCost === null ? "–" : S(p.unitCost)} / ${p.best ? S(p.best.price) : "–"}`),
        el("td", { class: cls }, ok ? S(p.res.profit / p.pieces) : "–",
          ok ? el("div", { class: "small", style: "font-weight:600" }, C.fmtNum(p.res.margin) + " %") : null),
        el("td", { class: cls }, ok ? S(p.res.profit) : "–",
          budgetMode && ok ? el("div", { class: "small muted", style: "font-weight:600" }, S(p.pieces) + " Stk") : null)));
    });

    // Billigster Weg je Zutat
    const ways = $("a-ways");
    ways.innerHTML = "";
    for (const x of plan.ings) {
      const n = x.node;
      const m = n.market;
      let how = "Preis fehlt";
      if (n.unit !== null) how = n.how === "craft" ? `Selbst herstellen: ${S(n.unit)} pro Stück` : `Kaufen: ${S(n.unit)} pro Stück`;
      const save = n.how === "craft" && m ? (m - n.unit) * x.qty : null;
      ways.append(el("div", { class: "way" },
        el("div", { class: "row", style: "justify-content:space-between;flex-wrap:nowrap;align-items:flex-start" },
          el("b", { style: "flex:1;min-width:0" }, `${S(x.qty)} × ${gd.label(x.id)}`),
          el("div", { class: "row", style: "flex-wrap:nowrap;gap:6px" },
            el("button", { class: "icon-btn", title: "Marktpreis eingeben", on: { click: () => aEditPrice(x.id, o.buyCity, o.buyMode === "instant" ? "sell" : "buy") } }, "✎"),
            el("button", { class: "icon-btn", title: "Live-Preis", on: { click: () => aResetPrice(x.id, o.buyCity, o.buyMode === "instant" ? "sell" : "buy") } }, "↺"))),
        el("div", { class: "small " + (n.how === "craft" ? "gold" : "") }, how + (m && n.how === "craft" ? ` (Markt: ${S(m)})` : "")),
        save > 0 ? el("div", { class: "save" }, `Spart ${S(save)} Silber gegenüber Kaufen`) : null,
        describeNode(n, x.qty, plan.solver, 0),
      ));
    }

    // Einkaufsliste
    const bl = $("a-buylist");
    bl.innerHTML = "";
    const bkind = o.buyMode === "instant" ? "sell" : "buy";
    plan.buyList.forEach((it) => {
      const man = store.isManual(it.item, o.buyCity, bkind);
      bl.append(el("div", { class: "shop-item" },
        el("div", { class: "t" }, el("div", { style: "font-weight:700" }, `${S(it.qty)} × ${gd.label(it.item)}`),
          el("div", { class: "small " + (man ? "" : "muted"), style: man ? "color:var(--manual)" : "" },
            `${o.buyCity} · ${it.price === null ? "Preis fehlt" : S(it.price) + " pro Stück"}${man ? " · eigener Preis" : ""}`)),
        el("div", { class: "num" }, S(it.cost)),
        el("button", { class: "icon-btn", on: { click: () => aEditPrice(it.item, o.buyCity, bkind) } }, "✎"),
        el("button", { class: "icon-btn", on: { click: () => aResetPrice(it.item, o.buyCity, bkind) } }, "↺")));
    });
    const sp = plan.directCost !== null && plan.buyCost !== null ? plan.directCost - plan.buyCost : null;
    $("a-buy-info").innerHTML = plan.buyCost === null ? "Noch nicht alle Preise vorhanden." :
      `Einkauf gesamt <b>${S(plan.buyCost)}</b> Silber` + (sp > 0 ? ` · <span class="pos">${S(sp)} günstiger</span> als alle Zutaten direkt zu kaufen (${S(plan.directCost)})` : "");
    renderAlch.text = `Einkauf für ${S(plan.pieces)} × ${gd.label(id)} (${o.buyCity})\n\n` +
      plan.buyList.map((it) => `${S(it.qty)} × ${gd.label(it.item)}${it.cost !== null ? " – " + S(it.cost) : ""}`).join("\n") +
      (plan.steps.length ? "\n\nSchritte:\n" + plan.steps.slice().reverse().map((s) => `${S(s.out)} × ${gd.label(s.item)}`).join("\n") : "") +
      `\n\nEinkauf gesamt: ${S(plan.buyCost)} Silber`;
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
    const buyCost = plan.every((pl) => pl.price !== null) ? plan.reduce((a, pl) => a + pl.buy * pl.price, 0) : null;
    return { rec, plan, profit: res.complete ? res.profit : null, buyCost, revenue: res.complete ? res.revenue : null, best };
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
        el("button", { class: "icon-btn", title: "Gecraftet – abhaken", style: "border-color:var(--pos);color:var(--pos)", on: { click: () => {
          if (logCraft({ id: e.id, pieces: e.crafts * amt, cost: k.buyCost, expected: k.revenue, where: `${e.city} → ${e.sell_loc}`,
            price: k.best ? k.best.price : null, loc: e.sell_loc, mode: e.sell_mode })) {
            shop.splice(i, 1); saveShop(); renderShop();
          }
        } } }, "✓"),
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

  // ------------------------------------------------------------ Buch (gecraftet / verkauft / Ausgaben / Einnahmen)
  let book = storage.get("book", []);
  for (const e of book) {  // älteres Format (ein Verkauf) in Teilverkäufe umwandeln
    if (e.type === "craft" && !e.sales) {
      e.sales = e.sold !== null && e.sold !== undefined ? [{ pieces: e.pieces, amount: e.sold, loc: "", mode: "", at: e.soldAt }] : [];
      delete e.sold; delete e.soldAt;
    }
  }
  const saveBook = () => storage.set("book", book);
  const soldPieces = (e) => (e.sales || []).reduce((a, x) => a + x.pieces, 0);
  const soldAmount = (e) => (e.sales || []).reduce((a, x) => a + x.amount, 0);
  const restPieces = (e) => Math.max(0, e.pieces - soldPieces(e));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const dayKey = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  function dayLabel(key) {
    const today = dayKey(Date.now()), yest = dayKey(Date.now() - 86400000);
    const [y, m, d] = key.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    const wd = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"][dt.getDay()];
    const base = `${wd} ${String(d).padStart(2, "0")}.${String(m).padStart(2, "0")}.`;
    return key === today ? "Heute · " + base : key === yest ? "Gestern · " + base : base;
  }
  const askSilver = (text, def) => {
    const v = window.prompt(text, def === null || def === undefined ? "" : String(Math.round(def)));
    if (v === null) return null;
    const n = Number(v.replace(/[.\s]/g, "").replace(",", "."));
    return isNaN(n) ? null : Math.max(0, Math.round(n));
  };

  /** Einen Craft ins Buch eintragen (Einkauf jetzt, Erlös später beim Verkauf). */
  function logCraft({ id, pieces, cost, expected, where, price, loc, mode }) {
    const c = askSilver(`${S(pieces)} × ${gd.label(id)} gecraftet.\n\nWas hast du dafür ausgegeben? (Silber – mit deinen eigenen Preisen vorausgefüllt)`, cost);
    if (c === null) return false;
    book.push({ uid: uid(), type: "craft", id, label: gd.label(id), pieces, cost: c, expected: expected || null,
      where: where || "", at: Date.now(), sales: [], price: price || null, loc: loc || "", mode: mode || "order" });
    saveBook();
    setStatus(`📒 Ins Buch eingetragen: ${S(pieces)} × ${gd.label(id)}`);
    return true;
  }

  let saleEntry = null, saleTotalTouched = false;
  function sellEntry(e) {
    saleEntry = e; saleTotalTouched = false;
    $("sale-title").textContent = `Verkauf: ${e.label}`;
    const rest = restPieces(e);
    $("sale-info").textContent = `${S(e.pieces)} gecraftet · ${S(soldPieces(e))} schon verkauft · noch ${S(rest)} übrig · Einkauf war ${S(e.cost)}`;
    const sel = $("sale-loc");
    sel.innerHTML = "";
    C.MARKETS.forEach((m) => sel.append(el("option", { value: m, textContent: m })));
    const last = (e.sales || []).length ? e.sales[e.sales.length - 1] : null;
    sel.value = (last && last.loc) || e.loc || C.CITIES[0];
    $("sale-mode").value = (last && last.mode) || e.mode || "order";
    $("sale-pieces").value = rest || e.pieces;
    const [lp] = store.get(e.id, sel.value, $("sale-mode").value === "instant" ? "buy" : "sell");
    $("sale-price").value = Math.round((last && last.unit) || lp || e.price || 0);
    saleCalc();
    $("sale-sheet").classList.add("on");
    document.body.style.overflow = "hidden";
  }
  function saleCalc() {
    const n = Math.max(0, Number($("sale-pieces").value) || 0), pr = Math.max(0, Number($("sale-price").value) || 0);
    const fee = C.sellFee(settings, $("sale-mode").value);
    const net = Math.round(n * pr * (1 - fee));
    if (!saleTotalTouched) $("sale-total").value = net;
    $("sale-calc").textContent = `${S(n)} × ${S(pr)} = ${S(n * pr)} brutto · − ${C.fmtNum(fee * 100)} % Steuer/Gebühr = ${S(net)} netto`;
  }
  function saveSale() {
    const e = saleEntry; if (!e) return;
    const n = Math.max(0, Math.floor(Number($("sale-pieces").value) || 0));
    const total = Math.max(0, Math.round(Number($("sale-total").value) || 0));
    if (!n) { alert("Bitte Stückzahl eingeben."); return; }
    if (n > restPieces(e) && !confirm(`Mehr als übrig (${S(restPieces(e))}) – trotzdem speichern?`)) return;
    e.sales.push({ pieces: n, amount: total, unit: Math.max(0, Number($("sale-price").value) || 0),
      loc: $("sale-loc").value, mode: $("sale-mode").value, at: Date.now() });
    saveBook(); closeSale(); renderBook();
    setStatus(`💰 Verkauf gespeichert: ${S(n)} × ${e.label} in ${$("sale-loc").value}`);
  }
  function closeSale() { $("sale-sheet").classList.remove("on"); document.body.style.overflow = ""; saleEntry = null; }

  function bookEvents() {
    // jede Buchung als Tages-Ereignis: Ausgabe am Craft-Tag, Einnahme am Verkaufs-Tag
    const ev = [];
    for (const e of book) {
      if (e.type === "craft") {
        ev.push({ day: dayKey(e.at), at: e.at, kind: "craft", e, amount: -e.cost });
        (e.sales || []).forEach((sl, i) => ev.push({ day: dayKey(sl.at), at: sl.at, kind: "sale", e, sale: sl, idx: i, amount: sl.amount }));
      } else {
        ev.push({ day: dayKey(e.at), at: e.at, kind: e.type, e, amount: e.type === "expense" ? -e.amount : e.amount });
      }
    }
    return ev.sort((a, b) => b.at - a.at);
  }

  function renderBookChart(byDay) {
    const days = [];
    for (let i = 13; i >= 0; i--) days.push(dayKey(Date.now() - i * 86400000));
    const vals = days.map((d) => (byDay[d] ? byDay[d].inc - byDay[d].exp : 0));
    const max = Math.max(1, ...vals.map(Math.abs));
    const W = 320, H = 120, mid = H / 2, bw = W / days.length;
    let bars = "";
    vals.forEach((v, i) => {
      const h = Math.abs(v) / max * (mid - 8);
      const y = v >= 0 ? mid - h : mid;
      const col = v > 0 ? "var(--pos)" : v < 0 ? "var(--neg)" : "var(--line)";
      bars += `<rect x="${i * bw + 3}" y="${y}" width="${bw - 6}" height="${Math.max(1, h)}" rx="2" fill="${col}"><title>${dayLabel(days[i])}: ${S(v)}</title></rect>`;
      if (i % 2 === 1 || i === days.length - 1) bars += `<text x="${i * bw + bw / 2}" y="${H - 1}" font-size="8" text-anchor="middle" fill="var(--muted)">${days[i].slice(8)}.</text>`;
    });
    $("book-chart").innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Gewinn pro Tag">` +
      `<line x1="0" x2="${W}" y1="${mid}" y2="${mid}" stroke="var(--line)"/>${bars}</svg>`;
  }

  function renderBook() {
    const ev = bookEvents();
    const byDay = {};
    for (const x of ev) {
      const d = (byDay[x.day] = byDay[x.day] || { exp: 0, inc: 0, list: [] });
      if (x.amount < 0) d.exp += -x.amount; else d.inc += x.amount;
      d.list.push(x);
    }
    const today = dayKey(Date.now());
    const sumRange = (n) => { let t = 0; for (let i = 0; i < n; i++) { const d = byDay[dayKey(Date.now() - i * 86400000)]; if (d) t += d.inc - d.exp; } return t; };
    const open = book.filter((e) => e.type === "craft" && restPieces(e) > 0);
    const openExp = open.reduce((a, e) => a + (e.expected ? e.expected * restPieces(e) / e.pieces : 0), 0);
    const total = ev.reduce((a, x) => a + x.amount, 0);
    const t = $("book-tiles");
    t.innerHTML = "";
    const cls = (v) => (v > 0 ? "good" : v < 0 ? "bad" : "");
    const td = byDay[today] ? byDay[today].inc - byDay[today].exp : 0;
    t.append(tile(S(td), "Saldo heute", cls(td)), tile(S(sumRange(7)), "Saldo 7 Tage", cls(sumRange(7))),
      tile(S(openExp), `noch offen (${open.length} unverkauft, erwartet)`), tile(S(total), "Saldo gesamt", cls(total)));
    renderBookChart(byDay);

    // offene Verkäufe
    const ob = $("book-open");
    ob.innerHTML = "";
    $("book-open-card").style.display = open.length ? "" : "none";
    open.sort((a, b) => a.at - b.at).forEach((e) => {
      const sp = soldPieces(e);
      ob.append(el("div", { class: "shop-item" },
        el("div", { class: "t" }, el("div", { style: "font-weight:700" }, `${S(restPieces(e))} × ${e.label}` + (sp ? ` (von ${S(e.pieces)})` : "")),
          el("div", { class: "small muted" }, `gecraftet ${dayLabel(dayKey(e.at))} · Einkauf ${S(e.cost)}` +
            (sp ? ` · schon ${S(soldAmount(e))} eingenommen` : e.expected ? ` · erwartet ${S(e.expected)}` : ""))),
        el("button", { class: "btn primary", on: { click: () => sellEntry(e) } }, "Verkauf +")));
    });

    // Wo verkaufst du am besten? (Ø-Preis je Item und Markt aus deinen Verkäufen)
    const perMarket = {};
    for (const e of book) for (const sl of e.sales || []) {
      if (!sl.loc || !sl.pieces) continue;
      const k = e.label + "|" + sl.loc;
      const m = (perMarket[k] = perMarket[k] || { label: e.label, loc: sl.loc, pieces: 0, amount: 0 });
      m.pieces += sl.pieces; m.amount += sl.amount;
    }
    const pm = Object.values(perMarket);
    let pmCard = $("book-markets");
    if (!pmCard) { pmCard = el("div", { class: "card", id: "book-markets" }); $("book-days").before(pmCard); }
    pmCard.innerHTML = "";
    pmCard.style.display = pm.length ? "" : "none";
    if (pm.length) {
      pmCard.append(el("b", {}, "Deine Verkäufe je Markt"), el("div", { class: "muted small" }, "Ø netto pro Stück – so siehst du, wo du am meisten bekommst"));
      const byItem = {};
      pm.forEach((m) => (byItem[m.label] = byItem[m.label] || []).push(m));
      Object.entries(byItem).forEach(([label, list]) => {
        list.sort((a, b) => b.amount / b.pieces - a.amount / a.pieces);
        pmCard.append(el("div", { class: "shop-item", style: "display:block" },
          el("div", { style: "font-weight:700" }, label),
          ...list.map((m, i) => el("div", { class: "row small", style: "justify-content:space-between" },
            el("span", { class: i === 0 && list.length > 1 ? "pos" : "" }, `${i === 0 && list.length > 1 ? "★ " : ""}${m.loc} · ${S(m.pieces)} Stk`),
            el("span", { class: "num" }, `Ø ${S(m.amount / m.pieces)} · ${S(m.amount)}`)))));
      });
    }

    // Tage
    const box = $("book-days");
    box.innerHTML = "";
    const keys = Object.keys(byDay).sort().reverse();
    if (!keys.length) box.append(el("div", { class: "empty" }, "Noch keine Einträge. In der Einkaufsliste abhaken oder in einem Rechner „✔ Gecraftet – ins Buch eintragen“ tippen."));
    for (const k of keys) {
      const d = byDay[k], saldo = d.inc - d.exp;
      const card = el("div", { class: "card" },
        el("div", { class: "row", style: "justify-content:space-between" },
          el("b", {}, dayLabel(k)),
          el("span", { class: "num " + (saldo > 0 ? "pos" : saldo < 0 ? "neg" : "muted"), style: "font-weight:800" }, (saldo > 0 ? "+" : "") + S(saldo))),
        el("div", { class: "small muted", style: "margin-bottom:4px" }, `Ausgaben ${S(d.exp)} · Einnahmen ${S(d.inc)}`));
      for (const x of d.list) {
        const e = x.e;
        let title, sub;
        if (x.kind === "craft") {
          title = `⚒ ${S(e.pieces)} × ${e.label} gecraftet`;
          const rest = restPieces(e);
          sub = (e.where ? e.where + " · " : "") + (rest === e.pieces ? "noch nicht verkauft" : rest ? `${S(rest)} noch übrig` : `alles verkauft · Gewinn ${S(soldAmount(e) - e.cost)}`);
        } else if (x.kind === "sale") {
          const sl = x.sale;
          title = `💰 ${S(sl.pieces)} × ${e.label} in ${sl.loc || "?"}`;
          sub = `${sl.unit ? S(sl.unit) + " pro Stück · " : ""}${sl.mode === "instant" ? "Sofortverkauf" : sl.mode === "order" ? "Verkaufsauftrag" : ""}`;
        }
        else { title = (x.kind === "expense" ? "− " : "+ ") + (e.note || (x.kind === "expense" ? "Ausgabe" : "Einnahme")); sub = "manuell"; }
        card.append(el("div", { class: "shop-item" },
          el("div", { class: "t" }, el("div", { style: "font-weight:600" }, title), el("div", { class: "small muted" }, sub)),
          el("div", { class: "num " + (x.amount >= 0 ? "pos" : "neg") }, (x.amount > 0 ? "+" : "") + S(x.amount)),
          x.kind === "craft" && restPieces(e) > 0 ? el("button", { class: "icon-btn", title: "Verkauf eintragen", on: { click: () => sellEntry(e) } }, "💰") : null,
          el("button", { class: "icon-btn", title: "Bearbeiten/Löschen", on: { click: () => editBookEntry(x) } }, "✎")));
      }
      box.append(card);
    }
  }

  function editBookEntry(x) {
    const e = x.e;
    const what = x.kind === "sale" ? "Erlös" : x.kind === "craft" ? "Einkauf" : "Betrag";
    const cur = x.kind === "sale" ? x.sale.amount : x.kind === "craft" ? e.cost : e.amount;
    const v = window.prompt(`${e.label || e.note || ""}\n${what} ändern (Silber).\nLeer lassen und OK = ${x.kind === "sale" ? "Verkauf zurücknehmen" : "Eintrag löschen"}`, String(cur));
    if (v === null) return;
    if (v.trim() === "") {
      if (x.kind === "sale") e.sales.splice(x.idx, 1);
      else if (confirm("Eintrag wirklich löschen?")) book = book.filter((b) => b !== e);
    } else {
      const n = Math.max(0, Math.round(Number(v.replace(/[.\s]/g, "").replace(",", ".")) || 0));
      if (x.kind === "sale") x.sale.amount = n; else if (x.kind === "craft") e.cost = n; else e.amount = n;
    }
    saveBook(); renderBook();
  }

  function addManual(type) {
    const note = window.prompt(type === "expense" ? "Wofür? (z. B. Transport, Stationsgebühr)" : "Wofür? (z. B. Journale verkauft)", "");
    if (note === null) return;
    const amount = askSilver("Betrag in Silber", "");
    if (amount === null) return;
    book.push({ uid: uid(), type, note: note.trim(), amount, at: Date.now() });
    saveBook(); renderBook();
  }

  async function exportBook() {
    const rows = [["Datum", "Art", "Item", "Stück", "Einkauf", "Erlös", "Notiz"]];
    for (const e of book.slice().sort((a, b) => a.at - b.at)) {
      const d = new Date(e.at).toLocaleString("de-DE");
      if (e.type === "craft") {
        rows.push([d, "gecraftet", e.label, e.pieces, e.cost, "", e.where || ""]);
        (e.sales || []).forEach((sl) => rows.push([new Date(sl.at).toLocaleString("de-DE"), "verkauft", e.label, sl.pieces, "", sl.amount,
          `${sl.loc || ""}${sl.unit ? " à " + sl.unit : ""}`]));
      }
      else rows.push([d, e.type === "expense" ? "Ausgabe" : "Einnahme", "", "", e.type === "expense" ? e.amount : "", e.type === "income" ? e.amount : "", e.note || ""]);
    }
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\n");
    try {
      const file = new File(["﻿" + csv], "albion-buch.csv", { type: "text/csv" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: "Albion Buch" }); return; }
    } catch (e) { /* weiter mit Download */ }
    const a = el("a", { href: URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" })), download: "albion-buch.csv" });
    document.body.append(a); a.click(); a.remove();
  }

  function showListPane(p) {
    ui.listPane = p; saveUi();
    [...$("list-tabs").children].forEach((b) => b.classList.toggle("on", b.dataset.p === p));
    $("shop-pane").style.display = p === "shop" ? "" : "none";
    $("book-pane").style.display = p === "book" ? "" : "none";
    if (p === "book") renderBook(); else renderShop();
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
    if (view === "shop") showListPane(ui.listPane || "shop");
    if (view === "craft") { renderCraftSearch(); renderCraft(); }
    if (view === "silver") renderSilver();
    if (view === "alch") { renderAlchSearch(); renderAlch(); }
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

    // Liste / Buch
    [...$("list-tabs").children].forEach((b) => b.addEventListener("click", () => showListPane(b.dataset.p)));
    $("book-expense").addEventListener("click", () => addManual("expense"));
    $("book-income").addEventListener("click", () => addManual("income"));
    $("book-export").addEventListener("click", exportBook);
    $("sale-close").addEventListener("click", closeSale);
    $("sale-save").addEventListener("click", saveSale);
    ["sale-pieces", "sale-price"].forEach((id) => $(id).addEventListener("input", saleCalc));
    $("sale-mode").addEventListener("change", saleCalc);
    $("sale-loc").addEventListener("change", () => {
      if (!saleEntry) return;
      const [lp] = store.get(saleEntry.id, $("sale-loc").value, $("sale-mode").value === "instant" ? "buy" : "sell");
      if (lp) $("sale-price").value = Math.round(lp);
      saleCalc();
    });
    $("sale-total").addEventListener("input", () => { saleTotalTouched = true; });
    $("a-done").addEventListener("click", () => {
      const id = aId(); if (!id) return;
      const o = aOpts(id);
      const pc = aPieces(id, o);
      const plan = C.cheapPlan(gd, store, settings, id, Math.max(pc.pieces, gd.recipes[id].amount), o);
      logCraft({ id, pieces: plan.pieces, cost: plan.buyCost, expected: plan.complete ? plan.res.revenue : null,
        where: `${o.city} → ${plan.best ? plan.best.loc : o.sellLocs[0]}`,
        price: plan.best ? plan.best.price : null, loc: plan.best ? plan.best.loc : o.sellLocs[0], mode: plan.best ? plan.best.mode : o.sellMode });
    });
    $("c-done").addEventListener("click", () => {
      const k = craftCalc(); if (!k) return;
      logCraft({ id: ui.cItem, pieces: k.crafts * k.rec.amount, cost: k.buyCost, expected: k.res.complete ? k.res.revenue : null,
        where: `${k.city} → ${k.sellLoc}`, price: k.best ? k.best.price : null, loc: k.sellLoc, mode: k.mode });
    });
    $("calc-done").addEventListener("click", () => {
      const r = calcRow(); if (!r) return;
      const n = calcAmount(r, ui.focus);
      const d = C.refineDetail(gd, settings, r, n, ui.focus);
      logCraft({ id: r.id, pieces: n, cost: d.cost_buy, expected: d.revenue_gross !== null ? d.revenue_gross - d.fee : null,
        where: `${r.city} → ${r.sell_loc || r.city}`, price: r.sell_price, loc: r.sell_loc || r.city, mode: r.sell_mode || ui.sellMode });
    });

    // Tränke & Essen
    [...$("a-kind").children].forEach((b) => b.addEventListener("click", () => {
      ui.aKind = b.dataset.k; ui.aBase = ui.aKind === "food" ? "T4_MEAL_STEW" : "T4_POTION_HEAL"; ui.aEnch = 0;
      saveUi(); $("a-search").value = ""; renderAlchSearch(); renderAlch();
    }));
    let at = null;
    $("a-search").addEventListener("input", () => { clearTimeout(at); at = setTimeout(renderAlchSearch, 150); });
    const aq = $("a-qty");
    let aqt = null;
    aq.addEventListener("input", () => {
      if (ui.aInput === "budget") ui.aBudget = aq.value; else ui.aQty = aq.value;
      saveUi(); clearTimeout(aqt); aqt = setTimeout(renderAlch, 300);
    });
    [...$("a-input").children].forEach((bt) => bt.addEventListener("click", () => { ui.aInput = bt.dataset.i; saveUi(); renderAlch(); }));
    $("a-load").addEventListener("click", loadAlch);
    const abind = (id, key, num) => $(id).addEventListener("change", (e) => {
      ui[key] = e.target.type === "checkbox" ? e.target.checked : num ? Number(e.target.value) || 0 : e.target.value;
      saveUi(); renderAlch();
    });
    abind("a-city", "aCity"); abind("a-buy", "aBuy"); abind("a-sell", "aSell"); abind("a-sellmode", "aSellMode");
    abind("a-buymode", "aBuyMode"); abind("a-daily", "aDaily", true); abind("a-focus", "aFocus");
    $("a-share").addEventListener("click", async () => {
      const text = renderAlch.text || "";
      try {
        if (navigator.share) await navigator.share({ title: "Einkauf", text });
        else { await navigator.clipboard.writeText(text); setStatus("Einkaufsliste kopiert"); }
      } catch (e) { /* abgebrochen */ }
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
      const [res, al] = await Promise.all([fetch("data/recipes_all.json"), fetch("data/alchemy.json")]);
      gd = new C.GameData(await res.json());
      alchData = await al.json();
      for (const [k, v] of Object.entries(alchData.names)) if (!gd.names[k]) gd.names[k] = v;
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
