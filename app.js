/* Albion Silber Tool – Oberfläche (Web/iPhone) */
(function () {
  "use strict";
  const C = window.Core;
  const VERSION = "1.9.0";
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
    sMode: "safe", sBudget: 1000000, sFocus: 10000, sFce: 0, sCity: "auto", sBuyMode: "instant", sChain: true,
    sMargin: 5, sDays: 1, sAge: 12, sGroups: ["Refining", "Tränke", "Essen", "Taschen & Umhänge", "Werkzeuge", "Sammlerausrüstung"], sTiers: [4, 5, 6, 7], sEnchs: [0, 1, 2, 3], sSellMode: "instant", sEnchUp: true,
  }, storage.get("ui", {}));
  const saveUi = () => storage.set("ui", ui);
  /** Dein verfügbarer Fokus (gilt für alle Rechner und den Silber-Finder). */
  const myFocus = () => Math.max(0, Math.floor(Number(ui.sFocus) || 0));
  if (!ui.sV3) { ui.sV3 = true; if (!Number(ui.sFocus)) ui.sFocus = 10000; saveUi(); }
  if (!ui.sV2) {   // Silber-Finder: einmalig auf die breiteren neuen Standardwerte setzen
    Object.assign(ui, { sV2: true, sMargin: 5, sAge: 12, sSellMode: "instant", sEnchUp: true,
      sGroups: ["Refining", "Tränke", "Essen", "Taschen & Umhänge", "Werkzeuge", "Sammlerausrüstung"], sTiers: [4, 5, 6, 7], sEnchs: [0, 1, 2, 3] });
    saveUi();
  }
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

  // ------------------------------------------------------------ Eingabe: Menge × Stückpreis = Gesamt
  let qpCfg = null;
  const qpNum = (v) => { const n = Number(String(v).replace(/\s/g, "").replace(",", ".")); return isFinite(n) ? n : NaN; };
  function qpCalc(from) {
    const q = qpNum($("qp-qty").value), u = qpNum($("qp-unit").value), t = qpNum($("qp-total").value);
    if (from === "total") { if (q > 0 && t >= 0) $("qp-unit").value = Math.round(t / q * 100) / 100; }
    else if (q >= 0 && u >= 0) $("qp-total").value = Math.round(q * u);
  }
  /** cfg: {title, sub, qty, qtyEdit, unit, live, check:{label, value}, onSave({qty,unit,total,check}), onLive} */
  function qpOpen(cfg) {
    qpCfg = cfg;
    $("qp-title").textContent = cfg.title || "";
    $("qp-sub").textContent = cfg.sub || "";
    $("qp-qty").value = cfg.qty === null || cfg.qty === undefined ? "" : Math.round(cfg.qty);
    $("qp-qty").readOnly = !cfg.qtyEdit;
    $("qp-qty").classList.toggle("ro", !cfg.qtyEdit);
    $("qp-unit").value = cfg.unit === null || cfg.unit === undefined ? "" : Math.round(cfg.unit * 100) / 100;
    $("qp-total").value = "";
    qpCalc("unit");
    $("qp-live").style.display = cfg.onLive ? "" : "none";
    $("qp-live").textContent = cfg.liveLabel || "↺ Live";
    $("qp-chk-wrap").style.display = cfg.check ? "" : "none";
    if (cfg.check) { $("qp-chk-label").textContent = cfg.check.label; $("qp-chk").checked = !!cfg.check.value; }
    $("qp-save").textContent = cfg.saveLabel || "✔ Speichern";
    $("qp").classList.add("on");
    setTimeout(() => { const f = cfg.qtyEdit && cfg.focusQty ? $("qp-qty") : $("qp-unit"); f.focus(); f.select && f.select(); }, 60);
  }
  function qpClose() { $("qp").classList.remove("on"); qpCfg = null; }
  function qpWire() {
    $("qp-qty").addEventListener("input", () => qpCalc("unit"));
    $("qp-unit").addEventListener("input", () => qpCalc("unit"));
    $("qp-total").addEventListener("input", () => qpCalc("total"));
    $("qp-cancel").addEventListener("click", qpClose);
    $("qp").addEventListener("click", (e) => { if (e.target === $("qp")) qpClose(); });
    $("qp-live").addEventListener("click", () => { const c = qpCfg; qpClose(); if (c && c.onLive) c.onLive(); });
    $("qp-save").addEventListener("click", () => {
      const c = qpCfg; if (!c) return;
      const qty = qpNum($("qp-qty").value), unit = qpNum($("qp-unit").value), total = qpNum($("qp-total").value);
      if ($("qp-unit").value.trim() === "" && $("qp-total").value.trim() === "") { if (c.onLive) { qpClose(); c.onLive(); } return; }
      if (!(unit >= 0) || (c.qtyEdit && !(qty >= 0))) { alert("Bitte Zahlen eingeben."); return; }
      qpClose();
      c.onSave({ qty: Math.round(qty || 0), unit, total: Math.round(total || 0), check: $("qp-chk").checked });
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Enter" && qpCfg) $("qp-save").click(); });
  }
  /** Marktpreis ändern – mit Menge, damit man sofort den Gesamtpreis sieht. */
  function priceEdit(item, loc, kind, qty, after, current) {
    const [cur] = store.get(item, loc, kind);
    const e = store.live[item + "|" + loc] || {};
    const liveTxt = e[kind] ? `Live: ${S(e[kind])} (${C.fmtAge(e[kind + "_ts"])} alt)` : "kein Live-Preis";
    const what = kind === "buy" ? "Kaufgebot" : "Verkaufsangebot";
    qpOpen({ title: gd.label(item), sub: `${loc} · ${what} · ${liveTxt}`, qty: qty || 1, qtyEdit: false,
      unit: current !== undefined && current !== null ? current : cur,
      onSave: ({ unit }) => { store.setManual(item, loc, kind, Math.round(unit)); after(); },
      onLive: () => { store.setManual(item, loc, kind, null); after(); }, liveLabel: "↺ Live-Preis" });
  }

  // ------------------------------------------------------------ Preise laden
  async function runJobs(jobs, done) {
    if (busy) { setStatus("Es läuft bereits ein Abruf …"); return; }
    busy = true; abort = new AbortController();
    $("load-btn").disabled = true; $("c-load").disabled = true; $("s-run").disabled = true; $("a-load").disabled = true; $("es-run").disabled = true;
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
      $("load-btn").disabled = false; $("c-load").disabled = false; $("s-run").disabled = false; $("a-load").disabled = false; $("es-run").disabled = false;
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
    if (ui.view === "shop") {
      const lp = ui.listPane || "shop";
      if (lp === "book") renderBook(); else if (lp === "stock") renderStock(); else if (lp === "orders") renderOrders(); else renderShop();
    }
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
    const n = calcAmount(r, ui.focus);
    const nd = C.needs(r, n, ui.focus);
    priceEdit(item, loc, kind, key === "raw" ? nd.raw : key === "prev" ? nd.prev : n, () => render());
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

  // ------------------------------------------------------------ Kette: vorher selbst refinen
  const isRefined = (id) => !!(gd.recipes[id] && C.REFINING_CATS.has(gd.recipes[id].cat));
  function chainFor(item, qty, city, buyCity, buyMode, refineCity) {
    return C.refineChain(gd, store, settings, item, Math.max(0, Math.round(qty)), { city, refineCity, buyCity, buyMode, maxAge: settings.max_age_hours });
  }
  const pct = (r) => C.fmtNum(r * 100) + " %";
  /** Was genau zu tun ist + wie viel es spart (und was die Bonusstadt zusätzlich bringen würde). */
  function chainView(ch, buyCity, buyMode, opts) {
    opts = opts || {};
    const box = el("div", { class: "chain" });
    const per = ch.qty ? ch.ownCost / ch.qty : null;
    box.append(el("div", { class: "chain-h" }, `★ ${S(ch.qty)} × ${gd.label(ch.item)} selbst refinen`,
      ch.saving !== null ? el("b", { class: ch.saving > 0 ? "pos" : "neg" }, ` · spart ${S(ch.saving)}`) : null),
      el("div", { class: "small muted" }, `${S(per)} statt ${S(ch.market)} pro Stück (Kaufpreis in ${buyCity})`));
    const ol = el("ol", { class: "chain-steps" });
    ol.append(el("li", {}, "Kaufen in " + buyCity + ": " + Object.entries(ch.buy).map(([id, q]) => `${S(q)} × ${gd.label(id)}`).join(" + ")));
    ch.steps.forEach((st) => ol.append(el("li", {}, `${S(st.out)} × ${gd.label(st.item)} refinen in ${st.city} (Rücklauf ${pct(st.rrr)}) – aus ` +
      st.from.map(([id, q]) => `${S(q)} × ${gd.label(id)}`).join(" + "))));
    box.append(ol);
    const rcRec = gd.recipes[ch.item];
    const rc = rcRec ? C.bonusCityFor(settings, rcRec.cat) : null;
    if (rc && rc !== ch.city && !opts.noBonus) {
      const b = chainFor(ch.item, ch.qty, ch.city, buyCity, buyMode, rc);
      if (b.ownCost !== null && ch.ownCost !== null) {
        const extra = ch.ownCost - b.ownCost;
        box.append(el("div", { class: "small " + (extra > 0 ? "gold" : "muted") }, extra > 0
          ? `💡 In ${rc} (Bonusstadt, Rücklauf ${pct(b.rrr)}) refinen spart zusätzlich ${S(extra)} – dafür Transport ${buyCity} → ${rc} → ${ch.city}`
          : `In ${rc} (Bonusstadt) wäre es nicht günstiger.`));
      }
    }
    return box;
  }

  // ------------------------------------------------------------ Silber-Finder
  const S_GROUPS = ["Refining", "Tränke", "Essen", "Waffen", "Rüstung", "Nebenhand", "Taschen & Umhänge", "Sammlerausrüstung", "Werkzeuge"];
  const ALCH_GROUPS = ["Tränke", "Essen"];
  let silver = null; // letztes Ergebnis
  let silverShowAll = false;

  function sCities() {
    // Brecilien gehört dazu (Bonusstadt für Tränke, Taschen, Umhänge); Caerleon nur im Black-Market-Modus
    const pool = C.ROYAL_CITIES.concat(["Brecilien"], ui.sMode === "bm" ? ["Caerleon"] : []);
    return ui.sCity === "auto" ? pool : [ui.sCity];
  }
  function sIds() {
    return Object.keys(gd.recipes).filter((id) => {
      const r = gd.recipes[id];
      return ui.sGroups.includes(r.group) && ui.sTiers.includes(r.tier) && ui.sEnchs.includes(r.ench);
    });
  }
  const sShare = () => Math.min(1, Math.max(0.01, (ui.sShare === undefined ? 20 : Number(ui.sShare) || 20) / 100));
  function sOpts() {
    return { maxAge: Number(ui.sAge) || 6, daily: 0, fce: Number(ui.sFce) || 0, chain: ui.sChain, buyMode: ui.sBuyMode,
      sellMode: ui.sSellMode || "instant" };
  }

  /** Tränke/Essen über den billigsten Weg (Extrakt aus Überresten, Fischsauce …) bewerten – liefert ein evalCraft-ähnliches Objekt. */
  function evalAlch(id, base) {
    const rec = gd.recipes[id];
    const o = { city: base.city, buyCity: base.buyCity, buyMode: base.buyMode, maxAge: base.maxAge, alts: alchData.alts,
      focus: base.focus, daily: 0, sellLocs: base.sellLocs, sellMode: base.sellMode, stock: {} };
    const plan = C.cheapPlan(gd, store, settings, id, rec.amount, o);
    if (!plan || !plan.complete) return null;
    const prices = {}, selfMade = [];
    plan.ings.forEach((x) => { prices[x.id] = x.node.unit; if (x.node.how === "craft") selfMade.push(x.id); });
    return { id, rec, city: base.city, buyCity: base.buyCity, buyMode: base.buyMode, focus: !!base.focus, rrr: plan.rrr, prices, selfMade,
      sellLoc: plan.best.loc, sellMode: plan.best.mode, sellPrice: plan.best.price, per_day: plan.best.info.per_day,
      profit: plan.res.profit, cost: plan.res.cost, margin: plan.res.margin, revenue: plan.res.revenue,
      focusCost: base.focus ? C.focusCost(rec.focus, base.fce) : 0, alch: true };
  }

  /** Alle Items bewerten: pro Item beste Stadt ohne und mit Fokus. stats zählt, warum etwas rausfällt. */
  function silverEvaluate(ids, stats, over) {
    const o = Object.assign(sOpts(), over || {});
    const minM = Number(ui.sMargin) || 0;
    const withFocus = (Number(ui.sFocus) || 0) > 0;
    const items = [];
    const memos = {};
    const st = stats || {};
    Object.assign(st, { noPrice: 0, loss: 0, lowMargin: 0, ok: 0 });
    for (const id of ids) {
      let bestNf = null, bestF = null, anyPrice = false, anyProfit = false;
      const isAlch = ALCH_GROUPS.includes(gd.recipes[id].group);
      for (const city of sCities()) {
        const memo = (memos[city] = memos[city] || {});
        // Der Black Market kauft nur Ausrüstung – Ressourcen, Tränke und Essen bleiben in der Stadt
        const bmOk = ui.sMode === "bm" && !["Refining", "Tränke", "Essen"].includes(gd.recipes[id].group);
        const sellLocs = bmOk ? [city, C.BLACK_MARKET] : [city];
        const base = Object.assign({}, o, { city, buyCity: city, sellLocs, memo });
        const ev = (focus) => isAlch ? evalAlch(id, Object.assign({}, base, { focus }))
          : C.evalCraft(gd, store, settings, id, Object.assign({}, base, { focus }));
        const nf = ev(false);
        if (nf) { anyPrice = true; if (nf.profit > 0) anyProfit = true; }
        if (nf && nf.margin >= minM && (!bestNf || nf.profit > bestNf.profit)) bestNf = nf;
        if (withFocus) {
          const f = ev(true);
          if (f) { anyPrice = true; if (f.profit > 0) anyProfit = true; }
          if (f && f.margin >= minM && (!bestF || f.profit / Math.max(1, f.focusCost) > bestF.profit / Math.max(1, bestF.focusCost))) bestF = f;
        }
      }
      if (bestNf || bestF) { items.push({ id, nf: bestNf, f: bestF }); st.ok++; }
      else if (!anyPrice) st.noPrice++;
      else if (!anyProfit) st.loss++;
      else st.lowMargin++;
    }
    return items;
  }

  function runSilver() {
    if (!ui.sGroups.length || !ui.sTiers.length || !ui.sEnchs.length) { setStatus("Bitte Gruppen, Tiers und Verzauberung wählen.", true); return; }
    const ids = sIds();
    if (ids.length > 6000 && !confirm(`${ids.length} Rezepte – das dauert etwas. Starten?`)) return;
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
    // Tränke/Essen: auch alle Wege (Tierteile, Fische, Überreste …) laden
    const alchIds = ids.filter((id) => ALCH_GROUPS.includes(gd.recipes[id].group));
    if (alchIds.length) alchItemsToLoad(alchIds).forEach((x) => mats.add(x));
    // Verzaubern: Runen/Seelen/Relikte + höhere Stufen der Ausrüstung
    const ench = esForSilver();
    const locs = sCities().concat(ui.sMode === "bm" ? [C.BLACK_MARKET] : []);
    runJobs([[[...new Set(ids.concat([...mats], ench.ids))], locs]], async () => {
      // Verkaufszahlen nur für Items mit Gewinn laden
      const items = silverEvaluate(ids);
      const hist = {};
      for (const x of items) for (const ev of [x.nf, x.f]) if (ev && ev.profit > 0) (hist[ev.sellLoc] = hist[ev.sellLoc] || new Set()).add(ev.id);
      esSilverEval().slice(0, 20).forEach((x) => (hist[x.sale.loc] = hist[x.sale.loc] || new Set()).add(x.dst));
      if (ui.sBuyMode !== "order" || (ui.sSellMode || "instant") !== "order")
        silverEvaluate(ids, {}, { buyMode: "order", sellMode: "order" }).map((x) => x.nf).filter((ev) => ev && ev.profit > 0)
          .sort((a, b) => b.profit - a.profit).slice(0, 60).forEach((ev) => (hist[ev.sellLoc] = hist[ev.sellLoc] || new Set()).add(ev.id));
      const jobs = Object.entries(hist).map(([loc, set]) => [[...set], [loc], "history"]);
      if (jobs.length) { busy = false; await runJobs(jobs, () => finishSilver(ids)); } else finishSilver(ids);
    });
  }

  /** Verzauberungen passend zu den gewählten Gruppen/Tiers (nur Ausrüstung). */
  function esForSilver() {
    if (!ui.sEnchUp) return { bases: [], ids: [] };
    const bases = Object.keys(enchData.c).filter((b) => { const r = gd.recipes[b]; return r && ui.sGroups.includes(r.group) && ui.sTiers.includes(r.tier); });
    const ids = new Set();
    for (const b of bases) for (const f of [0, 1, 2]) {
      if (!ui.sEnchs.includes(f)) continue;
      ids.add(enchId(b, f)); ids.add(enchId(b, f + 1)); ids.add(`T${gd.recipes[b].tier}_${ENCH_MAT[f]}`);
    }
    return { bases, ids: [...ids] };
  }
  function esSilverEval() {
    const { bases } = esForSilver();
    if (!bases.length) return [];
    const age = Number(ui.sAge) || 6;
    const unit = (item, loc) => {
      const [p, src] = store.get(item, loc, ui.sBuyMode === "instant" ? "sell" : "buy", age);
      return (p !== null && src !== "alt") || src === "manuell" ? C.buyUnitCost(settings, p, ui.sBuyMode) : null;
    };
    const out = [];
    for (const b of bases) {
      const r = gd.recipes[b], n = enchData.c[b];
      for (const from of [0, 1, 2]) {
        if (!ui.sEnchs.includes(from)) continue;
        const src = enchId(b, from), dst = enchId(b, from + 1), mat = `T${r.tier}_${ENCH_MAT[from]}`;
        let best = null;
        for (const c of sCities()) {
          const ip = unit(src, c), mp = unit(mat, c);
          if (ip === null || mp === null) continue;
          const locs = ui.sMode === "bm" ? [c, C.BLACK_MARKET] : [c];
          const sale = C.bestSale(store, settings, dst, locs, ui.sSellMode || "instant", age);
          if (!sale) continue;
          const cost = ip + n * mp, profit = sale.price * (1 - C.sellFee(settings, sale.mode)) - cost;
          if (!best || profit > best.profit) best = { base: b, from, to: from + 1, src, dst, mat, n, buyCity: c, ip, mp, cost, sale, profit,
            margin: cost ? profit / cost * 100 : 0, vol: sale.info ? sale.info.per_day : null };
        }
        if (best && best.profit > 0 && best.margin >= (Number(ui.sMargin) || 0)) out.push(best);
      }
    }
    return out.sort((a, b) => b.profit - a.profit);
  }

  function finishSilver(ids) {
    const stats = {};
    const items = silverEvaluate(ids, stats);
    const res = C.planSilver(items, {
      budget: Number(ui.sBudget) || 0, focus: Number(ui.sFocus) || 0, days: Number(ui.sDays) || 1, unknownCap: 0, share: sShare(),
    });
    // gleiche Items (z. B. zweimal mit Fokus) zusammenfassen
    const merged = [];
    for (const p of res.plan) {
      const m = merged.find((q) => q.ev.id === p.ev.id && q.ev.focus === p.ev.focus && q.ev.city === p.ev.city);
      if (m) { m.crafts += p.crafts; m.pieces += p.pieces; m.cost += p.cost; m.profit += p.profit; m.focus += p.focus; }
      else merged.push(Object.assign({}, p));
    }
    res.plan = merged.sort((a, b) => b.profit - a.profit);
    const usedIds = new Set(res.plan.map((p) => p.ev.id));
    // Bester Fokus-Einsatz: wofür bringt dein Fokus pro Tag am meisten Silber?
    const F = Number(ui.sFocus) || 0, days = Number(ui.sDays) || 1;
    const more = F <= 0 ? [] : items.filter((x) => x.f && x.f.profit > 0 && x.f.focusCost > 0).map((x) => {
      const ev = x.f;
      const byFocus = Math.floor(F / ev.focusCost);
      const vol = ev.per_day === null || ev.per_day === undefined ? null : Math.floor(ev.per_day * days * sShare() / ev.rec.amount);
      const crafts = vol === null ? byFocus : Math.min(byFocus, vol);
      const base = x.nf ? Math.max(0, x.nf.profit) : 0;
      return { ev, crafts, pieces: crafts * ev.rec.amount, profit: crafts * ev.profit, extra: crafts * (ev.profit - base),
        spf: ev.profit / ev.focusCost, focusUsed: crafts * ev.focusCost, limited: vol !== null && vol < byFocus, unknownVol: vol === null };
    }).filter((m) => m.crafts > 0).sort((a, b) => b.profit - a.profit).slice(0, 10);
    stats.noVolume = items.filter((x) => { const ev = x.nf || x.f; return ev && (ev.per_day === null || ev.per_day === undefined); }).length;
    const ench = esSilverEval().slice(0, 10);
    // Zum Vergleich: dieselben Rezepte mit Kauf- und Verkaufsaufträgen (mehr Gewinn, dauert)
    let orderList = [];
    if (ui.sBuyMode !== "order" || (ui.sSellMode || "instant") !== "order") {
      const its = silverEvaluate(ids, {}, { buyMode: "order", sellMode: "order" });
      orderList = its.map((x) => x.nf).filter((ev) => ev && ev.profit > 0 && ev.per_day)
        .map((ev) => { const crafts = Math.floor(ev.per_day * sShare() / ev.rec.amount); return { ev, crafts, perDay: ev.profit * crafts }; })
        .filter((m) => m.crafts > 0).sort((a, b) => b.perDay - a.perDay).slice(0, 10);
    }
    silverShowAll = false;
    silver = { plan: res.plan, more, ench, orderList, stats, budgetLeft: res.budgetLeft, focusLeft: res.focusLeft, checked: ids.length, found: items.length, at: Date.now() };
    storage.set("silver", null);
    renderSilver();
  }

  function renderSilverOpts() {
    [...$("s-mode").children].forEach((b) => b.classList.toggle("on", b.dataset.m === ui.sMode));
    $("s-mode-info").innerHTML = ui.sMode === "safe"
      ? "Alles in <b>einer Stadt</b>: kaufen, craften, verkaufen. Kein Transport."
      : "Ausrüstung an den <b>Black Market</b> (Caerleon). Mehr Gewinn, aber Transport durch die <b>rote Zone</b>.";
    const mini = (box, values, list, label) => {
      box.innerHTML = "";
      values.forEach((v) => box.append(el("button", {
        class: list.includes(v) ? "on" : "",
        on: { click: () => { const i = list.indexOf(v); if (i >= 0) list.splice(i, 1); else list.push(v); saveUi(); renderSilverOpts(); } },
      }, label(v))));
    };
    mini($("s-groups"), S_GROUPS, ui.sGroups, (g) => g);
    $("s-groups").append(el("button", { on: { click: () => { ui.sGroups.splice(0, ui.sGroups.length, ...(ui.sGroups.length === S_GROUPS.length ? ["Refining", "Tränke", "Essen"] : S_GROUPS)); saveUi(); renderSilverOpts(); } } },
      ui.sGroups.length === S_GROUPS.length ? "↺ nur Basis" : "✔ alle"));
    mini($("s-tiers"), TIERS, ui.sTiers, (t) => "T" + t);
    mini($("s-enchs"), ENCHS, ui.sEnchs, (e) => "." + e);
    const sel = $("s-city");
    sel.innerHTML = "";
    const pool = C.ROYAL_CITIES.concat(["Brecilien"], ui.sMode === "bm" ? ["Caerleon"] : []);
    if (ui.sCity !== "auto" && !pool.includes(ui.sCity)) ui.sCity = "auto";
    sel.append(el("option", { value: "auto", textContent: "Beste Stadt je Item" }));
    pool.forEach((c) => sel.append(el("option", { value: c, textContent: c })));
    sel.value = ui.sCity;
    $("s-buymode").value = ui.sBuyMode; $("s-margin").value = ui.sMargin; $("s-days").value = ui.sDays;
    $("s-age").value = ui.sAge; $("s-chain").checked = ui.sChain;
    $("s-sellmode").value = ui.sSellMode || "instant"; $("s-share").value = ui.sShare === undefined ? 20 : ui.sShare; $("s-enchup").checked = ui.sEnchUp !== false;
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

  function silverChains(ev, crafts) {
    const other = ev.selfMade.filter((i) => !isRefined(i));
    if (other.length && other.length === ev.selfMade.length)
      return el("div", { class: "small gold", style: "margin-top:6px" }, `★ Selbst herstellen (billiger als kaufen): ${other.map((i) => gd.name(i)).join(", ")} – Antippen zeigt jeden Schritt`);
    const jb = C.jointBuy(ev.rec.res, crafts, ev.rrr);
    const d = el("details", { class: "chain-wrap", on: { click: (e) => e.stopPropagation() } });
    let total = 0;
    const inner = el("div", {});
    ev.rec.res.forEach(([rid], i) => {
      if (!ev.selfMade.includes(rid) || !isRefined(rid)) return;
      const ch = chainFor(rid, jb[i], ev.city, ev.buyCity, ev.buyMode);
      if (ch.saving) total += ch.saving;
      inner.append(chainView(ch, ev.buyCity, ev.buyMode));
    });
    d.append(el("summary", { class: "small gold" }, `★ Vorher selbst refinen: ${ev.selfMade.map((i) => gd.name(i)).join(", ")} · spart ${S(total)} – so geht's`), inner);
    return d;
  }
  function silverCard(p, isPlan) {
    const ev = p.ev;
    const w = evWhere(ev);
    const fact = (label, value, cls) => el("div", {}, el("b", {}, label), el("span", { class: "num " + (cls || "") }, value));
    return el("div", { class: "stage " + marginTag(ev.margin, ev.profit), on: { click: () => openInCraft(p) } },
      el("div", { class: "h" },
        el("div", { class: "name" }, (isPlan || p.pieces ? `${S(p.pieces)} × ` : "") + gd.label(ev.id)),
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
      ev.selfMade.length ? silverChains(ev, p.crafts || Math.max(1, Math.round((p.pieces || ev.rec.amount) / ev.rec.amount))) : null,
    );
  }

  function focusCard(m) {
    const ev = m.ev, w = evWhere(ev);
    const fact = (label, value, cls) => el("div", {}, el("b", {}, label), el("span", { class: "num " + (cls || "") }, value));
    return el("div", { class: "stage good", on: { click: () => openInCraft({ ev, pieces: m.pieces }) } },
      el("div", { class: "h" },
        el("div", { class: "name" }, `${S(m.pieces)} × ${gd.label(ev.id)}`),
        el("div", { class: "profit num pos" }, "+" + S(m.profit))),
      el("div", { class: "where" }, w.text, w.transport ? el("span", { class: "warn" }, "  🐎 Transport durch rote Zone") : null),
      el("div", { class: "facts" },
        fact("Silber/Fokus", C.fmtNum(m.spf, m.spf < 10 ? 2 : 1), "pos"),
        fact("Fokus", S(m.focusUsed)),
        fact("dank Fokus", "+" + S(m.extra), "pos"),
        fact("Marge", C.fmtNum(ev.margin) + " %", "pos"),
        fact("Verk./Tag", m.unknownVol ? "?" : C.fmtNum(ev.per_day, ev.per_day < 10 ? 1 : 0))),
      m.limited ? el("div", { class: "small warn", style: "margin-top:6px" }, `Begrenzt durch Verkäufe/Tag – restlicher Fokus für eine zweite Option nutzen`) : null,
      m.unknownVol ? el("div", { class: "small warn", style: "margin-top:6px" }, "Verkaufszahlen unbekannt – Menge vorsichtig wählen") : null);
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
    const st = silver.stats || {};
    $("s-info").innerHTML = `<b>${silver.checked}</b> geprüft · <b class="pos">${silver.found}</b> mit Gewinn · Plan: ${P.length} · vor ${age} min` +
      (st.noPrice || st.loss || st.lowMargin || st.noVolume ? `<details class="why"><summary>Warum nicht mehr?</summary>` +
        `${S(st.noPrice || 0)} ohne aktuelle Preise (älter als ${ui.sAge} Std.) · ${S(st.loss || 0)} machen Verlust · ` +
        `${S(st.lowMargin || 0)} unter ${ui.sMargin} % Marge · ${S(st.noVolume || 0)} ohne Verkaufszahlen (nicht im Plan, aber unten gelistet)` +
        `<br>Mehr finden: ${ui.sCity !== "auto" ? "<b>Stadt auf „Beste Stadt je Item“ stellen</b> (gerade nur " + ui.sCity + "), " : ""}` +
        `${!(Number(ui.sFocus) > 0) ? "<b>Fokus eintragen</b>, " : ""}alle Gruppen wählen, Preisalter erhöhen, Marge senken – oder unten die Liste „Mit Aufträgen“ ansehen.</details>` : "");
    if (!P.length) {
      plan.append(el("div", { class: "empty" }, "Gerade nichts, das alle Sicherheitsregeln erfüllt. Tipp: Mindest-Marge senken, mehr Gruppen/Tiers wählen, „Ganze Kette“ einschalten oder Fokus eintragen."));
    }
    const limit = silverShowAll ? P.length : 15;
    P.slice(0, limit).forEach((p) => plan.append(silverCard(p, true)));
    if (P.length > limit) plan.append(el("button", { class: "btn block", style: "grid-column:1/-1", on: { click: () => { silverShowAll = true; renderSilver(); } } }, `Alle ${P.length} anzeigen`));
    if (P.length) $("s-shop").style.display = "";
    $("s-more-info").style.display = "none";
    if (silver.more.length) {
      $("s-more-h").style.display = "";
      $("s-more-info").style.display = "";
      $("s-more-info").textContent = `Für ${S(Number(ui.sFocus) || 0)} Fokus${(Number(ui.sDays) || 1) !== 1 ? "" : " pro Tag"} · jeweils eine Option allein, sortiert nach Gewinn · Tippen öffnet den Rechner mit Fokus`;
      silver.more.forEach((m) => more.append(focusCard(m)));
    } else if ((Number(ui.sFocus) || 0) > 0) {
      $("s-more-h").style.display = "";
      more.append(el("div", { class: "small muted", style: "margin:0 2px" }, "Mit Fokus lohnt sich gerade nichts zusätzlich – Filter erweitern oder später erneut suchen."));
    }
    const ob = $("s-order");
    ob.innerHTML = "";
    const ol = silver.orderList || [];
    $("s-order-h").style.display = ol.length ? "" : "none";
    $("s-order-info").style.display = ol.length ? "" : "none";
    if (ol.length) {
      $("s-order-info").textContent = `Material per Kaufauftrag, Verkauf per Verkaufsauftrag – mehr Gewinn, aber du musst warten. Menge = ${C.fmtNum(sShare() * 100)} % der Verkäufe/Tag.`;
      ol.forEach((m) => ob.append(silverCard({ ev: m.ev, perDay: m.perDay, pieces: m.crafts * m.ev.rec.amount }, false)));
    }
    const eb = $("s-ench");
    eb.innerHTML = "";
    $("s-ench-h").style.display = silver.ench && silver.ench.length ? "" : "none";
    if (silver.ench && silver.ench.length) {
      silver.ench.forEach((x) => {
        const t = (l) => `T${gd.recipes[x.base].tier}.${l}`;
        eb.append(el("div", { class: "stage good", on: { click: () => {
          Object.assign(ui, { eSrc: "buy", cBuy: x.buyCity, cSell: x.sale.loc === x.buyCity ? C.SAME_CITY : x.sale.loc, cSellMode: ui.sSellMode || "instant",
            cBuyMode: ui.sBuyMode, cItem: x.src, cQty: 1, cGroup: gd.recipes[x.src].group });
          saveUi(); show("craft");
          setTimeout(() => { const c = $("c-ench"); c && c.scrollIntoView({ behavior: "smooth", block: "start" }); }, 400);
        } } },
          el("div", { class: "h" }, el("div", { class: "name" }, `${gd.name(x.base)} ${t(x.from)} → ${t(x.to)}`), el("div", { class: "profit num pos" }, `+${S(x.profit)}/Stk`)),
          el("div", { class: "where" }, `Kaufen in ${x.buyCity} (${S(x.ip)}) + ${S(x.n)} × ${gd.name(x.mat)} à ${S(x.mp)} → Verkauf ${x.sale.loc === C.BLACK_MARKET ? "Black Market" : x.sale.loc} ${S(x.sale.price)}`),
          el("div", { class: "small muted" }, `Marge ${C.fmtNum(x.margin)} % · ${x.vol == null ? "Verkäufe/Tag ?" : C.fmtNum(x.vol, x.vol < 10 ? 1 : 0) + " Verkäufe/Tag"}`)));
      });
    }
  }

  function openInCraft(p) {
    const ev = p.ev;
    if (ev.alch) {
      Object.assign(ui, { aKind: ev.rec.cat === "food" ? "food" : "potion", aBase: ev.id.split("@")[0], aEnch: ev.rec.ench, aInput: "qty",
        aQty: p.pieces || ev.rec.amount, aCity: ev.city, aBuy: C.SAME_CITY, aBuyMode: ev.buyMode, aSell: ev.sellLoc, aSellMode: ev.sellMode, aFocus: ev.focus });
      saveUi(); show("alch"); return;
    }
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
    for (const p of silver.plan.filter((q) => q.ev.alch)) {
      const ev = p.ev;
      const o = { city: ev.city, buyCity: ev.buyCity, buyMode: ev.buyMode, maxAge: settings.max_age_hours, alts: alchData.alts, focus: ev.focus,
        daily: 0, sellLocs: [ev.sellLoc], sellMode: ev.sellMode, stock };
      const plan = C.cheapPlan(gd, store, settings, ev.id, p.pieces, o);
      projects.push(projectFromAlch(ev.id, o, plan));
    }
    saveProjects();
    const rest = silver.plan.filter((q) => !q.ev.alch);
    if (!rest.length) { note(`📝 ${silver.plan.length} Rezepte gespeichert`); return; }
    addToShop(rest.map((p) => ({ id: p.ev.id, crafts: p.crafts, city: p.ev.city, buy_city: p.ev.buyCity,
      buy_mode: p.ev.buyMode, focus: p.ev.focus, daily: 0, sell_loc: p.ev.sellLoc, sell_mode: p.ev.sellMode, self: p.ev.selfMade || [] })), "Silber-Finder");
    note(`📝 ${silver.plan.length} Rezepte gespeichert`);
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
      focus: ui.aFocus, daily: Number(ui.aDaily) || 0, sellLocs, sellMode: ui.aSellMode, stock, focusAvail: myFocus(), fce: Number(ui.sFce) || 0, buyOnly: ui.aSelf === false };
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
    {
      const open = aBrowse || !ui.aBase || $("a-search").value.trim() !== "";
      $("a-results").style.display = open ? "" : "none";
      $("a-browse").style.display = open ? "none" : "";
      $("a-search").style.display = open ? "" : "none";
    }
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
      on: { click: () => { ui.aBase = id; ui.aEnch = 0; saveUi(); aBrowse = false; $("a-search").value = ""; renderAlchSearch(); renderAlch(); loadAlch(); $("a-calc").scrollIntoView({ behavior: "smooth" }); } },
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
    const items = alchItemsToLoad(variants);
    runJobs([[items, [o.buyCity]], [variants, o.sellLocs], [variants, o.sellLocs, "history"], [items, [o.buyCity], "history"]], () => render());
  }

  function aEditPrice(item, loc, kind, current, after, qty) {
    priceEdit(item, loc, kind, qty, () => (after || renderAlch)(), current);
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
        el("div", { class: "small" }, el("span", { class: "src " + (src || "fehlt") }, `${src || "fehlt"}${ts ? " · " + C.fmtAge(ts) : ""}`)),
        trend(id, loc, p, "sell")),
      el("div", { class: "v num", style: "font-size:22px" }, S(p)),
      el("button", { class: "icon-btn", title: "Preis ändern", on: { click: () => {
        // bei „bester Markt“ den Markt festhalten, damit der eigene Preis auch dort gilt
        if (ui.aSell === C.AUTO_MARKET) { ui.aSell = loc; saveUi(); }
        aEditPrice(id, loc, kind, p, null, plan.pieces);
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
    fsegRender("a", ui.aFocus, o.city, gd.recipes[aId()]);
    $("a-self").checked = ui.aSelf !== false;
    $("a-daily").value = ui.aDaily; $("a-focus").checked = ui.aFocus; if (document.activeElement !== $("a-myfocus")) $("a-myfocus").value = myFocus();
    $("a-opts-sum").textContent = `${o.city}${o.buyCity !== o.city ? " · Kauf " + o.buyCity : ""} · ${ui.aSell === C.AUTO_MARKET ? "bester Markt" : o.sellLocs[0]}${ui.aFocus ? " · Fokus" : ""}`;
  }

  function describeNode(node, qty, solver, depth) {
    const lines = [];
    if (!node || node.how !== "craft" || qty <= 0) return lines;
    const crafts = Math.ceil(qty / node.alt.amount);
    const jb = C.jointBuy(node.alt.res, crafts, node.rrr);
    const parts = node.alt.res.map(([rid], i) => `${S(jb[i])} × ${gd.label(rid)}`);
    const isShred = node.alt.res.length === 1 && node.alt.amount > 1;
    const srcQty = isShred ? jb[0] : 0;
    lines.push(el("div", { class: "step" }, isShred
      ? `${S(srcQty)} × ${gd.label(node.alt.res[0][0])} ${node.item === "T1_FISHCHOPS" ? "zerkleinern" : "schreddern"} → ${S(crafts * node.alt.amount)} × ${gd.label(node.item)} (je ${node.alt.amount}${node.rrr > 0 ? ", mit Rückgabe" : ", ohne Rückgabe"})`
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
    node.alt.res.forEach(([rid], i) => {
      describeNode(node.children[i], jb[i], solver, depth + 1).forEach((l) => lines.push(l));
    });
    return lines;
  }

  /** Klarer Hinweis, wofür der Einkauf gerechnet ist – und was passiert, wenn der Fokus fehlt. */
  /** Großer, gut sichtbarer Fokus-Schalter direkt unter der Menge. */
  function fsegRender(p, on, city, rec) {
    [...$(p + "-fseg").children].forEach((b) => b.classList.toggle("on", (b.dataset.f === "1") === !!on));
    const info = $(p + "-finfo");
    if (!rec) { info.textContent = ""; return; }
    const r = C.returnRate(C.productionBonus(settings, city, rec.cat, !!on, Number(p === "a" ? ui.aDaily : ui.cDaily) || 0));
    info.innerHTML = on ? `<span class="gold">✦ Fokus an · dein Fokus: <b>${S(myFocus())}</b> · Ertragsrate ${C.fmtNum(r * 100)} %</span>`
      : `<span class="muted">Ohne Fokus · Ertragsrate im Spiel ${C.fmtNum(r * 100)} %</span>`;
  }
  function planNote(city, focus, fs, nfCrafts, amount) {
    const pc = (r) => C.fmtNum(r * 100) + " %";
    let h = `<div class="plan-note">Gerechnet für: <b>Craften in ${city}</b> · <b>${focus ? "MIT Fokus" : "ohne Fokus"}</b>`;
    if (!focus || !fs.cf) {
      h += `<br>Im Spiel muss bei <b>„Ressourcen-Ertragsrate“</b> stehen: <b>${pc(fs.rrrN)}</b>`;
      if (focus && !fs.cf) h += `<div class="neg" style="margin-top:4px">⚠ Dein Fokus (${S(myFocus())}) reicht für keinen Craft mit Fokus – alles ohne Fokus gerechnet.</div>`;
    } else {
      h += `<br>Im Spiel muss bei <b>„Ressourcen-Ertragsrate“</b> stehen: <b>${pc(fs.rrrF)}</b> mit Fokus`;
      h += fs.cn ? `<div class="gold" style="margin-top:4px">Dein Fokus (${S(myFocus())}) reicht für <b>${S(fs.cf)} von ${S(fs.crafts)} Crafts</b> (${S(fs.cf * amount)} Stück, ${S(fs.cf * fs.fpc)} Fokus). ` +
        `Die restlichen ${S(fs.cn)} Crafts sind <b>ohne Fokus</b> eingeplant (${pc(fs.rrrN)}). Im Spiel zuerst mit Fokus craften, dann ohne.</div>`
        : `<br>Verbraucht <b>${S(fs.cf * fs.fpc)} Fokus</b> (du hast ${S(myFocus())}).`;
      if (nfCrafts < fs.crafts) h += `<div class="neg" style="margin-top:4px">⚠ Ohne Fokus reicht dieser Einkauf nur für ca. <b>${S(nfCrafts * amount)}</b> statt ${S(fs.crafts * amount)} Stück.</div>`;
    }
    h += `<div class="muted hint" style="margin-top:4px">Die Rückgabe der letzten Runde bleibt immer übrig (weniger als 1 Craft) – leg sie ins 📦 Lager.</div></div>`;
    return h;
  }


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
            el("button", { class: "icon-btn", title: "Marktpreis eingeben", on: { click: () => aEditPrice(x.id, o.buyCity, o.buyMode === "instant" ? "sell" : "buy", null, null, x.qty) } }, "✎"),
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
      const [bp] = store.get(it.item, o.buyCity, "buy");
      bl.append(el("div", { class: "shop-item", style: "flex-wrap:wrap" },
        el("div", { class: "t" }, el("div", { style: "font-weight:700" }, it.buy > 0 ? `${S(it.buy)} × ${gd.label(it.item)}` : `✔ ${gd.label(it.item)} – nichts kaufen`),
          it.fromStock ? el("div", { class: "small gold" }, `📦 ${S(it.fromStock)} aus dem Lager · gesamt ${S(it.qty)}`) : null,
          el("div", { class: "small " + (man ? "" : "muted"), style: man ? "color:var(--manual)" : "" },
            `${o.buyCity} · ${it.price === null ? "Preis fehlt" : S(it.price) + " pro Stück"}${man ? " · eigener Preis" : ""}`),
          trend(it.item, o.buyCity, it.price, "buy")),
        el("div", { class: "num", style: "font-weight:700" }, S(it.cost)),
        el("div", { class: "row", style: "gap:6px;flex-wrap:nowrap;width:100%;justify-content:flex-end" },
          el("button", { class: "icon-btn", title: "Preis", on: { click: () => aEditPrice(it.item, o.buyCity, bkind, null, null, it.buy || it.qty) } }, "✎"),
          el("button", { class: "icon-btn", title: "Live-Preis", on: { click: () => aResetPrice(it.item, o.buyCity, bkind) } }, "↺"),
          el("button", { class: "icon-btn", title: "Lager", on: { click: () => editStock(it.item) } }, "📦"),
          it.buy > 0 ? el("button", { class: "icon-btn", title: "Als Kaufauftrag", on: { click: () => openOrder({ side: "buy", id: it.item, qty: it.buy, price: bp ? bp + 1 : it.price, loc: o.buyCity }) } }, "📑") : null)));
    });
    const sp = plan.directCost !== null && plan.buyCost !== null ? plan.directCost - plan.buyCost : null;
    $("a-buy-info").innerHTML = planNote(o.city, o.focus, C.focusSplit(settings, rec, plan.crafts, o), plan.noFocusCrafts, rec.amount) +
      (plan.buyCost === null ? "Noch nicht alle Preise vorhanden." :
      `Einkauf gesamt <b>${S(plan.buyCost)}</b> Silber` + (plan.stockValue ? ` · aus dem Lager: Wert ${S(plan.stockValue)}` : "") +
      (sp > 0 ? ` · <span class="pos">${S(sp)} günstiger</span> als alle Zutaten direkt zu kaufen (${S(plan.directCost)})` : "") +
      `<span class="hint"><br>📦 = ins Lager · 📑 = als Kaufauftrag merken</span>`);
    renderAlch.text = `Einkauf für ${S(plan.pieces)} × ${gd.label(id)} (${o.buyCity})\n\n` +
      plan.buyList.map((it) => `${S(it.qty)} × ${gd.label(it.item)}${it.cost !== null ? " – " + S(it.cost) : ""}`).join("\n") +
      (plan.steps.length ? "\n\nSchritte:\n" + plan.steps.slice().reverse().map((s) => `${S(s.out)} × ${gd.label(s.item)}`).join("\n") : "") +
      `\n\nEinkauf gesamt: ${S(plan.buyCost)} Silber`;
  }

  // ------------------------------------------------------------ Crafting-Rechner
  const GROUPS = ["Tränke", "Essen", "Waffen", "Rüstung", "Nebenhand", "Taschen & Umhänge", "Sammlerausrüstung", "Werkzeuge", "Refining"];

  function cCities(id) {
    const rec = gd.recipes[id || ui.cItem];
    let city = ui.cCity;
    if (city === C.AUTO_CITY) city = C.bonusCityFor(settings, rec.cat) || (ui.cBuy !== C.SAME_CITY ? ui.cBuy : "Lymhurst");
    const buy = ui.cBuy === C.SAME_CITY ? city : ui.cBuy;
    const sellLocs = ui.cSell === C.AUTO_MARKET ? C.MARKETS : [ui.cSell === C.SAME_CITY ? city : ui.cSell];
    return { city, buy, sellLocs };
  }

  /** Alles für den gewählten Craft ausrechnen. */
  function craftCalc(id) {
    id = id || ui.cItem;
    const rec = gd.recipes[id];
    if (!rec) return null;
    const pieces = Math.max(1, Math.floor(Number(ui.cQty) || 1));
    const crafts = C.craftsFor(rec, pieces);
    const { city, buy, sellLocs } = cCities(id);
    const bonus = C.productionBonus(settings, city, rec.cat, ui.cFocus, Number(ui.cDaily) || 0);
    const fs = C.focusSplit(settings, rec, crafts, { city, focus: ui.cFocus, daily: Number(ui.cDaily) || 0, focusAvail: myFocus(), fce: Number(ui.sFce) || 0 });
    const rrr = fs.rrr;
    const kind = ui.cBuyMode === "instant" ? "sell" : "buy";
    const sb = C.splitBuy(rec.res, fs);
    const simL = C.jointSim(rec.res, sb, crafts, rrr).left;
    const plan = rec.res.map(([pid, cnt, ret], i) => ({ id: pid, cnt, full: cnt * crafts, buy: sb[i], rest: simL[i], ret: !!ret }));
    const prices = {};
    let buyCost = 0, buyOk = true;
    for (const pl of plan) {
      const [p, src, ts] = store.get(pl.id, buy, kind);
      pl.price = p !== null && src !== "alt" || src === "manuell" ? C.buyUnitCost(settings, p, ui.cBuyMode) : null;
      pl.src = src; pl.ts = ts; pl.raw = p;
      const st = stock[pl.id];
      pl.fromStock = st && st.qty > 0 ? Math.min(pl.buy, st.qty) : 0;
      pl.buyNet = pl.buy - pl.fromStock;
      // Preis für den Gewinn: Lager mit seinem Wert, Rest zum Marktpreis
      prices[pl.id] = pl.buyNet > 0 ? (pl.price === null ? null : (pl.fromStock * (st ? st.value : 0) + pl.buyNet * pl.price) / pl.buy)
        : (st ? st.value : pl.price);
      pl.cost = pl.buyNet > 0 ? (pl.price !== null ? pl.buyNet * pl.price : null) : 0;
      if (ui.cSelf && ui.cSelf[pl.id] && pl.buyNet > 0 && isRefined(pl.id)) {
        const ch = chainFor(pl.id, pl.buyNet, city, buy, ui.cBuyMode);
        if (ch.self) { pl.chain = ch; pl.cost = ch.cost; prices[pl.id] = (pl.fromStock * (st ? st.value : 0) + ch.cost) / pl.buy; }
      }
      if (pl.cost === null) buyOk = false; else buyCost += pl.cost;
    }
    const best = C.bestSale(store, settings, id, sellLocs, ui.cSellMode);
    const mode = best ? best.mode : (sellLocs[0] === C.BLACK_MARKET ? "instant" : ui.cSellMode);
    const res = C.calcCraft(rec, crafts, rrr, prices, best ? best.price : null, C.sellFee(settings, mode),
      Number(ui.cStation) || 0, ui.cFocus);
    return { rec, pieces, crafts, city, buy, sellLocs, bonus, rrr, plan, fs, buyCost: buyOk ? buyCost : null, best, mode, res,
      sellLoc: best ? best.loc : sellLocs[0] };
  }

  let cBrowse = false, aBrowse = false;
  function renderCraftSearch() {
    const g = $("c-groups");
    const open = cBrowse || !ui.cItem || $("c-search").value.trim() !== "";
    g.style.display = open ? "" : "none"; $("c-results").style.display = open ? "" : "none";
    $("c-browse").style.display = open ? "none" : "";
    $("c-search").style.display = open ? "" : "none";
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
    ui.cItem = id; saveUi(); cBrowse = false; $("c-search").value = "";
    renderCraftSearch(); renderCraft();
    $("c-calc").scrollIntoView({ behavior: "smooth", block: "start" });
    const r = gd.recipes[id];
    const { buy } = cCities();
    if (r.res.some((x) => store.get(x[0], buy, "sell")[0] === null)) loadCraft();
  }

  function loadCraft() {
    const k = craftCalc(); if (!k) return;
    const mats = k.rec.res.map((x) => x[0]);
    // für die Kette (selbst refinen) auch die Rohstoffe der Barren/Planken … laden
    const addChain = (id, d) => { const r = gd.recipes[id]; if (!r || !C.REFINING_CATS.has(r.cat) || d > 8) return; r.res.forEach(([rid]) => { if (!mats.includes(rid)) mats.push(rid); addChain(rid, d + 1); }); };
    k.rec.res.forEach(([rid]) => addChain(rid, 0));
    const jobs = [[mats, [k.buy]], [[ui.cItem], k.sellLocs], [[ui.cItem], k.sellLocs, "history"], [mats, [k.buy], "history"]];
    const jf = journalFor(ui.cItem);
    if (jf) jobs.push([[jf[0] + "_FULL", jf[0] + "_EMPTY"], [k.city]]);
    const ei = enchInfo(ui.cItem);
    if (ei) {
      const lv = [1, 2, 3].filter((l) => l > ei.from);
      const tids = lv.map((l) => enchId(ei.base, l));
      const emats = lv.map((l) => `T${ei.tier}_${ENCH_MAT[l - 1]}`);
      const tres = [...new Set(tids.flatMap((t) => gd.recipes[t] ? gd.recipes[t].res.map((x) => x[0]) : []))];
      jobs.push([emats.concat(tids, [ui.cItem], tres), [k.buy]], [tids, k.sellLocs], [tids, k.sellLocs, "history"], [emats, [k.buy], "history"]);
    }
    runJobs(jobs, () => render());
  }

  function cPriceKey(which, k) {
    if (which === "prod") return [ui.cItem, k.sellLoc, k.mode === "instant" ? "buy" : "sell"];
    return [which, k.buy, ui.cBuyMode === "instant" ? "sell" : "buy"];
  }

  function editCraftPrice(which) {
    const k = craftCalc(); if (!k) return;
    const [item, loc, kind] = cPriceKey(which, k);
    const pl = k.plan.find((x) => x.id === which);
    priceEdit(item, loc, kind, which === "prod" ? k.crafts * k.rec.amount : (pl ? pl.buyNet || pl.buy : 1), renderCraft);
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
    fsegRender("c", ui.cFocus, cCities().city, gd.recipes[ui.cItem]);
    $("c-daily").value = ui.cDaily; $("c-station").value = ui.cStation; $("c-focus").checked = ui.cFocus; if (document.activeElement !== $("c-myfocus")) $("c-myfocus").value = myFocus();
  }

  function craftChainBox(pl, k) {
    if (!isRefined(pl.id) || pl.buyNet <= 0) return null;
    const ch = pl.chain || chainFor(pl.id, pl.buyNet, k.city, k.buy, ui.cBuyMode);
    if (ch.ownCost === null) return null;
    const toggle = () => { ui.cSelf = Object.assign({}, ui.cSelf || {}); if (ui.cSelf[pl.id]) delete ui.cSelf[pl.id]; else ui.cSelf[pl.id] = true; saveUi(); renderCraft(); };
    if (pl.chain) {
      const d = el("div", {});
      d.append(chainView(ch, k.buy, ui.cBuyMode));
      if (ch.saving !== null && ch.saving <= 0) d.append(el("div", { class: "small neg" }, "⚠ Bei den aktuellen Preisen wäre fertig kaufen jetzt billiger."));
      d.append(el("button", { class: "btn", style: "margin-top:6px", on: { click: toggle } }, "↺ Ausschalten – fertig kaufen"));
      return d;
    }
    const rc = C.bonusCityFor(settings, gd.recipes[pl.id].cat);
    const b = rc && rc !== k.city ? chainFor(pl.id, pl.buyNet, k.city, k.buy, ui.cBuyMode, rc) : null;
    const bestSave = Math.max(ch.saving || 0, b && b.saving !== null ? b.saving : 0);
    if (bestSave <= 0) return el("div", { class: "small muted" }, `Empfehlung: fertig kaufen – selbst refinen wäre ${S(-(ch.saving || 0))} teurer.`);
    return el("div", { class: "chain-hint" },
      el("div", { class: "small gold" }, ch.saving > 0 ? `★ Empfehlung: selbst refinen in ${k.city} – spart ${S(ch.saving)}` : `In ${k.city} selbst refinen spart nichts`,
        b && b.saving > (ch.saving || 0) ? ` · in ${rc} (Bonusstadt) sogar ${S(b.saving)}` : ""),
      ch.saving > 0 ? el("button", { class: "btn", style: "margin-top:4px", on: { click: toggle } }, "★ Selbst refinen einplanen") : null);
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
    {
      const nfR = C.returnRate(C.productionBonus(settings, k.city, rec.cat, false, Number(ui.cDaily) || 0));
      const nf = k.fs.cf ? C.jointSim(rec.res, k.plan.map((p) => p.buy), k.crafts, nfR).done : k.crafts;
      const d = document.createElement("div");
      d.innerHTML = planNote(k.city, ui.cFocus, k.fs, nf, rec.amount);
      box.append(d.firstElementChild);
    }
    for (const pl of k.plan) {
      const rest = !pl.ret ? "keine Rückgabe" : `Rest ~${Math.round(pl.rest)}`;
      box.append(el("div", { class: "price" },
        el("div", { class: "t" },
          el("div", { class: "n" }, gd.label(pl.id)),
          el("div", { class: "small muted" }, `${pl.cnt} pro Craft · ohne Rückgabe ${S(pl.full)} · ${rest}`),
          pl.fromStock ? el("div", { class: "small gold" }, `📦 ${S(pl.fromStock)} aus dem Lager`) : null,
          el("div", { class: "small" }, `Stückpreis ${S(pl.price)} `, el("span", { class: "src " + (pl.src || "fehlt") },
            `${pl.src || "fehlt"}${pl.ts ? " · " + C.fmtAge(pl.ts) : ""}`), `  ·  Einkauf ${S(pl.cost)}`),
          trend(pl.id, k.buy, pl.price, "buy"),
          craftChainBox(pl, k)),
        el("div", { style: "text-align:right" }, el("div", { class: "small muted" }, pl.chain ? "SELBST" : "KAUFEN"),
          el("div", { class: "v num", style: "font-size:20px;color:var(--gold-lt)" }, S(pl.buyNet))),
        el("div", { style: "display:flex;flex-direction:column;gap:6px" },
          el("button", { class: "icon-btn", on: { click: () => editCraftPrice(pl.id) } }, "✎"),
          el("button", { class: "icon-btn", on: { click: () => resetCraftPrices([pl.id]) } }, "↺"),
          el("button", { class: "icon-btn", on: { click: () => editStock(pl.id) } }, "📦")),
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
        el("div", { class: "small" }, el("span", { class: "src " + (psrc || "fehlt") }, `${psrc || "fehlt"}${pts ? " · " + C.fmtAge(pts) : ""}`)),
        trend(ui.cItem, k.sellLoc, pp, "sell")),
      el("div", { style: "text-align:right" }, el("div", { class: "small muted" }, "Stückpreis"),
        el("div", { class: "v num", style: "font-size:20px" }, S(pp))),
      el("button", { class: "icon-btn", on: { click: () => editCraftPrice("prod") } }, "✎"),
      el("button", { class: "icon-btn", on: { click: () => resetCraftPrices(["prod"]) } }, "↺"),
    ));

    // Ergebnis (+ Journale, wenn eingeschaltet)
    const r = k.res, ok = r.complete;
    const jc = journalCalc(k);
    const jx = ui.cJournal && jc && jc.extra ? jc.extra : 0;
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
      ["Silber pro Fokus", ui.cFocus && ok && r.focus ? C.fmtNum((r.profit + jx) / r.focus) : "–"],
    ];
    if (jx) rowsT.splice(9, 0, ["+ Journale", S(jx), false, jx > 0 ? "pos" : "neg"], ["= Gewinn inkl. Journale", ok ? S(r.profit + jx) : "–", true, ok ? (r.profit + jx > 0 ? "pos" : "neg") : ""]);
    const tbl = $("c-table");
    tbl.innerHTML = "";
    rowsT.forEach(([l, v, key, cls]) => tbl.append(el("tr", { class: key ? "key" : "" }, el("td", {}, l), el("td", { class: cls || "" }, v))));
    const b = $("c-banner");
    if (!ok) { b.className = "banner"; b.textContent = "Preise fehlen – „Live-Preise laden“ oder mit ✎ eintragen"; }
    else {
      const tot = r.profit + jx, mg = r.cost ? tot / r.cost * 100 : 0;
      b.className = "banner " + marginTag(mg, tot);
      b.innerHTML = `<span class="big num">${tot > 0 ? "▲" : "▼"} ${S(tot)} Silber</span>` +
        `${S(k.crafts * rec.amount)} × ${gd.name(ui.cItem)} · Marge ${C.fmtNum(mg)} % · Einkauf ${S(k.buyCost)}` + (jx ? ` · inkl. ${S(jx)} Journale` : "");
    }
    renderJournal(k);
    renderEnchant(k);
  }

  // ------------------------------------------------------------ Einkaufsliste
  function shopEntry(r, n) {
    return { id: r.id, crafts: n, city: r.city, buy_city: r.buy_city, buy_mode: ui.buyMode, focus: ui.focus,
      daily: Number(ui.daily) || 0, sell_loc: r.sell_loc || r.city, sell_mode: r.sell_mode || ui.sellMode };
  }
  function addToShop(entries, src) {
    entries.forEach((e) => { if (gd.recipes[e.id]) projects.push(projectFromEntry(e, src || "Rechner")); });
    saveProjects();
    note(entries.length === 1 ? `📝 Rezept gespeichert: ${S(projects[projects.length - 1].pieces)} × ${gd.label(projects[projects.length - 1].id)}` : `📝 ${entries.length} Rezepte gespeichert`);
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

  // ------------------------------------------------------------ Rezepte (gespeicherte Crafts mit Einkaufs-Checkliste)
  let projects = storage.get("projects", []);
  const saveProjects = () => storage.set("projects", projects);
  const pad2 = (n) => String(n).padStart(2, "0");
  const fmtWhen = (ts) => { const d = new Date(ts); return `${dayLabel(dayKey(ts))} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
  let noteTimer = null;
  function note(text) {
    $("note-text").textContent = text;
    $("note").classList.add("on");
    $("note-btn").onclick = () => {
      $("note").classList.remove("on"); ui.listPane = "shop"; show("shop");
      setTimeout(() => { const all = document.querySelectorAll("#proj-list .proj"); if (all.length) all[all.length - 1].scrollIntoView({ behavior: "smooth", block: "start" }); }, 150);
    };
    clearTimeout(noteTimer); noteTimer = setTimeout(() => $("note").classList.remove("on"), 5000);
  }
  const mat = (item, need, have, buy, unit, cost, city) => ({ item, need, have: have || 0, buy: Math.max(0, buy), unit, cost, city, done: buy <= 0, paid: null });

  function projectFromCraft(k) {
    return { uid: uid(), at: Date.now(), src: "Crafting", id: ui.cItem, pieces: k.crafts * k.rec.amount, crafts: k.crafts,
      city: k.city, buyCity: k.buy, sellLoc: k.sellLoc, sellMode: k.mode, focus: !!ui.cFocus,
      ...matsWithChains(k.plan.map((pl) => ({ id: pl.id, need: pl.buy, have: pl.fromStock, buy: pl.buyNet, unit: pl.price, cost: pl.cost, chain: pl.chain })), k.buy),
      cost: k.buyCost, price: k.best ? k.best.price : null, rrr: k.rrr, focusNeed: k.fs.cf * k.fs.fpc, focusCrafts: k.fs.cf, rrrF: k.fs.rrrF, rrrN: k.fs.rrrN,
      nfPieces: k.fs.cf ? C.jointSim(k.rec.res, k.plan.map((x) => x.buy), k.crafts,
        C.returnRate(C.productionBonus(settings, k.city, k.rec.cat, false, Number(ui.cDaily) || 0))).done * k.rec.amount : null,
      revenue: k.res.complete ? k.res.revenue : null, profit: k.res.complete ? k.res.profit : null };
  }
  function projectFromAlch(id, o, plan) {
    const steps = plan.steps.slice().sort((a, b) => b.depth - a.depth)
      .map((st) => ({ item: st.item, out: st.out, crafts: st.crafts, from: st.alt.res.map((x) => x[0]), done: false }));
    const sellLoc = plan.best ? plan.best.loc : o.sellLocs[0];
    return { uid: uid(), at: Date.now(), src: "Tränke & Essen", id, pieces: plan.pieces, crafts: plan.crafts,
      city: o.city, buyCity: o.buyCity, sellLoc, sellMode: plan.best ? plan.best.mode : o.sellMode, focus: !!o.focus,
      mats: plan.buyList.map((it) => mat(it.item, it.qty, it.fromStock, it.buy, it.price, it.cost, o.buyCity)), steps,
      rrr: plan.rrr, focusNeed: plan.focusNeed, focusCrafts: plan.focusCrafts, rrrF: plan.rrrF, rrrN: plan.rrrN, nfPieces: plan.noFocusCrafts * plan.rec.amount,
      cost: plan.buyCost, price: plan.best ? plan.best.price : null,
      revenue: plan.complete ? plan.res.revenue : null, profit: plan.complete ? plan.res.profit : null };
  }
  /** Material-Liste + Schritte; Zutaten mit Kette werden durch ihre Rohstoffe ersetzt. */
  function matsWithChains(entries, buyCity) {
    const mats = [], steps = [];
    const add = (item, need, have, buy, unit, cost) => {
      const m = mats.find((x) => x.item === item);
      if (m) { m.need += need; m.have += have || 0; m.buy += buy; m.cost = m.cost === null || cost === null ? null : m.cost + cost; m.done = m.buy <= 0; }
      else mats.push(mat(item, need, have, buy, unit, cost, buyCity));
    };
    for (const x of entries) {
      if (x.chain && x.chain.self) {
        for (const [id, q] of Object.entries(x.chain.buy)) {
          const [pp, src] = store.get(id, buyCity, "sell");
          const u = pp && src !== "alt" ? C.buyUnitCost(settings, pp, "instant") : null;
          add(id, q, 0, q, u, u === null ? null : u * q);
        }
        x.chain.steps.forEach((st) => steps.push({ item: st.item, out: st.out, crafts: st.crafts, from: st.from, city: st.city, kind: "refine", depth: st.depth, done: false }));
      } else add(x.id, x.need, x.have, x.buy, x.unit, x.cost);
    }
    steps.sort((a, b) => b.depth - a.depth);
    return { mats, steps };
  }
  function projectFromEntry(e, src) {
    const k = shopCalc(e);
    const self = e.self || [];
    const mw = matsWithChains(k.plan.map((pl) => ({ id: pl.id, need: pl.buy, have: 0, buy: pl.buy, unit: pl.price,
      cost: pl.price === null ? null : pl.buy * pl.price,
      chain: self.includes(pl.id) ? chainFor(pl.id, pl.buy, e.city, e.buy_city, e.buy_mode) : null })), e.buy_city);
    const cost = mw.mats.every((m) => m.cost !== null) ? mw.mats.reduce((a, m) => a + m.cost, 0) : k.buyCost;
    return { uid: uid(), at: Date.now(), src, id: e.id, pieces: e.crafts * k.rec.amount, crafts: e.crafts,
      city: e.city, buyCity: e.buy_city, sellLoc: e.sell_loc, sellMode: e.sell_mode, focus: !!e.focus,
      mats: mw.mats, steps: mw.steps, cost, price: k.best ? k.best.price : null, revenue: k.revenue, profit: k.revenue !== null && cost !== null ? k.revenue - cost : k.profit };
  }
  function saveRecipe(p) {
    projects = storage.get("projects", projects);   // immer den neuesten Stand nehmen
    projects.push(p); saveProjects();
    const ok = (storage.get("projects", []) || []).some((x) => x.uid === p.uid);
    if (!ok) { alert("Speichern hat nicht geklappt – ist der Speicher voll oder Privat-Modus an?"); return; }
    note(`📝 Gespeichert (Nr. ${projects.length}): ${S(p.pieces)} × ${gd.label(p.id)}`);
    renderShop();
  }
  const curProj = (m) => projects.find((p) => p.mats.includes(m));
  function editMat(m) {
    const unit = m.paid !== null && m.paid !== undefined && m.buy ? m.paid / m.buy : m.unit;
    qpOpen({ title: gd.label(m.item), sub: `${m.city} · geplant ${S(m.buy)} Stück${m.unit !== null ? " à ca. " + S(m.unit) : ""}`,
      qty: m.buy, qtyEdit: true, unit, check: { label: "✔ Schon gekauft", value: true },
      onSave: ({ qty, unit, total, check }) => {
        m.buy = qty;
        if (check) { m.done = true; m.paid = total; m.got = qty; removeMatOrders(curProj(m), m, true); }
        else { m.done = false; m.paid = null; m.unit = unit; m.cost = total; }
        saveProjects(); renderShop();
      } });
  }
  const matCost = (m) => {
    if (m.paid === null || m.paid === undefined) return m.cost;
    if (!m.done && m.got && m.got < m.buy && m.unit !== null) return m.paid + (m.buy - m.got) * m.unit;  // Rest noch zum Plan-Preis
    return m.paid;
  };
  /** Offene Kaufaufträge, die zu diesem Rezept-Material gehören */
  const matOrders = (p, m) => orders.filter((o) => o.proj === p.uid && o.mat === m.item && o.filled < o.qty);
  function removeMatOrders(p, m, ask) {
    const os = matOrders(p, m);
    if (!os.length) return;
    if (ask && !confirm(`Den offenen Kaufauftrag für ${gd.label(m.item)} auch löschen?`)) return;
    orders = orders.filter((o) => !os.includes(o)); saveOrders();
  }
  function matOrder(p, m) {
    const rest = Math.max(0, m.buy - (m.got || 0));
    const [bid, src] = store.get(m.item, m.city, "buy");
    const price = bid && src !== "alt" ? bid + 1 : m.unit;
    openOrder({ side: "buy", id: m.item, qty: rest, price, loc: m.city, proj: p.uid, mat: m.item });
  }
  function allMatOrders(p) {
    const list = toBuy(p).filter((m) => !m.done && !matOrders(p, m).length && m.buy - (m.got || 0) > 0);
    if (!list.length) { alert("Alle offenen Materialien haben schon einen Kaufauftrag (oder sind gekauft)."); return; }
    const rows = list.map((m) => {
      const [bid, src] = store.get(m.item, m.city, "buy");
      return { m, qty: m.buy - (m.got || 0), price: Math.round(bid && src !== "alt" ? bid + 1 : (m.unit || 0)) };
    }).filter((r) => r.price > 0);
    const tied = rows.reduce((a, r) => a + r.qty * r.price * (1 + settings.setup_fee / 100), 0);
    if (!confirm(`${rows.length} Kaufaufträge anlegen (je 1 Silber über dem höchsten Gebot)?\n\n` +
      rows.map((r) => `${S(r.qty)} × ${gd.label(r.m.item)} à ${S(r.price)}`).join("\n") + `\n\nGebundenes Silber: ${S(tied)}`)) return;
    rows.forEach((r) => orders.push({ uid: uid(), side: "buy", id: r.m.item, qty: r.qty, filled: 0, price: r.price, loc: r.m.city, at: Date.now(), proj: p.uid, mat: r.m.item }));
    saveOrders(); renderShop();
    note(`📑 ${rows.length} Kaufaufträge angelegt – im Spiel genauso einstellen`);
  }
  const toBuy = (p) => p.mats.filter((m) => m.buy > 0);

  function finishProject(p) {
    const open = toBuy(p).filter((m) => !m.done).length;
    if (open && !confirm(`Es sind noch ${open} Material(ien) nicht als gekauft abgehakt.\nTrotzdem als fertig ins Buch eintragen?`)) return;
    const spent = toBuy(p).reduce((a, m) => a + (matCost(m) || 0), 0);
    if (!logCraft({ id: p.id, pieces: p.pieces, cost: Math.round(spent), expected: projProfit(p).net, where: `${p.city} → ${p.sellLoc}`,
      price: p.price, loc: p.sellLoc, mode: p.sellMode })) return;
    const used = {}; p.mats.forEach((m) => { if (m.have) used[m.item] = m.have; });
    consumeStock(used);
    dropProjOrders(p);
    projects = projects.filter((x) => x !== p); saveProjects(); renderShop();
  }
  function dropProjOrders(p) {
    const os = orders.filter((o) => o.proj === p.uid && o.filled < o.qty);
    if (os.length && confirm(`${os.length} offene Kaufaufträge gehören zu diesem Rezept. Auch löschen?`)) { orders = orders.filter((o) => !os.includes(o)); saveOrders(); }
  }
  function openProject(p) {
    const r = gd.recipes[p.id]; if (!r) return;
    if (p.src === "Tränke & Essen") {
      Object.assign(ui, { aKind: r.cat === "food" ? "food" : "potion", aBase: p.id.split("@")[0], aEnch: r.ench, aInput: "qty", aQty: p.pieces });
      saveUi(); show("alch");
    } else {
      Object.assign(ui, { cItem: p.id, cQty: p.pieces, cGroup: r.group }); saveUi(); show("craft");
    }
  }
  function projectText(p) {
    const lines = toBuy(p).map((m) => `${m.done ? "✔" : "☐"} ${S(m.buy)} × ${gd.label(m.item)} (${m.city})${matCost(m) !== null ? " – " + S(matCost(m)) : ""}`);
    const steps = p.steps.map((st) => `${st.done ? "✔" : "☐"} ${S(st.out)} × ${gd.label(st.item)} ${st.kind === "refine" ? "refinen in " + st.city : "herstellen"}`);
    return `${S(p.pieces)} × ${gd.label(p.id)} – Craften in ${p.city}\n\nEinkaufen:\n${lines.join("\n") || "nichts"}` +
      (steps.length ? `\n\nZwischenprodukte:\n${steps.join("\n")}` : "") + `\n\nEinkauf ca. ${S(p.cost)} Silber`;
  }
  async function shareText(title, text) {
    try {
      if (navigator.share) await navigator.share({ title, text });
      else { await navigator.clipboard.writeText(text); setStatus("Kopiert"); }
    } catch (e) { /* abgebrochen */ }
  }

  function projFocusNote(p) {
    const pc = (r) => r === undefined || r === null ? "?" : C.fmtNum(r * 100) + " %";
    const amt = gd.recipes[p.id] ? gd.recipes[p.id].amount : 1;
    if (!p.focus || p.focusCrafts === 0) return el("div", { class: "small" }, `Im Spiel: „Ressourcen-Ertragsrate“ ${pc(p.rrrN !== undefined ? p.rrrN : p.rrr)}` +
      (p.focus && p.focusCrafts === 0 ? " (dein Fokus reichte beim Speichern für keinen Craft mit Fokus)" : ""));
    const fc = p.focusCrafts !== undefined ? p.focusCrafts : p.crafts;
    return el("div", { class: "small gold" },
      `✦ ${S(fc)} von ${S(p.crafts)} Crafts MIT Fokus (${S(p.focusNeed)} Fokus, Ertragsrate ${pc(p.rrrF)})` +
      (fc < p.crafts ? `, danach ${S(p.crafts - fc)} ohne Fokus (${pc(p.rrrN)})` : "") +
      (p.nfPieces && p.nfPieces < p.pieces ? ` · ganz ohne Fokus nur ca. ${S(p.nfPieces)} Stück` : ""));
  }
  /** Erwarteter Gewinn live: Erlös (Verkaufspreis × Stück nach Steuer) − Einkauf (bezahlt bzw. eingetragen). */
  function projProfit(p) {
    const cost = toBuy(p).reduce((a, m) => a + (matCost(m) || 0), 0);
    const missing = toBuy(p).some((m) => matCost(m) === null);
    const fee = C.sellFee(settings, p.sellMode || "order");
    const net = p.price ? p.pieces * p.price * (1 - fee) : (p.revenue !== null && p.revenue !== undefined ? p.revenue : null);
    return { cost, net, fee, missing, profit: net === null || missing ? null : net - cost };
  }
  function editProjSale(p) {
    qpOpen({ title: `Verkauf: ${gd.label(p.id)}`, sub: `${p.sellLoc} · ${p.sellMode === "instant" ? "Sofortverkauf (nur Steuer)" : "Verkaufsauftrag (Steuer + Einstellgebühr)"} · Preis pro Stück eintragen`,
      qty: p.pieces, qtyEdit: false, unit: p.price,
      onSave: ({ unit }) => { p.price = Math.round(unit); p.priceManual = true; saveProjects(); renderShop(); },
      onLive: () => {
        const best = C.bestSale(store, settings, p.id, [p.sellLoc], p.sellMode || "order");
        if (!best) { alert("Kein Live-Preis vorhanden – erst im Rechner Preise laden."); return; }
        p.price = best.price; p.priceManual = false; saveProjects(); renderShop();
      }, liveLabel: "↺ Live-Preis" });
  }
  function projMoney(p, spent) {
    const pp = projProfit(p);
    const box = el("div", {});
    box.append(
      el("div", { class: "money-row" }, el("span", {}, `Verkauf ${p.sellLoc}: ${S(p.pieces)} × ${p.price ? S(p.price) : "?"}` + (p.priceManual ? " (eigener Preis)" : "")),
        el("button", { class: "icon-btn sm", title: "Verkaufspreis ändern", on: { click: () => editProjSale(p) } }, "✎")),
      el("div", { class: "money-row" }, el("span", { class: "muted" }, `Erlös nach Steuer (${C.fmtNum(pp.fee * 100)} %)`), el("b", { class: "num" }, S(pp.net))),
      el("div", { class: "money-row" }, el("span", { class: "muted" }, `− Einkauf${spent ? " (davon bezahlt " + S(spent) + ")" : ""}`), el("b", { class: "num" }, (pp.missing ? "≥ " : "") + S(pp.cost))),
      el("div", { class: "money-row total" }, el("span", {}, "= Erwarteter Gewinn"),
        el("b", { class: "num " + (pp.profit === null ? "" : pp.profit > 0 ? "pos" : "neg") }, pp.profit === null ? "Preis fehlt" : `${pp.profit > 0 ? "+" : ""}${S(pp.profit)}`)));
    return box;
  }
  function projectCard(p) {
    const buys = toBuy(p), done = buys.filter((m) => m.done).length;
    const ready = done === buys.length;
    const rest = buys.filter((m) => !m.done).reduce((a, m) => a + (m.cost || 0), 0);
    const restMissing = buys.some((m) => !m.done && m.cost === null);
    const card = el("div", { class: "card proj" + (ready ? " ready" : "") });
    card.append(
      el("div", { class: "proj-h" },
        el("div", { class: "t" },
          el("div", { class: "proj-title" }, `${S(p.pieces)} × ${gd.label(p.id)}`),
          el("div", { class: "small muted" }, `aus ${p.src} · gespeichert ${fmtWhen(p.at)}`),
          el("div", { class: "small" }, `Craften in ${p.city}${p.focus && p.focusCrafts !== 0 ? " MIT Fokus" : " ohne Fokus"} · Einkauf in ${p.buyCity} · Verkauf in ${p.sellLoc}`),
          projFocusNote(p)),
        el("button", { class: "icon-btn", title: "Rezept löschen", on: { click: () => {
          if (confirm(`Rezept „${S(p.pieces)} × ${gd.label(p.id)}“ löschen?\n(Im Buch wird nichts eingetragen.)`)) { dropProjOrders(p); projects = projects.filter((x) => x !== p); saveProjects(); renderShop(); }
        } } }, "🗑")),
      el("div", { class: "proj-bar" }, el("div", { style: `width:${buys.length ? done / buys.length * 100 : 100}%` })),
      el("div", { class: "small " + (ready ? "pos" : "") }, ready ? "✔ Alles gekauft – jetzt craften" :
        `${done} von ${buys.length} Materialien gekauft · noch ca. ${S(rest)}${restMissing ? " *" : ""} Silber`),
    );
    // 1 · Einkaufen
    card.append(el("div", { class: "proj-sec" }, "1 · Einkaufen"));
    for (const m of p.mats) {
      if (m.buy <= 0) {
        card.append(el("div", { class: "chk have" }, el("div", { class: "t" },
          el("div", { class: "n" }, `✔ ${S(m.need)} × ${gd.label(m.item)}`),
          el("div", { class: "small gold" }, "hast du schon im Lager – nichts kaufen"))));
        continue;
      }
      const cb = el("input", { type: "checkbox", checked: !!m.done, on: { change: () => {
        m.done = cb.checked; if (m.done) { if (!m.got) m.got = m.buy; removeMatOrders(p, m, true); }
        saveProjects(); renderShop(); } } });
      const os = matOrders(p, m);
      const part = !m.done && m.got > 0;
      card.append(el("div", { class: "chk" + (m.done ? " done" : "") },
        el("label", {}, cb, el("div", { class: "t" },
          el("div", { class: "n" }, `${S(m.buy)} × ${gd.label(m.item)}`),
          el("div", { class: "small muted" }, `${m.city} · ${m.paid !== null && m.paid !== undefined && m.got ? S(m.paid / m.got) + " pro Stück (bezahlt)" : m.unit === null ? "Preis fehlt" : "ca. " + S(m.unit) + " pro Stück"}` +
            (m.have ? ` · dazu ${S(m.have)} aus dem Lager` : "")),
          part ? el("div", { class: "small gold" }, `${S(m.got)} von ${S(m.buy)} gekauft · noch ${S(m.buy - m.got)}`) : null,
          m.done ? el("div", { class: "small tag" }, m.paid !== null && m.paid !== undefined ? `✔ gekauft für ${S(m.paid)}` : "✔ gekauft") : null)),
        el("div", { class: "num", style: "font-weight:700;text-align:right" }, matCost(m) === null ? "–" : S(matCost(m))),
        el("div", { class: "mat-btns" },
          el("button", { class: "icon-btn", title: "Menge / Preis ändern", on: { click: () => editMat(m) } }, "✎"),
          !m.done && !os.length ? el("button", { class: "icon-btn", title: "Als Kaufauftrag", on: { click: () => matOrder(p, m) } }, "📑") : null)));
      // verknüpfte Kaufaufträge: einzeln ausführen oder löschen
      for (const o of os) {
        const rest = o.qty - o.filled;
        card.append(el("div", { class: "mat-order" },
          el("div", { class: "t" }, el("div", { class: "small", style: "font-weight:700" }, `📑 Kaufauftrag ${S(rest)} × à ${S(o.price)}`),
            el("div", { class: "small muted" }, `${o.loc}${o.filled ? " · " + S(o.filled) + " schon bekommen" : ""} · seit ${C.fmtAge(o.at / 1000)}`)),
          el("button", { class: "btn", on: { click: () => orderFillAsk(o) } }, "✔ Ausgeführt"),
          el("button", { class: "icon-btn", title: "Auftrag löschen", on: { click: () => {
            if (confirm(`Kaufauftrag ${S(rest)} × ${gd.label(o.id)} löschen?`)) { orders = orders.filter((x) => x !== o); saveOrders(); renderShop(); }
          } } }, "✕")));
      }
    }
    // 2 · Zwischenprodukte
    if (p.steps.length) {
      card.append(el("div", { class: "proj-sec" }, "2 · Zwischenprodukte herstellen"));
      for (const st of p.steps) {
        const cb = el("input", { type: "checkbox", checked: !!st.done, on: { change: () => { st.done = cb.checked; saveProjects(); renderShop(); } } });
        card.append(el("div", { class: "chk" + (st.done ? " done" : "") }, el("label", {}, cb, el("div", { class: "t" },
          el("div", { class: "n" }, `${S(st.out)} × ${gd.label(st.item)} ${st.kind === "refine" ? "refinen in " + st.city : "herstellen"}`),
          el("div", { class: "small muted" }, `${S(st.crafts)} ${st.kind === "refine" ? "Refines" : "Crafts"}` + (st.from && st.from.length ? ` · aus ${st.from.map((x) => Array.isArray(x) ? S(x[1]) + " × " + gd.label(x[0]) : gd.label(x)).join(" + ")}` : ""))))));
      }
    }
    // 3 · Craften
    const spent = buys.filter((m) => m.done).reduce((a, m) => a + (matCost(m) || 0), 0);
    card.append(el("div", { class: "proj-sec" }, `${p.steps.length ? 3 : 2} · Craften & verkaufen`),
      el("div", { class: "proj-sum" },
        el("div", {}, el("b", {}, `${S(p.crafts)} Crafts → ${S(p.pieces)} × ${gd.label(p.id)}`), ` in ${p.city}`),
        projMoney(p, spent)),
      el("div", { class: "proj-btns" },
        el("button", { class: "btn primary wide", on: { click: () => finishProject(p) } }, "✔ Fertig gecraftet – ins Buch"),
        el("button", { class: "btn wide", on: { click: () => allMatOrders(p) } }, "📑 Offenes als Kaufaufträge"),
        el("button", { class: "btn", on: { click: () => openProject(p) } }, "🧮 Im Rechner öffnen"),
        el("button", { class: "btn", on: { click: () => shareText("Rezept", projectText(p)) } }, "Teilen")));
    return card;
  }

  function renderShop() {
    const box = $("proj-list");
    if (!box) return;
    box.innerHTML = "";
    projects = projects.filter((p) => gd.recipes[p.id]);
    if (!projects.length) box.append(el("div", { class: "card empty" }, "Noch keine Rezepte gespeichert.",
      el("div", { class: "small", style: "margin-top:6px" }, "Im Crafting- oder Tränke-Rechner unten auf „📝 Rezept speichern“ tippen.")));
    projects.forEach((p) => box.append(projectCard(p)));
    $("howto").style.display = projects.length && !ui.hints ? "none" : "";
    // Alles zusammen (nur wenn mehrere Rezepte)
    const agg = {};
    projects.forEach((p) => toBuy(p).filter((m) => !m.done).forEach((m) => {
      const k = m.item + "|" + m.city;
      const a = (agg[k] = agg[k] || { item: m.item, city: m.city, n: 0, cost: 0, miss: false, refs: [] });
      a.n += m.buy; if (m.cost === null) a.miss = true; else a.cost += m.cost; a.refs.push(m);
    }));
    const list = Object.values(agg).sort((a, b) => a.city.localeCompare(b.city) || b.cost - a.cost);
    const all = $("proj-all");
    all.innerHTML = "";
    all.style.display = projects.length > 1 && list.length ? "" : "none";
    if (projects.length > 1 && list.length) {
      all.append(el("b", {}, "🛒 Alles zusammen einkaufen"),
        el("div", { class: "small muted", style: "margin:2px 0 4px" }, "Noch offen aus allen Rezepten. Abhaken hakt es in jedem Rezept ab."));
      let city = null;
      for (const a of list) {
        if (a.city !== city) { city = a.city; all.append(el("div", { class: "proj-sec" }, city)); }
        const cb = el("input", { type: "checkbox", on: { change: () => { a.refs.forEach((m) => { m.done = true; }); saveProjects(); renderShop(); } } });
        all.append(el("div", { class: "chk" }, el("label", {}, cb, el("div", { class: "t" },
          el("div", { class: "n" }, `${S(a.n)} × ${gd.label(a.item)}`),
          el("div", { class: "small muted" }, `für ${a.refs.length} Rezept(e)`))),
          el("div", { class: "num", style: "font-weight:700" }, a.miss ? "–" : S(a.cost))));
      }
    }
    const openCost = list.reduce((x, a) => x + a.cost, 0);
    const profit = projects.reduce((x, p) => x + (projProfit(p).profit || 0), 0);
    const t = $("shop-tiles");
    t.innerHTML = "";
    t.append(
      tile(String(projects.length), "gespeicherte Rezepte"),
      tile(S(openCost), "noch einzukaufen (Silber)"),
      tile(String(list.reduce((x, a) => x + a.refs.length, 0)), "Materialien offen"),
      tile(projects.length ? S(profit) : "–", "erwarteter Gewinn", profit > 0 ? "good" : projects.length ? "bad" : ""),
    );
    renderShop.lastText = projects.map(projectText).join("\n\n――――――――――\n\n");
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
    renderEval();

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
        el("div", { style: "display:flex;flex-direction:column;gap:6px" },
          el("button", { class: "btn primary", on: { click: () => sellEntry(e) } }, "Verkauf +"),
          el("button", { class: "btn", style: "min-height:34px;padding:5px 10px;font-size:13px", on: { click: () =>
            openOrder({ side: "sell", id: e.id, qty: restPieces(e), price: e.price, loc: e.loc || C.CITIES[0], bookUid: e.uid }) } }, "📑 als Auftrag"))));
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
    for (const k of ["shop", "book", "stock", "orders"]) $(k + "-pane").style.display = p === k ? "" : "none";
    if (p === "book") renderBook();
    else if (p === "stock") { fillItemList(); renderStock(); }
    else if (p === "orders") { fillItemList(); renderOrders(); }
    else renderShop();
  }

  // ------------------------------------------------------------ Lager
  let stock = storage.get("stock", {});   // item -> {qty, value}
  const saveStock = () => storage.set("stock", stock);
  function editStock(item) {
    const cur = stock[item] || { qty: 0, value: 0 };
    qpOpen({ title: "📦 " + gd.label(item), sub: "Lager: Menge und Wert pro Stück (0 = selbst gesammelt/gratis). Menge 0 = entfernen.",
      qty: cur.qty || "", qtyEdit: true, focusQty: true, unit: cur.value || 0,
      onSave: ({ qty, unit }) => {
        if (!qty) delete stock[item]; else stock[item] = { qty, value: Math.max(0, unit || 0) };
        saveStock(); refreshAll();
      } });
  }
  /** Lager nach dem Craften abziehen. used: {item: qty} */
  function consumeStock(used) {
    const list = Object.entries(used).filter(([, q]) => q > 0);
    if (!list.length) return;
    if (!confirm("Verbrauchtes Material vom Lager abziehen?\n\n" + list.map(([i, q]) => `${S(q)} × ${gd.label(i)}`).join("\n"))) return;
    for (const [i, q] of list) {
      if (!stock[i]) continue;
      stock[i].qty -= q;
      if (stock[i].qty <= 0) delete stock[i];
    }
    saveStock();
  }
  function renderStock() {
    const box = $("stock-list");
    box.innerHTML = "";
    const items = Object.entries(stock).sort((a, b) => gd.label(a[0]).localeCompare(gd.label(b[0]), "de"));
    if (!items.length) box.append(el("div", { class: "empty" }, "Noch leer. Oben ein Item suchen oder in den Rechnern 📦 tippen."));
    let total = 0;
    for (const [item, st] of items) {
      total += st.qty * st.value;
      box.append(el("div", { class: "shop-item" },
        el("div", { class: "t" }, el("div", { style: "font-weight:700" }, `${S(st.qty)} × ${gd.label(item)}`),
          el("div", { class: "small muted" }, st.value ? `Wert ${S(st.value)} pro Stück · ${S(st.qty * st.value)}` : "selbst gesammelt · Wert 0")),
        el("button", { class: "icon-btn", on: { click: () => editStock(item) } }, "✎"),
        el("button", { class: "icon-btn", on: { click: () => { if (confirm(`${gd.label(item)} aus dem Lager entfernen?`)) { delete stock[item]; saveStock(); renderStock(); } } } }, "✕")));
    }
    if (items.length) box.append(el("div", { class: "small muted", style: "margin-top:8px" }, `${items.length} Items · Lagerwert ${S(total)} Silber`));
  }
  let itemIndex = null;
  function fillItemList() {
    if (itemIndex) return;
    itemIndex = {};
    const ids = new Set(Object.keys(gd.names));
    Object.keys(gd.recipes).forEach((i) => ids.add(i));
    const dl = $("items-dl");
    const frag = document.createDocumentFragment();
    for (const id of ids) {
      const l = gd.label(id);
      if (itemIndex[l]) continue;
      itemIndex[l] = id;
      frag.append(el("option", { value: l }));
    }
    dl.append(frag);
  }
  const idFromLabel = (txt) => (itemIndex && itemIndex[txt.trim()]) || null;

  // ------------------------------------------------------------ Preisverlauf
  /** Mini-Kurve (Ø-Preis pro Tag) + Vergleich aktuell vs. Durchschnitt. */
  function trend(item, loc, current, side) {
    const h = store.history[item + "|" + loc];
    if (!h || !h.data || h.data.length < 2) return null;
    const vals = h.data.map((d) => d[2]);
    const sold = h.data.reduce((a, d) => a + d[1], 0);
    const avg = h.data.reduce((a, d) => a + d[1] * d[2], 0) / Math.max(1, sold);
    const min = Math.min(...vals), max = Math.max(...vals), W = 74, H = 22;
    const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * W},${H - 2 - ((v - min) / Math.max(1, max - min)) * (H - 4)}`).join(" ");
    const pct = current ? (current - avg) / avg * 100 : null;
    let hint = "", cls = "muted";
    if (pct !== null) {
      if (side === "buy") { if (pct <= -10) { hint = `günstig · ${C.fmtNum(-pct, 0)} % unter Ø`; cls = "pos"; } else if (pct >= 10) { hint = `teuer · ${C.fmtNum(pct, 0)} % über Ø`; cls = "neg"; } else hint = "normaler Preis"; }
      else { if (pct >= 10) { hint = `gut verkaufen · ${C.fmtNum(pct, 0)} % über Ø`; cls = "pos"; } else if (pct <= -10) { hint = `unter Ø (${C.fmtNum(pct, 0)} %) · evtl. warten`; cls = "neg"; } else hint = "normaler Preis"; }
    }
    const node = el("span", { class: "small", style: "display:inline-flex;align-items:center;gap:6px;margin-top:2px" });
    node.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="var(--gold)" stroke-width="1.6"/></svg>`;
    node.append(el("span", { class: cls }, `Ø${h.data.length} Tg ${S(avg)}${hint ? " · " + hint : ""}`));
    return node;
  }

  // ------------------------------------------------------------ Journale (nur Ausrüstung)
  let journals = { map: {}, names: {} };
  let fameStore = storage.get("fame", {});   // item -> Ruhm pro Craft (aus dem Craft-Fenster)
  const journalFor = (id) => journals.map[id.split("@")[0]] || null;
  function journalCalc(k) {
    const jf = journalFor(ui.cItem);
    if (!jf) return null;
    const [jid, maxfame] = jf;
    const fame = Number(fameStore[ui.cItem]) || 0;
    const full = jid + "_FULL", empty = jid + "_EMPTY";
    let [pf, sf] = store.get(full, k.city, "buy");          // volles Journal sofort ans Kaufgebot
    if (!pf) [pf, sf] = store.get(full, k.city, "sell");
    const [pe, se] = store.get(empty, k.city, "sell");       // leeres Journal kaufen
    const journalsFilled = fame > 0 ? k.crafts * fame / maxfame : 0;
    const per = pf && pe !== null ? pf * (1 - C.sellFee(settings, "instant")) - (pe || 0) : null;
    return { jid, full, empty, maxfame, fame, pf, sf, pe, se, journalsFilled, per, extra: per !== null ? journalsFilled * per : null };
  }
  function renderJournal(k) {
    const box = $("c-journal");
    const j = journalCalc(k);
    if (!j) { box.style.display = "none"; return; }
    box.style.display = "";
    box.innerHTML = "";
    const fameInp = el("input", { type: "number", inputMode: "numeric", value: j.fame || "", placeholder: "z. B. 1234",
      on: { change: () => { fameStore[ui.cItem] = Number(fameInp.value) || 0; storage.set("fame", fameStore); renderCraft(); } } });
    box.append(
      el("div", { class: "row", style: "justify-content:space-between" }, el("b", {}, "📘 Journale"),
        el("label", { class: "toggle", style: "padding:0" }, el("span", { class: "small" }, "in Gewinn einrechnen "),
          el("input", { type: "checkbox", checked: !!ui.cJournal, on: { change: (e) => { ui.cJournal = e.target.checked; saveUi(); renderCraft(); } } }))),
      el("div", { class: "small muted", style: "margin:2px 0 8px" }, `Füllt: ${gd.name(j.full).replace(" (voll)", "")} · ${S(j.maxfame)} Ruhm pro Journal`),
      el("div", { class: "field" }, el("label", {}, "Ruhm pro Craft (steht im Spiel im Craft-Fenster)"), fameInp),
      el("div", { class: "price" },
        el("div", { class: "t" }, el("div", { class: "n" }, "Volles Journal verkaufen"), el("div", { class: "small muted" }, `${k.city} · ${j.sf || "fehlt"}`)),
        el("div", { class: "v num" }, S(j.pf)),
        el("button", { class: "icon-btn", on: { click: () => aEditPrice(j.full, k.city, "buy", j.pf, renderCraft, Math.max(1, Math.round(j.journalsFilled))) } }, "✎")),
      el("div", { class: "price" },
        el("div", { class: "t" }, el("div", { class: "n" }, "Leeres Journal kaufen"), el("div", { class: "small muted" }, `${k.city} · ${j.se || "fehlt"}`)),
        el("div", { class: "v num" }, S(j.pe)),
        el("button", { class: "icon-btn", on: { click: () => aEditPrice(j.empty, k.city, "sell", j.pe, renderCraft, Math.max(1, Math.ceil(j.journalsFilled))) } }, "✎")),
      el("div", { class: "small", style: "margin-top:6px" }, !j.fame ? "Trag den Ruhm pro Craft ein, dann rechnet das Tool die Journale aus." :
        j.per === null ? "Journal-Preise fehlen – „Live-Preise laden“." :
        `${C.fmtNum(j.journalsFilled, 2)} Journale gefüllt × ${S(j.per)} = `,
        j.fame && j.per !== null ? el("b", { class: j.extra >= 0 ? "pos" : "neg" }, `${j.extra >= 0 ? "+" : ""}${S(j.extra)} Silber`) : null,
        j.fame && j.per !== null && j.per < 0 ? el("div", { class: "small neg" }, "Leere Journale sind gerade teurer, als volle bringen – lohnt sich im Moment nicht.") : null),
    );
  }

  // ------------------------------------------------------------ Verzaubern (Runen / Seelen / Relikte)
  let enchData = { c: {}, names: {} };
  const ENCH_MAT = ["RUNE", "SOUL", "RELIC"];
  const ENCH_WORD = ["Runen", "Seelen", "Relikte"];
  const enchId = (base, l) => l ? base + "@" + l : base;
  function enchInfo(id) {
    if (!id || !gd) return null;
    const base = id.split("@")[0], r = gd.recipes[id], n = enchData.c[base];
    if (!n || !r || r.ench >= 3) return null;
    return { base, n, from: r.ench, tier: r.tier };
  }
  function enchantCalc(k) {
    const inf = enchInfo(ui.cItem);
    if (!inf) return null;
    const pieces = k.crafts * k.rec.amount;
    const kind = ui.cBuyMode === "instant" ? "sell" : "buy";
    const unit = (item, loc) => {
      const [p, src, ts] = store.get(item, loc, kind);
      return { p: (p !== null && src !== "alt") || src === "manuell" ? C.buyUnitCost(settings, p, ui.cBuyMode) : null, src, ts };
    };
    const own = k.res.missing.length ? null : k.res.cost / Math.max(1, k.res.produced);
    const bought = unit(ui.cItem, k.buy);
    const src = ui.eSrc === "buy" ? "buy" : "craft";
    const baseCost = src === "buy" ? bought.p : own;
    const baseSaleNet = k.best ? k.best.price * (1 - C.sellFee(settings, k.mode)) : null;
    const fee = Math.max(0, Number(ui.eFee) || 0);
    const mats = [], steps = [];
    let up = 0, upOk = true;
    for (let l = inf.from + 1; l <= 3; l++) {
      const mid = `T${inf.tier}_${ENCH_MAT[l - 1]}`;
      const u = unit(mid, k.buy);
      mats.push(Object.assign({ id: mid, n: inf.n, lvl: l }, u));
      if (u.p === null) upOk = false; else up += u.p * inf.n + fee;
      const tid = enchId(inf.base, l);
      const best = C.bestSale(store, settings, tid, k.sellLocs, ui.cSellMode);
      const saleNet = best ? best.price * (1 - C.sellFee(settings, best.mode)) : null;
      const upEach = upOk ? up : null;
      const costEach = upEach !== null && baseCost !== null ? baseCost + upEach : null;
      let craftEach = null;
      if (gd.recipes[tid]) { const kk = craftCalc(tid); if (kk && !kk.res.missing.length) craftEach = kk.res.cost / Math.max(1, kk.res.produced); }
      const direct = unit(tid, k.buy).p;
      steps.push({ l, tid, best, saleNet, upEach, costEach, craftEach, direct,
        profitEach: costEach !== null && saleNet !== null ? saleNet - costEach : null,
        extraEach: upEach !== null && saleNet !== null && baseSaleNet !== null ? saleNet - upEach - baseSaleNet : null });
    }
    return Object.assign({}, inf, { pieces, own, bought, src, baseCost, baseSaleNet, mats, steps, kind });
  }

  function renderEnchant(k) {
    const box = $("c-ench");
    const e = enchantCalc(k);
    if (!e) { box.style.display = "none"; return; }
    box.style.display = "";
    box.innerHTML = "";
    const t = (l) => `T${e.tier}.${l}`;
    const pm = (v) => v === null ? "–" : (v > 0 ? "+" : "") + S(v);
    const cls = (v) => v === null ? "" : v > 0 ? "pos" : "neg";
    const segBtn = (val, label) => el("button", { class: e.src === val ? "on" : "", on: { click: () => { ui.eSrc = val; saveUi(); renderCraft(); } } }, label);
    const feeInp = el("input", { type: "number", inputMode: "numeric", value: ui.eFee || "", placeholder: "0",
      on: { change: () => { ui.eFee = Number(feeInp.value) || 0; saveUi(); renderCraft(); } } });
    box.append(
      el("b", {}, `✨ Verzaubern: lohnt sich ${t(e.from)} → höher?`),
      el("div", { class: "small muted", style: "margin:2px 0 8px" },
        `Pro Stück und Stufe ${S(e.n)} ${ENCH_WORD.slice(e.from).join(" / ")} · an der Artefaktschmiede · Qualität bleibt gleich · gerechnet für ${S(e.pieces)} Stück (MENGE oben)`),
      el("div", { class: "small", style: "margin-bottom:4px" }, `Woher kommt dein ${t(e.from)}-Item?`),
      el("div", { class: "seg", style: "margin-bottom:8px" },
        segBtn("craft", `⚒ Selbst gecraftet · ${S(e.own)}`), segBtn("buy", `🛒 Gekauft · ${S(e.bought.p)}`)),
      el("div", { class: "row", style: "justify-content:space-between;gap:8px" },
        el("div", { class: "small muted" }, `Einkauf in ${k.buy}${e.src === "buy" ? "" : " · Craftkosten aus dem Rechner oben"}`),
        e.src === "buy" ? el("button", { class: "icon-btn", on: { click: () => aEditPrice(ui.cItem, k.buy, e.kind, null, renderCraft, e.pieces) } }, "✎") : null),
    );
    // Material-Preise
    for (const m of e.mats) box.append(el("div", { class: "price" },
      el("div", { class: "t" }, el("div", { class: "n" }, gd.label(m.id)),
        el("div", { class: "small muted" }, `${t(m.lvl - 1)} → ${t(m.lvl)} · ${S(m.n)} pro Stück · `,
          el("span", { class: "src " + (m.src || "fehlt") }, `${m.src || "fehlt"}${m.ts ? " · " + C.fmtAge(m.ts) : ""}`)),
        trend(m.id, k.buy, m.p, "buy")),
      el("div", { style: "text-align:right" }, el("div", { class: "small muted" }, "Stückpreis"), el("div", { class: "v num" }, S(m.p))),
      el("button", { class: "icon-btn", on: { click: () => aEditPrice(m.id, k.buy, e.kind, null, renderCraft, m.n * e.pieces) } }, "✎")));
    box.append(el("div", { class: "field", style: "margin-top:8px" }, el("label", {}, "Gebühr pro Stück und Stufe (falls die Schmiede etwas kostet)"), feeInp));

    // Ergebnis je Zielstufe
    for (const st of e.steps) {
      const mode = st.best ? st.best.mode : ui.cSellMode;
      const loc = st.best ? st.best.loc : k.sellLocs[0];
      const ways = [["Selbst verzaubern", st.costEach], ["Fertig kaufen", st.direct], [`Direkt ${t(st.l)} craften`, st.craftEach]].filter((w) => w[1] !== null);
      const cheapest = ways.length ? ways.reduce((a, b) => (b[1] < a[1] ? b : a)) : null;
      const good = st.extraEach !== null && st.extraEach > 0 && (st.profitEach === null || st.profitEach > 0);
      const bad = st.extraEach !== null && st.extraEach <= 0;
      const card = el("div", { class: "ench-step " + (good ? "good" : bad ? "bad" : "") });
      card.append(
        el("div", { class: "row", style: "justify-content:space-between" },
          el("b", {}, `${t(e.from)} → ${t(st.l)}`),
          el("span", { class: "small " + (good ? "pos" : bad ? "neg" : "muted") },
            st.extraEach === null ? "Preise fehlen" : good ? "✔ lohnt sich" : bad ? "✘ lohnt sich nicht" : "⚠ nur mit Verlust")),
        el("div", { class: "price" },
          el("div", { class: "t" }, el("div", { class: "n" }, `Verkauf ${t(st.l)}`),
            el("div", { class: "small muted" }, `${loc}${mode === "instant" ? " · Sofortverkauf" : ""} · Verkäufe/Tag ${st.best && st.best.info && st.best.info.per_day != null ? C.fmtNum(st.best.info.per_day, st.best.info.per_day < 10 ? 1 : 0) : "?"}`),
            trend(st.tid, loc, st.best ? st.best.price : null, "sell")),
          el("div", { class: "v num" }, S(st.best ? st.best.price : null)),
          el("button", { class: "icon-btn", on: { click: () => aEditPrice(st.tid, loc, mode === "instant" ? "buy" : "sell", null, renderCraft, e.pieces) } }, "✎")),
      );
      const tbl = el("table", { class: "res num" });
      [
        ["Verzaubern kostet / Stk", S(st.upEach)],
        [`+ ${t(e.from)}-Item / Stk`, S(e.baseCost)],
        ["= Kosten / Stk", S(st.costEach), true],
        ["Erlös nach Steuer / Stk", S(st.saleNet)],
        ["Gewinn / Stk", pm(st.profitEach), true, cls(st.profitEach)],
        [`Gewinn gesamt (${S(e.pieces)} Stk)`, st.profitEach === null ? "–" : pm(st.profitEach * e.pieces), true, cls(st.profitEach)],
        [`Mehr als ${t(e.from)} direkt verkaufen`, st.extraEach === null ? "–" : pm(st.extraEach) + " / Stk", false, cls(st.extraEach)],
        [`… gesamt`, st.extraEach === null ? "–" : pm(st.extraEach * e.pieces), false, cls(st.extraEach)],
      ].forEach(([l, v, key, c]) => tbl.append(el("tr", { class: key ? "key" : "" }, el("td", {}, l), el("td", { class: c || "" }, v))));
      card.append(tbl);
      if (ways.length > 1) card.append(el("div", { class: "small", style: "margin-top:6px" },
        `Günstigster Weg zu ${t(st.l)}: `, el("b", { class: "gold" }, `${cheapest[0]} (${S(cheapest[1])}/Stk)`),
        el("div", { class: "small muted" }, ways.map((w) => `${w[0]} ${S(w[1])}`).join(" · "))));
      if (st.costEach !== null) card.append(el("button", { class: "btn block", style: "margin-top:8px",
        on: { click: () => { if (logCraft({ id: st.tid, pieces: e.pieces, cost: Math.round(st.costEach * e.pieces),
          expected: st.saleNet !== null ? Math.round(st.saleNet * e.pieces) : null, where: k.buy,
          price: st.best ? st.best.price : null, loc, mode })) renderBook && renderBook(); } } },
        `✔ ${S(e.pieces)} × auf ${t(st.l)} verzaubert – ins Buch`));
      box.append(card);
    }
    box.append(el("div", { class: "small muted", style: "margin-top:6px" },
      `„Mehr als direkt verkaufen“ vergleicht mit dem Verkauf deines ${t(e.from)}-Items zum Preis oben. Ist der Wert positiv, bringt das Verzaubern zusätzliches Silber.`));
  }

  // ------------------------------------------------------------ Verzauber-Scan
  const ES_GROUPS = ["Taschen & Umhänge", "Waffen", "Rüstung", "Nebenhand", "Sammlerausrüstung"];
  let esResult = null;
  function esDefaults() {
    if (!ui.esGroups) ui.esGroups = ["Taschen & Umhänge"];
    if (!ui.esTiers) ui.esTiers = [4, 5, 6];
    if (!ui.esSteps) ui.esSteps = [0];
    if (!ui.esRoute) ui.esRoute = "same";
    if (!ui.esSellMode) ui.esSellMode = "instant";
    if (ui.esVol === undefined) ui.esVol = 1;
    if (ui.esAge === undefined) ui.esAge = 6;
    if (ui.esMin === undefined) ui.esMin = 0;
  }
  function esBases() {
    return Object.keys(enchData.c).filter((b) => {
      const r = gd.recipes[b];
      return r && ui.esGroups.includes(r.group) && ui.esTiers.includes(r.tier);
    });
  }
  function esLocs() {
    const buy = ui.esRoute === "same" ? C.ROYAL_CITIES.concat(["Caerleon", "Brecilien"]) : C.CITIES;
    const sell = ui.esRoute === "bm" ? C.MARKETS : C.CITIES;
    return { buy, sell };
  }
  /** Bewertet alle gewählten Items: Item kaufen + Runen/Seelen/Relikte → höhere Stufe verkaufen. */
  function esEvaluate() {
    const age = Number(ui.esAge) || 6;
    const { buy, sell } = esLocs();
    const unit = (item, loc) => {
      const [p, src] = store.get(item, loc, "sell", age);
      return (p !== null && src !== "alt") || src === "manuell" ? C.buyUnitCost(settings, p, "instant") : null;
    };
    const out = [];
    for (const b of esBases()) {
      const r = gd.recipes[b], n = enchData.c[b];
      for (const from of ui.esSteps) {
        const to = from + 1;
        const src = enchId(b, from), dst = enchId(b, to), mat = `T${r.tier}_${ENCH_MAT[from]}`;
        let best = null;
        const consider = (bc, sellLocs) => {
          const ip = unit(src, bc), mp = unit(mat, bc);
          if (ip === null || mp === null) return;
          const sale = C.bestSale(store, settings, dst, sellLocs, ui.esSellMode, age);
          if (!sale) return;
          const cost = ip + n * mp, net = sale.price * (1 - C.sellFee(settings, sale.mode));
          const profit = net - cost;
          if (!best || profit > best.profit) best = { base: b, from, to, src, dst, mat, n, buyCity: bc, ip, mp, cost, sale, net, profit,
            margin: cost ? profit / cost * 100 : 0, vol: sale.info ? sale.info.per_day : null };
        };
        if (ui.esRoute === "same") for (const c of buy) consider(c, [c]);
        else for (const c of buy) consider(c, sell);
        if (best) out.push(best);
      }
    }
    return out.sort((a, b) => b.profit - a.profit);
  }
  async function esRun() {
    esDefaults();
    const bases = esBases();
    if (!bases.length || !ui.esSteps.length) { setStatus("Bitte mindestens eine Gruppe, ein Tier und einen Schritt wählen", true); return; }
    const { buy, sell } = esLocs();
    const ids = new Set(), mats = new Set();
    for (const b of bases) for (const f of ui.esSteps) {
      ids.add(enchId(b, f)); ids.add(enchId(b, f + 1)); mats.add(`T${gd.recipes[b].tier}_${ENCH_MAT[f]}`);
    }
    const locs = [...new Set(buy.concat(sell))];
    $("es-info").textContent = `${S(bases.length)} Items · ${ui.esSteps.length} Schritt(e) · ${locs.length} Märkte – lädt …`;
    await runJobs([[[...mats].concat([...ids]), locs]], async () => {
      // Verkaufszahlen nur für die besten Kandidaten nachladen
      const cand = esEvaluate().filter((x) => x.profit > 0).slice(0, 40);
      const hist = [...new Set(cand.map((x) => x.dst))];
      if (hist.length) await runJobs([[hist, [...new Set(cand.map((x) => x.sale.loc))], "history"]], () => esRender());
      else esRender();
    });
  }
  function esRender() {
    esDefaults();
    const box = $("es-list");
    if (!box) return;
    box.innerHTML = "";
    const all = esEvaluate();
    const minVol = Number(ui.esVol) || 0, minP = Number(ui.esMin) || 0;
    const list = all.filter((x) => x.profit > 0 && x.profit >= minP && (x.vol === null || x.vol === undefined || x.vol >= minVol)).slice(0, 40);
    if (!all.length) { $("es-info").textContent = "Noch keine Preise – „Verzauberungen scannen“ tippen."; return; }
    $("es-info").textContent = `${S(all.length)} Verzauberungen mit Preisen geprüft · ${list.length} lohnen sich` +
      (list.length ? ` · Gewinn pro Stück · antippen öffnet den Rechner` : " – im Moment nichts im Plus. Andere Tiers/Gruppen oder Weg „Black Market“ probieren.");
    for (const x of list) {
      const t = (l) => `T${gd.recipes[x.base].tier}.${l}`;
      const volTxt = x.vol === null || x.vol === undefined ? "Verkäufe/Tag ?" : `${C.fmtNum(x.vol, x.vol < 10 ? 1 : 0)} Verkäufe/Tag`;
      box.append(el("div", { class: "shop-item", style: "cursor:pointer;display:block",
        on: { click: () => { ui.eSrc = "buy"; ui.cBuy = x.buyCity; ui.cSell = x.sale.loc === x.buyCity ? C.SAME_CITY : x.sale.loc;
          ui.cSellMode = ui.esSellMode; ui.cBuyMode = "instant";
          if (!ui.cQty || Number(ui.cQty) < 1) ui.cQty = 1; saveUi(); selectCraft(x.src);
          setTimeout(() => { const c = $("c-ench"); c && c.scrollIntoView({ behavior: "smooth", block: "start" }); }, 400); } } },
        el("div", { class: "row", style: "justify-content:space-between;gap:8px" },
          el("b", {}, `${gd.name(x.base)} ${t(x.from)} → ${t(x.to)}`),
          el("b", { class: "pos num" }, `+${S(x.profit)}`)),
        el("div", { class: "small muted" },
          `Kauf ${x.buyCity} ${S(x.ip)} + ${S(x.n)} × ${gd.name(x.mat)} à ${S(x.mp)} = ${S(x.cost)}`),
        el("div", { class: "small" },
          `Verkauf ${x.sale.loc}${x.sale.mode === "instant" ? " sofort" : " per Auftrag"} ${S(x.sale.price)} · Marge ${C.fmtNum(x.margin)} % · ${volTxt}`),
      ));
    }
  }
  function esWire() {
    esDefaults();
    const chips = (id, values, key, label) => {
      const box = $(id); box.innerHTML = "";
      values.forEach((v) => box.append(el("button", { class: "chip" + (ui[key].includes(v) ? " on" : ""),
        on: { click: () => { const a = ui[key]; const i = a.indexOf(v); if (i >= 0) a.splice(i, 1); else a.push(v); saveUi(); esWire(); esRender(); } } }, label(v))));
    };
    chips("es-groups", ES_GROUPS, "esGroups", (v) => v);
    chips("es-tiers", [4, 5, 6, 7, 8], "esTiers", (v) => "T" + v);
    chips("es-steps", [0, 1, 2], "esSteps", (v) => `.${v} → .${v + 1} (${ENCH_WORD[v]})`);
    $("es-route").value = ui.esRoute; $("es-sellmode").value = ui.esSellMode;
    $("es-vol").value = ui.esVol; $("es-age").value = ui.esAge; $("es-min").value = ui.esMin;
  }

  // ------------------------------------------------------------ Profitabelste Tränke / Essen
  let abResult = null;
  function abVariants() {
    return Object.keys(gd.recipes).filter((id) => gd.recipes[id].cat === aCat() && gd.recipes[id].ench === 0)
      .flatMap((b) => aVariants(b));
  }
  function abEvaluate() {
    const out = [];
    for (const v of abVariants()) {
      const o = aOpts(v);
      const rec = gd.recipes[v];
      const pieces = Math.max(ui.aInput === "budget" ? 0 : aQty(), rec.amount);
      let plan;
      if (ui.aInput === "budget") {
        const pc = aPieces(v, o);
        if (!pc.pieces) continue;
        plan = C.cheapPlan(gd, store, settings, v, Math.max(pc.pieces, rec.amount), o);
      } else plan = C.cheapPlan(gd, store, settings, v, pieces, o);
      if (!plan.complete) continue;
      out.push({ id: v, plan, o, profit: plan.res.profit, each: plan.res.profit / plan.pieces, margin: plan.res.margin,
        vol: plan.best && plan.best.info ? plan.best.info.per_day : null, loc: plan.best ? plan.best.loc : o.sellLocs[0] });
    }
    return out.sort((a, b) => b.profit - a.profit);
  }
  function abRun() {
    const vs = abVariants();
    const bases = [...new Set(vs.map((v) => v.split("@")[0]))];
    const buy = new Set(), sell = new Set();
    vs.forEach((v) => { const o = aOpts(v); buy.add(o.buyCity); o.sellLocs.forEach((l) => sell.add(l)); });
    const items = alchItemsToLoad(vs);
    runJobs([[items, [...buy]], [vs, [...sell]]], async () => {
      const top = abEvaluate().filter((x) => x.profit > 0).slice(0, 30);
      const hist = [...new Set(top.map((x) => x.id))];
      if (hist.length) await runJobs([[hist, [...new Set(top.map((x) => x.loc))], "history"]], () => abRender());
      else abRender();
    });
    $("ab-list").innerHTML = `<div class="small muted" style="margin-top:6px">Prüfe ${vs.length} Sorten/Stufen aus ${bases.length} Rezepten …</div>`;
  }
  function abRender() {
    const box = $("ab-list");
    if (!box || !gd) return;
    const food = aCat() === "food";
    $("ab-title").textContent = food ? "🏆 Profitabelstes Essen" : "🏆 Profitabelste Tränke";
    if (document.activeElement !== $("ab-vol")) $("ab-vol").value = ui.abVol === undefined ? 5 : ui.abVol;
    box.innerHTML = "";
    const all = abEvaluate();
    if (!all.length) { box.append(el("div", { class: "small muted", style: "margin-top:6px" }, "Noch keine Preise – „🔍 Suchen“ tippen.")); return; }
    const minVol = ui.abVol === undefined ? 5 : Number(ui.abVol) || 0;
    const list = all.filter((x) => x.profit > 0 && (x.vol === null || x.vol === undefined || x.vol >= minVol)).slice(0, 15);
    const qtyTxt = ui.aInput === "budget" ? `Budget ${S(aBudget())} Silber` : `${S(aQty())} Stück`;
    box.append(el("div", { class: "small muted", style: "margin:6px 0 2px" },
      list.length ? `Top ${list.length} von ${all.length} geprüften · gerechnet für ${qtyTxt} · antippen = im Rechner öffnen` :
        `Von ${all.length} geprüften ist gerade nichts im Plus (mit mind. ${minVol} Verkäufen/Tag). Filter senken oder Städte im Rechner ändern.`));
    list.forEach((x, i) => {
      const volTxt = x.vol === null || x.vol === undefined ? "Verkäufe/Tag ?" : `${C.fmtNum(x.vol, x.vol < 10 ? 1 : 0)} Verkäufe/Tag`;
      const warn = x.vol !== null && x.vol !== undefined && x.plan.pieces > x.vol * 3;
      box.append(el("div", { class: "shop-item", style: "cursor:pointer;align-items:flex-start" },
        el("div", { class: "rank" }, String(i + 1)),
        el("div", { class: "t", on: { click: () => abOpen(x) } },
          el("div", { style: "font-weight:700" }, gd.label(x.id)),
          el("div", { class: "small muted" }, `${S(x.plan.pieces)} Stk · Einkauf ${S(x.plan.buyCost)} · Verkauf ${x.loc} ${S(x.plan.best ? x.plan.best.price : null)}`),
          el("div", { class: "small" + (warn ? " neg" : "") }, `${S(x.each)} pro Stück · Marge ${C.fmtNum(x.margin)} % · ${volTxt}` + (warn ? " · Menge evtl. zu groß für den Markt" : ""))),
        el("div", { style: "text-align:right", on: { click: () => abOpen(x) } },
          el("div", { class: "pos num", style: "font-weight:800" }, `+${S(x.profit)}`)),
        el("button", { class: "icon-btn", title: "Als Rezept speichern", on: { click: () => saveRecipe(projectFromAlch(x.id, x.o, x.plan)) } }, "📝")));
    });
  }
  function abOpen(x) {
    ui.aBase = x.id.split("@")[0]; ui.aEnch = gd.recipes[x.id].ench; saveUi();
    renderAlchSearch(); renderAlch();
    $("a-calc").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ------------------------------------------------------------ Buch-Auswertung
  function renderEval() {
    const ranges = [[7, "7 Tage"], [30, "30 Tage"], [0, "Alles"]];
    const rb = $("eval-range");
    rb.innerHTML = "";
    const cur = ui.evalRange === undefined ? 30 : ui.evalRange;
    ranges.forEach(([d, l]) => rb.append(el("button", { class: d === cur ? "on" : "", on: { click: () => { ui.evalRange = d; saveUi(); renderEval(); } } }, l)));
    const since = cur ? Date.now() - cur * 86400000 : 0;
    const per = {};
    let revenue = 0, costShare = 0;
    for (const e of book) {
      if (e.type !== "craft") continue;
      for (const sl of e.sales || []) {
        if (sl.at < since) continue;
        const cs = e.cost * sl.pieces / Math.max(1, e.pieces);
        const p = (per[e.label] = per[e.label] || { label: e.label, pieces: 0, revenue: 0, cost: 0, markets: new Set() });
        p.pieces += sl.pieces; p.revenue += sl.amount; p.cost += cs;
        if (sl.loc) p.markets.add(sl.loc);
        revenue += sl.amount; costShare += cs;
      }
    }
    const list = Object.values(per).map((p) => Object.assign(p, { profit: p.revenue - p.cost, margin: p.cost ? (p.revenue - p.cost) / p.cost * 100 : null }))
      .sort((a, b) => b.profit - a.profit);
    const t = $("eval-tiles");
    t.innerHTML = "";
    const prof = revenue - costShare;
    t.append(tile(S(prof), "echter Gewinn", prof > 0 ? "good" : prof < 0 ? "bad" : ""),
      tile(costShare ? C.fmtNum(prof / costShare * 100) + " %" : "–", "Ø Marge"),
      tile(S(revenue), "Umsatz (netto)"), tile(list.length ? list[0].label.replace(/ \(T.*\)$/, "") : "–", "bestes Item"));
    const box = $("eval-list");
    box.innerHTML = "";
    if (!list.length) { box.append(el("div", { class: "muted small" }, "Noch keine Verkäufe in diesem Zeitraum.")); return; }
    list.forEach((p, i) => box.append(el("div", { class: "shop-item" },
      el("div", { class: "t" }, el("div", { style: "font-weight:700" }, `${i + 1}. ${p.label}`),
        el("div", { class: "small muted" }, `${S(p.pieces)} Stk verkauft · Ø ${S(p.revenue / p.pieces)}/Stk · ${[...p.markets].join(", ") || "–"}`)),
      el("div", { style: "text-align:right" }, el("div", { class: "num " + (p.profit >= 0 ? "pos" : "neg"), style: "font-weight:800" }, S(p.profit)),
        el("div", { class: "small muted" }, p.margin === null ? "" : C.fmtNum(p.margin) + " %")))));
  }

  // ------------------------------------------------------------ Laufende Aufträge
  let orders = storage.get("orders", []);
  const saveOrders = () => storage.set("orders", orders);
  let orderDraft = null;
  function openOrder(draft) {
    fillItemList();
    orderDraft = Object.assign({ side: "buy", id: null, qty: "", price: "", loc: C.CITIES[0], bookUid: null, proj: null, mat: null }, draft || {});
    [...$("order-side").children].forEach((b) => b.classList.toggle("on", b.dataset.s === orderDraft.side));
    $("order-item").value = orderDraft.id ? gd.label(orderDraft.id) : "";
    $("order-qty").value = orderDraft.qty; $("order-price").value = orderDraft.price ? Math.round(orderDraft.price) : "";
    const sel = $("order-loc"); sel.innerHTML = "";
    C.MARKETS.forEach((m) => sel.append(el("option", { value: m, textContent: m })));
    sel.value = orderDraft.loc;
    orderInfo();
    $("order-sheet").classList.add("on"); document.body.style.overflow = "hidden";
  }
  function closeOrder() { $("order-sheet").classList.remove("on"); document.body.style.overflow = ""; }
  function orderInfo() {
    const q = Number($("order-qty").value) || 0, p = Number($("order-price").value) || 0;
    const side = [...$("order-side").children].find((b) => b.classList.contains("on")).dataset.s;
    $("order-info").textContent = side === "buy"
      ? `Gebundenes Silber: ${S(q * p * (1 + settings.setup_fee / 100))} (inkl. ${C.fmtNum(settings.setup_fee)} % Einstellgebühr)`
      : `Warenwert: ${S(q * p)} · nach Steuer und Gebühr ca. ${S(q * p * (1 - C.sellFee(settings, "order")))}`;
  }
  function saveOrder() {
    const id = idFromLabel($("order-item").value) || orderDraft.id;
    const qty = Math.floor(Number($("order-qty").value) || 0), price = Math.round(Number($("order-price").value) || 0);
    if (!id) { alert("Bitte ein Item aus der Liste auswählen."); return; }
    if (!qty || !price) { alert("Bitte Stück und Preis eingeben."); return; }
    const side = [...$("order-side").children].find((b) => b.classList.contains("on")).dataset.s;
    orders.push({ uid: uid(), side, id, qty, filled: 0, price, loc: $("order-loc").value, at: Date.now(), bookUid: orderDraft.bookUid || null,
      proj: orderDraft.proj || null, mat: orderDraft.mat || null });
    saveOrders(); closeOrder();
    if (orderDraft.proj) { renderShop(); note("📑 Kaufauftrag gespeichert – steht im Rezept unter dem Material"); }
    else if (ui.view === "shop") showListPane("orders");
    else setStatus(`📑 Auftrag gespeichert – zu finden unter Liste → Aufträge`);
  }
  /** Ausgeführte Menge verbuchen: Kauf -> Lager + Ausgabe, Verkauf -> Verkauf im Buch */
  function fillOrder(o, n) {
    n = Math.min(n, o.qty - o.filled);
    if (n <= 0) return;
    o.filled += n;
    const pj = o.proj && projects.find((x) => x.uid === o.proj);
    const pm = pj && pj.mats.find((x) => x.item === o.mat);
    if (o.side === "buy" && pm) {
      // gehört zu einem Rezept: dort abhaken (Ausgabe kommt beim „Fertig – ins Buch“)
      pm.got = (pm.got || 0) + n;
      pm.paid = (pm.paid || 0) + Math.round(n * o.price * (1 + settings.setup_fee / 100));
      if (pm.got >= pm.buy) pm.done = true;
      saveProjects(); saveOrders();
      return;
    }
    if (o.side === "buy") {
      const st = stock[o.id] || { qty: 0, value: o.price };
      st.value = st.qty ? (st.qty * st.value + n * o.price) / (st.qty + n) : o.price;
      st.qty += n; stock[o.id] = st; saveStock();
      book.push({ uid: uid(), type: "expense", note: `Kaufauftrag: ${S(n)} × ${gd.label(o.id)} (${o.loc})`, amount: Math.round(n * o.price * (1 + settings.setup_fee / 100)), at: Date.now() });
    } else {
      const amount = Math.round(n * o.price * (1 - C.sellFee(settings, "order")));
      const e = o.bookUid && book.find((b) => b.uid === o.bookUid);
      if (e) e.sales.push({ pieces: n, amount, unit: o.price, loc: o.loc, mode: "order", at: Date.now() });
      else book.push({ uid: uid(), type: "income", note: `Verkaufsauftrag: ${S(n)} × ${gd.label(o.id)} (${o.loc})`, amount, at: Date.now() });
    }
    saveBook(); saveOrders();
  }
  function orderFillAsk(o) {
    const rest = o.qty - o.filled;
    qpOpen({ title: `Ausgeführt: ${gd.label(o.id)}`, sub: `${o.loc} · Auftrag ${S(rest)} offen à ${S(o.price)} – wie viele hast du bekommen?`,
      qty: rest, qtyEdit: true, focusQty: true, unit: o.price,
      onSave: ({ qty, unit }) => { if (Math.round(unit) !== o.price) o.price = Math.round(unit); fillOrder(o, qty); refreshAll(); } });
  }
  function renderOrders() {
    const list = $("orders-list");
    list.innerHTML = "";
    let tiedBuy = 0, goods = 0, outbid = 0;
    const open = orders.filter((o) => o.filled < o.qty);
    for (const o of open) {
      const rest = o.qty - o.filled;
      let status = "", cls = "muted";
      if (o.side === "buy") {
        tiedBuy += rest * o.price * (1 + settings.setup_fee / 100);
        const [best, src] = store.get(o.id, o.loc, "buy");
        if (best && src !== "alt") { if (best > o.price) { status = `⚠ überboten – bestes Gebot ${S(best)}`; cls = "neg"; outbid++; } else { status = "✔ höchstes Gebot"; cls = "pos"; } }
      } else {
        goods += rest * o.price;
        const [low, src] = store.get(o.id, o.loc, "sell");
        if (low && src !== "alt") { if (low < o.price) { status = `⚠ unterboten – günstigstes Angebot ${S(low)}`; cls = "neg"; outbid++; } else { status = "✔ günstigstes Angebot"; cls = "pos"; } }
      }
      list.append(el("div", { class: "shop-item", style: "flex-wrap:wrap" },
        el("div", { class: "t" },
          el("div", { style: "font-weight:700" }, `${o.side === "buy" ? "🟢 Kauf" : "🔵 Verkauf"} · ${S(rest)} × ${gd.label(o.id)}`),
          el("div", { class: "small muted" }, `${o.loc} · ${S(o.price)}/Stk · ${o.filled ? S(o.filled) + " schon ausgeführt · " : ""}seit ${C.fmtAge(o.at / 1000)}`),
          (() => { const pj = o.proj && projects.find((x) => x.uid === o.proj); return pj ? el("div", { class: "small gold" }, `für Rezept: ${S(pj.pieces)} × ${gd.label(pj.id)}`) : null; })(),
          status ? el("div", { class: "small " + cls }, status) : el("div", { class: "small muted" }, "„Preise prüfen“ zeigt, ob du überboten wurdest")),
        el("div", { class: "row", style: "gap:6px;width:100%;justify-content:flex-end" },
          el("button", { class: "btn", on: { click: () => orderFillAsk(o) } }, "Ausgeführt"),
          el("button", { class: "icon-btn", title: "Preis ändern", on: { click: () => { const v = window.prompt("Neuer Preis pro Stück", String(o.price)); if (v === null) return; o.price = Math.round(Number(v.replace(/[.\s]/g, "")) || o.price); saveOrders(); renderOrders(); } } }, "✎"),
          el("button", { class: "icon-btn", title: "Zurückziehen", on: { click: () => { if (confirm("Auftrag zurückgezogen / löschen?")) { orders = orders.filter((x) => x !== o); saveOrders(); renderOrders(); } } } }, "✕"))));
    }
    if (!open.length) list.append(el("div", { class: "empty" }, "Keine offenen Aufträge. „+ Auftrag“ tippen – oder im Buch bei unverkaufter Ware „Als Verkaufsauftrag“."));
    const done = orders.filter((o) => o.filled >= o.qty).length;
    const t = $("orders-tiles"); t.innerHTML = "";
    t.append(tile(S(tiedBuy), "Silber in Kaufaufträgen"), tile(S(goods), "Warenwert in Verkaufsaufträgen"),
      tile(String(open.length), "offene Aufträge"), tile(String(outbid), "überboten/unterboten", outbid ? "bad" : open.length ? "good" : ""));
    if (done) t.append();
  }
  function checkOrders() {
    const byLoc = {};
    orders.filter((o) => o.filled < o.qty).forEach((o) => (byLoc[o.loc] = byLoc[o.loc] || new Set()).add(o.id));
    const jobs = Object.entries(byLoc).map(([loc, set]) => [[...set], [loc]]);
    if (jobs.length) runJobs(jobs, () => renderOrders());
  }

  function refreshAll() {
    render();
    if (ui.view === "alch") renderAlch();
    if (ui.view === "craft") renderCraft();
    if (ui.view === "shop") showListPane(ui.listPane || "shop");
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
    const hb = el("input", { type: "checkbox", checked: !!ui.hints, on: { change: () => { ui.hints = hb.checked; saveUi(); applyHints(); } } });
    g.prepend(el("label", { class: "toggle full" }, el("span", {}, "Erklärtexte anzeigen ", el("span", { class: "muted small" }, "(aus = aufgeräumte Ansicht)")), hb));
    $("app-version").textContent = VERSION;
  }
  function applyHints() { document.body.classList.toggle("no-hints", !ui.hints); }
  function saveSettings() { storage.set("settings", settings); render(); }

  // ------------------------------------------------------------ Navigation
  function show(view) {
    ui.view = view; saveUi();
    document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === "view-" + view));
    document.querySelectorAll("nav.tabs button").forEach((b) => b.classList.toggle("on", b.dataset.view === view));
    if (view === "shop") showListPane(ui.listPane || "shop");
    if (view === "craft") { renderCraftSearch(); renderCraft(); }
    if (view === "silver") renderSilver();
    if (view === "alch") { renderAlchSearch(); renderAlch(); abRender(); }
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
      if (n > 0) { addToShop([shopEntry(r, n)], "Refining"); }
    });

    // Liste / Buch
    [...$("list-tabs").children].forEach((b) => b.addEventListener("click", () => showListPane(b.dataset.p)));
    $("book-expense").addEventListener("click", () => addManual("expense"));
    $("book-income").addEventListener("click", () => addManual("income"));
    $("book-export").addEventListener("click", exportBook);
    $("sale-close").addEventListener("click", closeSale);
    $("order-close").addEventListener("click", closeOrder);
    $("order-save").addEventListener("click", saveOrder);
    [...$("order-side").children].forEach((b) => b.addEventListener("click", () => {
      [...$("order-side").children].forEach((x) => x.classList.toggle("on", x === b)); orderInfo();
    }));
    ["order-qty", "order-price"].forEach((id) => $(id).addEventListener("input", orderInfo));
    $("order-add").addEventListener("click", () => openOrder({}));
    $("orders-check").addEventListener("click", checkOrders);
    $("stock-search").addEventListener("change", () => {
      const id = idFromLabel($("stock-search").value);
      if (id) { $("stock-search").value = ""; editStock(id); }
    });
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
      if (logCraft({ id, pieces: plan.pieces, cost: plan.buyCost, expected: plan.complete ? plan.res.revenue : null,
        where: `${o.city} → ${plan.best ? plan.best.loc : o.sellLocs[0]}`,
        price: plan.best ? plan.best.price : null, loc: plan.best ? plan.best.loc : o.sellLocs[0], mode: plan.best ? plan.best.mode : o.sellMode })) {
        const used = {}; plan.buyList.forEach((b) => { if (b.fromStock) used[b.item] = b.fromStock; });
        consumeStock(used); renderAlch();
      }
    });
    $("c-done").addEventListener("click", () => {
      const k = craftCalc(); if (!k) return;
      if (logCraft({ id: ui.cItem, pieces: k.crafts * k.rec.amount, cost: k.buyCost, expected: k.res.complete ? k.res.revenue : null,
        where: `${k.city} → ${k.sellLoc}`, price: k.best ? k.best.price : null, loc: k.sellLoc, mode: k.mode })) {
        const used = {}; k.plan.forEach((pl) => { if (pl.fromStock) used[pl.id] = pl.fromStock; });
        consumeStock(used); renderCraft();
      }
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
      saveUi(); $("a-search").value = ""; renderAlchSearch(); renderAlch(); abRender();
    }));
    $("ab-run").addEventListener("click", abRun);
    $("ab-vol").addEventListener("change", (e) => { ui.abVol = Number(e.target.value) || 0; saveUi(); abRender(); });
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
    [[10000, "10 k"], [30000, "30 k"], [100000, "100 k"]].forEach(([v, l]) =>
      $("s-fquick").append(el("button", { on: { click: () => { ui.sFocus = v; $("s-focus").value = v; saveUi(); } } }, l)));
    const sb = $("s-budget");
    sb.addEventListener("input", () => { ui.sBudget = sb.value; saveUi(); });
    [[500000, "500 k"], [1000000, "1 Mio"], [5000000, "5 Mio"], [10000000, "10 Mio"], [0, "∞"]].forEach(([v, l]) =>
      $("s-quick").append(el("button", { on: { click: () => { ui.sBudget = v; sb.value = v; saveUi(); } } }, l)));
    const sbind = (id, key, num) => $(id).addEventListener("change", (e) => {
      ui[key] = e.target.type === "checkbox" ? e.target.checked : num ? Number(e.target.value) || 0 : e.target.value;
      saveUi(); renderSilverOpts();
    });
    sbind("s-focus", "sFocus", true); sbind("s-fce", "sFce", true); sbind("s-city", "sCity"); sbind("s-buymode", "sBuyMode");
    sbind("s-margin", "sMargin", true); sbind("s-days", "sDays", true); sbind("s-age", "sAge", true); sbind("s-chain", "sChain"); sbind("s-sellmode", "sSellMode"); sbind("s-share", "sShare", true); sbind("s-enchup", "sEnchUp");
    $("s-run").addEventListener("click", runSilver);
    $("s-shop").addEventListener("click", silverToShop);

    // Crafting
    let st = null;
    $("es-run").addEventListener("click", esRun);
    [["es-route", "esRoute"], ["es-sellmode", "esSellMode"], ["es-vol", "esVol"], ["es-age", "esAge"], ["es-min", "esMin"]].forEach(([id, key]) =>
      $(id).addEventListener("change", (e) => { ui[key] = e.target.type === "number" ? Number(e.target.value) || 0 : e.target.value; saveUi(); esRender(); }));
    [...$("a-fseg").children].forEach((b) => b.addEventListener("click", () => { ui.aFocus = b.dataset.f === "1"; saveUi(); renderAlch(); }));
    [...$("c-fseg").children].forEach((b) => b.addEventListener("click", () => { ui.cFocus = b.dataset.f === "1"; saveUi(); renderCraft(); }));
    $("a-self").addEventListener("change", (e) => { ui.aSelf = e.target.checked; saveUi(); renderAlch(); });
    $("a-myfocus").addEventListener("change", (e) => { ui.sFocus = Math.max(0, Number(e.target.value) || 0); saveUi(); renderAlch(); });
    $("c-myfocus").addEventListener("change", (e) => { ui.sFocus = Math.max(0, Number(e.target.value) || 0); saveUi(); renderCraft(); });
    $("c-browse").addEventListener("click", () => { cBrowse = true; renderCraftSearch(); $("c-search").focus(); });
    $("a-browse").addEventListener("click", () => { aBrowse = true; renderAlchSearch(); $("a-search").focus(); });
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
      saveRecipe(projectFromCraft(k));
    });
    $("a-save").addEventListener("click", () => {
      const id = aId(); if (!id) return;
      const o = aOpts(id);
      const pc = aPieces(id, o);
      const plan = C.cheapPlan(gd, store, settings, id, Math.max(pc.pieces, gd.recipes[id].amount), o);
      if (!plan.complete) { alert("Es fehlen noch Preise, deshalb kann der billigste Weg nicht berechnet werden.\nErst „⟳ Live-Preise laden“ tippen oder fehlende Preise mit ✎ eintragen."); return; }
      saveRecipe(projectFromAlch(id, o, plan));
    });

    $("shop-share").addEventListener("click", () => shareText("Rezepte", renderShop.lastText || ""));
    $("shop-clear").addEventListener("click", () => { if (projects.length && confirm("Alle gespeicherten Rezepte löschen?\n(Im Buch wird nichts eingetragen.)")) { projects = []; saveProjects(); renderShop(); } });

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
        $("toast-btn").onclick = () => {
          $("toast-text").textContent = "Lädt neu …";
          try { w.postMessage("skip"); } catch (e) { /* egal */ }
          // Falls der neue Service Worker nicht übernimmt: abmelden und frisch laden
          setTimeout(async () => {
            try { const regs = await navigator.serviceWorker.getRegistrations(); await Promise.all(regs.map((r) => r.unregister())); } catch (e) { /* egal */ }
            location.reload();
          }, 2500);
        };
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
    applyHints();
    wire(); qpWire();
    try {
      const [res, al, jr, en] = await Promise.all([fetch("data/recipes_all.json"), fetch("data/alchemy.json"), fetch("data/journals.json"), fetch("data/enchant.json")]);
      gd = new C.GameData(await res.json());
      alchData = await al.json();
      journals = await jr.json();
      enchData = await en.json();
      for (const [k, v] of Object.entries(enchData.names)) if (!gd.names[k]) gd.names[k] = v;
      for (const [k, v] of Object.entries(journals.names)) if (!gd.names[k]) gd.names[k] = v;
      for (const [k, v] of Object.entries(alchData.names)) if (!gd.names[k]) gd.names[k] = v;
    } catch (e) {
      setStatus("Rezeptdaten konnten nicht geladen werden: " + e.message, true);
      return;
    }
    if (shop.length) {  // alte Einkaufsliste in Rezepte umwandeln
      shop.filter((e) => gd.recipes[e.id]).forEach((e) => projects.push(projectFromEntry(e, "alte Einkaufsliste")));
      shop = []; saveShop(); saveProjects();
    }
    render();
    esWire(); esRender();
    show(ui.view || "silver");
    setStatus(hasPrices() ? "Gespeicherte Preise vorhanden · beim Suchen/Laden werden sie aktualisiert" : "Bereit – Preise werden beim Suchen geladen");
    registerSW();
  }
  start();
})();
