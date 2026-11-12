/* Admin: the Permissions tab (admins only). A table of every tool and action with one column per role; a tick is
   saved at once (PUT /api/admin/permissions), a dot marks a cell that differs from the default, and each role has a
   two-click "Reset to defaults" (POST /api/admin/permissions/reset). The ROLE_ADMIN column is fixed (always).
   Without the table (tableReady false) the defaults show, the boxes are disabled and a notice says what to run.
   Everything from the API stays text (textContent). Started by js/admin.js (window.startAdminPermissions). */
(function () {
  "use strict";

  var API = "https://api.hvmhfz.eclipseforge.xyz";
  var TOKEN_KEY = "hvmhfz.token";

  var started = false;
  // data: the API's answer; msgs: the Saving/Saved/error text per cell ("ROLE|tool|action"), kept across redraws
  var state = { data: null, msgs: {}, busy: false, armed: null };

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function $(id) { return document.getElementById(id); }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function token() {
    try {
      var value = localStorage.getItem(TOKEN_KEY) || "";
      var claims = JSON.parse(atob(value.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      return claims.exp && claims.exp * 1000 > Date.now() + 30000 ? value : "";
    } catch (e) {
      return "";
    }
  }

  function request(path, method, body) {
    var headers = { Authorization: "Bearer " + token() };
    if (body) headers["Content-Type"] = "application/json";
    return fetch(API + path, { method: method || "GET", headers: headers, body: body ? JSON.stringify(body) : undefined, cache: "no-store" })
      .then(function (r) {
        if (r.status === 401) throw Object.assign(new Error("Sign in again: your session has ended."), { status: 401 });
        return r.json().catch(function () { return null; }).then(function (data) {
          if (!r.ok) {
            var fallback = r.status === 403 ? "Only admins can change permissions." : "HTTP " + r.status;
            throw Object.assign(new Error((data && data.message) || fallback), { status: r.status });
          }
          return data;
        });
      });
  }

  function say(id, text) {
    var box = $(id);
    box.textContent = text || "";
    box.hidden = !text;
  }

  function roleLabel(role) {
    var name = String(role).replace("ROLE_", "").toLowerCase();
    return name.charAt(0).toUpperCase() + name.slice(1);
  }

  function has(map, role, tool, action) {
    var tools = map && map[role];
    var list = tools && tools[tool];
    return !!list && list.indexOf(action) !== -1;
  }

  function isFixed(role) { return (state.data.fixed || []).indexOf(role) !== -1; }

  function ready() { return state.data.tableReady !== false; }

  function key(role, tool, action) { return role + "|" + tool + "|" + action; }

  /* ---------- drawing ---------- */

  function resetButton(role) {
    var button = el("button", "ghost-btn small", "Reset to defaults");
    button.type = "button";
    button.setAttribute("data-reset", role);
    button.disabled = !ready() || state.busy;
    button.addEventListener("click", function () {
      if (state.armed !== role) {
        state.armed = role;
        button.textContent = "Click again to reset " + roleLabel(role);
        setTimeout(function () {
          if (state.armed === role) { state.armed = null; button.textContent = "Reset to defaults"; }
        }, 5000);
        return;
      }
      state.armed = null;
      resetRole(role);
    });
    return button;
  }

  function cell(role, tool, action) {
    var td = el("td", "perm-cell");
    var fixed = isFixed(role);
    var on = fixed || has(state.data.grants, role, tool, action);
    var label = el("label", "perm-box");
    var box = el("input");
    box.type = "checkbox";
    box.checked = on;
    box.disabled = fixed || !ready() || state.busy;
    box.setAttribute("aria-label", roleLabel(role) + ": " + tool + " " + action);
    box.setAttribute("data-cell", key(role, tool, action));
    if (fixed) box.title = "always";
    label.appendChild(box);
    if (!fixed && on !== has(state.data.defaults, role, tool, action)) {
      var dot = el("span", "perm-dot", "●");
      dot.title = "changed from the default";
      label.appendChild(dot);
    }
    td.appendChild(label);
    var msg = state.msgs[key(role, tool, action)];
    if (msg) td.appendChild(el("span", "perm-msg" + (msg.bad ? " is-bad" : ""), msg.text));
    if (!fixed) box.addEventListener("change", function () { save(role, tool, action, box.checked); });
    return td;
  }

  function render() {
    var d = state.data, head = $("perm-head"), body = $("perm-body");
    clear(head);
    clear(body);
    $("perm-notable").hidden = ready();
    var roles = d.roles || [];
    var hr = el("tr");
    hr.appendChild(el("th", null, "Tool and action"));
    roles.forEach(function (role) {
      var th = el("th", "perm-role");
      th.appendChild(el("div", null, roleLabel(role)));
      if (isFixed(role)) th.appendChild(el("div", "perm-always", "always"));
      else th.appendChild(resetButton(role));
      hr.appendChild(th);
    });
    head.appendChild(hr);
    (d.tools || []).forEach(function (tool) {
      var group = el("tr", "perm-group");
      var gc = el("th", null, tool.label || tool.key);
      gc.colSpan = roles.length + 1;
      group.appendChild(gc);
      body.appendChild(group);
      (tool.actions || []).forEach(function (action) {
        var tr = el("tr");
        tr.setAttribute("data-tool", tool.key);
        tr.appendChild(el("td", "perm-action", action.label || action.key));
        roles.forEach(function (role) { tr.appendChild(cell(role, tool.key, action.key)); });
        body.appendChild(tr);
      });
    });
    $("perm-note").textContent = (d.tools || []).length + " tools, " + roles.length + " roles";
  }

  /* ---------- talking to the API ---------- */

  function load() {
    return request("/api/admin/permissions").then(function (d) {
      state.data = d;
      say("perm-alert", "");
      render();
    }).catch(function (e) { say("perm-alert", e.message); });
  }

  function save(role, tool, action, allowed) {
    if (state.busy) return;
    var k = key(role, tool, action);
    state.busy = true;
    state.msgs = {};
    state.msgs[k] = { text: "Saving…" };
    say("perm-ok", "");
    say("perm-alert", "");
    render();
    request("/api/admin/permissions", "PUT", { role: role, tool: tool, action: action, allowed: allowed }).then(function (d) {
      state.data = d;
      state.busy = false;
      state.msgs[k] = { text: "Saved" };
      render();
    }).catch(function (e) {
      state.busy = false;
      state.msgs[k] = { text: e.message, bad: true };
      say("perm-alert", e.message);
      render();
    });
  }

  function resetRole(role) {
    if (state.busy) return;
    state.busy = true;
    state.msgs = {};
    say("perm-alert", "");
    request("/api/admin/permissions/reset", "POST", { role: role }).then(function (d) {
      state.data = d;
      state.busy = false;
      render();
      say("perm-ok", roleLabel(role) + " is back to the defaults.");
    }).catch(function (e) {
      state.busy = false;
      say("perm-alert", e.message);
      render();
    });
  }

  window.startAdminPermissions = function () {
    if (!started) started = true;
    load();
  };
})();
