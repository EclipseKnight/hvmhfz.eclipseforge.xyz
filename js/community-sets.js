/* Community sets page (community-sets.html): armour sets that hunters posted from the Set builder.

   Browse: filters (hunter rank band, "up to my rank", stage, weapon class, skills any/all, sort Top/New) and paging.
   The filters live in the address (?band=hr4&stage=zenith&skill=12&skill=40&match=all&sort=new&page=1), so a
   filtered list can be linked. ?id=N opens one set: its pieces with names, decorations, cuffs, skills, votes, "Open in
   the Set builder", Upvote / Remove vote, Report and Share. Signed in: "My sets" (edit the details, delete, change the
   pieces in the builder). Signed out: browsing works, the other buttons say "Sign in to ...".

   The API is /api/public/armor-sets and /api/account/armor-sets (js/community-api.js, docs/armor-set-builder.md
   "Community sets"). Titles, notes, author names and reasons come from players: they are only ever put in with
   textContent. Errors show the API's message as it is. The names of pieces, decorations and skills come from the
   Set builder's static data (data/armor/). */
(function () {
  "use strict";

  var Api = window.CommunityApi;
  var Calc = window.ArmorCalc;
  var Form = window.SetPostForm;
  var PAGE_SIZE = 20;
  var MAX_SKILLS = 10;
  var CARD_SKILLS = 6;          // skills named on a card before "+N more"
  var WEAPONS = ["Great Sword", "Heavy Bowgun", "Hammer", "Lance", "Sword and Shield", "Light Bowgun", "Dual Swords",
                 "Long Sword", "Hunting Horn", "Gunlance", "Bow", "Tonfa", "Switch Axe F", "Magnet Spike"];
  var WEAPON_SLUGS = ["great-sword", "heavy-bowgun", "hammer", "lance", "sword-and-shield", "light-bowgun", "dual-swords",
                      "long-sword", "hunting-horn", "gunlance", "bow", "tonfa", "switch-axe-f", "magnet-spike"];
  var SLOT_NAMES = { head: "Head", chest: "Chest", arms: "Arms", waist: "Waist", legs: "Legs" };

  var listView = document.getElementById("cs-list-view");
  var detailView = document.getElementById("cs-detail-view");
  var statusBox = document.getElementById("cs-status");
  var mineBox = document.getElementById("cs-mine");

  var options = null;           // bands, stages, limits
  var catalog = null;           // data/armor/index.json: skillNames, decorations, sigils, version
  var skillIdByName = {};       // lower-case skill name -> id
  var mine = { items: [], open: null, characters: null, message: "" };
  var listSearch = "";          // the address of the list, for "All community sets" on a set's page
  var listSeq = 0;
  var detailSeq = 0;
  var filters = blank();

  function $(id) { return document.getElementById(id); }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function say(box, text) {
    box.textContent = text || "";
    box.hidden = !text;
  }

  function getJson(url) {
    return fetch(url).then(function (res) {
      if (!res.ok) throw new Error(url + ": " + res.status);
      return res.json();
    });
  }

  // ---- names ---------------------------------------------------------------------------------------

  function skillName(id) { return (catalog && catalog.skillNames && catalog.skillNames[id]) || "Skill " + id; }
  function weaponClassName(c) { return WEAPONS[c] || "Any weapon"; }
  function bandLabel(key) {
    var found = options.bands.filter(function (b) { return b.key === key; })[0];
    return found ? found.label : key;
  }
  function stageLabel(key) {
    var found = options.stages.filter(function (s) { return s.key === key; })[0];
    return found ? found.label : key;
  }

  function dateText(iso) {
    var t = iso ? Date.parse(iso) : NaN;
    return isNaN(t) ? "" : new Date(t).toISOString().slice(0, 10);
  }

  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }

  // ---- the filters in the address ------------------------------------------------------------------

  function blank() { return { band: "", upTo: "", stage: "", weapon: "", skills: [], match: "any", sort: "top", page: 0 }; }

  /** The filters a query string holds; anything that is not a plain key or number is dropped. */
  function parseFilters(search) {
    var q = new URLSearchParams(search);
    var f = blank();
    var key = function (v) { return /^[a-z0-9]{1,12}$/.test(v || "") ? v : ""; };
    f.band = key(q.get("band"));
    f.upTo = key(q.get("upTo"));
    if (f.band && f.upTo) f.upTo = "";
    f.stage = key(q.get("stage"));
    f.weapon = /^\d{1,2}$/.test(q.get("weapon") || "") && Number(q.get("weapon")) <= 13 ? q.get("weapon") : "";
    q.getAll("skill").forEach(function (s) {
      if (/^\d{1,5}$/.test(s) && f.skills.indexOf(Number(s)) === -1 && f.skills.length < MAX_SKILLS) f.skills.push(Number(s));
    });
    f.match = q.get("match") === "all" ? "all" : "any";
    f.sort = q.get("sort") === "new" ? "new" : "top";
    f.page = /^\d{1,4}$/.test(q.get("page") || "") ? Number(q.get("page")) : 0;
    return f;
  }

  /** The query string of the filters; the address leaves out what is the default, the API gets the page size too. */
  function queryOf(f, forApi) {
    var q = new URLSearchParams();
    if (f.band) q.set("band", f.band);
    if (f.upTo) q.set("upTo", f.upTo);
    if (f.stage) q.set("stage", f.stage);
    if (f.weapon !== "") q.set("weapon", f.weapon);
    f.skills.forEach(function (s) { q.append("skill", String(s)); });
    if (f.skills.length && (forApi || f.match !== "any")) q.set("match", f.match);
    if (forApi || f.sort !== "top") q.set("sort", f.sort);
    if (forApi || f.page) q.set("page", String(f.page));
    if (forApi) q.set("size", String(PAGE_SIZE));
    return q.toString();
  }

  function addressOf(f) {
    var q = queryOf(f, false);
    return location.pathname + (q ? "?" + q : "");
  }

  // ---- the filter form -----------------------------------------------------------------------------

  function fillSelect(select, first, list) {
    clear(select);
    var any = el("option", null, first);
    any.value = "";
    select.appendChild(any);
    list.forEach(function (o) {
      var opt = el("option", null, o.label);
      opt.value = o.value;
      select.appendChild(opt);
    });
  }

  function buildFilterControls() {
    fillSelect($("cs-band"), "Any band", options.bands.map(function (b) { return { value: b.key, label: b.label }; }));
    fillSelect($("cs-upto"), "Not used", options.bands.map(function (b) { return { value: b.key, label: "Up to " + b.label }; }));
    fillSelect($("cs-stage"), "Any stage", options.stages.filter(function (s) { return s.key; })
      .map(function (s) { return { value: s.key, label: s.label }; }));
    fillSelect($("cs-weapon"), "Any weapon", WEAPONS.map(function (name, i) { return { value: String(i), label: name }; }));
    var names = $("cs-skill-names");
    Object.keys(catalog.skillNames).forEach(function (id) {
      var name = catalog.skillNames[id];
      skillIdByName[name.toLowerCase()] = Number(id);
      var opt = el("option");
      opt.value = name;
      names.appendChild(opt);
    });
  }

  function syncForm() {
    $("cs-band").value = filters.band;
    $("cs-upto").value = filters.upTo;
    $("cs-stage").value = filters.stage;
    $("cs-weapon").value = filters.weapon;
    $("cs-sort").value = filters.sort;
    $("cs-match").value = filters.match;
    var chips = $("cs-skill-chips");
    clear(chips);
    filters.skills.forEach(function (id) {
      var li = el("li", "cs-skill-chip");
      li.setAttribute("data-skill", id);
      li.appendChild(el("span", null, skillName(id)));
      var x = el("button", "cs-chip-x", "x");
      x.type = "button";
      x.setAttribute("aria-label", "Remove " + skillName(id));
      x.addEventListener("click", function () {
        filters.skills = filters.skills.filter(function (s) { return s !== id; });
        apply();
      });
      li.appendChild(x);
      chips.appendChild(li);
    });
    $("cs-match").hidden = filters.skills.length < 2;
  }

  /** The form's values into `filters`, back to page one, into the address, and the list again. */
  function apply(fromForm) {
    if (fromForm) {
      filters.band = $("cs-band").value;
      filters.upTo = $("cs-upto").value;
      filters.stage = $("cs-stage").value;
      filters.weapon = $("cs-weapon").value;
      filters.sort = $("cs-sort").value;
      filters.match = $("cs-match").value;
    }
    filters.page = 0;
    commit();
  }

  function commit() {
    history.replaceState(null, "", addressOf(filters));
    listSearch = addressOf(filters);
    syncForm();
    loadList();
  }

  function addSkillFromBox() {
    var box = $("cs-skill");
    var note = $("cs-skill-note");
    var id = skillIdByName[box.value.trim().toLowerCase()];
    if (!box.value.trim()) return;
    if (!id) { say(note, "No skill is called \"" + box.value.trim() + "\". Pick one from the list."); return; }
    if (filters.skills.indexOf(id) !== -1) { say(note, ""); box.value = ""; return; }
    if (filters.skills.length >= MAX_SKILLS) { say(note, "At most " + MAX_SKILLS + " skills."); return; }
    say(note, "");
    box.value = "";
    filters.skills.push(id);
    apply();
  }

  function wireFilters() {
    ["cs-band", "cs-stage", "cs-weapon", "cs-sort", "cs-match"].forEach(function (id) {
      $(id).addEventListener("change", function () {
        // a band and "up to my rank" do not combine: the one just chosen wins
        if (id === "cs-band" && $("cs-band").value) $("cs-upto").value = "";
        apply(true);
      });
    });
    $("cs-upto").addEventListener("change", function () {
      if ($("cs-upto").value) $("cs-band").value = "";
      apply(true);
    });
    $("cs-skill-add").addEventListener("click", addSkillFromBox);
    $("cs-skill").addEventListener("keydown", function (event) {
      if (event.key === "Enter") { event.preventDefault(); addSkillFromBox(); }
    });
    $("cs-skill").addEventListener("change", function () {
      // choosing from the suggestions fires change with the full name
      if (skillIdByName[$("cs-skill").value.trim().toLowerCase()]) addSkillFromBox();
    });
    $("cs-clear").addEventListener("click", function () {
      filters = blank();
      commit();
    });
    $("cs-form").addEventListener("submit", function (event) { event.preventDefault(); });
    $("cs-prev").addEventListener("click", function () { if (filters.page > 0) { filters.page -= 1; commit(); } });
    $("cs-next").addEventListener("click", function () { filters.page += 1; commit(); });
  }

  // ---- the list ------------------------------------------------------------------------------------

  function openSet(id) {
    history.pushState(null, "", location.pathname + "?id=" + id);
    route();
    window.scrollTo(0, 0);
  }

  function setLink(item, cls) {
    var a = el("a", cls, item.title);
    a.href = "?id=" + item.id;
    a.addEventListener("click", function (event) {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.button) return;
      event.preventDefault();
      openSet(item.id);
    });
    return a;
  }

  function skillBadges(item, limit) {
    var wrap = el("ul", "cs-skills");
    var ids = item.skills || [];
    ids.slice(0, limit || ids.length).forEach(function (id) { wrap.appendChild(el("li", "badge", skillName(id))); });
    if (limit && ids.length > limit) wrap.appendChild(el("li", "cs-more", "+" + (ids.length - limit) + " more"));
    if (!ids.length) wrap.appendChild(el("li", "cs-more", "No active skills"));
    return wrap;
  }

  function metaLine(item) {
    var parts = [weaponClassName(item.weaponClass), bandLabel(item.band)];
    if (item.stage) parts.push(stageLabel(item.stage));
    var line = el("p", "cs-meta", parts.join(" · "));
    return line;
  }

  function card(item) {
    var art = el("article", "cs-card");
    art.setAttribute("data-id", item.id);
    var head = el("div", "cs-card-head");
    var h = el("h3", "cs-card-title");
    h.appendChild(setLink(item));
    head.appendChild(h);
    var votes = el("span", "cs-votes" + (item.voted ? " is-voted" : ""), plural(item.votes, "vote", "votes"));
    if (item.voted) votes.title = "You voted for this set";
    head.appendChild(votes);
    art.appendChild(head);
    art.appendChild(metaLine(item));
    art.appendChild(skillBadges(item, CARD_SKILLS));
    var foot = [];
    if (item.author) foot.push("by " + item.author);
    var date = dateText(item.createdAt);
    if (date) foot.push(date);
    art.appendChild(el("p", "cs-foot", foot.join(" · ")));
    return art;
  }

  function loadList() {
    var seq = ++listSeq;
    var box = $("cs-list");
    say($("cs-list-error"), "");
    box.setAttribute("aria-busy", "true");
    return Api.request("/api/public/armor-sets?" + queryOf(filters, true)).then(function (res) {
      if (seq !== listSeq) return;
      box.removeAttribute("aria-busy");
      var items = (res && res.items) || [];
      var total = (res && res.total) || 0;
      clear(box);
      $("cs-total").textContent = plural(total, "set", "sets");
      if (!items.length) {
        box.appendChild(el("p", "note-text cs-empty", total || filters.page
          ? "No sets on this page." : "No sets match these filters yet. Clear a filter, or post the first one from the Set builder."));
      } else {
        var grid = el("div", "cs-grid");
        items.forEach(function (it) { grid.appendChild(card(it)); });
        box.appendChild(grid);
      }
      var pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
      $("cs-pager").hidden = pages <= 1;
      $("cs-page-note").textContent = "Page " + (filters.page + 1) + " of " + pages;
      $("cs-prev").disabled = filters.page <= 0;
      $("cs-next").disabled = filters.page + 1 >= pages;
    }, function (error) {
      if (seq !== listSeq) return;
      box.removeAttribute("aria-busy");
      clear(box);
      say($("cs-list-error"), error.message);
      $("cs-pager").hidden = true;
    });
  }

  // ---- my sets -------------------------------------------------------------------------------------

  function builderLink(item) {
    return "/set-builder.html#s=" + Calc.encode(item.set) + "&edit=" + item.id;
  }

  function loadMine() {
    if (!Api.signedIn()) { renderMine(); return Promise.resolve(); }
    return Api.request("/api/account/armor-sets", { auth: true }).then(function (res) {
      mine.items = (res && res.items) || [];
      mine.error = "";
      renderMine();
    }, function (error) {
      mine.items = [];
      mine.error = error.message;
      renderMine();
    });
  }

  function mineItem(item) {
    var art = el("article", "cs-mine-item");
    art.setAttribute("data-id", item.id);
    var head = el("div", "cs-card-head");
    var h = el("h3", "cs-card-title");
    h.appendChild(setLink(item));
    head.appendChild(h);
    head.appendChild(el("span", "cs-votes", plural(item.votes, "vote", "votes")));
    art.appendChild(head);
    art.appendChild(metaLine(item));
    if (item.hidden) {
      art.appendChild(el("p", "form-alert cs-hidden-note", "Hidden by staff: only you can see this set." +
        (item.hiddenReason ? " Reason: " + item.hiddenReason : "")));
    }
    if (mine.open === item.id + ":delete") {
      var ask = el("div", "cs-confirm");
      ask.appendChild(el("span", null, "Delete \"" + item.title + "\" for good?"));
      var yes = el("button", "btn btn-primary btn-small", "Yes, delete it");
      yes.type = "button";
      yes.addEventListener("click", function () { removeSet(item, yes); });
      var no = el("button", "ghost-btn small", "Keep it");
      no.type = "button";
      no.addEventListener("click", function () { mine.open = null; renderMine(); });
      ask.appendChild(yes);
      ask.appendChild(no);
      art.appendChild(ask);
    } else {
      var actions = el("div", "bui-actions");
      var edit = el("button", "ghost-btn small", "Edit details");
      edit.type = "button";
      edit.addEventListener("click", function () { openEdit(item); });
      var del = el("button", "ghost-btn small cs-delete", "Delete");
      del.type = "button";
      del.addEventListener("click", function () { mine.open = item.id + ":delete"; renderMine(); });
      var pieces = el("a", "ghost-btn small", "Change the pieces in the builder");
      pieces.href = builderLink(item);
      actions.appendChild(edit);
      actions.appendChild(pieces);
      actions.appendChild(del);
      art.appendChild(actions);
    }
    if (mine.open === item.id + ":edit" && mine.characters) {
      art.appendChild(editForm(item));
    }
    return art;
  }

  function editForm(item) {
    var form = Form.create({
      options: options, characters: mine.characters, submitLabel: "Save changes",
      values: { title: item.title, notes: item.notes, band: item.band, stage: item.stage, showAuthor: item.showAuthor, charId: item.charId },
      onCancel: function () { mine.open = null; renderMine(); },
      submit: function (v) {
        var body = { title: v.title, notes: v.notes, set: item.set, band: v.band, stage: v.stage, skills: item.skills || [],
                     showAuthor: v.showAuthor, charId: v.charId };
        return Api.request("/api/account/armor-sets/" + item.id, { method: "PUT", body: body, auth: true }).then(function (saved) {
          mine.items = mine.items.map(function (m) { return m.id === item.id ? saved : m; });
          mine.open = null;
          mine.message = "Saved \"" + saved.title + "\".";
          renderMine();
        });
      }
    });
    var wrap = el("div", "cs-edit");
    wrap.appendChild(form.el);
    return wrap;
  }

  function openEdit(item) {
    mine.open = item.id + ":edit";
    mine.message = "";
    if (mine.characters) { renderMine(); return; }
    Api.loadCharacters().then(function (list) { mine.characters = list; }, function (error) {
      mine.open = null;
      mine.message = error.message;
    }).then(function () { renderMine(); });
  }

  function removeSet(item, button) {
    button.disabled = true;
    Api.request("/api/account/armor-sets/" + item.id, { method: "DELETE", auth: true }).then(function () {
      mine.items = mine.items.filter(function (m) { return m.id !== item.id; });
      mine.open = null;
      mine.message = "Deleted \"" + item.title + "\".";
      renderMine();
      loadList();
    }, function (error) {
      button.disabled = false;
      mine.message = error.message;
      renderMine();
    });
  }

  function renderMine() {
    clear(mineBox);
    mineBox.hidden = false;
    var head = el("div", "panel-head");
    head.appendChild(el("h2", null, "My sets"));
    mineBox.appendChild(head);
    if (!Api.signedIn()) {
      var p = el("p", "note-text");
      var a = el("a", "btn btn-primary btn-small", "Sign in to post a set");
      a.href = Api.signinUrl("/community-sets.html");
      p.appendChild(a);
      p.appendChild(document.createTextNode(" Build a set in the "));
      var b = el("a", null, "Set builder");
      b.href = "/set-builder.html";
      p.appendChild(b);
      p.appendChild(document.createTextNode(", then post it from there. Browsing needs no account."));
      mineBox.appendChild(p);
      return;
    }
    if (mine.message) {
      var msg = el("p", "road-ok cs-message", mine.message);
      msg.setAttribute("role", "status");
      mineBox.appendChild(msg);
    }
    if (mine.error) {
      mineBox.appendChild(el("p", "form-alert", mine.error));
      return;
    }
    if (!mine.items.length) {
      var none = el("p", "note-text");
      none.appendChild(document.createTextNode("You have not posted a set yet. Build one in the "));
      var link = el("a", null, "Set builder");
      link.href = "/set-builder.html";
      none.appendChild(link);
      none.appendChild(document.createTextNode(" and press \"Post to Community Sets\"."));
      mineBox.appendChild(none);
      return;
    }
    var list = el("div", "cs-mine-list");
    mine.items.forEach(function (it) { list.appendChild(mineItem(it)); });
    mineBox.appendChild(list);
  }

  // ---- one set -------------------------------------------------------------------------------------

  var slotCache = {};
  var weaponCache = {};

  function loadSlot(slot) {
    if (!slotCache[slot]) {
      slotCache[slot] = getJson("/data/armor/" + slot + ".json").then(function (json) {
        var names = {};
        json.pieces.forEach(function (row) { names[row[0]] = row[1]; });
        return names;
      }).catch(function () { return {}; });
    }
    return slotCache[slot];
  }

  function loadWeaponNames(cls) {
    if (cls < 0 || !WEAPON_SLUGS[cls]) return Promise.resolve({});
    if (!weaponCache[cls]) {
      weaponCache[cls] = getJson("/data/weapons/" + WEAPON_SLUGS[cls] + ".json").then(function (json) {
        var id = json.fields.indexOf("id"), name = json.fields.indexOf("name");
        var names = {};
        json.weapons.forEach(function (w) { names[w[id]] = w[name]; });
        return names;
      }).catch(function () { return {}; });
    }
    return weaponCache[cls];
  }

  function itemName(id) {
    var name = null;
    (catalog.decorations || []).forEach(function (d) { if (d[0] === id) name = d[1]; });
    (catalog.sigils || []).forEach(function (s) { if (s[0] === id) name = s[1]; });
    return name || "Item " + id;
  }

  function decoText(ids) { return ids.length ? ids.map(itemName).join(", ") : "none"; }

  function piecesTable(item, names) {
    var set = Calc.normalize(item.set);
    var rows = [];
    var weapon = set.weapon;
    var weaponName = weapon[0] < 0 ? "No weapon" : weapon[1] ? (names.weapon[weapon[1]] || "Weapon " + weapon[1])
      : "Any " + weaponClassName(weapon[0]);
    rows.push(["Weapon", weaponName, "", decoText(weapon[3]), null]);
    set.armour.forEach(function (a) {
      var name = a[1] ? (names[a[0]][a[1]] || "Piece " + a[1]) : "Nothing";
      rows.push([SLOT_NAMES[a[0]], name, a[1] ? "Level " + a[2] : "", a[1] ? decoText(a[3]) : "",
                 a[1] ? "/equipment.html?slot=" + a[0] + "&id=" + a[1] : null]);
    });
    rows.push(["Skill cuffs", set.cuffs.length ? set.cuffs.map(itemName).join(", ") : "none", "", "", null]);
    var wrap = el("div", "table-wrap");
    var table = el("table", "data-table cs-pieces");
    var thead = el("thead");
    var hr = el("tr");
    ["Slot", "Piece", "Level", "Decorations"].forEach(function (t) { hr.appendChild(el("th", null, t)); });
    thead.appendChild(hr);
    table.appendChild(thead);
    var tbody = el("tbody");
    rows.forEach(function (r) {
      var tr = el("tr");
      tr.appendChild(el("th", null, r[0]));
      var td = el("td");
      if (r[4]) {
        var a = el("a", null, r[1]);
        a.href = r[4];
        td.appendChild(a);
      } else td.textContent = r[1];
      tr.appendChild(td);
      tr.appendChild(el("td", null, r[2]));
      tr.appendChild(el("td", null, r[3]));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  }

  function copyText(text, button, label) {
    var done = function () {
      button.textContent = "Link copied";
      setTimeout(function () { button.textContent = label; }, 2000);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { window.prompt("Copy this link:", text); });
    } else window.prompt("Copy this link:", text);
  }

  function detailActions(item, msg) {
    var actions = el("div", "bui-actions cs-actions");
    var open = el("a", "btn btn-primary btn-small", "Open in the Set builder");
    open.href = "/set-builder.html#s=" + Calc.encode(item.set);
    actions.appendChild(open);

    var signin = Api.signinUrl("/community-sets.html?id=" + item.id);
    if (item.mine) {
      actions.appendChild(el("span", "note-text cs-own", "This is your set."));
    } else if (!Api.signedIn()) {
      var si = el("a", "ghost-btn small", "Sign in to upvote");
      si.href = signin;
      actions.appendChild(si);
    } else {
      var vote = el("button", "ghost-btn small cs-vote");
      vote.type = "button";
      var paint = function () { vote.textContent = (item.voted ? "Remove vote" : "Upvote") + " (" + item.votes + ")"; };
      paint();
      vote.addEventListener("click", function () {
        vote.disabled = true;
        Api.request("/api/account/armor-sets/" + item.id + "/vote", { method: item.voted ? "DELETE" : "PUT", auth: true })
          .then(function (res) {
            item.votes = res.votes;
            item.voted = !!res.voted;
            say(msg, "");
            paint();
            $("cs-detail-votes").textContent = plural(item.votes, "vote", "votes");
          }, function (error) { say(msg, error.message); })
          .then(function () { vote.disabled = false; });
      });
      actions.appendChild(vote);
    }

    var report = null;
    if (!item.mine) {
      if (!Api.signedIn()) {
        var sr = el("a", "ghost-btn small", "Sign in to report");
        sr.href = signin;
        actions.appendChild(sr);
      } else {
        var rb = el("button", "ghost-btn small cs-report", "Report");
        rb.type = "button";
        rb.setAttribute("aria-expanded", "false");
        report = el("form", "cs-report-form");
        report.hidden = true;
        rb.addEventListener("click", function () {
          report.hidden = !report.hidden;
          rb.setAttribute("aria-expanded", report.hidden ? "true" : "false");
          if (!report.hidden) report.querySelector("textarea").focus();
        });
        actions.appendChild(rb);
      }
    }

    var share = el("button", "ghost-btn small cs-share", "Share");
    share.type = "button";
    share.addEventListener("click", function () { copyText(Api.SHARE + item.id, share, "Share"); });
    actions.appendChild(share);

    if (report) buildReport(report, item, msg);
    return { actions: actions, report: report };
  }

  function buildReport(form, item, msg) {
    var max = options.maxReason;
    var field = el("div", "field");
    var label = el("label", null, "Why should staff look at this set? (up to " + max + " characters)");
    label.setAttribute("for", "cs-reason");
    var box = el("textarea");
    box.id = "cs-reason";
    box.rows = 3;
    box.maxLength = max;
    field.appendChild(label);
    field.appendChild(box);
    form.appendChild(field);
    var err = el("p", "form-alert");
    err.hidden = true;
    form.appendChild(err);
    var send = el("button", "btn btn-primary btn-small", "Send report");
    send.type = "submit";
    form.appendChild(send);
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var reason = box.value.trim();
      if (!reason) { say(err, "Say what is wrong with the set."); return; }
      say(err, "");
      send.disabled = true;
      Api.request("/api/account/armor-sets/" + item.id + "/report", { method: "POST", body: { reason: reason }, auth: true })
        .then(function (res) {
          form.hidden = true;
          box.value = "";
          msg.className = "road-ok cs-message";
          say(msg, (res && res.message) || "Thanks: staff will look at this set.");
        }, function (error) { say(err, error.message); })
        .then(function () { send.disabled = false; });
    });
  }

  function renderDetail(item, names) {
    clear(detailView);
    document.title = item.title + " · Community sets · Hunsterverse";
    var back = el("p", "cs-back");
    var link = el("a", null, "← All community sets");
    link.href = listSearch || location.pathname;
    link.addEventListener("click", function (event) {
      event.preventDefault();
      history.pushState(null, "", listSearch || location.pathname);
      route();
    });
    back.appendChild(link);
    detailView.appendChild(back);

    var panel = el("section", "panel cs-detail");
    var head = el("div", "panel-head");
    head.appendChild(el("h1", "cs-detail-title", item.title));
    var votes = el("span", "panel-note", plural(item.votes, "vote", "votes"));
    votes.id = "cs-detail-votes";
    head.appendChild(votes);
    panel.appendChild(head);
    panel.appendChild(metaLine(item));
    var foot = [];
    if (item.author) foot.push("by " + item.author);
    var posted = dateText(item.createdAt);
    if (posted) foot.push("posted " + posted);
    var updated = dateText(item.updatedAt);
    if (updated && updated !== posted) foot.push("changed " + updated);
    if (foot.length) panel.appendChild(el("p", "cs-foot", foot.join(" · ")));
    if (item.data && catalog.version && item.data !== catalog.version) {
      panel.appendChild(el("p", "note-text", "Made with the game data of " + item.data + "; the Set builder now uses " +
        catalog.version + ", so numbers may differ."));
    }
    if (item.notes) panel.appendChild(el("p", "cs-notes", item.notes));

    var msg = el("p", "form-alert cs-message");
    msg.setAttribute("role", "status");
    msg.hidden = true;
    var built = detailActions(item, msg);
    panel.appendChild(built.actions);
    if (built.report) panel.appendChild(built.report);
    panel.appendChild(msg);

    panel.appendChild(el("h2", "cs-sub", "Skills"));
    panel.appendChild(skillBadges(item, 0));
    panel.appendChild(el("h2", "cs-sub", "Pieces"));
    panel.appendChild(piecesTable(item, names));
    detailView.appendChild(panel);
  }

  function showDetail(id) {
    var seq = ++detailSeq;
    clear(detailView);
    detailView.appendChild(el("p", "note-text", "Loading the set."));
    return Api.request("/api/public/armor-sets/" + id).then(function (item) {
      var set = Calc.normalize(item.set);
      var jobs = [loadWeaponNames(set.weapon[0])].concat(Calc.SLOTS.map(function (slot, i) {
        return set.armour[i][1] ? loadSlot(slot) : Promise.resolve({});
      }));
      return Promise.all(jobs).then(function (all) {
        if (seq !== detailSeq) return;
        var names = { weapon: all[0] };
        Calc.SLOTS.forEach(function (slot, i) { names[slot] = all[i + 1]; });
        renderDetail(item, names);
      });
    }).catch(function (error) {
      if (seq !== detailSeq) return;
      clear(detailView);
      var back = el("p", "cs-back");
      var a = el("a", null, "← All community sets");
      a.href = listSearch || location.pathname;
      back.appendChild(a);
      detailView.appendChild(back);
      detailView.appendChild(el("p", "form-alert cs-missing", error.message));
    });
  }

  // ---- routes --------------------------------------------------------------------------------------

  function route() {
    var id = new URLSearchParams(location.search).get("id");
    if (/^\d{1,10}$/.test(id || "")) {
      listView.hidden = true;
      detailView.hidden = false;
      showDetail(id);
      return;
    }
    detailView.hidden = true;
    listView.hidden = false;
    document.title = "Community sets · Hunsterverse";
    filters = parseFilters(location.search);
    listSearch = addressOf(filters);
    syncForm();
    loadMine();
    loadList();
  }

  function start() {
    Promise.all([Api.loadOptions(), getJson("/data/armor/index.json")]).then(function (all) {
      options = all[0];
      catalog = all[1];
      buildFilterControls();
      wireFilters();
      route();
    }).catch(function (error) {
      say(statusBox, "The page's data did not load. Reload the page to try again.");
      if (window.console) console.warn(error);
    });
    window.addEventListener("popstate", function () { if (options) route(); });
  }

  start();
})();
