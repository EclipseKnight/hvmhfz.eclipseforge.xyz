/* A hunter's quest log: page through everything the server recorded, newest first. */
(function () {
  "use strict";

  var API = "https://api.hvmhfz.eclipseforge.xyz";
  var SIZE = 20;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function duration(seconds) {
    if (seconds === null || seconds === undefined) return "-";
    var s = Math.max(0, Math.round(seconds));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    if (h) return h + "h " + m + "m";
    if (m) return m + "m";
    return s + "s";
  }

  function when(iso) {
    if (!iso) return "-";
    var at = new Date(iso);
    return isNaN(at) ? "-" : at.toLocaleString();
  }

  function badge(result) {
    if (result === "clear") return el("span", "badge good", "Cleared");
    if (result === "fail") return el("span", "badge bad", "Failed");
    return el("span", "badge", "No result");
  }

  function mount(container, charId, options) {
    if (!container || !charId) return;
    var state = { page: 0, total: 0, rows: [] };
    var title = (options && options.title) || "Quest log";

    var panel = el("section", "panel quest-log-panel");
    var head = el("div", "panel-head");
    head.appendChild(el("h2", null, title));
    var note = el("span", "panel-note", "loading");
    head.appendChild(note);
    panel.appendChild(head);

    var alert = el("p", "form-alert");
    alert.hidden = true;
    panel.appendChild(alert);

    var wrap = el("div", "table-wrap");
    var table = el("table", "data-table");
    var thead = el("thead");
    var hr = el("tr");
    ["Quest", "Result", "Party", "In quest", "Clear time", "When"].forEach(function (label) {
      hr.appendChild(el("th", label === "In quest" || label === "Clear time" ? "num" : null, label));
    });
    thead.appendChild(hr);
    table.appendChild(thead);
    var tbody = el("tbody");
    table.appendChild(tbody);
    wrap.appendChild(table);
    panel.appendChild(wrap);

    var pager = el("div", "quest-pager");
    var prev = el("button", "btn btn-ghost", "Previous");
    prev.type = "button";
    var pageNote = el("span", "panel-note", "-");
    var next = el("button", "btn btn-ghost", "Next");
    next.type = "button";
    pager.appendChild(prev);
    pager.appendChild(pageNote);
    pager.appendChild(next);
    panel.appendChild(pager);

    container.appendChild(panel);

    function render() {
      while (tbody.firstChild) tbody.removeChild(tbody.firstChild);
      if (!state.rows.length) {
        var row = el("tr");
        var cell = el("td", "empty-cell", state.total ? "Nothing on this page." : "No quests recorded yet.");
        cell.colSpan = 6;
        row.appendChild(cell);
        tbody.appendChild(row);
      }
      state.rows.forEach(function (quest) {
        var row = el("tr");
        var nameCell = el("td", "cell-name");
        if (quest.questId) {
          var link = el("a", null, quest.quest || ("#" + quest.questId));
          link.href = "/quest.html?id=" + quest.questId;
          nameCell.appendChild(link);
        } else {
          nameCell.textContent = quest.quest || "-";
        }
        row.appendChild(nameCell);
        var res = el("td");
        res.appendChild(badge(quest.result));
        row.appendChild(res);
        var party = el("td", "quest-party");
        (quest.party || []).forEach(function (member, index) {
          if (index) party.appendChild(document.createTextNode(", "));
          var link = el("a", null, member);
          link.href = "/hunters.html?name=" + encodeURIComponent(member);
          party.appendChild(link);
        });
        if (!(quest.party || []).length) party.textContent = "-";
        row.appendChild(party);
        row.appendChild(el("td", "num", duration(quest.durationSeconds)));
        row.appendChild(el("td", "num", quest.clearSeconds === null || quest.clearSeconds === undefined
          ? "-" : duration(quest.clearSeconds)));
        row.appendChild(el("td", null, when(quest.endedAt)));
        tbody.appendChild(row);
      });
      var pages = Math.max(1, Math.ceil(state.total / SIZE));
      note.textContent = state.total.toLocaleString() + (state.total === 1 ? " quest" : " quests");
      pageNote.textContent = "Page " + (state.page + 1) + " of " + pages;
      prev.disabled = state.page === 0;
      next.disabled = state.page >= pages - 1;
    }

    function load() {
      alert.hidden = true;
      fetch(API + "/api/public/quests/hunter/" + encodeURIComponent(charId) + "?page=" + state.page + "&size=" + SIZE,
        { cache: "no-store" })
        .then(function (r) {
          if (!r.ok) throw new Error("HTTP " + r.status);
          return r.json();
        })
        .then(function (data) {
          state.rows = data.rows || [];
          state.total = data.total || 0;
          render();
        })
        .catch(function (error) {
          alert.textContent = "The quest log is unavailable right now (" + error.message + ").";
          alert.hidden = false;
          note.textContent = "";
        });
    }

    prev.addEventListener("click", function () {
      if (state.page > 0) { state.page--; load(); }
    });
    next.addEventListener("click", function () {
      if ((state.page + 1) * SIZE < state.total) { state.page++; load(); }
    });

    load();
    return { reload: load };
  }

  window.QuestLog = { mount: mount };
})();
