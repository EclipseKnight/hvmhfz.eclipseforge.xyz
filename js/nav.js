/* Site navigation, loaded by every page. On narrow screens (see the 1160px rule in styles.css)
   the links fold behind the Menu button so the sticky bar keeps one fixed height. Without
   JavaScript the button stays hidden and the links simply wrap under the logo. */
(function () {
  "use strict";

  var header = document.querySelector(".site-nav");
  var button = header && header.querySelector(".nav-toggle");
  var menu = header && header.querySelector("nav");
  if (!button || !menu) return;

  function setOpen(open) {
    header.classList.toggle("open", open);
    button.setAttribute("aria-expanded", open ? "true" : "false");
  }

  header.classList.add("collapsible");
  button.hidden = false;
  button.addEventListener("click", function () {
    setOpen(!header.classList.contains("open"));
  });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && header.classList.contains("open")) {
      setOpen(false);
      button.focus();
    }
  });
  // A tap outside the bar closes the menu, as people expect from a dropdown.
  document.addEventListener("click", function (event) {
    if (header.classList.contains("open") && !header.contains(event.target)) setOpen(false);
  });
  // Tapping a link in the open menu closes it (a link to a spot on this page would otherwise leave
  // the menu covering it). Focus goes back to the Menu button, since the link has just been hidden.
  // Search opens its own dialog and takes the focus itself, so it only closes the menu.
  menu.addEventListener("click", function (event) {
    if (!header.classList.contains("open") || !event.target.closest) return;
    if (event.target.closest("a")) {
      setOpen(false);
      button.focus();
    } else if (event.target.closest(".nav-search")) {
      setOpen(false);
    }
  });
})();

/* The nav menus (Guides, Database, Hunting Road, Community, Server). Hover opens them on a wide screen (CSS);
   this adds click and keyboard: the button toggles its menu, Escape or a click elsewhere closes it,
   and opening one closes the others. In the folded Menu the groups are always open (CSS). */
(function () {
  "use strict";

  var groups = Array.prototype.slice.call(document.querySelectorAll(".site-nav .nav-group"));
  if (!groups.length) return;

  function setOpen(group, open) {
    group.classList.toggle("open", open);
    group.querySelector(".nav-group-toggle").setAttribute("aria-expanded", open ? "true" : "false");
  }

  groups.forEach(function (group) {
    var toggle = group.querySelector(".nav-group-toggle");
    toggle.addEventListener("click", function (event) {
      var open = !group.classList.contains("open");
      groups.forEach(function (other) { setOpen(other, false); });
      setOpen(group, open);
      if (open) {
        var first = group.querySelector(".nav-menu a");
        if (first && event.detail === 0) first.focus(); // opened with the keyboard: move into the menu
      }
    });
    group.addEventListener("focusout", function (event) {
      if (!group.contains(event.relatedTarget)) setOpen(group, false);
    });
  });
  document.addEventListener("keydown", function (event) {
    if (event.key !== "Escape") return;
    groups.forEach(function (group) {
      if (group.classList.contains("open")) {
        setOpen(group, false);
        group.querySelector(".nav-group-toggle").focus();
      }
    });
  });
  document.addEventListener("click", function (event) {
    groups.forEach(function (group) { if (!group.contains(event.target)) setOpen(group, false); });
  });
})();

/* The account button at the end of the bar (dev/shell/nav.html): "Sign in" by default, which goes to
   /account.html (that page sends a visitor who is not signed in to the sign-in form). With a saved
   sign-in that has not expired (the same test as js/main.js) it reads "My account"; without one it
   goes straight to the sign-in form on the home page. */
(function () {
  "use strict";

  var link = document.querySelector(".site-nav .nav-account");
  if (!link) return;
  var signedIn = false;
  try {
    var token = localStorage.getItem("hvmhfz.token");
    if (token) {
      var payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      signedIn = payload.exp * 1000 > Date.now() + 30000;
    }
  } catch (error) {
    signedIn = false;
  }
  if (signedIn) link.textContent = "My account";
  else if (link.getAttribute("aria-current") !== "page") link.href = "/#login-form";
})();

/* Server status in the bar on every page: a dot and the hunters online, from GET /api/public/status
   (the API checks the game's ports every 30 s). Clicking it opens the panel with each port's state and
   what to type into the launcher; host, ports, mode and version come from the same answer, so the
   HTML values in dev/shell/nav.html are only the fallback while the API is unreachable. The last
   answer is kept in sessionStorage so the next page shows it at once instead of "Server". */
(function () {
  "use strict";

  var API = "https://api.hvmhfz.eclipseforge.xyz";
  var KEY = "hvmhfz.status";
  var REFRESH_MS = 60000;
  var box = document.querySelector(".site-nav .nav-status");
  if (!box) return;
  var toggle = box.querySelector(".nav-status-toggle");
  var panel = box.querySelector(".nav-status-panel");
  var label = box.querySelector(".nav-status-label");
  var title = box.querySelector(".nav-status-title");
  var sub = box.querySelector(".nav-status-sub");
  var ports = box.querySelector(".nav-status-ports");
  var timer = null;

  function hunters(n) { return n === 1 ? "1 hunter" : n.toLocaleString() + " hunters"; }

  function ago(iso) {
    var s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
    if (!isFinite(s)) return "";
    if (s < 60) return "just now";
    var m = Math.round(s / 60);
    return m === 1 ? "1 minute ago" : m + " minutes ago";
  }

  function render(status) {
    var state = status ? status.state : "unknown";
    box.setAttribute("data-state", state);
    var count = status && typeof status.players === "number" ? status.players : null;
    if (state === "online" || (state === "degraded" && status.online)) {
      label.textContent = count === null ? "Online" : count.toLocaleString() + " online";
      title.textContent = state === "online" ? "Online" : "Online, with a port down";
      sub.textContent = (count === null ? "Hunters online unknown" : hunters(count) + " online")
          + ". Checked " + ago(status.checkedAt) + ".";
    } else if (state === "degraded") {
      label.textContent = "Partial outage";
      title.textContent = "Partial outage";
      sub.textContent = "The game is not taking logins right now. Checked " + ago(status.checkedAt) + ".";
    } else if (state === "offline") {
      label.textContent = "Offline";
      title.textContent = "Offline";
      sub.textContent = "The game server is not answering. Restarts are announced on Discord. Checked "
          + ago(status.checkedAt) + ".";
    } else {
      label.textContent = "Status unknown";
      title.textContent = "Status unknown";
      sub.textContent = "The status check could not be reached. The connection details below still apply.";
    }
    toggle.setAttribute("aria-label", "Server status: " + label.textContent + ". Show how to connect");

    while (ports.firstChild) ports.removeChild(ports.firstChild);
    (status && status.ports || []).forEach(function (port) {
      var li = document.createElement("li");
      li.className = port.open ? "is-open" : "is-closed";
      var name = document.createElement("span");
      name.textContent = port.name + " " + port.port;
      var verdict = document.createElement("span");
      verdict.className = "nav-port-state";
      verdict.textContent = port.open ? "answering" : "not answering";
      li.appendChild(name);
      li.appendChild(verdict);
      ports.appendChild(li);
    });

    var connect = status && status.connect;
    if (connect) {
      box.querySelectorAll("[data-connect]").forEach(function (node) {
        var value = connect[node.getAttribute("data-connect")];
        if (value !== undefined && value !== null && value !== "") node.textContent = String(value);
      });
    }
  }

  function load() {
    fetch(API + "/api/public/status", { cache: "no-store" })
      .then(function (response) {
        if (!response.ok) throw new Error("HTTP " + response.status);
        return response.json();
      })
      .then(function (status) {
        try { sessionStorage.setItem(KEY, JSON.stringify(status)); } catch (error) { /* private mode */ }
        render(status);
      })
      .catch(function () { render(null); });
  }

  function schedule() {
    clearInterval(timer);
    timer = setInterval(function () { if (!document.hidden) load(); }, REFRESH_MS);
  }

  function setOpen(open) {
    panel.hidden = !open;
    box.classList.toggle("open", open);
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
  }

  toggle.addEventListener("click", function (event) {
    event.stopPropagation();
    setOpen(panel.hidden);
  });
  document.addEventListener("click", function (event) {
    if (!panel.hidden && !box.contains(event.target)) setOpen(false);
  });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && !panel.hidden) {
      setOpen(false);
      toggle.focus();
    }
  });
  document.addEventListener("visibilitychange", function () { if (!document.hidden) load(); });

  box.querySelectorAll("[data-nav-copy]").forEach(function (button) {
    button.addEventListener("click", function () {
      var node = box.querySelector('[data-connect="' + button.getAttribute("data-nav-copy") + '"]');
      var text = node ? node.textContent : "";
      var done = function () {
        button.textContent = "Copied";
        setTimeout(function () { button.textContent = "Copy"; }, 1500);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () { button.textContent = "Select it"; });
      } else {
        button.textContent = "Select it";
      }
    });
  });

  try {
    var last = JSON.parse(sessionStorage.getItem(KEY) || "null");
    if (last && last.checkedAt) render(last);
  } catch (error) { /* ignore a damaged entry */ }
  load();
  schedule();
})();

/* Breadcrumbs on a detail page (one monster, quest, hunter or guild): HvCrumbs.item(name) puts the
   item's name last. The trail itself comes from dev/shell/pages.json (dev/site-shell.py). If its last
   crumb is a stand-in (data-crumb-item) the name replaces it; otherwise that crumb (the list page)
   becomes a link and the name is added after it. Calling it again only changes the name. */
window.HvCrumbs = {
  item: function (name) {
    var list = document.querySelector("nav.breadcrumbs ol");
    if (!list || !name) return;
    var last = list.lastElementChild;
    if (!last) return;
    if (!last.hasAttribute("data-crumb-item")) {
      var link = document.createElement("a");
      link.href = location.pathname;
      link.textContent = last.textContent;
      last.textContent = "";
      last.removeAttribute("aria-current");
      last.appendChild(link);
      last = document.createElement("li");
      last.setAttribute("aria-current", "page");
      last.setAttribute("data-crumb-item", "");
      list.appendChild(last);
    }
    last.textContent = name;
  }
};
