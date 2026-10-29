/* Sortable tables: every .data-table gets click-to-sort headers.
 *
 * No markup changes: the script enhances each table under document (or a given root), reads each
 * cell's text, and sorts numerically when both values parse as numbers, by date when both parse as
 * dates, and by text otherwise. It keeps working when rows are replaced (the leaderboards and the
 * admin tables re-render): a MutationObserver re-applies the current sort. Empty-state rows (one
 * cell with colspan) are ignored and stay put.
 *
 * Opt a table out with data-nosort; opt a column out with data-nosort on its th. A cell can give
 * its sort key in data-sort (for dates written differently from their display, or numbers with a
 * prefix such as "#12").
 */
(function () {
  "use strict";

  var NUM = /^-?\d+(\.\d+)?$/;

  function cellKey(cell) {
    if (!cell) return "";
    if (cell.dataset && cell.dataset.sort !== undefined) return cell.dataset.sort;
    return (cell.textContent || "").trim();
  }

  function isNumber(text) {
    var clean = text.replace(/[,\s]/g, "").replace(/^\$/, "");
    return NUM.test(clean) ? Number(clean) : null;
  }

  function isDate(text) {
    if (!/^\d{4}-\d{2}-\d{2}|^\d{1,2}\s+\w+\s+\d{4}|\w{3}\s+\d{1,2},?\s+\d{4}/.test(text)) return null;
    var t = Date.parse(text);
    return isNaN(t) ? null : t;
  }

  function key(text) {
    var n = isNumber(text);
    if (n !== null) return { type: "n", value: n };
    var d = isDate(text);
    if (d !== null) return { type: "d", value: d };
    return { type: "s", value: text.toLowerCase() };
  }

  function compare(a, b) {
    var ka = key(a), kb = key(b);
    if (ka.type !== kb.type) {
      return String(ka.value).localeCompare(String(kb.value), undefined, { numeric: true });
    }
    if (ka.type === "s") return String(ka.value).localeCompare(String(kb.value), undefined, { numeric: true });
    return ka.value === kb.value ? 0 : (ka.value < kb.value ? -1 : 1);
  }

  function meaningful(row) {
    return !(row.children.length === 1 && row.children[0].colSpan > 1);
  }

  function sortBy(table, index, dir) {
    var body = table.tBodies[0];
    if (!body) return;
    var rows = Array.prototype.slice.call(body.rows).filter(meaningful);
    var fixed = Array.prototype.slice.call(body.rows).filter(function (r) { return !meaningful(r); });
    rows.sort(function (ra, rb) {
      var va = cellKey(ra.cells[index]);
      var vb = cellKey(rb.cells[index]);
      return dir === "desc" ? compare(vb, va) : compare(va, vb);
    });
    rows.forEach(function (r) { body.appendChild(r); });
    fixed.forEach(function (r) { body.appendChild(r); });
    table.setAttribute("data-sort-index", String(index));
    table.setAttribute("data-sort-dir", dir);
    Array.prototype.forEach.call(table.tHead ? table.tHead.rows[0].cells : [], function (th, i) {
      if (th.hasAttribute("data-nosort")) return;
      if (i === index) th.setAttribute("aria-sort", dir === "desc" ? "descending" : "ascending");
      else th.removeAttribute("aria-sort");
    });
  }

  function enhance(table) {
    if (!table || table.dataset.nosort !== undefined || table._sortable) return;
    if (!table.tHead || !table.tBodies[0]) return;
    table._sortable = true;
    var headRow = table.tHead.rows[0];

    Array.prototype.forEach.call(headRow.cells, function (th, index) {
      if (th.hasAttribute("data-nosort")) return;
      th.setAttribute("role", "button");
      th.setAttribute("tabindex", "0");
      th.setAttribute("title", "Sort by this column");
      function toggle() {
        var dir = table.getAttribute("data-sort-index") === String(index) &&
          table.getAttribute("data-sort-dir") === "asc" ? "desc" : "asc";
        sortBy(table, index, dir);
      }
      th.addEventListener("click", toggle);
      th.addEventListener("keydown", function (event) {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          toggle();
        }
      });
    });

    // Re-apply the chosen sort when rows are replaced by a render.
    var body = table.tBodies[0];
    var timer = null;
    var observer = new MutationObserver(function () {
      if (table.getAttribute("data-sort-index") === null) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () {
        sortBy(table, Number(table.getAttribute("data-sort-index")), table.getAttribute("data-sort-dir") || "asc");
      }, 30);
    });
    observer.observe(body, { childList: true });
  }

  function enhanceAll(root) {
    Array.prototype.forEach.call((root || document).querySelectorAll("table.data-table"), enhance);
  }

  // Wide tables on a phone scroll inside .table-wrap; say so, and drop the hint once it fits.
  function markScrollable() {
    Array.prototype.forEach.call(document.querySelectorAll(".table-wrap"), function (wrap) {
      var scrolls = wrap.scrollWidth > wrap.clientWidth + 2;
      wrap.classList.toggle("is-scrollable", scrolls);
      var hint = wrap.previousElementSibling;
      var hasHint = hint && hint.classList && hint.classList.contains("scroll-hint");
      if (scrolls && !hasHint) {
        hint = document.createElement("p");
        hint.className = "scroll-hint";
        hint.textContent = "Swipe the table to see every column";
        wrap.parentNode.insertBefore(hint, wrap);
      } else if (!scrolls && hasHint) {
        hint.parentNode.removeChild(hint);
      }
      if (!wrap._scrollObs) {
        wrap._scrollObs = new ResizeObserver(function () { markScrollable(); });
        wrap._scrollObs.observe(wrap);
      }
    });
  }

  window.enhanceSortableTables = enhanceAll;
  window.markScrollableTables = markScrollable;
  function init() {
    enhanceAll(document);
    markScrollable();
    window.addEventListener("resize", markScrollable);
    // Rows are replaced by the page scripts; re-check after they render.
    var pending = null;
    new MutationObserver(function () {
      if (pending) clearTimeout(pending);
      pending = setTimeout(markScrollable, 80);
    }).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
