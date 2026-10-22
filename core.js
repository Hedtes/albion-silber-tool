/* Albion Silber Tool – Rechenkern (Web-Version)
 * 1:1 aus albion_core.py übertragen, damit PC- und Handy-Version gleich rechnen.
 */
(function (root) {
  "use strict";

  const API_HOST = "https://europe.albion-online-data.com";
  const ROYAL_CITIES = ["Bridgewatch", "Fort Sterling", "Lymhurst", "Martlock", "Thetford"];
  const CITIES = ROYAL_CITIES.concat(["Caerleon", "Brecilien"]);
  const BLACK_MARKET = "Black Market";
  const MARKETS = CITIES.concat([BLACK_MARKET]);
  const AUTO_CITY = "Auto (Bonusstadt)";
  const AUTO_MARKET = "Bester Markt (auto)";
  const SAME_CITY = "Wie Refining-Stadt";
  const REFINING_CATS = new Set(["ore", "wood", "hide", "fiber", "rock"]);
  const REFINE_TYPES = [
    ["ore", "Erz", "Barren"], ["wood", "Holz", "Planken"], ["fiber", "Fasern", "Stoff"],
    ["hide", "Häute", "Leder"], ["rock", "Stein", "Blöcke"],
  ];

  const DEFAULT_SETTINGS = {
    premium: true,
    quality: 1,
    max_age_hours: 24,
    manual_until_newer: true,
    history_days: 7,
    price_basis: "min", // "current" | "avg" | "min"
    base_bonus: 18.0,
    focus_bonus: 59.0,
    refining_city_bonus: 40.0,
    crafting_city_bonus: 15.0,
    sales_tax_premium: 4.0,
    sales_tax_normal: 8.0,
    setup_fee: 2.5,
    city_specs: {
      "Thetford": ["ore", "mace", "naturestaff", "firestaff", "leather_armor", "cloth_helmet"],
      "Fort Sterling": ["wood", "hammer", "spear", "holystaff", "plate_helmet", "cloth_armor"],
      "Lymhurst": ["fiber", "sword", "bow", "arcanestaff", "leather_helmet", "leather_shoes"],
      "Martlock": ["hide", "axe", "quarterstaff", "froststaff", "plate_shoes", "offhand"],
      "Bridgewatch": ["rock", "crossbow", "dagger", "cursestaff", "plate_armor", "cloth_shoes"],
      "Caerleon": ["knuckles", "gatherergear", "tools", "food"],
      "Brecilien": ["potion", "cape", "bag"],
    },
  };

  // ------------------------------------------------------------ Hilfen
  const now = () => Date.now() / 1000;

  function parseDate(s) {
    if (!s || s.startsWith("0001")) return null;
    const t = Date.parse(/Z$|[+-]\d\d:\d\d$/.test(s) ? s : s + "Z");
    return isNaN(t) ? null : t / 1000;
  }

  function ageHours(ts) {
    if (!ts) return null;
    return Math.max(0, (now() - ts) / 3600);
  }

  function fmtAge(ts) {
    const h = ageHours(ts);
    if (h === null) return "–";
    if (h < 1) return Math.floor(h * 60) + " min";
    if (h < 48) return Math.round(h) + " h";
    return Math.round(h / 24) + " T";
  }

  function fmtSilver(v) {
    if (v === null || v === undefined || isNaN(v)) return "–";
    const r = Math.round(v);
    const s = Math.abs(r).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    return (r < 0 ? "-" : "") + s;
  }

  function fmtNum(v, digits) {
    if (v === null || v === undefined || isNaN(v)) return "–";
    return v.toFixed(digits === undefined ? 1 : digits).replace(".", ",");
  }

  const ceilInt = (x) => Math.ceil(x - 1e-9);

  // ------------------------------------------------------------ Spieldaten
  class GameData {
    constructor(data) {
      if (data.r) { // kompaktes Format: [amount, focus, silver, res, cat, group, tier, ench]
        this.recipes = {};
        for (const [k, v] of Object.entries(data.r)) {
          this.recipes[k] = { amount: v[0], focus: v[1], silver: v[2], res: v[3], cat: v[4], group: v[5], tier: v[6], ench: v[7] };
        }
        this.names = data.n;
      } else {
        this.recipes = data.recipes;
        this.names = data.names;
      }
    }
    search(text, group) {
      const words = (text || "").toLowerCase().split(/\s+/).filter(Boolean);
      const out = [];
      for (const [id, r] of Object.entries(this.recipes)) {
        if (group && r.group !== group) continue;
        if (words.length) {
          const hay = (this.name(id) + " " + id + " t" + r.tier + "." + r.ench + " t" + r.tier).toLowerCase();
          if (!words.every((w) => hay.includes(w))) continue;
        }
        out.push(id);
      }
      out.sort((a, b) => this.name(a).localeCompare(this.name(b), "de") ||
        this.recipes[a].tier - this.recipes[b].tier || this.recipes[a].ench - this.recipes[b].ench);
      return out;
    }
    name(id) { return this.names[id] || id; }
    label(id) {
      const r = this.recipes[id];
      let tier = id[0] === "T" ? parseInt(id[1], 10) : 0;
      let ench = 0;
      if (id.includes("@")) ench = parseInt(id.split("@").pop(), 10) || 0;
      if (r) tier = r.tier || tier;
      const tag = tier ? "T" + tier + (ench ? "." + ench : "") : "";
      return tag ? `${this.name(id)} (${tag})` : this.name(id);
    }
  }

  // ------------------------------------------------------------ Rücklaufquote
  function bonusCityFor(settings, category) {
    for (const [city, cats] of Object.entries(settings.city_specs)) {
      if (cats.includes(category)) return city;
    }
    return null;
  }

  function productionBonus(settings, city, category, useFocus, daily) {
    let b = settings.base_bonus + (daily || 0);
    if ((settings.city_specs[city] || []).includes(category)) {
      b += REFINING_CATS.has(category) ? settings.refining_city_bonus : settings.crafting_city_bonus;
    }
    if (useFocus) b += settings.focus_bonus;
    return b;
  }

  const returnRate = (bonus) => 1 - 1 / (1 + bonus / 100);

  function focusCost(base, fce) {
    return base * Math.pow(0.5, Math.max(0, fce || 0) / 10000);
  }

  // ------------------------------------------------------------ Gebühren
  function salesTax(s) { return (s.premium ? s.sales_tax_premium : s.sales_tax_normal) / 100; }
  function sellFee(s, mode) { return salesTax(s) + (mode === "order" ? s.setup_fee / 100 : 0); }
  function buyUnitCost(s, price, mode) {
    if (price === null || price === undefined) return null;
    return mode === "order" ? price * (1 + s.setup_fee / 100) : price;
  }

  // ------------------------------------------------------------ Preise
  class PriceStore {
    /** storage: {get(key, fallback), set(key, value)} */
    constructor(settings, storage) {
      this.settings = settings;
      this.storage = storage;
      this.live = storage.get("live", {});        // "ITEM|Markt" -> {sell, sell_ts, buy, buy_ts}
      this.history = storage.get("history", {});  // "ITEM|Markt" -> {ts, days, data:[[tag, n, avg]]}
      this.manual = storage.get("manual", {});    // "ITEM|Markt|sell/buy" -> {p, ts}
      this.lastPruned = 0;
    }
    save() {
      this.storage.set("live", this.live);
      this.storage.set("history", this.history);
    }
    saveManual() { this.storage.set("manual", this.manual); }

    // ---- Abruf
    static batches(ids, limit) {
      const out = [];
      let cur = [], len = 0;
      for (const id of [...new Set(ids)].sort()) {
        const add = encodeURIComponent(id).length + 1;
        if (cur.length && len + add > limit) { out.push(cur); cur = []; len = 0; }
        cur.push(id); len += add;
      }
      if (cur.length) out.push(cur);
      return out;
    }

    async _run(endpoint, params, ids, ingest, limit, onProgress, signal) {
      const batches = PriceStore.batches(ids, limit);
      let errors = 0;
      for (let n = 0; n < batches.length; n++) {
        if (signal && signal.aborted) break;
        const b = batches[n];
        const url = `${API_HOST}/api/v2/stats/${endpoint}/` +
          b.map(encodeURIComponent).join(",").replace(/%40/g, "@") + ".json?" + new URLSearchParams(params);
        let data = null, lastErr = null;
        for (let attempt = 0; attempt < 3 && data === null; attempt++) {
          try {
            const res = await fetch(url, { signal });
            if (!res.ok) throw new Error("HTTP " + res.status);
            data = await res.json();
          } catch (e) {
            lastErr = e;
            if (signal && signal.aborted) break;
            await new Promise((r) => setTimeout(r, 1500 + attempt * 2500));
          }
        }
        if (data === null) { errors++; this.lastError = lastErr; } else ingest(data, b);
        if (onProgress) onProgress(n + 1, batches.length);
        if (n < batches.length - 1) await new Promise((r) => setTimeout(r, 400)); // API-Limit
      }
      return errors;
    }

    async fetchPrices(ids, locations, onProgress, signal) {
      const params = { locations: locations.join(","), qualities: this.settings.quality || 1 };
      const wanted = new Set(locations);
      const err = await this._run("prices", params, ids, (rows) => this._ingest(rows, wanted), 3500, onProgress, signal);
      this.save();
      this.lastPruned = this.pruneManual();
      return err;
    }

    _ingest(rows, wanted) {
      for (const r of rows) {
        const loc = r.city;
        if (!wanted.has(loc)) continue;
        const key = r.item_id + "|" + loc;
        const e = this.live[key] || {};
        const sd = parseDate(r.sell_price_min_date), bd = parseDate(r.buy_price_max_date);
        if (r.sell_price_min && sd) { e.sell = r.sell_price_min; e.sell_ts = sd; }
        if (r.buy_price_max && bd) { e.buy = r.buy_price_max; e.buy_ts = bd; }
        if (Object.keys(e).length) this.live[key] = e;
      }
    }

    async fetchHistory(ids, locations, onProgress, signal) {
      const days = this.settings.history_days || 7;
      const fresh = now() - 3 * 3600;
      ids = [...new Set(ids)].filter((i) => locations.some((l) => {
        const h = this.history[i + "|" + l];
        return !h || h.ts < fresh || h.days !== days;
      }));
      if (!ids.length) { if (onProgress) onProgress(1, 1); return 0; }
      const start = new Date((now() - (days + 1) * 86400) * 1000).toISOString().slice(0, 10);
      const params = { locations: locations.join(","), qualities: this.settings.quality || 1, "time-scale": 24, date: start };
      const wanted = new Set(locations);
      const err = await this._run("history", params, ids, (rows, b) => this._ingestHistory(rows, wanted, days, b),
        800, onProgress, signal);
      this.save();
      return err;
    }

    _ingestHistory(rows, wanted, days, batch) {
      const t = now(), cutoff = t - days * 86400;
      const got = {};
      for (const r of rows) {
        const loc = r.location || r.city;
        if (!wanted.has(loc)) continue;
        for (const d of r.data || []) {
          const ts = parseDate(d.timestamp);
          const cnt = d.item_count || 0, avg = d.avg_price || 0;
          if (!ts || ts < cutoff || cnt <= 0 || avg <= 0) continue;
          const k = r.item_id + "|" + loc;
          (got[k] = got[k] || {})[new Date(ts * 1000).toISOString().slice(0, 10)] = [cnt, avg];
        }
      }
      for (const [k, m] of Object.entries(got)) {
        this.history[k] = { ts: t, days, data: Object.keys(m).sort().map((d) => [d, m[d][0], m[d][1]]) };
      }
      for (const id of batch) for (const loc of wanted) {
        const k = id + "|" + loc;
        if (!got[k]) this.history[k] = { ts: t, days, data: [] };
      }
    }

    stats(id, loc) {
      const h = this.history[id + "|" + loc];
      if (!h) return null;
      const days = Math.max(1, h.days || 7);
      const sold = h.data.reduce((a, x) => a + x[1], 0);
      const avg = sold ? h.data.reduce((a, x) => a + x[1] * x[2], 0) / sold : null;
      return { per_day: sold / days, avg, sold, days, ts: h.ts };
    }

    // ---- Zugriff
    get(id, loc, kind, maxAge) {
      const e = this.live[id + "|" + loc];
      const m = this.manual[id + "|" + loc + "|" + kind];
      if (m) {
        const liveTs = (e && e[kind + "_ts"]) || 0;
        if (!(this.settings.manual_until_newer && liveTs > m.ts)) return [m.p, "manuell", m.ts];
      }
      if (!e || e[kind] === undefined) return [null, null, null];
      const ts = e[kind + "_ts"];
      if (maxAge === undefined || maxAge === null) maxAge = this.settings.max_age_hours;
      const h = ageHours(ts);
      return [e[kind], h !== null && h <= maxAge ? "live" : "alt", ts];
    }

    setManual(id, loc, kind, price) {
      const k = id + "|" + loc + "|" + kind;
      if (price === null || price === undefined) delete this.manual[k];
      else this.manual[k] = { p: Math.round(price), ts: now() };
      this.saveManual();
    }
    isManual(id, loc, kind) { return this.get(id, loc, kind)[1] === "manuell"; }
    clearManual() { this.manual = {}; this.saveManual(); }
    pruneManual() {
      if (!this.settings.manual_until_newer) return 0;
      let n = 0;
      for (const [k, m] of Object.entries(this.manual)) {
        const [id, loc, kind] = k.split("|");
        const e = this.live[id + "|" + loc];
        if (((e && e[kind + "_ts"]) || 0) > m.ts) { delete this.manual[k]; n++; }
      }
      if (n) this.saveManual();
      return n;
    }
  }

  // ------------------------------------------------------------ Verkauf
  function salePrice(store, s, id, loc, mode, maxAge) {
    const [p, src, ts] = store.get(id, loc, mode === "instant" ? "buy" : "sell", maxAge);
    const st = store.stats(id, loc);
    const info = { current: p && src !== "alt" ? p : null, avg: st ? st.avg : null, per_day: st ? st.per_day : null };
    if (src === "manuell") return [p, null, info];
    const cur = info.current, avg = info.avg;
    let price;
    if (mode === "instant" || s.price_basis === "current") price = cur;
    else if (s.price_basis === "avg") price = avg || cur;
    else {
      const vals = [cur, avg].filter((v) => v);
      price = vals.length ? Math.min(...vals) : null;
    }
    if (!price) return null;
    return [price, price === cur ? ts : null, info];
  }

  function bestSale(store, s, id, locations, sellMode, maxAge) {
    let best = null, bestNet = -1;
    for (const loc of locations) {
      const mode = loc === BLACK_MARKET ? "instant" : sellMode;
      const sp = salePrice(store, s, id, loc, mode, maxAge);
      if (!sp) continue;
      const net = sp[0] * (1 - sellFee(s, mode));
      if (net > bestNet) { best = { price: sp[0], loc, mode, ts: sp[1], info: sp[2] }; bestNet = net; }
    }
    return best;
  }

  const volumeOk = (perDay, minVol, hideUnknown) => (perDay === null || perDay === undefined) ? !hideUnknown : perDay >= minVol;

  // ------------------------------------------------------------ Crafting-Rechnung
  function calcCraft(recipe, crafts, rrr, ingPrices, sellPrice, fee, stationFee, useFocus) {
    let gross = 0, returnable = 0;
    const missing = [];
    for (const [id, cnt, ret] of recipe.res) {
      const p = ingPrices[id];
      if (p === null || p === undefined) { missing.push(id); continue; }
      const cost = p * cnt * crafts;
      gross += cost;
      if (ret) returnable += cost;
    }
    const returned = returnable * rrr;
    const netMat = gross - returned;
    const station = (stationFee || 0) * crafts + (recipe.silver || 0) * crafts;
    const produced = recipe.amount * crafts;
    const revenueGross = (sellPrice || 0) * produced;
    const feeAmt = revenueGross * fee;
    const revenue = revenueGross - feeAmt;
    const cost = netMat + station;
    const profit = revenue - cost;
    const focus = useFocus ? recipe.focus * crafts : 0;
    return {
      missing, produced, gross, returned, net_mat: netMat, station, revenue_gross: revenueGross,
      fee: feeAmt, revenue, cost, profit, profit_each: produced ? profit / produced : 0,
      margin: cost ? (profit / cost) * 100 : 0, focus, complete: !missing.length && !!sellPrice,
    };
  }

  // ------------------------------------------------------------ Refining
  function refineTable(gd, store, s, cat, opt) {
    // opt: {tiers, enchs, city, buyCity, buyMode, sellLoc, sellMode, daily, fce, chain, maxAge}
    const maxAge = opt.maxAge === undefined ? s.max_age_hours : opt.maxAge;
    const kind = opt.buyMode === "instant" ? "sell" : "buy";
    const memo = {};
    const cityFor = (rec) => (opt.city === AUTO_CITY ? (bonusCityFor(s, rec.cat) || opt.buyCity) : opt.city);
    const market = (item) => {
      const [p, src, ts] = store.get(item, opt.buyCity, kind, maxAge);
      return p && src !== "alt" ? [buyUnitCost(s, p, opt.buyMode), ts] : [null, null];
    };
    function ownCost(item, focus) {
      const key = item + "|" + focus;
      if (key in memo) return memo[key];
      memo[key] = null;
      const rec = gd.recipes[item];
      if (!rec || !REFINING_CATS.has(rec.cat)) return null;
      const rrr = returnRate(productionBonus(s, cityFor(rec), rec.cat, focus, opt.daily));
      let total = 0;
      for (const [rid, cnt, ret] of rec.res) {
        const u = unit(rid, focus);
        if (u === null) return null;
        total += u * cnt * (ret ? 1 - rrr : 1);
      }
      memo[key] = total / rec.amount;
      return memo[key];
    }
    function unit(item, focus) {
      const [mp] = market(item);
      if (opt.chain && gd.recipes[item]) {
        const oc = ownCost(item, focus);
        if (oc !== null && (mp === null || oc < mp)) return oc;
      }
      return mp;
    }

    const ids = Object.keys(gd.recipes).filter((i) => {
      const r = gd.recipes[i];
      return r.cat === cat && (!opt.tiers || !opt.tiers.length || opt.tiers.includes(r.tier)) &&
        (!opt.enchs || opt.enchs.includes(r.ench));
    }).sort((a, b) => gd.recipes[a].tier - gd.recipes[b].tier || gd.recipes[a].ench - gd.recipes[b].ench);
    const locs = opt.sellLoc === AUTO_MARKET ? MARKETS : [opt.sellLoc];
    const rows = [];
    for (const id of ids) {
      const rec = gd.recipes[id];
      const cCity = cityFor(rec);
      const [rawId, rawCnt] = rec.res[0];
      const prevId = rec.res.length > 1 ? rec.res[1][0] : null;
      const prevCnt = prevId ? rec.res[1][1] : 0;
      const [rawP, rawTs] = market(rawId);
      const [prevMp, prevTs] = prevId ? market(prevId) : [null, null];
      const best = bestSale(store, s, id, locs, opt.sellMode, maxAge);
      const row = {
        id, cat, tier: rec.tier, ench: rec.ench, city: cCity, buy_city: opt.buyCity,
        raw: rawId, raw_cnt: rawCnt, raw_price: rawP, prev: prevId, prev_cnt: prevCnt, prev_market: prevMp,
        sell_price: best ? best.price : null, sell_loc: best ? best.loc : null, sell_mode: best ? best.mode : null,
        per_day: best ? best.info.per_day : null, avg: best ? best.info.avg : null,
        focus: focusCost(rec.focus, opt.fce),
      };
      const tss = [rawTs, prevTs, best ? best.ts : null].filter((t) => t);
      row.ts = tss.length ? Math.min(...tss) : null;
      for (const [tag, focus] of [["nf", false], ["f", true]]) {
        const rrr = returnRate(productionBonus(s, cCity, cat, focus, opt.daily));
        const prevU = prevId ? unit(prevId, focus) : 0;
        row["rrr_" + tag] = rrr;
        row["prev_" + tag] = prevU;
        row["prev_self_" + tag] = !!(prevId && opt.chain && prevU !== null && (prevMp === null || prevU < prevMp));
        const prices = { [rawId]: rawP };
        if (prevId) prices[prevId] = prevU;
        if (best && rawP !== null && (!prevId || prevU !== null)) {
          const res = calcCraft(rec, 1, rrr, prices, best.price, sellFee(s, best.mode));
          row["cost_" + tag] = res.cost; row["profit_" + tag] = res.profit; row["margin_" + tag] = res.margin;
        } else {
          row["cost_" + tag] = row["profit_" + tag] = row["margin_" + tag] = null;
        }
      }
      row.spf = row.profit_f !== null && row.focus ? row.profit_f / row.focus : null;
      rows.push(row);
    }
    return rows;
  }

  // ------------------------------------------------------------ Einkaufsmengen
  /** Craftet in Runden so viel wie möglich und verwendet die Rückgabe weiter. -> [geschafft, Rest] */
  function simulate(buy, cnt, crafts, rrr) {
    let stock = buy, done = 0;
    while (done < crafts) {
      const k = Math.min(crafts - done, Math.floor(stock / cnt + 1e-9));
      if (k <= 0) break;
      // Das Spiel gibt nur ganze Stücke zurück → abrunden (sicher, nie zu wenig)
      stock = stock - k * cnt + Math.floor(k * cnt * rrr + 1e-9);
      done += k;
    }
    return [done, stock];
  }

  /** Kleinste Kaufmenge einer Zutat für `crafts` Crafts – am Ende bleibt (fast) nichts übrig. -> [kaufen, Rest] */
  function buyAmount(cnt, crafts, rrr, returnable) {
    crafts = Math.floor(crafts);
    if (crafts <= 0) return [0, 0];
    const total = cnt * crafts;
    if (returnable === false || rrr <= 0) return [total, 0];
    let lo = Math.max(cnt, Math.ceil(crafts * cnt * (1 - rrr) - 1e-9)), hi = total;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (simulate(mid, cnt, crafts, rrr)[0] >= crafts) hi = mid; else lo = mid + 1;
    }
    return [lo, simulate(lo, cnt, crafts, rrr)[1]];
  }

  /**
   * Echtes Craften im Spiel nachspielen: pro Runde so viele Crafts, wie die knappste Zutat erlaubt,
   * Rückgabe nur in ganzen Stücken (abgerundet). res = [[id, cnt, ret], …], buy = Mengen je Zutat.
   */
  function jointSim(res, buy, crafts, rrr) {
    const st = buy.slice();
    let done = 0, lim = -1;
    while (done < crafts) {
      let k = crafts - done;
      lim = -1;
      res.forEach(([, c], i) => { const can = Math.floor(st[i] / c + 1e-9); if (can < k) { k = can; lim = i; } });
      if (k <= 0) break;
      res.forEach(([, c, ret], i) => { st[i] -= k * c; if (ret && rrr > 0) st[i] += Math.floor(k * c * rrr - 1e-9); });
      done += k;
    }
    return { done, left: st, lim };
  }

  /** Kaufmengen für ALLE Zutaten zusammen, sodass im Spiel wirklich `crafts` Crafts klappen. */
  function jointBuy(res, crafts, rrr) {
    crafts = Math.floor(crafts);
    if (crafts <= 0) return res.map(() => 0);
    const buy = res.map(([, c, ret]) => buyAmount(c, crafts, rrr, !!ret)[0]);
    for (let guard = 0; guard < 5000; guard++) {
      const r = jointSim(res, buy, crafts, rrr);
      if (r.done >= crafts) return buy;
      const c = res[r.lim][1];
      buy[r.lim] += Math.max(1, c - r.left[r.lim]);   // genau so viel, dass eine Runde mehr geht
    }
    return res.map(([, c]) => c * crafts);
  }

  /**
   * Fokus aufteilen: so viele Crafts mit Fokus, wie dein verfügbarer Fokus reicht (o.focusAvail), den Rest ohne.
   * o.focusAvail null/undefined = unbegrenzt.
   */
  function focusSplit(s, rec, crafts, o) {
    const rrrF = returnRate(productionBonus(s, o.city, rec.cat, true, o.daily));
    const rrrN = returnRate(productionBonus(s, o.city, rec.cat, false, o.daily));
    const fpc = Math.max(1, focusCost(rec.focus || 0, o.fce || 0));
    let cf = o.focus ? crafts : 0;
    if (o.focus && o.focusAvail !== null && o.focusAvail !== undefined) cf = Math.min(crafts, Math.max(0, Math.floor(o.focusAvail / fpc)));
    const cn = crafts - cf;
    return { crafts, cf, cn, fpc, rrrF, rrrN, rrr: crafts ? (cf * rrrF + cn * rrrN) / crafts : rrrN };
  }
  /** Einkauf für den Fokus-Teil + den Rest ohne Fokus (im Spiel: erst mit Fokus craften, dann ohne). */
  function splitBuy(res, fs) {
    const a = jointBuy(res, fs.cf, fs.rrrF), b = jointBuy(res, fs.cn, fs.rrrN);
    const buy = res.map((_, i) => (a[i] || 0) + (b[i] || 0));
    if (!fs.cf || !fs.cn) return buy;
    // wie im Spiel nachspielen: erst die Fokus-Crafts, dann der Rest – fehlt etwas, genau das nachlegen
    for (let guard = 0; guard < 5000; guard++) {
      const r1 = jointSim(res, buy, fs.cf, fs.rrrF);
      if (r1.done < fs.cf) { buy[r1.lim] += Math.max(1, res[r1.lim][1] - r1.left[r1.lim]); continue; }
      const r2 = jointSim(res, r1.left, fs.cn, fs.rrrN);
      if (r2.done >= fs.cn) return buy;
      buy[r2.lim] += Math.max(1, res[r2.lim][1] - r2.left[r2.lim]);
    }
    return buy;
  }

  /**
   * Kette: Lohnt es sich, eine Zutat (Barren, Planken, Leder, Stoff, Blöcke) vorher selbst zu refinen?
   * Rekursiv bis zum Rohstoff, mit echten Kaufmengen (ganze Rückgabe). o: {city, refineCity, buyCity, buyMode, maxAge, daily}
   * -> {item, qty, market (Stückpreis), cost (günstigster Weg gesamt), self, ownCost, saving, steps:[…], buy:{id:qty}, city, rrr}
   */
  function refineChain(gd, store, s, item, qty, o, depth) {
    depth = depth || 0;
    const kind = o.buyMode === "instant" ? "sell" : "buy";
    const [p, src] = store.get(item, o.buyCity, kind, o.maxAge);
    const market = p && (src !== "alt" || src === "manuell") ? buyUnitCost(s, p, o.buyMode) : null;
    const r = gd.recipes[item];
    const out = { item, qty, market, cost: market !== null ? market * qty : null, self: false, ownCost: null, saving: null, steps: [], buy: { [item]: qty } };
    if (!r || !REFINING_CATS.has(r.cat) || depth > 8 || qty <= 0) return out;
    const city = o.refineCity || o.city;
    const rrr = returnRate(productionBonus(s, city, r.cat, false, o.daily || 0));
    const crafts = Math.ceil(qty / r.amount);
    const jb = jointBuy(r.res, crafts, rrr);
    const subs = r.res.map(([rid], i) => refineChain(gd, store, s, rid, jb[i], o, depth + 1));
    if (subs.some((x) => x.cost === null)) return out;
    const ownCost = subs.reduce((a, x) => a + x.cost, 0) + (r.silver || 0) * crafts;
    out.ownCost = ownCost; out.city = city; out.rrr = rrr;
    out.saving = market !== null ? market * qty - ownCost : null;
    if (market === null || ownCost < market * qty) {
      out.self = true; out.cost = ownCost; out.buy = {};
      subs.forEach((x) => { for (const [k, v] of Object.entries(x.buy)) out.buy[k] = (out.buy[k] || 0) + v; out.steps.push(...x.steps); });
      out.steps.push({ item, crafts, out: crafts * r.amount, city, rrr, from: r.res.map(([rid], i) => [rid, jb[i]]), kind: "refine", depth });
    }
    return out;
  }

  /** Pro Zutat: was du kaufen musst, damit am Ende (fast) nichts übrig bleibt. */
  function buyPlan(recipe, crafts, rrr) {
    const buys = jointBuy(recipe.res, crafts, rrr);
    const sim = jointSim(recipe.res, buys, Math.floor(crafts), rrr);
    return recipe.res.map(([id, cnt, ret], i) => ({ id, cnt, full: cnt * crafts, buy: buys[i], rest: sim.left[i], ret: !!ret }));
  }

  /** Wie viele Crafts für `pieces` Stück (z. B. Tränke: 5 Stück pro Craft). */
  function craftsFor(recipe, pieces) {
    const amt = Math.max(1, recipe.amount || 1);
    return pieces > 0 ? Math.ceil(pieces / amt) : 0;
  }

  /** Einkaufsmengen und Kosten für n Refines (Rückgabe wird weiterverwendet). */
  function needs(r, n, focus) {
    const rrr = r[focus ? "rrr_f" : "rrr_nf"];
    const jb = jointBuy(r.prev ? [["raw", r.raw_cnt, 1], ["prev", r.prev_cnt, 1]] : [["raw", r.raw_cnt, 1]], n, rrr);
    const raw = jb[0];
    const prev = r.prev ? jb[1] : 0;
    const pu = r[focus ? "prev_f" : "prev_nf"];
    let cost = null;
    if (r.raw_price !== null && (!r.prev || pu !== null)) cost = raw * r.raw_price + (r.prev ? prev * pu : 0);
    const profit = r[focus ? "profit_f" : "profit_nf"];
    return { raw, prev, cost, profit: profit !== null ? n * profit : null, focus: focus ? n * r.focus : 0 };
  }

  /** Wie viele Refines schafft man mit rawHave Rohstoffen? */
  function refineAmount(r, rawHave, focus) {
    const rrr = r[focus ? "rrr_f" : "rrr_nf"];
    const per = r.raw_cnt * (1 - rrr);
    return per > 0 ? Math.floor(rawHave / per) : 0;
  }

  /** Vollständige Aufstellung für den Detail-Rechner. */
  function refineDetail(gd, s, r, n, focus) {
    const rec = gd.recipes[r.id];
    const rrr = r[focus ? "rrr_f" : "rrr_nf"];
    const nd = needs(r, n, focus);
    const prices = { [r.raw]: r.raw_price };
    if (r.prev) prices[r.prev] = r[focus ? "prev_f" : "prev_nf"];
    const res = calcCraft(rec, n, rrr, prices, r.sell_price, sellFee(s, r.sell_mode || "order"));
    const ok = res.complete && n > 0;
    return {
      n, rrr, raw_buy: nd.raw, prev_buy: r.prev ? nd.prev : null, cost_buy: nd.cost,
      gross: res.missing.length ? null : res.gross, returned: res.missing.length ? null : res.returned,
      revenue_gross: r.sell_price ? res.revenue_gross : null, fee: r.sell_price ? res.fee : null,
      profit: ok ? res.profit : null, profit_each: ok ? res.profit / n : null, margin: ok ? res.margin : null,
      focus: focus ? n * r.focus : null, spf: ok && focus && r.focus ? res.profit / (n * r.focus) : null,
    };
  }

  // ------------------------------------------------------------ Silber-Finder
  /**
   * Bewertet einen Craft/Refine in einer Stadt.
   * o: {city, buyCity, buyMode, sellLocs, sellMode, focus, daily, chain, maxAge, fce, memo}
   * -> null, wenn Preise fehlen. Preise gelten pro Craft.
   */
  function evalCraft(gd, store, s, id, o) {
    const rec = gd.recipes[id];
    if (!rec) return null;
    const kind = o.buyMode === "instant" ? "sell" : "buy";
    const memo = o.memo || (o.memo = {});
    const market = (item) => {
      const key = "m|" + item + "|" + o.buyCity + "|" + kind;
      if (key in memo) return memo[key];
      const [p, src] = store.get(item, o.buyCity, kind, o.maxAge);
      return (memo[key] = p && (src !== "alt") ? buyUnitCost(s, p, o.buyMode) : null);
    };
    // Selbstkosten, wenn man eine Zutat selbst refined (nur Refining, ohne Fokus = vorsichtig)
    const own = (item, depth) => {
      const key = "o|" + item + "|" + o.city + "|" + o.buyCity + "|" + kind + "|" + (o.daily || 0);
      if (key in memo) return memo[key];
      memo[key] = null;
      const r = gd.recipes[item];
      if (!r || !REFINING_CATS.has(r.cat) || depth > 8) return null;
      const rr = returnRate(productionBonus(s, o.city, r.cat, false, o.daily));
      let t = 0;
      for (const [rid, cnt, ret] of r.res) {
        const u = unit(rid, depth + 1);
        if (u === null) return null;
        t += u.price * cnt * (ret ? 1 - rr : 1);
      }
      return (memo[key] = t / r.amount);
    };
    const unit = (item, depth) => {
      const mp = market(item);
      if (o.chain && gd.recipes[item] && REFINING_CATS.has(gd.recipes[item].cat)) {
        const oc = own(item, depth || 0);
        if (oc !== null && (mp === null || oc < mp)) return { price: oc, self: true };
      }
      return mp === null ? null : { price: mp, self: false };
    };
    const prices = {}, selfMade = [];
    for (const [rid] of rec.res) {
      const u = unit(rid, 0);
      if (u === null) return null;
      prices[rid] = u.price;
      if (u.self) selfMade.push(rid);
    }
    const best = bestSale(store, s, id, o.sellLocs, o.sellMode, o.maxAge);
    if (!best) return null;
    const rrr = returnRate(productionBonus(s, o.city, rec.cat, o.focus, o.daily));
    const res = calcCraft(rec, 1, rrr, prices, best.price, sellFee(s, best.mode));
    return {
      id, rec, city: o.city, buyCity: o.buyCity, buyMode: o.buyMode, focus: !!o.focus, rrr, prices, selfMade,
      sellLoc: best.loc, sellMode: best.mode, sellPrice: best.price, per_day: best.info.per_day,
      profit: res.profit, cost: res.cost, margin: res.margin, revenue: res.revenue,
      focusCost: o.focus ? focusCost(rec.focus, o.fce) : 0,
    };
  }

  /** Einkaufskosten (Silber, das man vorab braucht) für n Crafts. */
  function upfrontCost(ev, n) {
    let t = 0;
    const jb = jointBuy(ev.rec.res, n, ev.rrr);
    ev.rec.res.forEach(([rid], i) => { t += jb[i] * ev.prices[rid]; });
    return t;
  }

  /**
   * Verteilt Budget und Fokus auf die besten Gelegenheiten.
   * items: [{nf: ev|null, f: ev|null}] – pro Item die beste Variante ohne/mit Fokus.
   * cap: max. Stück pro Item (z. B. Verkäufe/Tag × Tage).
   */
  function planSilver(items, opt) {
    let budget = opt.budget > 0 ? opt.budget : Infinity;
    let focusLeft = opt.focus || 0;
    const plan = [];
    const usedCrafts = {};
    const capCrafts = (ev) => {
      const pieces = ev.per_day === null || ev.per_day === undefined
        ? (opt.unknownCap || 0) : Math.floor(ev.per_day * opt.days * (opt.share === undefined ? 1 : opt.share));
      return Math.min(opt.maxCrafts || 1e9, Math.floor(pieces / ev.rec.amount)) - (usedCrafts[ev.id] || 0);
    };
    const take = (ev) => {
      let n = capCrafts(ev);
      if (ev.focus && ev.focusCost > 0) n = Math.min(n, Math.floor(focusLeft / ev.focusCost));
      const per = Math.max(1e-9, ev.cost);
      if (budget !== Infinity) n = Math.min(n, Math.floor(budget / per));
      while (n > 0 && budget !== Infinity && upfrontCost(ev, n) > budget) n = Math.floor(n * 0.97);
      if (n <= 0) return false;
      const cost = upfrontCost(ev, n);
      budget -= cost;
      if (ev.focus) focusLeft -= n * ev.focusCost;
      plan.push({ ev, crafts: n, pieces: n * ev.rec.amount, cost, profit: n * ev.profit, focus: ev.focus ? n * ev.focusCost : 0 });
      usedCrafts[ev.id] = (usedCrafts[ev.id] || 0) + n;
      return true;
    };
    // 1) Fokus dorthin, wo er am meisten zusätzliches Silber bringt
    if (focusLeft > 0) {
      const fc = items.filter((x) => x.f && x.f.profit > 0 && x.f.focusCost > 0)
        .map((x) => ({ x, gain: (x.f.profit - Math.max(0, x.nf ? x.nf.profit : 0)) / x.f.focusCost }))
        .filter((y) => y.gain > 0).sort((a, b) => b.gain - a.gain);
      for (const { x } of fc) { if (focusLeft < x.f.focusCost) continue; take(x.f); }
    }
    // 2) Rest ohne Fokus nach Rendite (Gewinn je eingesetztem Silber)
    const nc = items.filter((x) => x.nf && x.nf.profit > 0)
      .sort((a, b) => b.nf.profit / Math.max(1, b.nf.cost) - a.nf.profit / Math.max(1, a.nf.cost));
    for (const x of nc) { if (budget <= 0) break; take(x.nf); }
    plan.sort((a, b) => b.profit - a.profit);
    return { plan, budgetLeft: budget, focusLeft };
  }

  // ------------------------------------------------------------ Günstigster Weg (Tränke & Essen)
  /**
   * Findet für jede Zutat den billigsten Weg: kaufen, selbst herstellen (z. B. Extrakt aus Überresten)
   * oder umwandeln (Tierteile schreddern, Fisch zerkleinern). Rekursiv, mit Rücklaufquote.
   * ctx: {city, buyCity, buyMode, maxAge, alts}
   */
  function makeSolver(gd, store, s, ctx) {
    const kind = ctx.buyMode === "instant" ? "sell" : "buy";
    const memo = {};
    const stock = ctx.stock || {}, override = ctx.override || {};
    /** echter Marktpreis (ohne Lager) */
    const realMarket = (item) => {
      const [p, src, ts] = store.get(item, ctx.buyCity, kind, ctx.maxAge);
      return p && src !== "alt" ? { price: buyUnitCost(s, p, ctx.buyMode), src, ts } : null;
    };
    /** Preis für die Wegsuche: Mischpreis (2. Durchlauf) > Lagerwert > Markt */
    const market = (item) => {
      if (override[item] !== undefined && override[item] !== null) return { price: override[item], src: "mix", ts: null };
      const m = realMarket(item);
      const st = stock[item];
      if (st && st.qty > 0 && (!m || st.value < m.price)) return { price: st.value, src: "lager", ts: null };
      return m;
    };
    const altsOf = (item) => {
      if (ctx.buyOnly) return [];   // Schalter „Zwischenprodukte selbst herstellen“ aus: alles kaufen
      const list = (ctx.alts[item] || []).map((a) => Object.assign({ cat: null }, a));
      const r = gd.recipes[item];
      if (r && (r.cat === "food" || r.cat === "potion") && r.ench === 0 && !list.length) list.push({ amount: r.amount, res: r.res, cat: r.cat });
      return list;
    };
    function cheapest(item, depth) {
      if (memo[item]) return memo[item];
      memo[item] = { item, unit: null, how: "none", market: null }; // Schutz gegen Schleifen
      const m = market(item);
      let best = m ? { item, unit: m.price, how: "buy", market: m.price, src: m.src, ts: m.ts } : null;
      if ((depth || 0) < 5) {
        for (const alt of altsOf(item)) {
          // Umwandlungen (Fisch zerkleinern, Fischsauce, Tierteile schreddern, Extrakt) geben im Spiel nichts zurück: 0 %
          const rrr = alt.cat ? returnRate(productionBonus(s, ctx.city, alt.cat, false, 0)) : 0;
          let total = 0, ok = true;
          const children = [];
          for (const [rid, cnt, ret] of alt.res) {
            const c = cheapest(rid, (depth || 0) + 1);
            if (c.unit === null) { ok = false; break; }
            total += c.unit * cnt * (ret ? 1 - rrr : 1);
            children.push(c);
          }
          if (!ok) continue;
          const unit = total / alt.amount;
          if (!best || unit < best.unit - 1e-9) best = { item, unit, how: "craft", alt, rrr, children, market: m ? m.price : null };
        }
      }
      return (memo[item] = best || { item, unit: null, how: "none", market: m ? m.price : null });
    }
    /** Mengen entlang des billigsten Wegs auflösen. out = {buy:{id:qty}, steps:[]} */
    function expand(node, qty, out, depth) {
      if (qty <= 0 || !node) return;
      if (node.how !== "craft") { out.buy[node.item] = (out.buy[node.item] || 0) + qty; return; }
      const crafts = Math.ceil(qty / node.alt.amount);
      out.steps.push({ item: node.item, qty, crafts, out: crafts * node.alt.amount, alt: node.alt, depth: depth || 0 });
      const jb = jointBuy(node.alt.res, crafts, node.rrr);
      node.alt.res.forEach(([rid, cnt, ret], i) => {
        expand(node.children[i], jb[i], out, (depth || 0) + 1);
      });
    }
    return { cheapest, expand, market, realMarket };
  }

  /**
   * Kompletter Plan für ein Produkt (Trank/Essen) mit Stückzahl.
   * o.stock = {item: {qty, value}}: Lagerbestand wird zuerst verbraucht (mit seinem Wert, z. B. 0 bei selbst gesammelt).
   */
  function cheapPlan(gd, store, s, id, pieces, o) {
    const rec = gd.recipes[id];
    if (!rec) return null;
    const stock = o.stock || {};
    const crafts = craftsFor(rec, pieces);
    const fs = focusSplit(s, rec, crafts, o);
    const rrr = fs.rrr;
    const best = bestSale(store, s, id, o.sellLocs, o.sellMode, o.maxAge);

    function run(override) {
      const solver = makeSolver(gd, store, s, Object.assign({}, o, { stock, override }));
      const jb = splitBuy(rec.res, fs);
      const ings = rec.res.map(([rid, cnt, ret], i) => {
        const node = solver.cheapest(rid, 0);
        const qty = jb[i];
        return { id: rid, cnt, ret: !!ret, node, qty, full: cnt * crafts };
      });
      const complete = ings.every((x) => x.node.unit !== null);
      const out = { buy: {}, steps: [] };
      if (complete) ings.forEach((x) => solver.expand(x.node, x.qty, out, 0));
      return { solver, ings, complete, out };
    }

    // 1. Durchlauf: Weg finden (Lager zählt mit seinem Wert)
    let r1 = run({});
    // Mischpreise für Blätter: erst Lager, Rest zum Marktpreis
    const override = {};
    let usesStock = false;
    for (const [item, qty] of Object.entries(r1.out.buy)) {
      const st = stock[item];
      if (!st || st.qty <= 0) continue;
      usesStock = true;
      const from = Math.min(qty, st.qty), rest = qty - from;
      const m = r1.solver.realMarket(item);
      override[item] = rest > 0 ? (m ? (from * st.value + rest * m.price) / qty : null) : st.value;
    }
    const r = usesStock ? run(override) : r1;
    const prices = {};
    r.ings.forEach((x) => { prices[x.id] = x.node.unit; });
    const res = calcCraft(rec, crafts, rrr, prices, best ? best.price : null, sellFee(s, best ? best.mode : o.sellMode), o.station || 0, o.focus);

    let buyCost = r.complete ? 0 : null, stockValue = 0;
    const buyList = Object.entries(r.out.buy).map(([item, qty]) => {
      const st = stock[item];
      const fromStock = st && st.qty > 0 ? Math.min(qty, st.qty) : 0;
      const buy = qty - fromStock;
      const m = r.solver.realMarket(item);
      const cost = buy > 0 ? (m ? buy * m.price : null) : 0;
      if (cost === null) buyCost = null; else if (buyCost !== null) buyCost += cost;
      stockValue += fromStock * (st ? st.value : 0);
      return { item, qty, fromStock, buy, price: m ? m.price : null, cost, stockUnit: st ? st.value : null };
    }).sort((a, b) => (b.cost || 0) - (a.cost || 0));
    // Ersparnis gegenüber "alles direkt kaufen"
    let directCost = 0, directOk = true;
    r.ings.forEach((x) => { const m = r.solver.realMarket(x.id); if (!m) directOk = false; else directCost += m.price * x.qty; });
    return {
      id, rec, crafts, pieces: crafts * rec.amount, rrr, ings: r.ings, res, best, complete: r.complete && !!best,
      buyList, steps: r.out.steps, buyCost, stockValue, directCost: directOk ? directCost : null, solver: r.solver,
      unitCost: r.complete ? res.cost / (crafts * rec.amount) : null,
      focusNeed: fs.cf * fs.fpc, focusFull: o.focus ? crafts * fs.fpc : 0, focusCrafts: fs.cf, rrrF: fs.rrrF, rrrN: fs.rrrN,
      // Wie viele Crafts gehen mit diesem Einkauf OHNE Fokus? (Warnung, falls Fokus fehlt)
      noFocusCrafts: fs.cf ? jointSim(rec.res, r.ings.map((x) => x.qty), crafts, fs.rrrN).done : crafts,
    };
  }

  const Core = {
    API_HOST, ROYAL_CITIES, CITIES, BLACK_MARKET, MARKETS, AUTO_CITY, AUTO_MARKET, SAME_CITY,
    REFINING_CATS, REFINE_TYPES, DEFAULT_SETTINGS,
    parseDate, ageHours, fmtAge, fmtSilver, fmtNum, ceilInt,
    GameData, PriceStore, bonusCityFor, productionBonus, returnRate, focusCost,
    salesTax, sellFee, buyUnitCost, salePrice, bestSale, volumeOk, calcCraft,
    refineTable, needs, refineAmount, refineDetail, simulate, buyAmount, jointSim, jointBuy, focusSplit, splitBuy, refineChain, buyPlan, craftsFor,
    evalCraft, upfrontCost, planSilver, makeSolver, cheapPlan,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = Core;
  else root.Core = Core;
})(typeof window !== "undefined" ? window : globalThis);
