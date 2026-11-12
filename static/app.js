"use strict";

const root = document.querySelector("#app");
const dialog = document.querySelector("#dialog");
const notifications = document.querySelector("#notifications");
const sections = {
  dashboard: ["Panoramica", "home"],
  articles: ["Articoli di base", "box"],
  perfumes: ["Profumi", "bottle"],
  movements: ["Produzione", "clock"],
  units: ["Elenchi", "list"],
  users: ["Utenti", "users"],
};
const paths = {
  home: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  box: '<path d="m3 7 9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10M7.5 5l9 4"/>',
  bottle: '<path d="M9 3h6v5H9zM8 8h8l3 4v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7zM5 13h14"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l4 2"/>',
  list: '<path d="M9 6h12M9 12h12M9 18h12M3 6h2M3 12h2M3 18h2"/>',
  users: '<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2m1-15a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 5v1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  logout: '<path d="M11 4H5v16h6m4-12 4 4-4 4m4-4H9"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
const mark = '<svg viewBox="0 0 40 40" fill="none" aria-hidden="true"><path d="M20 4c0 9 7 16 16 16-9 0-16 7-16 16 0-9-7-16-16-16 9 0 16-7 16-16Z" stroke="currentColor"/><path d="M20 11c0 5 4 9 9 9-5 0-9 4-9 9 0-5-4-9-9-9 5 0 9-4 9-9Z" stroke="currentColor"/></svg>';
const escape = value => String(value ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
const scale = 1e6;
const number = new Intl.NumberFormat("it-IT", {maximumFractionDigits: 6});
const money = new Intl.NumberFormat("it-IT", {style:"currency", currency:"EUR", maximumFractionDigits: 6});
const date = new Intl.DateTimeFormat("it-IT", {dateStyle:"short", timeStyle:"short", timeZone:"Europe/Rome"});
const format = value => number.format(value / scale);
const euro = value => money.format(value / scale);
let state;
let query = "";
let navOpen = false;
let notificationTimer;

function section() {
  const key = location.hash.slice(1);
  return Object.hasOwn(sections,key) && (key !== "users" || state?.user.role === "admin") ? key : "dashboard";
}
const unit = id => state.units.find(item => item.id === id)?.name ?? "";
const article = id => state.articles.find(item => item.id === id);
const recipe = id => state.recipes.filter(line => line.perfume === id);
const cost = id => recipe(id).reduce((total,line) => total + (article(line.article)?.cost ?? 0) * line.amount / scale, 0);
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
  const links = Object.entries(sections).filter(([key]) => key !== "users" || state.user.role === "admin")
    .map(([key,[label,symbol]]) => `<a href="#${key}" ${current === key ? 'aria-current="page"' : ""}>${icon(symbol)}${label}</a>`).join("");
  root.innerHTML = `<div class="shell">
    <aside id="sidebar" class="sidebar ${navOpen ? "open" : ""}">${brand}
      <nav aria-label="Menu principale">${links}</nav>
      <div class="account"><div class="avatar" aria-hidden="true">${escape(state.user.name.slice(0,1).toUpperCase())}</div>
        <div class="identity"><strong>${escape(state.user.name)}</strong><small>${state.user.role === "admin" ? "Amministratore" : "Operatore"}</small></div>
        ${state.demo ? "" : `<button class="icon-button" data-action="logout" aria-label="Esci">${icon("logout")}</button>`}
      </div>
    </aside>
    <main id="main" tabindex="-1">
      <header class="topbar">
        <button class="icon-button menu-button" data-action="menu" aria-label="Menu principale" aria-expanded="${navOpen}" aria-controls="sidebar">${icon(navOpen ? "close" : "menu")}</button>
        <span class="breadcrumb">Scentora <span aria-hidden="true">/</span> ${sections[current][0]}</span>
        ${state.demo ? '<span class="demo-chip">Modalità demo</span>' : ""}
      </header>
      <div class="work" id="work">${current === "dashboard" ? dashboard() : listing(current)}</div>
    </main></div>`;
  updateCount();
}

function dashboard() {
  const counts = [["Articoli di base", state.articles.length, "articles", "box"],
    ["Profumi a catalogo", state.perfumes.length, "perfumes", "bottle"],
    ["Carichi registrati", state.movements.length >= 100 ? "100+" : state.movements.length, "movements", "clock"]];
  return `<section class="hero">
      <div class="hero-art" aria-hidden="true"><i></i><i></i><i></i>${mark}</div>
      <div class="hero-content"><p class="eyebrow">SCENTORA / PRODUZIONE</p><h1>Panoramica</h1>
      <p>Giacenze, distinte base e carichi di produzione.</p>
      ${button("Carica profumo", "produce", "primary", "plus")}</div>
    </section>
    <section class="metrics" aria-label="Riepilogo">${counts.map(([label,value,link,symbol]) => `<a class="metric" href="#${link}">
      <span class="metric-icon">${icon(symbol)}</span><span class="metric-label">${label}</span><strong>${value}</strong><span class="metric-arrow">${icon("arrow")}</span>
    </a>`).join("")}</section>
    <section class="panel"><div class="panel-heading"><h2>Ultimi carichi</h2><a class="text-link" href="#movements">Vedi produzione ${icon("arrow")}</a></div>
    ${table("movements", state.movements.slice(0,5))}</section>`;
}

const settings = {
  articles: ["Gestisci codici, costi e disponibilità di magazzino.", "Nuovo articolo", "article", "Cerca per codice o descrizione"],
  perfumes: ["Consulta il catalogo e configura le distinte base.", "Nuovo profumo", "perfume", "Cerca un profumo"],
  movements: ["Consulta gli ultimi 100 carichi di produzione.", "Carica profumo", "produce", "Cerca per profumo o operatore"],
  units: ["Unità di misura disponibili nelle schede.", "Nuova unità", "unit", "Cerca un’unità"],
  users: ["Gestisci gli account e i ruoli di accesso.", "Nuovo utente", "user", "Cerca un utente"],
};

function listing(key) {
  const [description,label,action,placeholder] = settings[key];
  const canCreate = key !== "units" || state.user.role === "admin";
  return `<div class="page-heading"><div><h1>${sections[key][0]}</h1><p>${description}</p></div>
    <div class="actions">${key === "perfumes" ? button("Carica profumo","produce") : ""}
    ${canCreate ? button(label,action,"primary","plus") : ""}</div></div>
    <section class="panel"><div class="panel-heading"><label class="search">${icon("search")}<input type="search" id="search" aria-label="${placeholder}" placeholder="${placeholder}" value="${escape(query)}"></label><span class="count" id="count" aria-live="polite"></span></div>
    <div id="results">${table(key,filtered(key))}</div></section>`;
}

function filtered(key) {
  return state[key].filter(item => [item.name,item.code,item.actor].some(value =>
    String(value ?? "").toLocaleLowerCase("it").includes(query.trim().toLocaleLowerCase("it"))));
}

const cell = (label,value,style = "") => `<td data-label="${label}" class="${style}">${value}</td>`;
function table(key, items) {
  if (!items.length) {
    const messages = {articles:"Aggiungi il primo articolo di base.", perfumes:"Crea un profumo con la sua distinta base.",
      movements:"I carichi confermati compariranno qui.", units:"Aggiungi un’unità di misura.", users:"Crea il primo utente."};
    return `<div class="empty"><span class="metric-icon">${icon(sections[key][1])}</span><strong>${query ? "Nessun risultato" : "Nessuna voce da mostrare"}</strong>
      <span>${query ? "Prova un altro termine di ricerca." : messages[key]}</span></div>`;
  }
  const headings = {
    articles:["Codice","Descrizione","Unità","Costo unitario","Giacenza","Azioni"],
    perfumes:["Profumo","Unità","Costo distinta","Prezzo vendita","Giacenza","Azioni"],
    movements:["Profumo","Data e ora","Operatore","Quantità"],
    units:["Unità di misura"],
    users:["Utente","Ruolo","Stato","Azioni"],
  }[key];
  const body = items.map(item => {
    const name = escape(item.name);
    switch (key) {
      case "articles":
        return cell("Codice",`<span class="code">${escape(item.code)}</span>`) + cell("Descrizione",`<strong>${name}</strong>`)
          + cell("Unità",escape(unit(item.unit))) + cell("Costo unitario",euro(item.cost),"numeric")
          + cell("Giacenza",`<span class="stock ${item.stock ? "" : "zero"}">${format(item.stock)}</span>`,"numeric")
          + cell("Azioni",button("Movimenta",`stock:${item.id}`,"inline") + button("Modifica",`article:${item.id}`,"inline"),"row-actions");
      case "perfumes":
        return cell("Profumo",`<strong>${name}</strong>`) + cell("Unità",escape(unit(item.unit)))
          + cell("Costo distinta",euro(cost(item.id)),"numeric") + cell("Prezzo vendita",euro(item.price),"numeric")
          + cell("Giacenza",format(item.stock),"numeric")
          + cell("Azioni",button("Carica",`produce:${item.id}`,"inline") + button("Modifica",`perfume:${item.id}`,"inline"),"row-actions");
      case "movements":
        return cell("Profumo",`<strong>${name}</strong>`) + cell("Data e ora",date.format(new Date(item.created.replace(" ","T")+"Z")))
          + cell("Operatore",escape(item.actor)) + cell("Quantità",format(item.amount),"numeric");
      case "units":
        return cell("Unità di misura",`<strong>${name}</strong>`);
      default:
        return cell("Utente",`<strong>${name}</strong>`) + cell("Ruolo",item.role === "admin" ? "Amministratore" : "Operatore")
          + cell("Stato",`<span class="stock ${item.active ? "" : "zero"}">${item.active ? "Attivo" : "Disattivato"}</span>`)
          + cell("Azioni",button("Modifica",`user:${item.id}`,"inline"),"row-actions");
    }
  }).map(row => `<tr>${row}</tr>`).join("");
  return `<div class="table-wrap" tabindex="0" role="region" aria-label="Tabella ${sections[key][0]}"><table aria-label="${sections[key][0]}"><thead><tr>${headings.map(label => `<th scope="col">${label}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table></div>`;
}

const options = (items,id,label = item => item.name) => '<option value="">Seleziona…</option>' +
  items.map(item => `<option value="${item.id}" ${item.id === id ? "selected" : ""}>${escape(label(item))}</option>`).join("");
const input = (label,name,value = "",attrs = "required") => `<label>${label}<input name="${name}" value="${escape(value)}" ${attrs}></label>`;
const numericInput = (label,name,value,required = true) => input(label,name,value == null ? "" : value / scale,`inputmode="decimal" maxlength="22" ${required ? "required" : ""}`);
const select = (label,name,choices) => `<label>${label}<select name="${name}" required>${choices}</select></label>`;
const units = id => select("Unità di misura","unit",options(state.units,id));
const selected = (a,b) => a === b ? "selected" : "";

function recipeLine(line = {}) {
  return `<div class="recipe-line">
    ${select("Articolo di base","lineArticle",options(state.articles,line.article,item => item.code + " · " + item.name))}
    ${numericInput("Quantità per unità","lineAmount",line.amount)}
    <button type="button" class="icon-button" data-action="remove-line" aria-label="Rimuovi riga">${icon("close")}</button>
    <span class="line-meta"></span></div>`;
}

function modal(action,id) {
  const item = id ? ({
    article:state.articles, stock:state.articles, perfume:state.perfumes,
    produce:state.perfumes, user:state.users,
  }[action] || []).find(record => record.id === id) : undefined;
  let title, fields, label = "Salva";
  switch (action) {
    case "article":
      title = item ? "Modifica articolo" : "Nuovo articolo di base";
      fields = `<div class="form-grid">${input("Codice","codice",item?.code,'required maxlength="40"')}
        ${input("Descrizione","descrizione",item?.name,'required maxlength="120"')}${units(item?.unit)}
        ${numericInput("Costo unitario (€)","cost",item?.cost)}
        ${item ? "" : numericInput("Giacenza iniziale","stock",null,false)}</div>`;
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
        ${numericInput("Prezzo vendita (€)","price",item?.price)}</div>
        <fieldset><legend>Distinta base</legend><div id="recipe-lines">${(item ? recipe(id) : [{}]).map(recipeLine).join("")}</div>
        ${button("Aggiungi articolo","add-line","secondary","plus")}</fieldset>`;
      break;
    case "produce":
      if (!state.perfumes.length) return notify("Crea prima un profumo con la sua distinta base.");
      title = "Carica profumo";
      label = "Conferma carico";
      fields = `<div class="form-grid">${select("Profumo","perfume",options(state.perfumes,id || (state.perfumes.length === 1 ? state.perfumes[0].id : null)))}
        ${numericInput("Quantità da caricare","amount")}</div><div id="production-preview" aria-live="polite"></div>`;
      break;
    case "unit":
      title = "Nuova unità di misura";
      fields = input("Unità di misura","unità","","required maxlength=24");
      break;
    case "user":
      title = item ? "Modifica utente" : "Nuovo utente";
      fields = `<div class="form-grid">${input("Utente","utente",item?.name,'required maxlength="120"')}
        ${select("Ruolo","role",`<option value="operator" ${selected(item?.role,"operator")}>Operatore</option><option value="admin" ${selected(item?.role,"admin")}>Amministratore</option>`)}
        ${input(item ? "Nuova password (facoltativa)" : "Password","password","",`type="password" autocomplete="new-password" minlength="12" maxlength="256" ${item ? "" : "required"}`)}
        ${select("Stato","active",`<option value="true">Attivo</option><option value="false" ${item?.active === 0 ? "selected" : ""}>Disattivato</option>`)}</div>`;
      break;
  }
  dialog.innerHTML = `<div class="dialog-heading"><h2 id="dialog-title">${title}</h2><button class="icon-button" data-action="close" aria-label="Chiudi">${icon("close")}</button></div>
    <form data-form="${action}" data-id="${id || ""}">
      <div class="dialog-content">${fields}<p class="form-error" role="alert" hidden></p></div>
      <div class="dialog-actions">${button("Annulla","close")}<button class="button primary" type="submit">${label}</button></div>
    </form>`;
  dialog.showModal();
  updatePreview();
}

function updatePreview() {
  dialog.querySelectorAll(".recipe-line").forEach(line => {
    const item = article(Number(line.querySelector("select").value));
    line.querySelector(".line-meta").textContent = item ? `${unit(item.unit)} · ${euro(item.cost)} per unità · ${format(item.stock)} disponibili` : "";
  });
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

function formData(form) {
  const action = form.dataset.form;
  const data = Object.fromEntries(new FormData(form));
  if (form.dataset.id) data.id = Number(form.dataset.id);
  if (data.unit) data.unit = Number(data.unit);
  if (action === "produce") data.id = Number(data.perfume);
  if (action === "user") data.active = data.active === "true";
  if (action === "perfume") data.recipe = [...form.querySelectorAll(".recipe-line")].map(line => ({
    article: Number(line.querySelector("select").value), amount: line.querySelector("input").value,
  }));
  return data;
}

document.addEventListener("submit", async event => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault();
  const action = form.dataset.form || "login";
  const submit = form.querySelector('[type="submit"]');
  const errorBox = form.querySelector(".form-error");
  const label = submit.innerHTML;
  submit.disabled = true;
  submit.textContent = action === "login" ? "Accesso in corso…" : "Salvataggio…";
  errorBox.hidden = true;
  try {
    await request(action, formData(form));
    if (dialog.open) dialog.close();
    await refresh();
    if (action !== "login") notify(action === "produce" ? "Carico registrato e magazzino aggiornato." : "Modifiche salvate.");
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
  if (action === "menu") {
    navOpen = !navOpen;
    document.querySelector("#sidebar").classList.toggle("open", navOpen);
    control.setAttribute("aria-expanded",navOpen);
    control.innerHTML = icon(navOpen ? "close" : "menu");
  } else if (action === "close") dialog.close();
  else if (action === "add-line") {
    const lines = dialog.querySelector("#recipe-lines");
    if (lines.children.length >= 100) return;
    lines.insertAdjacentHTML("beforeend",recipeLine());
    lines.lastElementChild.querySelector("select").focus();
  } else if (action === "remove-line") {
    if (dialog.querySelectorAll(".recipe-line").length > 1) {
      control.closest(".recipe-line").remove();
      dialog.querySelector('[data-action="add-line"]').focus();
    } else notify("La distinta deve contenere almeno un articolo.");
  } else if (action === "refresh") await refresh();
  else if (action === "logout") {
    try { await request("logout",{}); renderLogin(); }
    catch (error) { notify(error.message); }
  } else modal(action,Number(id));
});

function updateCount() {
  const count = document.querySelector("#count");
  if (count) {
    const total = filtered(section()).length;
    count.textContent = total === 1 ? "1 voce" : total + " voci";
  }
}
document.addEventListener("input", event => {
  if (event.target.id === "search") {
    query = event.target.value;
    document.querySelector("#results").innerHTML = table(section(),filtered(section()));
    updateCount();
  }
  if (dialog.contains(event.target)) updatePreview();
});
window.addEventListener("hashchange", () => {
  if (!state) return;
  query = "";
  navOpen = false;
  render();
  document.querySelector("#main").focus();
  window.scrollTo(0,0);
});
refresh();
