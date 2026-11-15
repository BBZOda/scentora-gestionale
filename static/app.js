"use strict";

const root = document.querySelector("#app");
const dialog = document.querySelector("#dialog");
const notifications = document.querySelector("#notifications");
const sections = {
  dashboard: ["Panoramica", "home"],
  analysis: ["Analisi Costo", "list"],
  articles: ["Articoli di base", "box"],
  perfumes: ["Profumi", "bottle"],
  movements: ["Produzione", "clock"],
  customers: ["Clienti", "users"],
  suppliers: ["Fornitori", "box"],
  receipts: ["Incassi", "wallet"],
  purchases: ["Acquisto Articoli", "wallet"],
  units: ["Elenchi", "list"],
  equivalents: ["Tabella Equivalenze", "list"],
  documents: ["Documenti acquisto", "list"],
  equipment: ["Attrezzi per Produzione", "box"],
  users: ["Utenti", "users"],
  archives: ["Gestione Archivi", "box"],
};
const paths = {
  home: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  box: '<path d="m3 7 9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10M7.5 5l9 4"/>',
  bottle: '<path d="M9 3h6v5H9zM8 8h8l3 4v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7zM5 13h14"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l4 2"/>',
  list: '<path d="M9 6h12M9 12h12M9 18h12M3 6h2M3 12h2M3 18h2"/>',
  users: '<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2m1-15a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 5v1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  arrow: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  logout: '<path d="M11 4H5v16h6m4-12 4 4-4 4m4-4H9"/>',
  wallet: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18m-5 5h2"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
const mark = '<svg viewBox="0 0 40 40" fill="none" aria-hidden="true"><path d="M20 4c0 9 7 16 16 16-9 0-16 7-16 16 0-9-7-16-16-16 9 0 16-7 16-16Z" stroke="currentColor"/><path d="M20 11c0 5 4 9 9 9-5 0-9 4-9 9 0-5-4-9-9-9 5 0 9-4 9-9Z" stroke="currentColor"/></svg>';
const escape = value => String(value ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
const scale = 1e6;
const cent = scale / 100;
const purchaseDivisor = BigInt(scale) * BigInt(cent);
const number = new Intl.NumberFormat("it-IT", {useGrouping:"always", maximumFractionDigits:6});
const money = new Intl.NumberFormat("it-IT", {style:"currency", currency:"EUR", useGrouping:"always", maximumFractionDigits:6});
const saleMoney = new Intl.NumberFormat("it-IT", {style:"currency", currency:"EUR", useGrouping:"always", minimumFractionDigits:2, maximumFractionDigits:2});
const saleVatRate = 0.22;
const marginPercent = new Intl.NumberFormat("it-IT", {style:"percent", minimumFractionDigits:2, maximumFractionDigits:2});
const saleNumber = new Intl.NumberFormat("it-IT", {useGrouping:"always", minimumFractionDigits:2, maximumFractionDigits:2});
const format = value => number.format(value / scale);
const euro = value => money.format(value / scale);
const shortDate = value => value.split("-").reverse().join("/");
const today = new Intl.DateTimeFormat("sv-SE", {timeZone:"Europe/Rome", dateStyle:"short"});
const usersSection = key => key === "users" || key === "archives";
const accountingSection = key => key === "receipts" || key === "purchases";
let state;
let query = "";
let purchaseDate = "";
let purchaseDateOrder = "descending";
let sortDocumentsByNumber = false;
let navOpen = false;
let notificationTimer;

function section() {
  const key = location.hash.slice(1);
  if (key === "accounting") return "purchases";
  return Object.hasOwn(sections,key) && (!usersSection(key) || state?.user.role === "admin") ? key : "dashboard";
}
const unit = id => state.units.find(item => item.id === id)?.name ?? "";
const article = id => state.articles.find(item => item.id === id);
const articleLabel = item => item.code ? item.code + " · " + item.name : item.name;
const recipe = id => state.recipes.filter(line => line.perfume === id);
const lineCost = (item,quantity) => (item?.cost ?? 0) * quantity;
const cost = id => recipe(id).reduce((total,line) => total + lineCost(article(line.article),line.amount / scale), 0);
const button = (label, action, type = "secondary", symbol = "") => `<button type="button" class="button ${type}" data-action="${action}">${symbol ? icon(symbol) : ""}${label}</button>`;
const brand = `<a class="brand" href="#dashboard">${mark}<span>SCENTORA<small>GESTIONALE DI PRODUZIONE</small></span></a>`;

async function request(path, data) {
  let response;
  try {
    response = await fetch("/api/" + path, data === undefined ? {} : {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(data),
    });
  } catch {
    throw new Error("Connessione non disponibile. Verifica la rete e riprova.");
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || "Il servizio non risponde. Riprova.");
    error.status = response.status;
    throw error;
  }
  return payload;
}

function notify(message) {
  notifications.textContent = message;
  notifications.classList.add("visible");
  clearTimeout(notificationTimer);
  notificationTimer = setTimeout(() => notifications.classList.remove("visible"), 3600);
}

async function refresh() {
  try {
    state = await request("state");
    render();
  } catch (error) {
    if (error.status === 401) return renderLogin();
    root.innerHTML = `<main id="main" class="login"><div class="login-card">${brand}<h1>Connessione interrotta</h1><p>${escape(error.message)}</p>${button("Riprova", "refresh", "primary")}</div></main>`;
  }
}

function renderLogin() {
  state = undefined;
  root.innerHTML = `<main id="main" class="login"><div class="login-card">${brand}<h1>Accedi a Scentora</h1>
    <form id="login-form">
      <label>Utente<input name="utente" autocomplete="username" required maxlength="120"></label>
      <label>Password<input type="password" name="password" autocomplete="current-password" required maxlength="256"></label>
      <p class="form-error" role="alert" hidden></p>
      <button class="button primary" type="submit">Accedi ${icon("arrow")}</button>
    </form></div></main>`;
}

function render() {
  const current = section();
  const links = Object.entries(sections).filter(([key]) => key !== "purchases" && key !== "equivalents" && key !== "documents" && key !== "equipment" && key !== "archives" && (!usersSection(key) || state.user.role === "admin"))
    .map(([key,[label,symbol]]) => {
      const accounting = key === "receipts";
      const active = current === key || (accounting && accountingSection(current)) || (key === "units" && ["equivalents","documents","equipment"].includes(current)) || (key === "users" && current === "archives");
      return `<a href="#${accounting ? "accounting" : key}" ${active ? 'aria-current="page"' : ""}>${icon(symbol)}${accounting ? "Acquisti-Incassi" : key === "users" ? "Utenti e Archivi" : label}</a>`;
    }).join("");
  root.innerHTML = `<div class="shell">
    <aside id="sidebar" class="sidebar ${navOpen ? "open" : ""}">${brand}
      <nav aria-label="Menu principale">${links}</nav>
      <div class="account"><div class="avatar" aria-hidden="true">${escape(state.user.name.slice(0,1).toUpperCase())}</div>
        <div class="identity"><strong>${escape(state.user.name)}</strong><small>${state.user.role === "admin" ? "Amministratore" : "Operatore"}</small></div>
        ${state.demo ? "" : `<button class="icon-button" data-action="logout" aria-label="Esci">${icon("logout")}</button>`}
      </div>
    </aside>
    <main id="main" tabindex="-1"${current === "purchases" ? ' class="fixed-list-page purchases-page"' : ["perfumes","articles"].includes(current) ? ' class="fixed-list-page"' : ""}>
      <header class="topbar">
        <button class="icon-button menu-button" data-action="menu" aria-label="Menu principale" aria-expanded="${navOpen}" aria-controls="sidebar">${icon(navOpen ? "close" : "menu")}</button>
        <span class="breadcrumb">Scentora <span aria-hidden="true">/</span> ${sections[current][0]}</span>
        ${state.demo ? '<span class="demo-chip">Modalità demo</span>' : ""}
      </header>
      <div class="work" id="work">${current === "dashboard" ? dashboard() : current === "archives" ? archives() : current === "analysis" ? analysisPage() : listing(current)}</div>
    </main></div>`;
  updateCount();
  if (current === "archives" && !dialog.open) openArchives();
}

function dashboard() {
  const counts = [["Articoli di base", state.articles.length, "articles", "box"],
    ["Profumi a catalogo", state.perfumes.length, "perfumes", "bottle"],
    ["Movimenti registrati", state.movements.length >= 100 ? "100+" : state.movements.length, "movements", "clock"]];
  return `<section class="hero">
      <div class="hero-art" aria-hidden="true"><i></i><i></i><i></i>${mark}</div>
      <div class="hero-content"><p class="eyebrow">SCENTORA / PRODUZIONE</p><h1>Panoramica</h1>
      <p>Giacenze, distinte base e carichi di produzione.</p>
      </div>
      <a class="button primary hero-site-link" href="https://www.scentora.it/" target="_blank" rel="noopener noreferrer">VAI AL SITO ${icon("arrow")}</a>
    </section>
    <section class="metrics" aria-label="Riepilogo">${counts.map(([label,value,link,symbol]) => `<a class="metric" href="#${link}">
      <span class="metric-icon">${icon(symbol)}</span><span class="metric-label">${label}</span><strong>${value}</strong><span class="metric-arrow">${icon("arrow")}</span>
    </a>`).join("")}</section>
    <section class="panel"><div class="panel-heading"><h2>Ultimi movimenti</h2><a class="text-link" href="#movements">Vedi produzione ${icon("arrow")}</a></div>
    ${table("movements", state.movements.slice(0,5))}</section>`;
}

const settings = {
  articles: ["Gestisci codici, costi e disponibilità di magazzino.", "Nuovo articolo", "article", "Cerca per codice, descrizione, fornitore o note"],
  perfumes: ["Consulta il catalogo e configura le distinte base.", "Nuovo profumo", "perfume", "Cerca un profumo"],
  movements: ["Consulta gli ultimi 100 carichi e scarichi di profumi.", "Carica profumo", "produce", "Cerca per profumo, operatore o note"],
  customers: ["Consulta le anagrafiche e i movimenti di incasso.", "Nuovo cliente", "customer", "Cerca per nome, città o telefono"],
  suppliers: ["Consulta le anagrafiche e i movimenti di spesa.", "Nuovo fornitore", "supplier", "Cerca per nome, città, nazione o telefono"],
  receipts: ["Registra gli incassi dei clienti.", "Nuovo incasso", "receipt", "Cerca per cliente, profumo o note"],
  purchases: ["Registra gli acquisti dai fornitori e aggiorna la giacenza degli articoli.", "Nuovo acquisto", "purchase", "Cerca per numero documento, fornitore, articolo o note"],
  equipment: ["Consulta gli attrezzi per la produzione.", "Nuovo attrezzo", "equipment", "Cerca per descrizione, fornitore o note"],
  documents: ["Documenti registrati negli acquisti, con data e fornitore.", "", "", "Cerca per numero documento o fornitore"],
  equivalents: ["Corrispondenze tra codici, equivalenze e profumi Scentora.", "", "", "Cerca per codice, equivalenza o profumo"],
  units: ["Unità di misura disponibili nelle schede.", "Nuova unità", "unit", "Cerca un’unità"],
  users: ["Gestisci gli account e i ruoli di accesso.", "Nuovo utente", "user", "Cerca un utente"],
};

function usersTabs(current) {
  return `<nav class="accounting-nav" aria-label="Utenti">${["users","archives"].map(key =>
    `<a href="#${key}" ${key === current ? 'aria-current="page"' : ""}>${sections[key][0]}</a>`).join("")}</nav>`;
}

function archives() {
  return `<div class="page-heading"><div><h1>Gestione Archivi</h1>
    </div></div>${usersTabs("archives")}
    <div class="empty">${button("Apri finestra di backup","open-archives","primary")}</div>`;
}

function openArchives() {
  dialog.innerHTML = `<div class="dialog-heading"><h2 id="dialog-title">Gestione Archivi</h2>
    <button type="button" class="icon-button" data-action="close" aria-label="Chiudi">${icon("close")}</button></div>
    <div class="empty"><p>Scarica una copia degli archivi e della Tabella Equivalenze.</p>
    <a class="button primary" href="/api/backup" download>Esegui Backup</a></div>`;
  dialog.showModal();
}


function analysisPage() {
  return `<div class="page-heading"><h1>Analisi Costo</h1></div>
    <section class="panel cost-analysis">
      <div class="analysis-toolbar">
        ${select("Profumo","analysis-perfume",options(state.perfumes),false)}
        <div id="analysis-identity" class="analysis-identity" hidden></div>
        <button class="button recipe-button" type="button" data-action="print-page" disabled>STAMPA</button>
      </div>
      <div id="analysis-detail"></div>
    </section>`;
}

function analysisMetricValues(perfume, net, total) {
  const profit = net - total / scale;
  return [
    ["Prezzo vendita",saleMoney.format(perfume.price / scale)],
    ["Prezzo vendita imponibile",net === null ? "—" : saleMoney.format(net)],
    ["Costo totale distinta",euro(total)],
    ["Margine %",net > 0 ? marginPercent.format(profit / net) : "—"],
    ["Margine valore",net === null ? "—" : saleMoney.format(profit)],
  ];
}

function analysisMetrics(perfume, net, total, editable = false) {
  return `<dl class="analysis-metrics"${editable ? ' id="analysis-base-metrics"' : ""}>${analysisMetricValues(perfume,net,total).map(([label,value],index) =>
    editable && index === 0
      ? `<div><dt><label for="scenario-price">Prezzo vendita simulato (€)</label></dt>
        <dd><input id="scenario-price" inputmode="decimal" maxlength="14" value="${(perfume.price / scale).toFixed(2).replace(".",",")}"></dd></div>`
      : `<div><dt>${label}</dt><dd>${value}</dd></div>`).join("")}</dl>`;
}

function showAnalysis(selectField) {
  const detail = document.querySelector("#analysis-detail");
  const perfume = state.perfumes.find(item => item.id === Number(selectField.value));
  const printButton = selectField.closest(".analysis-toolbar").querySelector("button");
  const identity = document.querySelector("#analysis-identity");
  identity.hidden = !perfume;
  identity.innerHTML = "";
  printButton.disabled = !perfume;
  if (!perfume) {
    detail.innerHTML = "";
    return;
  }
  const net = Math.round(perfume.price / scale * 100 / (1 + saleVatRate)) / 100;
  const base = cost(perfume.id);
  const equivalents = [...new Set((state.equivalents ?? [])
    .filter(entry => equivalenceKey(entry.name) === equivalenceKey(perfume.name))
    .map(entry => entry.description).filter(Boolean))];
  identity.innerHTML = `${perfume.has_photo ? `<div class="analysis-photo">${perfumePhoto(perfume)}</div>` : ""}
    <div class="analysis-equivalence"><strong>Equivalenza</strong><span>${escape(equivalents.join(" · ") || "—")}</span></div>`;
  detail.innerHTML = `${analysisMetrics(perfume,net,base,true)}
    <h2>Distinta Art.</h2>
    <div class="table-wrap" tabindex="0" role="region" aria-label="Distinta Art.">
    <table><thead><tr>${["Articolo","Quantità","Costo unitario","Costo totale"].map(label =>
      `<th scope="col">${label}</th>`).join("")}</tr></thead><tbody>
      ${recipe(perfume.id).map(line => {
        const item = article(line.article);
        return `<tr>${cell("Articolo",escape(item ? articleLabel(item) : "Articolo archiviato"))}
          ${cell("Quantità",escape(format(line.amount) + (item ? " " + unit(item.unit) : "")))}
          ${cell("Costo unitario",euro(item?.cost ?? 0),"numeric")}
          ${cell("Costo totale",euro(lineCost(item,line.amount / scale)),"numeric")}</tr>`;
      }).join("")}
      ${[1,2,3].map(index => `<tr class="analysis-extra"><td colspan="3">
        <input aria-label="Articolo aggiuntivo ${index}" placeholder="Articolo aggiuntivo" maxlength="120"></td>
        <td><input data-extra-cost aria-label="Costo aggiuntivo ${index} (€)" placeholder="€" inputmode="decimal" maxlength="18"></td></tr>`).join("")}
    </tbody></table></div>
    <h2>Risultato con costi aggiuntivi</h2>
    <div id="analysis-result" aria-live="polite"></div>
    <div class="actions scenario-library">
      <label>Simulazioni salvate<select id="scenario-picker"></select></label>
      <label>Nome simulazione<input id="scenario-name" maxlength="80"></label>
      <button type="button" class="button recipe-button" id="scenario-save">Salva simulazione</button>
    </div>`;
  const result = detail.querySelector("#analysis-result");
  const fields = [...detail.querySelectorAll("[data-extra-cost]")];
  const labels = [...detail.querySelectorAll(".analysis-extra td:first-child input")];
  const priceField = detail.querySelector("#scenario-price");
  const baseMetrics = [...detail.querySelectorAll("#analysis-base-metrics dd")].slice(1);
  const picker = detail.querySelector("#scenario-picker");
  const name = detail.querySelector("#scenario-name");
  const save = detail.querySelector("#scenario-save");
  const scenarios = () => state.scenarios.filter(item => item.perfume_id === perfume.id);
  picker.innerHTML = options(scenarios());
  let saving = false;
  picker.addEventListener("change", () => {
    const entry = scenarios().find(item => item.id === Number(picker.value));
    if (!entry) return;
    const extras = JSON.parse(entry.extras);
    name.value = entry.name;
    priceField.value = (entry.price / scale).toFixed(2).replace(".",",");
    fields.forEach((field,index) => {
      field.value = extras[index].cost == null ? "" : String(extras[index].cost / scale).replace(".",",");
      labels[index].value = extras[index].label;
    });
    update();
  });
  save.addEventListener("click", async () => {
    const scenarioName = name.value.trim();
    if (scenarios().some(item => item.name.toLowerCase() === scenarioName.toLowerCase())
      && !window.confirm("Aggiornare la simulazione già salvata con questo nome?")) return;
    saving = true;
    update();
    try {
      const {scenarios: saved} = await request("cost-scenario",{
        perfume:perfume.id, name:scenarioName, price:priceField.value.trim(),
        extras:fields.map((field,index) => ({label:labels[index].value,cost:field.value.trim()})),
      });
      state.scenarios = saved;
      if (!picker.isConnected) return;
      picker.innerHTML = options(scenarios(),scenarios().find(item => item.name === scenarioName)?.id);
      notify("Simulazione salvata.");
    } catch (error) { notify(error.message); }
    finally { saving = false; update(); }
  });
  const update = () => {
    let total = base;
    const validPrice = /^\d{1,9}(?:[.,]\d{1,2})?$/.test(priceField.value.trim());
    const price = Math.round(Number(priceField.value.replace(",",".")) * scale);
    const simulationNet = Math.round(price / scale * 100 / (1 + saleVatRate)) / 100;
    const simulated = {...perfume,price};
    analysisMetricValues(simulated,validPrice ? simulationNet : null,base).slice(1)
      .forEach(([,value],index) => { baseMetrics[index].textContent = value; });
    let invalid = !validPrice;
    priceField.setAttribute("aria-invalid",String(!validPrice));
    for (const field of fields) {
      const value = field.value.trim();
      const valid = !value || /^\d{1,9}(?:[.,]\d{1,6})?$/.test(value);
      field.setAttribute("aria-invalid",String(!valid));
      invalid ||= !valid;
      if (valid && value) total += Math.round(Number(value.replace(",",".")) * scale);
    }
    printButton.disabled = invalid;
    save.disabled = saving || invalid || !name.value.trim();
    result.innerHTML = invalid ? '<p class="form-error">Verifica il prezzo e i costi in euro.</p>'
      : analysisMetrics(simulated,simulationNet,total);
  };
  for (const field of [...fields,priceField,name]) field.addEventListener("input",update);
  update();
}


function printableCopy(source) {
  const copy = source.cloneNode(true);
  const controls = copy.querySelectorAll("input,select,textarea,output");
  source.querySelectorAll("input,select,textarea,output").forEach((field,index) => {
    const value = document.createElement("span");
    value.className = "print-value";
    value.textContent = field.type === "password" || field.type === "search" ? ""
      : field.tagName === "SELECT" ? field.selectedOptions[0]?.textContent ?? "" : field.value;
    controls[index].replaceWith(value);
  });
  copy.querySelectorAll(".analysis-extra").forEach(row => {
    if (!row.textContent.trim()) row.remove();
    else {
      const cost = row.lastElementChild.querySelector(".print-value");
      if (cost.textContent.trim()) cost.textContent = euro(Number(cost.textContent.replace(",",".")) * scale);
    }
  });
  copy.querySelectorAll("td,th").forEach(cell => {
    const link = cell.querySelector('button[data-action^="ledger:"],button[data-action^="supplier-totals"],button[data-action="sort-purchase-date"],button[data-action="sort-document-number"],button[data-action^="purchase-document:"],button[data-action^="article-history:"]');
    if (link) link.replaceWith(document.createTextNode(link.textContent));
  });
  copy.querySelectorAll("button,[hidden],.form-error,.scenario-library,.photo-controls").forEach(node => node.remove());
  copy.querySelectorAll('th,td[data-label="Azioni"],td[data-label="Contabile"]').forEach(node => {
    if (node.tagName === "TD" || ["Azioni","Contabile"].includes(node.textContent.trim())) node.remove();
  });
  copy.querySelectorAll("label").forEach(label => {
    if (!label.querySelector(".print-value")?.textContent.trim()) label.remove();
  });
  return copy;
}

function printReport(fromDialog) {
  const key = section();
  const source = fromDialog ? dialog.querySelector(".dialog-content")
    : document.querySelector(key === "analysis" ? ".cost-analysis" : key === "dashboard" ? "#work" : "#results");
  if (!source || source.querySelector('[role="status"]:only-child')?.textContent === "Caricamento movimenti…") return;
  const report = document.createElement("article");
  report.className = "print-report";
  if (!fromDialog && ["articles","purchases"].includes(key)) report.classList.add("print-wide");
  const title = document.createElement("h1");
  title.textContent = fromDialog ? dialog.querySelector("#dialog-title").textContent : sections[key][0];
  const brand = document.createElement("p");
  brand.textContent = "SCENTORA";
  brand.className = "print-brand";
  const content = printableCopy(source);
  content.querySelectorAll(".hero,.panel-heading").forEach(node => node.remove());
  if (key === "dashboard" && !fromDialog) {
    const heading = document.createElement("h2");
    heading.textContent = "Ultimi movimenti";
    content.querySelector(".panel")?.prepend(heading);
  }
  report.append(brand,title,content);
  if (!fromDialog && key === "articles") {
    const footer = document.createElement("p");
    footer.className = "purchase-search-total";
    const label = document.createElement("strong");
    label.textContent = "Valore totale di magazzino · " + totalStockMoney();
    footer.append(label);
    report.append(footer);
  }
  const total = !fromDialog && document.querySelector("#purchase-search-total:not([hidden]),#equipment-total");
  if (total) report.append(printableCopy(total));
  document.querySelector("body > .print-report")?.remove();
  document.body.append(report);
  window.addEventListener("afterprint", () => report.remove(), {once: true});
  window.print();
}

const stockValue = item => BigInt(item.cost) * BigInt(item.stock);

function stockMoney(value) {
  const cents = (value + purchaseDivisor / 2n) / purchaseDivisor;
  return saleMoney.formatToParts(cents / 100n).map(part =>
    part.type === "fraction" ? String(cents % 100n).padStart(2,"0") : part.value).join("");
}

function totalStockMoney() {
  return stockMoney(state.articles.reduce((sum,item) => sum + stockValue(item),0n));
}


function capacityStep(current, divisor) {
  if (divisor === 0n) return current;
  return capacityStep(divisor,current % divisor);
}

function perfumePhoto(item) {
  return item.has_photo
    ? `<img src="/api/perfumes/${item.id}/photo${item.photo_revision ? "?v=" + item.photo_revision : ""}" alt="${escape(item.name)}">`
    : mark;
}

function photoControls(item) {
  return `<section class="perfume-photo-editor" data-photo-editor="${item.id}">
    ${item.has_photo ? `<button type="button" class="perfume-photo-preview photo-zoom-trigger" data-action="zoom-perfume-photo:${item.id}" aria-label="Ingrandisci foto di ${escape(item.name)}" title="Ingrandisci foto">${perfumePhoto(item)}</button>`
      : `<div class="perfume-photo-preview">${perfumePhoto(item)}</div>`}
    <div class="photo-controls">
      <label class="photo-picker">${item.has_photo ? "Sostituisci foto" : "Carica foto"}
        <input type="file" class="perfume-photo-input" accept="image/jpeg,image/png,image/webp"></label>
      ${item.has_photo ? button("Rimuovi foto","remove-perfume-photo","secondary") : ""}
    </div>
  </section>`;
}

function zoomPerfumePhoto(id) {
  const item = state.perfumes.find(perfume => perfume.id === id);
  if (!item?.has_photo) return;
  const viewer = document.createElement("dialog");
  viewer.className = "photo-viewer";
  viewer.setAttribute("aria-label","Foto di " + item.name);
  viewer.innerHTML = `<button type="button" class="icon-button photo-viewer-close" aria-label="Chiudi foto" autofocus>${icon("close")}</button>${perfumePhoto(item)}`;
  viewer.querySelector("button").addEventListener("click",() => viewer.close());
  viewer.addEventListener("click",event => {
    if (event.target === viewer) viewer.close();
  });
  viewer.addEventListener("close",() => viewer.remove(),{once:true});
  document.body.append(viewer);
  viewer.showModal();
}

function openPerfumePhoto(id) {
  const item = state.perfumes.find(perfume => perfume.id === id);
  if (!item) return;
  dialog.innerHTML = `<div class="dialog-heading"><h2 id="dialog-title">Foto · ${escape(item.name)}</h2>
    <button type="button" class="icon-button" data-action="close" aria-label="Chiudi">${icon("close")}</button></div>
    <div class="dialog-content photo-gallery">${photoControls(item)}</div>
    <div class="dialog-actions">${button("Chiudi","close")}</div>`;
  dialog.showModal();
}

async function jpegFromFile(file) {
  if (!["image/jpeg","image/png","image/webp"].includes(file.type) || file.size > 20 * 1024 * 1024) {
    throw new Error("Scegli una foto JPG, PNG o WebP fino a 20 MB.");
  }
  const bitmap = await createImageBitmap(file);
  try {
    const ratio = Math.min(1,640 / Math.max(bitmap.width,bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1,Math.round(bitmap.width * ratio));
    canvas.height = Math.max(1,Math.round(bitmap.height * ratio));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
    for (const quality of [0.82,0.65,0.45]) {
      const photo = canvas.toDataURL("image/jpeg",quality).split(",")[1];
      if (photo && photo.length <= 400000) return photo;
    }
    throw new Error("La foto è troppo grande dopo la compressione.");
  } finally {
    bitmap.close();
  }
}

async function updatePerfumePhoto(container,file) {
  const id = Number(container.dataset.photoEditor);
  const item = state.perfumes.find(perfume => perfume.id === id);
  if (!item) return;
  const controls = [...container.querySelectorAll("button,input")];
  controls.forEach(control => { control.disabled = true; });
  try {
    const photo = file ? await jpegFromFile(file) : null;
    await request("perfume-photo",{id,photo});
    item.has_photo = Boolean(file);
    item.photo_revision = Date.now();
    document.querySelectorAll(`[data-photo-editor="${id}"]`).forEach(editor => {
      editor.outerHTML = photoControls(item);
    });
    const thumbnail = root.querySelector(`[data-action="perfume-photo:${id}"]`);
    if (thumbnail) thumbnail.innerHTML = perfumePhoto(item);
    notify(file ? "Foto salvata." : "Foto rimossa.");
  } catch (error) {
    notify(error.message || "Impossibile leggere la foto.");
  } finally {
    controls.forEach(control => { control.disabled = false; });
    container.querySelector("input").value = "";
  }
}

function openProductionCapacity(id) {
  const perfume = state.perfumes.find(item => item.id === id);
  if (!perfume) return;
  const lines = recipe(id).map(line => ({...line,item:article(line.article)}));
  const precision = BigInt(scale);
  let maximum = null;
  let step = 1n;
  for (const line of lines) {
    const available = BigInt(line.item?.stock ?? 0) / BigInt(line.amount);
    maximum = maximum === null || available < maximum ? available : maximum;
    if (unit(line.item?.unit).toLowerCase() === "pz.") {
      const multiple = precision / capacityStep(precision,BigInt(line.amount));
      step = step / capacityStep(step,multiple) * multiple;
    }
  }
  const producible = maximum === null ? 0n : maximum / step * step;
  const limiting = lines.filter(line => BigInt(line.item?.stock ?? 0) / BigInt(line.amount) === maximum);
  dialog.innerHTML = `<div class="dialog-heading"><h2 id="dialog-title">Producibilità · ${escape(perfume.name)}</h2>
    <button type="button" class="icon-button" data-action="close" aria-label="Chiudi">${icon("close")}</button></div>
    <div class="dialog-content">${lines.length ? `<p><strong>Quantità intera producibile · ${number.format(producible)}</strong></p>
      <p>Componenti limitanti · ${limiting.map(line => escape(line.item ? articleLabel(line.item) : "Articolo non disponibile")).join(", ")}</p>
      ${step > 1n ? `<p>Quantità compatibili con la distinta in multipli di ${number.format(step)}.</p>` : ""}
      <label>Quantità da produrre<input id="capacity-target" type="number" min="1" max="1000000000" step="1"></label>
      <div id="capacity-shortage" aria-live="polite"></div>` : "<p>Completa la distinta base per calcolare la producibilità.</p>"}</div>
    <div class="dialog-actions">${button("Chiudi","close")}</div>`;
  dialog.showModal();
  const field = dialog.querySelector("#capacity-target");
  if (!field) return;
  field.addEventListener("input", () => {
    const result = dialog.querySelector("#capacity-shortage");
    const quantity = Number(field.value);
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1e9) {
      result.textContent = field.value ? "Inserisci una quantità intera valida." : "";
      return;
    }
    const missing = lines.map(line => ({
      item:line.item, amount:BigInt(line.amount) * BigInt(quantity) - BigInt(line.item?.stock ?? 0),
    })).filter(line => line.amount > 0n);
    const compatible = BigInt(quantity) % step === 0n;
    result.innerHTML = `${!compatible ? "<p>Quantità incompatibile con i multipli della distinta.</p>" : ""}
      ${missing.length ? `<p><strong>Componenti mancanti</strong></p><ul>${missing.map(line =>
        `<li>${escape(line.item ? articleLabel(line.item) : "Articolo non disponibile")} · ${format(Number(line.amount))} ${escape(unit(line.item?.unit))}</li>`).join("")}</ul>`
        : "<p>Giacenze sufficienti per la quantità indicata.</p>"}`;
  });
}

async function openArticleHistory(id) {
  const item = article(id);
  if (!item) return;
  dialog.innerHTML = `<div class="dialog-heading"><h2 id="dialog-title">Storico giacenza · ${escape(articleLabel(item))}</h2>
    <button type="button" class="icon-button" data-action="close" aria-label="Chiudi">${icon("close")}</button></div>
    <div class="dialog-content"><p role="status">Caricamento movimenti…</p></div>
    <div class="dialog-actions">${button("STAMPA","print-dialog","recipe-button")}${button("Chiudi","close")}</div>`;
  const content = dialog.querySelector(".dialog-content");
  dialog.showModal();
  try {
    const {entries} = await request(`articles/${id}/history`);
    if (!dialog.open || !content.isConnected) return;
    content.innerHTML = `<p>Giacenza attuale · <strong>${format(item.stock)} ${escape(unit(item.unit))}</strong></p>
      ${entries.length ? `<div class="table-wrap" tabindex="0" role="region" aria-label="Storico giacenza">
        <table><thead><tr>${["Data","Movimento","NUM. DOC","Variazione","Giacenza"].map(label => `<th scope="col">${label}</th>`).join("")}</tr></thead>
        <tbody>${entries.map(row => `<tr>${cell("Data",shortDate(row.day))}${cell("Movimento",escape(row.action))}
          ${cell("NUM. DOC",escape(row.document))}
          ${cell("Variazione",row.delta == null ? "—" : (row.delta > 0 ? "+" : "") + format(row.delta),"numeric")}
          ${cell("Giacenza",row.balance == null ? "—" : format(row.balance),"numeric")}</tr>`).join("")}</tbody></table>
      </div>` : "<p>Nessun movimento registrato.</p>"}`;
  } catch (error) {
    if (dialog.open && content.isConnected) content.innerHTML = `<p class="form-error" role="alert">${escape(error.message)}</p>`;
  }
}

function openPurchaseDocument(id) {
  const entry = state.documents.find(item => item.id === id);
  if (!entry) return;
  const lines = state.accounting.filter(item => item.kind === "supplier" && item.document_id === id);
  const total = lines.reduce((sum,item) => sum + BigInt(item.amount),0n);
  dialog.innerHTML = `<div class="dialog-heading"><h2 id="dialog-title">Documento ${escape(entry.document_number)}</h2>
    <button type="button" class="icon-button" data-action="close" aria-label="Chiudi">${icon("close")}</button></div>
    <div class="dialog-content">
      <p><strong>${escape(entry.contact)}</strong> · ${shortDate(entry.occurred_on)}</p>
      <div class="table-wrap" tabindex="0" role="region" aria-label="Articoli del documento">
        <table><thead><tr>${["Articolo","Quantità","Costo unitario","Totale","Note"].map(label =>
          `<th scope="col">${label}</th>`).join("")}</tr></thead>
          <tbody>${lines.map(item => `<tr>${cell("Articolo",escape(item.description))}
            ${cell("Quantità",format(item.quantity) + " " + escape(item.unit),"numeric")}
            ${cell("Costo unitario",euro(item.unit_cost),"numeric")}
            ${cell("Totale",euro(item.amount),"numeric")}
            ${cell("Note",escape(item.notes),"notes-cell")}</tr>`).join("")}</tbody>
          <tfoot><tr><th scope="row" colspan="3">Totale documento</th>
            ${cell("Totale",stockMoney(total * BigInt(scale)),"numeric")}<td></td></tr></tfoot>
        </table>
      </div>
    </div>
    <div class="dialog-actions">${button("STAMPA","print-dialog","recipe-button")}${button("Chiudi","close")}</div>`;
  dialog.showModal();
}

function openSupplierTotals(id) {
  const suppliers = id ? state.suppliers.filter(supplier => supplier.id === id) : state.suppliers;
  const totals = new Map();
  for (const item of state.accounting) {
    if (item.kind !== "supplier") continue;
    totals.set(item.contact_id,(totals.get(item.contact_id) ?? 0n) + BigInt(item.amount));
  }
  const total = suppliers.reduce((sum,supplier) => sum + (totals.get(supplier.id) ?? 0n),0n);
  dialog.innerHTML = `<div class="dialog-heading"><h2 id="dialog-title">Acquisti per fornitore</h2>
    <button type="button" class="icon-button" data-action="close" aria-label="Chiudi">${icon("close")}</button></div>
    <div class="dialog-content">${suppliers.length ? `<div class="table-wrap" tabindex="0" role="region" aria-label="Acquisti per fornitore">
      <table><thead><tr><th scope="col">Fornitore</th><th scope="col">Valore acquistato</th></tr></thead>
      <tbody>${suppliers.map(supplier => `<tr>${cell("Fornitore",escape(supplier.name))}
        ${cell("Valore acquistato",stockMoney((totals.get(supplier.id) ?? 0n) * BigInt(scale)),"numeric")}</tr>`).join("")}
      </tbody></table></div>` : "<p>Nessun fornitore presente.</p>"}</div>
    <div class="dialog-actions supplier-total-footer"><strong class="numeric">Totale acquisti · ${stockMoney(total * BigInt(scale))}</strong>${button("STAMPA","print-dialog","recipe-button")}${button("Chiudi","close")}</div>`;
  dialog.showModal();
}

function openStockValue() {
  dialog.innerHTML = `<div class="dialog-heading"><h2 id="dialog-title">Valore magazzino</h2>
    <button type="button" class="icon-button" data-action="close" aria-label="Chiudi">${icon("close")}</button></div>
    <div class="dialog-content"><p>Valore totale degli articoli di base in giacenza</p><strong class="stock-value-total">${totalStockMoney()}</strong></div>
    <div class="dialog-actions">${button("Chiudi","close")}</div>`;
  dialog.showModal();
}

function listing(key) {
  const [description,label,action,placeholder] = settings[key];
  const canCreate = !["equivalents","documents"].includes(key) && (key !== "units" || state.user.role === "admin");
  return `<div class="page-heading${key === "movements" ? " production-heading" : ""}"><div><h1>${sections[key][0]}</h1><p>${description}</p></div>
    ${key === "movements" ? `<div class="actions production-actions">
      ${button("Carica Profumo","produce","perfume-load","plus")}
      ${button("Scarica Profumo","unload","perfume-unload","minus")}</div>` : ""}
    <div class="actions">${key === "perfumes" ? button("Scarica profumo","unload","perfume-unload")
      + button("Carica profumo","produce","perfume-load") : ""}
    ${key === "articles" ? button("VALORE MAGAZZINO","stock-value","perfume-load") : ""}
    ${button("STAMPA","print-page","recipe-button")}
    ${canCreate && key !== "users" && key !== "movements" ? button(label,action,"primary","plus") : ""}
    ${key === "purchases" ? button("Acquisto a lista","purchase-list","recipe-button","plus") : ""}</div></div>
    ${key === "users" ? usersTabs(key) : ""}
    ${accountingSection(key) ? `<nav class="accounting-nav" aria-label="Gestione Contabilità">${["purchases","receipts"].map(tab =>
      `<a href="#${tab}" ${tab === key ? 'aria-current="page"' : ""}>${tab === "receipts" ? "Incasso/Apporto Socio" : sections[tab][0]}</a>`).join("")}</nav>` : ""}
    ${["units","equivalents","documents","equipment"].includes(key) ? `<nav class="accounting-nav" aria-label="Elenchi">
      <a href="#units" ${key === "units" ? 'aria-current="page"' : ""}>Unità di misura</a>
      <a href="#equivalents" ${key === "equivalents" ? 'aria-current="page"' : ""}>Tabella Equivalenze</a>
      <a href="#documents" ${key === "documents" ? 'aria-current="page"' : ""}>Documenti acquisto</a>
      <a href="#equipment" ${key === "equipment" ? 'aria-current="page"' : ""}>Attrezzi per Produzione</a>
    </nav>` : ""}
    <section class="panel"><div class="panel-heading">${key === "users" ? '<div class="users-toolbar">' : ""}<label class="search">${icon("search")}<input type="search" id="search" aria-label="${placeholder}" placeholder="${placeholder}" value="${escape(query)}"></label>${key === "users" ? button(label,action,"primary","plus") + "</div>" : ""}${["purchases","documents"].includes(key) ? `<div class="actions"><label>Data acquisto<input id="purchase-date" type="date" value="${escape(purchaseDate)}"></label>
      <button type="button" class="button recipe-button" data-action="clear-purchase-date">Azzera data</button></div>` : ""}<span class="count" id="count" aria-live="polite"></span></div>
    <div id="results">${table(key,filtered(key))}</div></section>
    ${key === "purchases" ? '<div class="purchase-search-total" id="purchase-search-total" role="status" hidden></div>' : ""}
    ${key === "equipment" ? '<div class="equipment-total" id="equipment-total" role="status"><span>Totale attrezzi per produzione</span><strong></strong></div>' : ""}`;
}

function filtered(key) {
  const entries = accountingSection(key) ? state.accounting.filter(item =>
    item.kind === (key === "receipts" ? "customer" : "supplier")) : state[key];
  const filterDate = ["purchases","documents"].includes(key) ? purchaseDate : "";
  const term = query.trim().toLocaleLowerCase("it");
  const matches = entries.filter(item => (!filterDate || item.occurred_on === filterDate) && [item.document_number,item.name,item.code,item.actor,item.city,item.country,item.phone,
    item.contact,item.description,item.notes,
    key === "articles" ? state.suppliers.find(supplier => supplier.id === item.supplier_id)?.name : undefined].some(value =>
    String(value ?? "").toLocaleLowerCase("it").includes(term)));
  if (key === "documents" && sortDocumentsByNumber) {
    return matches.sort((a,b) => a.document_number.localeCompare(b.document_number,"it",{numeric:true,sensitivity:"base"}));
  }
  return key === "purchases" ? matches.sort((a,b) =>
    (purchaseDateOrder === "ascending" ? 1 : -1) * a.occurred_on.localeCompare(b.occurred_on)) : matches;
}

const cell = (label,value,style = "") => `<td data-label="${label}" class="${style}">${value}</td>`;
function table(key, items, movementActions = key === "movements" && section() === "movements") {
  if (!items.length) {
    const messages = {articles:"Aggiungi il primo articolo di base.", perfumes:"Crea un profumo con la sua distinta base.",
      movements:"I movimenti confermati compariranno qui.", units:"Aggiungi un’unità di misura.", users:"Crea il primo utente.",
      customers:"Aggiungi il primo cliente.", suppliers:"Aggiungi il primo fornitore.",
      equipment:"Aggiungi il primo attrezzo.", receipts:"Registra il primo incasso.", purchases:"Registra il primo acquisto."};
    return `<div class="empty"><span class="metric-icon">${icon(sections[key][1])}</span><strong>${query ? "Nessun risultato" : "Nessuna voce da mostrare"}</strong>
      <span>${query ? "Prova un altro termine di ricerca." : messages[key]}</span></div>`;
  }
  const headings = {
    articles:["Codice","Descrizione Articolo","Profumo Scentora","Unità","Costo unitario","Giacenza","Valore","Azioni","Fornitore"],
    perfumes:["Profumo","Unità","Costo distinta","Prezzo vendita","Giacenza","Azioni"],
    movements:["Profumo","Data","Movimento","Operatore","Quantità","Note",...(movementActions ? ["Azioni"] : [])],
    customers:["Nome","Indirizzo","Città","Telefono","Contabile","Azioni"],
    suppliers:["Nome","Indirizzo","Città","Nazione","Telefono","Contabile","Azioni"],
    receipts:["Data","Cliente","Profumo","Importo","Note"],
    equipment:["Data","Descrizione","Importo","Fornitore","Note","Azioni"],
    documents:["NUM. DOC","Data acquisto","Fornitore","Totale documento"],
    purchases:["Data","NUM. DOC","Fornitore","Articolo di base","Costo unitario","Unità di misura","Quantità","Totale","Note","Azioni"],
    units:["Unità di misura"],
    equivalents:["Codice","Equivalenza","Profumo Scentora"],
    users:["Utente","Ruolo","Stato","Azioni"],
  }[key];
  const documentTotals = new Map();
  if (key === "documents") {
    for (const item of state.accounting) {
      if (item.kind === "supplier" && item.document_id != null) {
        documentTotals.set(item.document_id,(documentTotals.get(item.document_id) ?? 0n) + BigInt(item.amount));
      }
    }
  }
  const body = items.map(item => {
    const name = escape(item.name);
    switch (key) {
      case "articles": {
        const supplier = state.suppliers.find(entry => entry.id === item.supplier_id);
        return cell("Codice",`<span class="code">${escape(item.code)}</span>`)
          + cell("Descrizione Articolo",`<strong>${name}</strong>`)
          + cell("Profumo Scentora",escape(state.perfumes.find(perfume => perfume.id === item.scentora_perfume_id)?.name))
          + cell("Unità",escape(unit(item.unit))) + cell("Costo unitario",euro(item.cost),"numeric")
          + cell("Giacenza",`<button type="button" class="button inline text-link" data-action="article-history:${item.id}" title="Storico giacenza"><span class="stock ${item.stock ? "" : "zero"}">${format(item.stock)}</span></button>`,"numeric")
          + cell("Valore",stockMoney(stockValue(item)),"numeric")
          + cell("Azioni",`<div class="article-actions">${button("Movimenta",`stock:${item.id}`,"inline")}
            <div class="article-edit-actions"><button type="button" class="button inline" data-action="article:${item.id}" title="Modifica" aria-label="Modifica articolo">Mod.</button>
              <button type="button" class="button article-delete" data-action="article:${item.id}" title="Elimina" aria-label="Elimina articolo">Elim.</button></div></div>`)
          + cell("Fornitore",supplier ? button(escape(supplier.name),`supplier-totals:${supplier.id}`,"inline text-link") : "");
      }
      case "perfumes":
        return cell("Profumo",`<div class="perfume-name-cell">
          <button type="button" class="photo-thumbnail" data-action="perfume-photo:${item.id}" aria-label="Foto di ${name}">${perfumePhoto(item)}</button>
          <strong>${name}</strong></div>`) + cell("Unità",escape(unit(item.unit)))
          + cell("Costo distinta",euro(cost(item.id)),"numeric") + cell("Prezzo vendita",saleMoney.format(item.price / scale),"numeric")
          + cell("Giacenza",format(item.stock),"numeric")
          + cell("Azioni",button("Carica",`produce:${item.id}`,"inline perfume-load") + button("Distinta Art.",`perfume:${item.id}`,"inline recipe-button") + " " + button("Producibilità",`production-capacity:${item.id}`,"inline secondary"),"row-actions");
      case "movements":
        return cell("Profumo",`<strong>${name}</strong>`) + cell("Data",
          escape(shortDate(item.occurred_on ?? today.format(new Date(item.created.replace(" ","T")+"Z")))))
          + cell("Movimento",item.kind === "unload" ? "Scarico" : "Carico")
          + cell("Operatore",escape(item.actor)) + cell("Quantità",format(item.amount),"numeric")
          + cell("Note",escape(item.notes),"notes-cell")
          + (movementActions ? cell("Azioni",`<div class="purchase-actions">${button("Modifica",`edit-movement:${item.id}`,"recipe-button")}${button("Elimina",`confirm-movement:${item.id}`,"article-delete")}</div>`,"row-actions") : "");
      case "equivalents":
        return cell("Codice",escape(item.code)) + cell("Equivalenza",escape(item.description)) + cell("Profumo Scentora",name);
      case "units":
        return cell("Unità di misura",`<strong>${name}</strong>`);
      case "customers":
      case "suppliers":
        return cell("Nome",`<strong>${name}</strong>`) + cell("Indirizzo",escape(item.address))
          + cell("Città",escape(item.city)) + (key === "suppliers" ? cell("Nazione",escape(item.country)) : "")
          + cell("Telefono",escape(item.phone))
          + cell("Contabile",button("Contabile",`ledger:${item.id}`,"inline"))
          + cell("Azioni",button("Modifica",`${item.kind}:${item.id}`,"inline"),"row-actions");
      case "equipment":
        return cell("Data",shortDate(item.occurred_on)) + cell("Descrizione",escape(item.description))
          + cell("Importo",saleMoney.format(item.amount / scale),"numeric") + cell("Fornitore",escape(item.contact))
          + cell("Note",escape(item.notes),"notes-cell")
          + cell("Azioni",button("Modifica",`equipment:${item.id}`,"recipe-button")
            + " " + button("Elimina",`delete-equipment:${item.id}`,"article-delete"),"row-actions");
      case "documents":
        return cell("NUM. DOC",button(escape(item.document_number),`purchase-document:${item.id}`,"inline text-link")) + cell("Data acquisto",shortDate(item.occurred_on)) + cell("Fornitore",escape(item.contact))
          + cell("Totale documento",stockMoney((documentTotals.get(item.id) ?? 0n) * BigInt(scale)),"numeric");
      case "receipts":
      case "purchases":
        return cell("Data",shortDate(item.occurred_on))
          + (key === "purchases" ? cell("NUM. DOC",item.document_id ? button(escape(item.document_number),`purchase-document:${item.document_id}`,"inline text-link") : escape(item.document_number)) : "")
          + cell(key === "receipts" ? "Cliente" : "Fornitore",item.contact_id ? button(escape(item.contact),`ledger:${item.contact_id}`,"inline text-link") : `<strong>${escape(item.contact)}</strong>`)
          + cell(key === "receipts" ? "Profumo" : "Articolo di base",
            key === "receipts" && item.perfume_id === null ? "—" : escape(item.description))
          + (key === "purchases" ? cell("Costo unitario",euro(item.unit_cost),"numeric")
            + cell("Unità di misura",escape(item.unit)) + cell("Quantità",format(item.quantity),"numeric") : "")
          + cell(key === "receipts" ? "Importo" : "Totale",euro(item.amount),"numeric")
          + cell("Note",escape(item.notes),"notes-cell")
          + (key === "purchases" ? cell("Azioni",`<div class="purchase-actions">
            <button type="button" class="button recipe-button" data-action="edit-purchase:${item.id}" title="Modifica acquisto" aria-label="Modifica acquisto">M</button>
            <button type="button" class="button article-delete" data-action="delete-purchase:${item.id}" title="Elimina acquisto" aria-label="Elimina acquisto">E</button>
          </div>`) : "");
      default:
        return cell("Utente",`<strong>${name}</strong>`) + cell("Ruolo",item.role === "admin" ? "Amministratore" : "Operatore")
          + cell("Stato",`<span class="stock ${item.active ? "" : "zero"}">${item.active ? "Attivo" : "Disattivato"}</span>`)
          + cell("Azioni",button("Modifica",`user:${item.id}`,"inline"),"row-actions");
    }
  }).map(row => `<tr>${row}</tr>`).join("");
  return `<div class="table-wrap" tabindex="0" role="region" aria-label="Tabella ${sections[key][0]}"><table aria-label="${sections[key][0]}"><thead><tr>${headings.map(label => `<th scope="col"${key === "purchases" && label === "Data" ? ` aria-sort="${purchaseDateOrder}"` : key === "documents" && label === "NUM. DOC" && sortDocumentsByNumber ? ' aria-sort="ascending"' : ""}>${key === "documents" && label === "NUM. DOC"
    ? button("NUM. DOC ↑","sort-document-number","recipe-button")
    : key === "purchases" && label === "Data"
    ? button(purchaseDateOrder === "ascending" ? "Data ↑" : "Data ↓","sort-purchase-date","recipe-button")
    : key === "articles" && label === "Fornitore"
    ? '<button type="button" class="button inline text-link" data-action="supplier-totals" title="Totali acquisti per fornitore">Fornitore</button>'
    : label}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table></div>`;
}

const options = (items,id,label = item => item.name) => '<option value="">Seleziona…</option>' +
  items.map(item => `<option value="${item.id}" ${item.id === id ? "selected" : ""}>${escape(label(item))}</option>`).join("");
const input = (label,name,value = "",attrs = "required") => `<label>${label}<input name="${name}" value="${escape(value)}" ${attrs}></label>`;
const numericInput = (label,name,value,required = true) => input(label,name,value == null ? "" : value / scale,`inputmode="decimal" maxlength="22" ${required ? "required" : ""}`);
const select = (label,name,choices,required = true) =>
  `<label>${label}<select name="${name}" ${required ? "required" : ""}>${choices}</select></label>`;
const units = id => select("Unità di misura","unit",options(state.units,id));
const selected = (a,b) => a === b ? "selected" : "";

function equipmentLine() {
  return `<tr>
    <td><input name="description" aria-label="Descrizione" maxlength="200" required></td>
    <td><input name="amount" aria-label="Importo (€)" inputmode="decimal" maxlength="22" required></td>
    <td><input name="notes" aria-label="Note" maxlength="1000"></td>
    <td><button type="button" class="icon-button" data-action="remove-equipment-line" aria-label="Rimuovi riga">${icon("close")}</button></td>
  </tr>`;
}

function purchaseLine() {
  return `<tr><td data-purchase-code></td>
    <td><select name="article" aria-label="Descrizione Articolo" required>${options(state.articles,null,articleLabel)}</select></td>
    <td data-purchase-perfume></td><td data-purchase-unit></td><td data-purchase-cost class="numeric"></td>
    <td><input name="quantity" aria-label="Quantità" inputmode="decimal" maxlength="22" required></td>
    <td><input name="note" aria-label="Note" maxlength="1000"></td>
    <td><button type="button" class="icon-button" data-action="remove-purchase-line" aria-label="Rimuovi riga">${icon("close")}</button></td></tr>`;
}

function recipeLine(line = {}) {
  return `<div class="recipe-line">
    ${select("Articolo di base","lineArticle",options(state.articles,line.article,articleLabel))}
    ${numericInput("Quantità per unità","lineAmount",line.amount)}
    <button type="button" class="icon-button" data-action="remove-line" aria-label="Rimuovi riga">${icon("close")}</button>
    <span class="line-meta"></span>
    <strong class="line-meta form-error" role="status" hidden></strong></div>`;
}

function perfumeFormSnapshot(form) {
  const fields = new FormData(form);
  fields.delete("recipeSource");
  return JSON.stringify([...fields]);
}

function perfumeNavigation(id) {
  const index = state.perfumes.findIndex(item => item.id === id);
  return [-1,1].map(direction => {
    const label = direction < 0 ? "Profumo precedente" : "Profumo successivo";
    const target = state.perfumes[index + direction];
    return `<button type="button" class="icon-button perfume-step" aria-label="${label}" title="${label}"
      data-action="step-perfume:${target?.id ?? ""}" ${target ? "" : "disabled"}>${direction < 0 ? "‹" : "›"}</button>`;
  }).join("");
}

function modal(action,id,keepEquivalences = false) {
  const item = id ? ({
    equipment:state.equipment, "delete-equipment":state.equipment,
    article:state.articles, stock:state.articles, perfume:state.perfumes,
    produce:state.perfumes, user:state.users, customer:state.customers, supplier:state.suppliers,
  }[action] || []).find(record => record.id === id) : undefined;
  let title, fields, label = "Salva";
  switch (action) {
    case "article":
      title = item ? "Modifica articolo" : "Nuovo articolo di base";
      fields = `<div class="form-grid">${input("Codice","codice",item?.code,'maxlength="40"')}
        ${input("Descrizione Articolo","descrizione",item?.name,'required maxlength="120"')}
        ${select("Profumo Scentora","scentora_perfume_id",options(state.perfumes,item?.scentora_perfume_id),false)}
        ${select("Fornitore","supplier_id",options(state.suppliers,item?.supplier_id),false)}
        ${units(item?.unit)}
        ${numericInput("Costo unitario (€)","cost",item?.cost)}
        ${item ? "" : numericInput("Giacenza iniziale","stock",null,false)}</div>
        <label class="notes-field">Note<textarea name="notes" rows="3" maxlength="1000">${escape(item?.notes)}</textarea></label>`;
      break;
    case "stock":
      title = "Movimenta articolo";
      fields = `<p><strong>${escape(item.name)}</strong> · ${format(item.stock)} ${escape(unit(item.unit))} disponibili</p>
        <div class="form-grid">${select("Movimento","direction",'<option value="in">Carico</option><option value="out">Scarico</option>')}
        ${numericInput("Quantità","amount")}</div>`;
      break;
    case "perfume":
      if (!state.articles.length) return notify("Crea prima un articolo di base.");
      title = item ? "Modifica profumo" : "Nuovo profumo";
      fields = `<div class="form-grid">${input("Nome profumo","profumo",item?.name,'required maxlength="120"')}
        ${units(item?.unit ?? state.units.find(x => x.name === "pz.")?.id)}
        <div class="perfume-pricing">${input("Prezzo vendita (€)","price",item ? saleNumber.format(item.price / scale) : "",'inputmode="decimal" maxlength="22" required')}
          <div class="recipe-cost"><span id="net-price-label">Prezzo vendita imponibile</span>
            <output id="net-price" aria-labelledby="net-price-label" title="IVA 22% scorporata"></output></div>
          <div class="recipe-cost"><span id="recipe-cost-label">Costo distinta</span>
          <output id="recipe-cost" aria-labelledby="recipe-cost-label"></output></div>
          <div class="recipe-cost"><span id="sale-margin-label">Margine</span>
            <output id="sale-margin" aria-labelledby="sale-margin-label"></output></div></div></div>
        ${item ? photoControls(item) : ""}
        <fieldset><legend>Distinta base</legend><div id="recipe-lines">${(item ? recipe(id) : [{}]).map(recipeLine).join("")}</div>
        ${button("Aggiungi articolo","add-line","secondary","plus")}</fieldset>`;
      break;
    case "produce":
      if (!state.perfumes.length) return notify("Crea prima un profumo con la sua distinta base.");
      title = "Carica profumo";
      label = "Conferma carico";
      fields = `<div class="form-grid">${input("Data","data",today.format(new Date()),'type="date" required')}
        ${select("Profumo","perfume",options(state.perfumes,id || (state.perfumes.length === 1 ? state.perfumes[0].id : null)))}
        ${numericInput("Quantità da caricare","amount")}</div><div id="production-preview" aria-live="polite"></div>`;
      break;
    case "unload":
      if (!state.perfumes.length) return notify("Crea prima un profumo.");
      title = "Scarica profumo";
      label = "Conferma scarico";
      fields = `<div class="form-grid">${input("Data","data",today.format(new Date()),'type="date" required')}
        ${select("Profumo","perfume",options(state.perfumes,state.perfumes.length === 1 ? state.perfumes[0].id : null,
          item => `${item.name} · ${format(item.stock)} ${unit(item.unit)} disponibili`))}
        ${numericInput("Quantità da scaricare","amount")}</div>
        <label class="notes-field">Note<textarea name="note" rows="3" maxlength="1000"></textarea></label>`;
      break;
    case "unit":
      title = "Nuova unità di misura";
      fields = input("Unità di misura","unità","","required maxlength=24");
      break;
    case "customer":
    case "supplier":
      title = action === "customer" ? (item ? "Modifica cliente" : "Nuovo cliente")
        : (item ? "Modifica fornitore" : "Nuovo fornitore");
      fields = `<div class="form-grid">${input("Nome","nome",item?.name,'required maxlength="120"')}
        ${input("Indirizzo","indirizzo",item?.address,'maxlength="200"')}
        ${input("Città","città",item?.city,'maxlength="100"')}
        ${action === "supplier" ? input("Nazione","nazione",item?.country,'maxlength="100"') : ""}
        ${input("Telefono","telefono",item?.phone,'type="tel" maxlength="48"')}</div>`;
      break;
    case "purchase-list":
      if (!state.suppliers.length) return notify("Crea prima un fornitore.");
      if (!state.articles.length) return notify("Crea prima un articolo di base.");
      title = "Acquisto a lista";
      label = "Salva";
      fields = `<div class="form-grid">${input("Data","data",today.format(new Date()),'type="date" required')}
        ${select("Fornitore","contact",options(state.suppliers))}
        ${input("NUM. DOC","document_number","","maxlength=\"80\"")}</div>
        <div class="table-wrap" tabindex="0" role="region" aria-label="Righe di acquisto">
          <table class="purchase-lines"><thead><tr>
            ${["Codice","Descrizione Articolo","Profumo Scentora","Unità di misura","Costo unitario (€)","Quantità","Note","Azioni"].map(heading => `<th scope="col">${heading}</th>`).join("")}
          </tr></thead><tbody>${purchaseLine()}</tbody></table>
        </div>
        ${button("Aggiungi articolo","add-purchase-line","secondary","plus")}`;
      break;
    case "delete-purchase": {
      const row = state.accounting.find(item => item.id === id && item.kind === "supplier");
      if (!row) return;
      title = "Eliminare l’acquisto?";
      label = "Conferma eliminazione";
      fields = `<div class="delete-summary"><strong>${escape(row.description)}</strong>
        <small>${escape(row.contact)} · ${format(row.quantity)} ${escape(row.unit)} · ${euro(row.amount)}</small></div>
        <p>Verrà eliminata la riga selezionata e stornato il carico di magazzino, se applicato.</p>`;
      break;
    }
    case "receipt":
    case "edit-purchase":
    case "purchase": {
      const receipt = action === "receipt";
      const original = action === "edit-purchase" ? state.accounting.find(row => row.id === id && row.kind === "supplier") : null;
      if (action === "edit-purchase" && !original) return;
      const contacts = receipt ? state.customers : [...state.suppliers];
      if (original && !contacts.some(entry => entry.id === original.contact_id)) {
        contacts.push({id: original.contact_id,name: original.contact});
      }
      const products = receipt ? state.perfumes : [...state.articles];
      if (original && !products.some(entry => entry.id === original.article_id)) {
        products.push({id: original.article_id,name: original.description});
      }
      if (!contacts.length) return notify(receipt ? "Crea prima un cliente." : "Crea prima un fornitore.");
      if (!receipt && !products.length) return notify("Crea prima un articolo di base.");
      title = receipt ? "Nuovo incasso / Apporto Soci" : original ? "Modifica acquisto" : "Nuovo acquisto articolo";
      label = receipt ? "Registra" : original ? "Salva" : "Registra acquisto";
      fields = `<div class="form-grid">${input("Data","data",original?.occurred_on ?? today.format(new Date()),'type="date" required')}
        ${select(receipt ? "Cliente" : "Fornitore","contact",options(contacts,original?.contact_id))}
        ${receipt ? "" : input("NUM. DOC","document_number",original?.document_number,'maxlength="80"')}
        ${receipt ? select("Profumo","perfume",options(products),false) + numericInput("Importo (€)","amount")
          : select("Articolo di base","article",options(products,original?.article_id,articleLabel))
            + (original ? input("Costo unitario (€)","purchase_cost",String(original.unit_cost / scale).replace(".",","),'inputmode="decimal" maxlength="22" required')
              : input("Costo unitario (€)","display_cost","","readonly"))
            + input("Unità di misura","display_unit","","readonly")
            + numericInput("Quantità","quantity",original?.quantity)}</div>
        ${receipt ? "" : '<p class="purchase-total" id="purchase-total" aria-live="polite"></p>'}
        <label class="notes-field">Note<textarea name="note" rows="3" maxlength="1000">${escape(original?.notes)}</textarea></label>`;
      break;
    }
    case "equipment-list":
      if (!state.suppliers.length) return notify("Crea prima un fornitore.");
      title = "Attrezzi a lista";
      fields = `<div class="form-grid">
        ${input("Data","data",today.format(new Date()),'type="date" required')}
        ${select("Fornitore","supplier_id",options(state.suppliers))}
        </div><div class="table-wrap" tabindex="0" role="region" aria-label="Attrezzi da registrare">
          <table class="equipment-lines"><thead><tr><th scope="col">Descrizione</th><th scope="col">Importo (€)</th>
            <th scope="col">Note</th><th scope="col">Azioni</th></tr></thead><tbody>${equipmentLine()}</tbody></table>
        </div>${button("Aggiungi attrezzo","add-equipment-line","secondary","plus")}`;
      break;
    case "equipment": {
      if (id && !item) return;
      const suppliers = [...state.suppliers];
      if (item && !suppliers.some(supplier => supplier.id === item.supplier_id)) {
        suppliers.push({id:item.supplier_id,name:item.contact});
      }
      if (!suppliers.length) return notify("Crea prima un fornitore.");
      title = item ? "Modifica attrezzo" : "Nuovo attrezzo";
      fields = `<div class="form-grid">
        ${input("Data","data",item?.occurred_on ?? today.format(new Date()),'type="date" required')}
        ${input("Descrizione","description",item?.description,'maxlength="200" required')}
        ${numericInput("Importo (€)","amount",item?.amount)}
        ${select("Fornitore","supplier_id",options(suppliers,item?.supplier_id))}
        </div><label class="notes-field">Note<textarea name="notes" rows="3" maxlength="1000">${escape(item?.notes)}</textarea></label>`;
      break;
    }
    case "delete-equipment":
      if (!item) return;
      title = "Eliminare l’attrezzo?";
      label = "Conferma eliminazione";
      fields = `<div class="delete-summary"><strong>${escape(item.description)}</strong></div>`;
      break;
    case "user":
      title = item ? "Modifica utente" : "Nuovo utente";
      fields = `<div class="form-grid">${input("Utente","utente",item?.name,'required maxlength="120"')}
        ${select("Ruolo","role",`<option value="operator" ${selected(item?.role,"operator")}>Operatore</option><option value="admin" ${selected(item?.role,"admin")}>Amministratore</option>`)}
        ${input(item ? "Nuova password (facoltativa)" : "Password","password","",`type="password" autocomplete="new-password" minlength="5" maxlength="256" ${item ? "" : "required"}`)}
        ${select("Stato","active",`<option value="true">Attivo</option><option value="false" ${item?.active === 0 ? "selected" : ""}>Disattivato</option>`)}</div>`;
      break;
  }
  dialog.innerHTML = `<div class="dialog-heading"><h2 id="dialog-title">${title}</h2><div class="dialog-heading-actions">${action === "perfume" && item ? perfumeNavigation(id) : ""}
    ${action === "equipment" && !item ? button("Carica a lista","open-equipment-list","recipe-button","plus") : ""}
      <button type="button" class="icon-button" data-action="close" aria-label="Chiudi">${icon("close")}</button></div></div>
    <form data-form="${action}" data-id="${id || ""}">
      <div class="dialog-content">${fields}<p class="form-error" role="alert" hidden></p></div>
      <div class="dialog-actions">${item && ["article","customer","supplier"].includes(action)
        ? button("Elimina",`confirm-${action}-delete:${item.id}`,"article-delete delete-start") : ""}
        ${action === "perfume" ? `<div class="perfume-footer-tools">${recipeCopyControls(id)}
          <button type="button" class="button secondary" data-action="toggle-equivalences"
            aria-controls="recipe-equivalences" aria-expanded="${keepEquivalences}">Vis. Tabella Equivalenze</button></div>` : ""}
        ${(item && ["article","perfume","customer","supplier","user","equipment"].includes(action)) || action === "edit-purchase"
          ? button("STAMPA","print-dialog","recipe-button") : ""}
        ${button("Annulla","close")}<button class="button primary" type="submit">${label}</button></div>
    </form>`;
  if (action === "perfume") {
    dialog.innerHTML = `<div class="perfume-editor">${dialog.innerHTML}</div>
      <aside id="recipe-equivalences" aria-labelledby="recipe-equivalences-title" ${keepEquivalences ? "" : "hidden"}>
        <div class="dialog-heading"><h2 id="recipe-equivalences-title">Tabella Equivalenze</h2>
          <button type="button" class="icon-button" data-action="toggle-equivalences"
            aria-label="Chiudi Tabella Equivalenze">${icon("close")}</button></div>
        ${table("equivalents",state.equivalents ?? [])}
      </aside>`;
  }
  if (action === "receipt" || action === "purchase" || action === "edit-purchase" || action === "purchase-list" || action === "equipment-list" || action === "unload") {
    dialog.querySelector("form").dataset.requestKey = crypto.randomUUID();
  }
  if (action === "perfume") {
    const form = dialog.querySelector("form");
    form.dataset.initialFields = perfumeFormSnapshot(form);
  }
  if (!dialog.open) dialog.showModal();
  updatePreview();
}

function recipeCopyControls(id) {
  const sources = state.perfumes.filter(item => item.id !== id && state.recipes.some(line => line.perfume === item.id));
  return `<div class="recipe-copy">
    <button type="button" class="button recipe-button" data-action="show-recipe-copy"
      aria-controls="recipe-copy-picker" aria-expanded="false">Carica distinta Art. da:</button>
    <div id="recipe-copy-picker" hidden>
      ${sources.length ? `${select("Profumo","recipeSource",options(sources,null),false)}
        <small>La scelta sostituisce le righe della distinta nella scheda.</small>`
        : "<small>Nessun altro profumo ha una distinta da copiare.</small>"}
    </div></div>`;
}

function confirmArticleDelete(id) {
  const item = article(id);
  if (!item) return;
  dialog.innerHTML = `<div class="dialog-heading"><h2 id="dialog-title">Eliminare l’articolo?</h2>
    <button class="icon-button" data-action="close" aria-label="Chiudi">${icon("close")}</button></div>
    <form data-form="delete-article" data-id="${id}">
      <div class="dialog-content">
        <div class="delete-summary"><strong>${escape(item.name)}</strong>
          ${item.code ? `<small>Codice ${escape(item.code)}</small>` : ""}
          <small>Giacenza ${format(item.stock)} ${escape(unit(item.unit))}</small></div>
        <p>L’articolo verrà rimosso dall’archivio operativo. Gli acquisti già registrati resteranno nello storico.</p>
        <p class="form-error" role="alert" hidden></p>
      </div>
      <div class="dialog-actions">
        ${button("Annulla",`article:${id}`)}
        <button class="button article-delete delete-confirm" type="submit">Conferma eliminazione</button>
      </div>
    </form>`;
  dialog.querySelector(`[data-action="article:${id}"]`).focus();
}

function confirmContactDelete(kind,id) {
  const item = state[kind === "customer" ? "customers" : "suppliers"].find(contact => contact.id === id);
  if (!item) return;
  const label = kind === "customer" ? "cliente" : "fornitore";
  dialog.innerHTML = `<div class="dialog-heading"><h2 id="dialog-title">Eliminare il ${label}?</h2>
    <button class="icon-button" data-action="close" aria-label="Chiudi">${icon("close")}</button></div>
    <form data-form="delete-contact" data-id="${id}">
      <div class="dialog-content">
        <div class="delete-summary"><strong>${escape(item.name)}</strong></div>
        <p>La scheda verrà rimossa dall’anagrafica operativa. I movimenti già registrati resteranno in Contabilità.</p>
        <p class="form-error" role="alert" hidden></p>
      </div>
      <div class="dialog-actions">
        ${button("Annulla",`${kind}:${id}`)}
        <button class="button article-delete delete-confirm" type="submit">Conferma eliminazione</button>
      </div>
    </form>`;
  dialog.querySelector(`[data-action="${kind}:${id}"]`).focus();
}

function editMovement(id) {
  const item = state.movements.find(movement => movement.id === id);
  if (!item) return;
  const day = item.occurred_on ?? today.format(new Date(item.created.replace(" ","T") + "Z"));
  dialog.innerHTML = `<div class="dialog-heading"><h2 id="dialog-title">Modifica ${item.kind === "unload" ? "scarico" : "carico"}</h2>
    <button type="button" class="icon-button" data-action="close" aria-label="Chiudi">${icon("close")}</button></div>
    <form data-form="edit-movement" data-id="${id}">
      <div class="dialog-content">
        <div class="form-grid">${input("Data","data",day,'type="date" required')}
          ${input("Profumo","display_perfume",item.name,"readonly")}
          ${numericInput("Quantità","amount",item.amount)}</div>
        <label class="notes-field">Note<textarea name="note" rows="3" maxlength="1000">${escape(item.notes)}</textarea></label>
        <p class="form-error" role="alert" hidden></p>
      </div>
      <div class="dialog-actions">${button("Annulla","close")}<button class="button primary" type="submit">Salva</button></div>
    </form>`;
  dialog.showModal();
}

function confirmMovement(id) {
  const item = state.movements.find(movement => movement.id === id);
  if (!item) return;
  const load = item.kind !== "unload";
  dialog.innerHTML = `<div class="dialog-heading"><h2 id="dialog-title">Eliminare il movimento?</h2>
    <button class="icon-button" data-action="close" aria-label="Chiudi">${icon("close")}</button></div>
    <form data-form="cancel-movement" data-id="${id}">
      <div class="dialog-content">
        <div class="delete-summary"><strong>${escape(item.name)}</strong>
          <small>${load ? "Carico" : "Scarico"} · Quantità ${format(item.amount)}</small></div>
        <p>${load ? "Il profumo prodotto sarà sottratto dalla giacenza e gli articoli consumati saranno reintegrati."
          : "La quantità scaricata sarà reintegrata nella giacenza del profumo."}</p>
        <p class="form-error" role="alert" hidden></p>
      </div>
      <div class="dialog-actions">
        <button class="button secondary" type="button" data-action="close" autofocus>Annulla</button>
        <button class="button article-delete delete-confirm" type="submit">Conferma eliminazione</button>
      </div>
    </form>`;
  dialog.showModal();
}

const equivalenceKey = value => (value ?? "").trim().normalize("NFC").toLocaleLowerCase("it");

function recipeEquivalenceWarning(item, perfumeName) {
  if (!item || !perfumeName.trim()) return "";
  const code = equivalenceKey(item.code);
  const equivalences = state.equivalents ?? [];
  const matches = equivalences.filter(entry => code
    ? equivalenceKey(entry.code) === code
    : equivalenceKey(entry.description) === equivalenceKey(item.name));
  if (!matches.length || matches.some(entry => equivalenceKey(entry.name) === equivalenceKey(perfumeName))) return "";
  const names = [...new Set(matches.map(entry => entry.name))].join(", ");
  return `Non corrispondenza tra profumo ed equivalenza. L’articolo selezionato corrisponde a ${names}.`;
}

function updatePreview() {
  const purchase = dialog.querySelector('form:is([data-form="purchase"],[data-form="edit-purchase"])');
  if (purchase) {
    const id = Number(purchase.elements.article.value);
    const original = state.accounting.find(row => row.id === Number(purchase.dataset.id));
    const item = article(id);
    const sameArticle = original && original.article_id === id;
    let cost = sameArticle ? original.unit_cost : item?.cost;
    const costField = purchase.elements.purchase_cost;
    if (costField) {
      if (purchase.dataset.costArticle !== String(id)) {
        costField.value = cost == null ? "" : String(cost / scale).replace(".",",");
        purchase.dataset.costArticle = String(id);
      }
      const value = Number(costField.value.trim().replace(",", ".")) * scale;
      cost = /^\d+(?:[.,]\d{1,6})?$/.test(costField.value.trim()) && value <= 1e9 * scale
        ? Math.round(value) : undefined;
    } else {
      purchase.elements.display_cost.value = cost == null ? "" : euro(cost);
    }
    purchase.elements.display_unit.value = sameArticle ? original.unit : item ? unit(item.unit) : "";
    const preview = purchase.querySelector("#purchase-total");
    const quantity = purchase.elements.quantity.value.trim().replace(",", ".");
    const match = /^(\d*)(?:\.(\d{0,6}))?$/.exec(quantity);
    preview.textContent = "";
    if (cost === 0 && !costField) preview.textContent = "Imposta il costo unitario nella scheda dell’articolo di base.";
    else if (cost && match && quantity && quantity !== ".") {
      const scaled = BigInt((match[1] || "0") + (match[2] || "").padEnd(6,"0"));
      const cents = (BigInt(cost) * scaled + purchaseDivisor / 2n) / purchaseDivisor;
      if (scaled <= BigInt(1e9 * scale) && cents <= BigInt(1e9 * 100)) {
        preview.textContent = `Totale acquisto ${euro(Number(cents) * cent)}`;
      }
    }
  }
  let totalCost = 0;
  const perfumeName = dialog.querySelector('input[name="profumo"]')?.value ?? "";
  dialog.querySelectorAll(".recipe-line").forEach(line => {
    const item = article(Number(line.querySelector("select").value));
    line.querySelector(".line-meta").textContent = item ? `${unit(item.unit)} · ${euro(item.cost)} per unità · ${format(item.stock)} disponibili` : "";
    const warning = line.querySelector(".form-error");
    const message = recipeEquivalenceWarning(item,perfumeName);
    warning.hidden = !message;
    if (warning.textContent !== message) warning.textContent = message;
    const quantity = Number(line.querySelector("input").value.replace(",","."));
    if (Number.isFinite(quantity) && quantity > 0) totalCost += lineCost(item,quantity);
  });
  const recipeCost = dialog.querySelector("#recipe-cost");
  if (recipeCost) {
    const formatted = euro(totalCost);
    if (recipeCost.value !== formatted) recipeCost.value = formatted;
    const price = parseSalePrice(dialog.querySelector('input[name="price"]').value);
    const net = price === null ? null : Math.round(Number(price) * 100 / (1 + saleVatRate)) / 100;
    const netOutput = dialog.querySelector("#net-price");
    const marginOutput = dialog.querySelector("#sale-margin");
    netOutput.value = net === null ? "—" : saleMoney.format(net);
    marginOutput.value = net > 0 ? marginPercent.format((net - totalCost / scale) / net) : "—";
  }
  const preview = dialog.querySelector("#production-preview");
  if (!preview) return;
  const form = dialog.querySelector("form");
  const perfume = state.perfumes.find(item => item.id === Number(form.elements.perfume.value));
  const quantity = Number(form.elements.amount.value.replace(",","."));
  if (!perfume) { preview.innerHTML = ""; return; }
  preview.innerHTML = `<div class="preview"><strong>Scarico previsto dal magazzino</strong><ul>${recipe(perfume.id).map(line => {
    const item = article(line.article);
    const required = line.amount * (Number.isFinite(quantity) && quantity > 0 ? quantity : 1);
    return `<li><span>${escape(item.name)}</span><span>${format(required)} ${escape(unit(item.unit))}${required > item.stock ? ' · Giacenza insufficiente' : ''}</span></li>`;
  }).join("")}</ul><small>${quantity > 0 ? `Carico in ${escape(unit(perfume.unit))}` : "Quantità mostrate per una singola unità."}</small></div>`;
}

function parseSalePrice(text) {
  const value = text.trim();
  if (/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{0,2})?$/.test(value)) {
    return value.replaceAll(".", "").replace(",", ".");
  }
  if (/^(?:\d+\.\d{0,2}|[.,]\d{1,2})$/.test(value)) return value.replace(",", ".");
  return null;
}

document.addEventListener("focusout", event => {
  const field = event.target;
  if (!field.matches('form[data-form="perfume"] input[name="price"]')) return;
  const value = parseSalePrice(field.value);
  if (value !== null) {
    field.value = saleNumber.format(Number(value));
    updatePreview();
  }
});

function formData(form) {
  const action = form.dataset.form;
  const data = Object.fromEntries(new FormData(form));
  if (form.dataset.id) data.id = Number(form.dataset.id);
  if (data.unit) data.unit = Number(data.unit);
  if (action === "article") {
    data.scentora_perfume_id = data.scentora_perfume_id ? Number(data.scentora_perfume_id) : null;
    data.supplier_id = data.supplier_id ? Number(data.supplier_id) : null;
  }
  if (action === "produce" || action === "unload") data.id = Number(data.perfume);
  if (action === "unload") data.request_key = form.dataset.requestKey;
  if (action === "equipment-list") {
    return {
      data: data.data, supplier_id: Number(data.supplier_id), request_key: form.dataset.requestKey,
      lines: [...form.querySelectorAll(".equipment-lines tbody tr")].map(row =>
        Object.fromEntries([...row.querySelectorAll("input")].map(field => [field.name,field.value]))),
    };
  }
  if (action === "equipment") data.supplier_id = Number(data.supplier_id);
  if (action === "user") data.active = data.active === "true";
  if (action === "customer" || action === "supplier") data.kind = action;
  if (action === "receipt" || action === "purchase" || action === "edit-purchase") {
    data.contact = Number(data.contact);
    data.request_key = form.dataset.requestKey;
  }
  if (action === "receipt") data.perfume = data.perfume ? Number(data.perfume) : null;
  if (action === "purchase" || action === "edit-purchase") {
    data.article = Number(data.article);
    const item = article(data.article);
    data.unit = item?.unit;
    data.unit_cost = item ? item.cost / scale : null;
    delete data.display_cost;
    delete data.display_unit;
  }
  if (action === "purchase-list") {
    return {
      data: data.data, contact: Number(data.contact), request_key: form.dataset.requestKey,
      document_number: data.document_number,
      lines: [...form.querySelectorAll(".purchase-lines tbody tr")].map(row => {
        const id = Number(row.querySelector('[name="article"]').value);
        const item = article(id);
        return {article: id, unit: item?.unit, unit_cost: item ? item.cost / scale : null,
          quantity: row.querySelector('[name="quantity"]').value,
          note: row.querySelector('[name="note"]').value};
      }),
    };
  }
  if (action === "perfume") {
    const price = parseSalePrice(data.price);
    if (price === null) throw new Error("Inserisci un prezzo di vendita con al massimo due decimali.");
    data.price = price;
    data.recipe = [...form.querySelectorAll(".recipe-line")].map(line => ({
      article: Number(line.querySelector("select").value), amount: line.querySelector("input").value,
    }));
  }
  return data;
}

async function openLedger(id) {
  const contact = [...state.customers, ...state.suppliers].find(item => item.id === id);
  const movement = state.accounting.find(item => item.contact_id === id);
  const name = contact?.name ?? movement?.contact;
  const kind = contact?.kind ?? movement?.kind;
  if (!name) return;
  const category = kind === "customer" ? "Incassi" : "Acquisto Articoli";
  dialog.innerHTML = `<div class="dialog-heading"><h2 id="dialog-title">Contabile · ${escape(name)}</h2>
    <div class="dialog-heading-actions">
      ${kind === "supplier" ? '<button type="button" id="ledger-notes" class="button recipe-button" aria-controls="ledger-content" disabled>ELENCO SEPARATO</button>' : ""}
      <button class="icon-button" data-action="close" aria-label="Chiudi">${icon("close")}</button>
    </div></div>
    <div class="dialog-content" id="ledger-content"><p role="status">Caricamento movimenti…</p></div>
    <div class="dialog-actions">${button("STAMPA","print-dialog","recipe-button")} ${button("Chiudi","close")}</div>`;
  const content = dialog.querySelector("#ledger-content");
  dialog.showModal();
  try {
    const {movements} = await request(`contacts/${id}/ledger`);
    if (!dialog.open || !content.isConnected) return;
    const detail = movements.length ? `<div class="table-wrap" tabindex="0" role="region" aria-label="${category}">
      <table><thead><tr><th scope="col">Data</th><th scope="col">Descrizione</th><th scope="col">Importo</th><th scope="col">Note</th></tr></thead>
      <tbody>${movements.map(item => `<tr>${cell("Data",escape(shortDate(item.occurred_on)))}
        ${cell("Descrizione",escape(item.description))}${cell("Importo",euro(item.amount),"numeric")}${cell("Note",escape(item.notes),"notes-cell")}</tr>`).join("")}</tbody>
      <tfoot><tr><th scope="row" colspan="2">Totale</th>
        ${cell("Totale",euro(movements.reduce((sum,item) => sum + item.amount,0)),"numeric")}<td></td>
      </tr></tfoot></table></div>`
      : `<p><strong>Nessun movimento registrato.</strong></p><p>Qui compariranno i movimenti della sezione ${category} in Gestione Contabilità.</p>`;
    content.innerHTML = detail;
    const toggle = dialog.querySelector("#ledger-notes");
    if (toggle && movements.length) {
      const totals = new Map();
      for (const {notes, amount} of movements) {
        const note = notes?.trim() ?? "";
        totals.set(note, (totals.get(note) ?? 0) + amount);
      }
      const summary = `<div class="table-wrap" tabindex="0" role="region" aria-label="Totali per nota">
        <table><thead><tr><th scope="col">Fornitore</th><th scope="col">Nota</th><th scope="col">Totale</th></tr></thead>
        <tbody>${[...totals].map(([note, amount]) => `<tr>${cell("Fornitore",escape(name))}
          ${cell("Nota",note ? "Totale per " + escape(note) : "Senza note","notes-cell")}
          ${cell("Totale",saleMoney.format(amount / scale),"numeric")}</tr>`).join("")}</tbody></table></div>`;
      let showSummary = false;
      toggle.disabled = false;
      toggle.addEventListener("click", () => {
        showSummary = !showSummary;
        content.innerHTML = showSummary ? summary : detail;
        toggle.textContent = showSummary ? "VEDI MOVIMENTI" : "ELENCO SEPARATO";
        dialog.scrollTop = 0;
      });
    }
  } catch (error) {
    if (!dialog.open || !content.isConnected) return;
    if (error.status === 401) {
      dialog.close();
      renderLogin();
      notify("Sessione scaduta. Accedi nuovamente.");
      return;
    }
    content.innerHTML = `<p class="form-error" role="alert">${escape(error.message)}</p>`;
  }
}

document.addEventListener("submit", async event => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault();
  const action = form.dataset.form || "login";
  const submit = form.querySelector('[type="submit"]');
  const errorBox = form.querySelector('.form-error[role="alert"]');
  const label = submit.innerHTML;
  submit.disabled = true;
  submit.textContent = action === "login" ? "Accesso in corso…" : "Salvataggio…";
  errorBox.hidden = true;
  try {
    const data = formData(form);
    await request(data.kind ? "contact" : action, data);
    if (dialog.open) dialog.close();
    await refresh();
    const messages = {
      produce: "Carico registrato e magazzino aggiornato.",
      unload: "Scarico registrato e giacenza aggiornata.",
      purchase: "Acquisto registrato e giacenza aggiornata.",
      "edit-purchase": "Acquisto modificato.",
      "delete-purchase": "Acquisto eliminato.",
      "purchase-list": "Acquisti registrati e giacenze aggiornate.",
      "equipment-list": "Attrezzi registrati.",
      "delete-article": "Articolo eliminato.",
      "delete-contact": "Scheda eliminata.",
      "edit-movement": "Movimento modificato e giacenze aggiornate.",
      "cancel-movement": "Movimento eliminato e giacenze aggiornate.",
    };
    if (action !== "login") notify(messages[action] || "Modifiche salvate.");
  } catch (error) {
    if (error.status === 401 && action !== "login") {
      if (dialog.open) dialog.close();
      renderLogin();
      notify("Sessione scaduta. Accedi nuovamente.");
      return;
    }
    errorBox.textContent = error.message;
    errorBox.hidden = false;
  } finally {
    submit.disabled = false;
    submit.innerHTML = label;
  }
});

document.addEventListener("click", async event => {
  const control = event.target.closest("[data-action]");
  if (!control) return;
  const [action,id] = control.dataset.action.split(":");
  if (action === "print-page" || action === "print-dialog") printReport(action === "print-dialog");
  else if (action === "supplier-totals") openSupplierTotals(Number(id));
  else if (action === "zoom-perfume-photo") zoomPerfumePhoto(Number(id));
  else if (action === "perfume-photo") openPerfumePhoto(Number(id));
  else if (action === "remove-perfume-photo") {
    const container = control.closest("[data-photo-editor]");
    if (window.confirm("Rimuovere la foto di questo profumo?")) await updatePerfumePhoto(container,null);
  }
  else if (action === "production-capacity") openProductionCapacity(Number(id));
  else if (action === "article-history") await openArticleHistory(Number(id));
  else if (action === "purchase-document") openPurchaseDocument(Number(id));
  else if (action === "sort-document-number") {
    sortDocumentsByNumber = true;
    renderSearchResults();
    document.querySelector('[data-action="sort-document-number"]')?.focus();
  }
  else if (action === "sort-purchase-date") {
    purchaseDateOrder = purchaseDateOrder === "ascending" ? "descending" : "ascending";
    renderSearchResults();
    document.querySelector('[data-action="sort-purchase-date"]')?.focus();
  } else if (action === "clear-purchase-date") {
    purchaseDate = "";
    document.querySelector("#purchase-date").value = "";
    renderSearchResults();
  }
  else if (action === "stock-value") openStockValue();
  else if (action === "menu") {
    navOpen = !navOpen;
    document.querySelector("#sidebar").classList.toggle("open", navOpen);
    control.setAttribute("aria-expanded",navOpen);
    control.innerHTML = icon(navOpen ? "close" : "menu");
  } else if (action === "close") dialog.close();
  else if (action === "open-archives" && section() === "archives") openArchives();
  else if (action === "open-equipment-list") {
    const draft = new FormData(dialog.querySelector('form[data-form="equipment"]'));
    modal("equipment-list");
    const form = dialog.querySelector('form[data-form="equipment-list"]');
    for (const field of ["data","supplier_id","description","amount","notes"]) {
      form.elements[field].value = draft.get(field) ?? "";
    }
    form.elements.description.focus();
  } else if (action === "add-equipment-line") {
    const lines = dialog.querySelector(".equipment-lines tbody");
    if (lines.rows.length >= 50) return notify("Puoi inserire fino a 50 righe per lista.");
    lines.insertAdjacentHTML("beforeend",equipmentLine());
    lines.lastElementChild.querySelector("input").focus();
  } else if (action === "remove-equipment-line") {
    const row = control.closest("tr");
    if (row.parentElement.rows.length <= 1) return notify("La lista deve contenere almeno un attrezzo.");
    row.remove();
    dialog.querySelector('[data-action="add-equipment-line"]').focus();
  } else if (action === "add-purchase-line") {
    const lines = dialog.querySelector(".purchase-lines tbody");
    if (lines.rows.length >= 50) return notify("Puoi inserire fino a 50 righe per lista.");
    lines.insertAdjacentHTML("beforeend",purchaseLine());
    lines.lastElementChild.querySelector("select").focus();
  } else if (action === "remove-purchase-line") {
    const row = control.closest("tr");
    if (row.parentElement.rows.length <= 1) return notify("L’acquisto deve contenere almeno una riga.");
    row.remove();
    dialog.querySelector('[data-action="add-purchase-line"]').focus();
  } else if (action === "add-line") {
    const lines = dialog.querySelector("#recipe-lines");
    if (lines.children.length >= 100) return;
    lines.insertAdjacentHTML("beforeend",recipeLine());
    lines.lastElementChild.querySelector("select").focus();
  } else if (action === "remove-line") {
    if (dialog.querySelectorAll(".recipe-line").length > 1) {
      control.closest(".recipe-line").remove();
      updatePreview();
      dialog.querySelector('[data-action="add-line"]').focus();
    } else notify("La distinta deve contenere almeno un articolo.");
  } else if (action === "refresh") await refresh();
  else if (action === "logout") {
    try { await request("logout",{}); renderLogin(); }
    catch (error) { notify(error.message); }
  } else if (action === "ledger") await openLedger(Number(id));
  else if (action === "step-perfume") {
    const form = dialog.querySelector('form[data-form="perfume"]');
    if (!id || !form || form.querySelector('[type="submit"]').disabled) return;
    if (form.dataset.initialFields !== perfumeFormSnapshot(form)
      && !window.confirm("Ci sono modifiche da salvare. Passare a un altro profumo senza salvarle?")) return;
    modal("perfume",Number(id),!dialog.querySelector("#recipe-equivalences").hidden);
    const steps = [...dialog.querySelectorAll(".perfume-step")];
    const nextFocus = steps[control.textContent.trim() === "‹" ? 0 : 1];
    (nextFocus?.disabled ? steps.find(step => !step.disabled) : nextFocus)?.focus();
  }
  else if (action === "toggle-equivalences") {
    const panel = dialog.querySelector("#recipe-equivalences");
    const trigger = dialog.querySelector(".dialog-actions [data-action='toggle-equivalences']");
    panel.hidden = !panel.hidden;
    trigger.setAttribute("aria-expanded",String(!panel.hidden));
    if (panel.hidden) trigger.focus();
    else if (matchMedia("(max-width: 900px)").matches) panel.scrollIntoView({block:"nearest"});
  }
  else if (action === "show-recipe-copy") {
    const picker = dialog.querySelector("#recipe-copy-picker");
    picker.hidden = !picker.hidden;
    control.setAttribute("aria-expanded",String(!picker.hidden));
    if (!picker.hidden) picker.querySelector("select")?.focus();
  }
  else if (action === "confirm-article-delete") confirmArticleDelete(Number(id));
  else if (action === "confirm-customer-delete") confirmContactDelete("customer",Number(id));
  else if (action === "confirm-supplier-delete") confirmContactDelete("supplier",Number(id));
  else if (action === "edit-movement") editMovement(Number(id));
  else if (action === "confirm-movement") confirmMovement(Number(id));
  else modal(action,Number(id));
});

function renderSearchResults() {
  const key = section();
  document.querySelector("#results").innerHTML = table(key,filtered(key));
  updateCount();
}

function updateCount() {
  const count = document.querySelector("#count");
  if (count) {
    const matches = filtered(section());
    const total = matches.length;
    count.textContent = total === 1 ? "1 voce" : number.format(total) + " voci";
    const equipment = document.querySelector("#equipment-total strong");
    if (equipment) {
      const amount = matches.reduce((sum,item) => sum + BigInt(item.amount),0n);
      equipment.textContent = stockMoney(amount * BigInt(scale));
    }
    const summary = document.querySelector("#purchase-search-total");
    if (summary) {
      summary.hidden = !query.trim() && !purchaseDate;
      if (!summary.hidden) {
        const amount = matches.reduce((sum,item) => sum + item.amount,0);
        summary.textContent = "Totale ricerca · " + saleMoney.format(amount / scale);
      }
    }
  }
}
document.addEventListener("change", event => {
  if (event.target.matches(".perfume-photo-input") && event.target.files[0]) {
    void updatePerfumePhoto(event.target.closest("[data-photo-editor]"),event.target.files[0]);
    return;
  }
  if (event.target.name === "analysis-perfume") showAnalysis(event.target);
  if (event.target.matches('.purchase-lines select[name="article"]')) {
    const row = event.target.closest("tr");
    const item = article(Number(event.target.value));
    const perfume = state.perfumes.find(entry => entry.id === item?.scentora_perfume_id);
    row.querySelector("[data-purchase-code]").textContent = item?.code ?? "";
    row.querySelector("[data-purchase-perfume]").textContent = perfume?.name ?? "";
    row.querySelector("[data-purchase-unit]").textContent = item ? unit(item.unit) : "";
    row.querySelector("[data-purchase-cost]").textContent = item ? euro(item.cost) : "";
  }
  if (!event.target.matches('#recipe-copy-picker select[name="recipeSource"]')) return;
  const lines = recipe(Number(event.target.value));
  if (!lines.length) return;
  dialog.querySelector("#recipe-lines").innerHTML = lines.map(line => recipeLine(line)).join("");
  event.target.value = "";
  const picker = dialog.querySelector("#recipe-copy-picker");
  const trigger = dialog.querySelector('[data-action="show-recipe-copy"]');
  picker.hidden = true;
  trigger.setAttribute("aria-expanded","false");
  trigger.focus();
  updatePreview();
  notify("Distinta caricata nella scheda. Premi Salva per confermare.");
});

document.addEventListener("input", event => {
  if (event.target.id === "search" || event.target.id === "purchase-date") {
    if (event.target.id === "search") query = event.target.value;
    else purchaseDate = event.target.value;
    renderSearchResults();
  }
  if (dialog.contains(event.target)) updatePreview();
});
window.addEventListener("hashchange", () => {
  if (!state) return;
  query = "";
  purchaseDate = "";
  navOpen = false;
  render();
  document.querySelector("#main").focus();
  window.scrollTo(0,0);
});
refresh();
