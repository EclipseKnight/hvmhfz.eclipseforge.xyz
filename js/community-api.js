/* The API calls the community sets pages share (community-sets.html, set-builder.html's "Post to Community Sets"):
   the sign-in token, one request function, the options list (bands, stages, limits) and the account's characters.
   The contract is in docs/armor-set-builder.md "Community sets". Errors are {"message": "..."}; they are thrown as
   Error(message) and shown as they are. Nothing here touches the page. Also runs under node (no browser calls). */
(function (root) {
  "use strict";

  var API = "https://api.hvmhfz.eclipseforge.xyz";
  var TOKEN_KEY = "hvmhfz.token";

  // What the page uses when GET /api/public/armor-sets/options does not answer.
  var FALLBACK_OPTIONS = {
    bands: [
      { key: "hr1", label: "HR1 (HR 1-29)" }, { key: "hr2", label: "HR2 (HR 30-49)" }, { key: "hr3", label: "HR3 (HR 50-98)" },
      { key: "hr4", label: "HR4 (HR 99-298)" }, { key: "hr5", label: "HR5 (HR 299-997)" }, { key: "hr6", label: "HR6-7 (HR 998-999)" },
      { key: "gr1", label: "GR 1-49" }, { key: "gr50", label: "GR 50-99" }, { key: "gr100", label: "GR 100+" }
    ],
    stages: [{ key: "", label: "Any" }, { key: "zenith", label: "Zenith" }, { key: "tower", label: "Tower" },
             { key: "road", label: "Hunting Road" }],
    data: "", maxTitle: 60, maxNotes: 1000, maxReason: 300
  };

  /** The sign-in token while it is valid (the account page uses the same key), else "". */
  function token() {
    try {
      var value = root.localStorage.getItem(TOKEN_KEY) || "";
      var claims = JSON.parse(atob(value.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      return claims.exp && claims.exp * 1000 > Date.now() + 30000 ? value : "";
    } catch (error) {
      return "";
    }
  }

  function signedIn() { return !!token(); }

  /** One call. opts: method, body (an object), auth (true = needs the sign-in; false/absent = sends it only when there
      is one, so a public list can say which sets you voted for). Resolves with the JSON answer; a refusal rejects with
      Error(the API's message) and `status`. */
  function request(path, opts) {
    var o = opts || {};
    var headers = {};
    var t = token();
    if (t) headers.Authorization = "Bearer " + t;
    if (o.auth && !t) return Promise.reject(Object.assign(new Error("Sign in first."), { status: 401 }));
    if (o.body !== undefined) headers["Content-Type"] = "application/json";
    return fetch(API + path, { method: o.method || "GET", headers: headers, cache: "no-store",
                               body: o.body !== undefined ? JSON.stringify(o.body) : undefined })
      .then(function (res) {
        return res.json().catch(function () { return null; }).then(function (data) {
          if (!res.ok) {
            var fallback = res.status === 401 ? "Sign in again: your session has ended." : "HTTP " + res.status;
            throw Object.assign(new Error((data && data.message) || fallback), { status: res.status });
          }
          return data;
        });
      });
  }

  var optionsPromise = null;
  /** The bands, stages and limits, once; the fallback when the API does not answer. */
  function loadOptions() {
    if (!optionsPromise) {
      optionsPromise = request("/api/public/armor-sets/options").then(function (o) {
        var out = {};
        Object.keys(FALLBACK_OPTIONS).forEach(function (k) {
          out[k] = o && o[k] !== undefined && o[k] !== null ? o[k] : FALLBACK_OPTIONS[k];
        });
        if (!Array.isArray(out.bands) || !out.bands.length) out.bands = FALLBACK_OPTIONS.bands;
        if (!Array.isArray(out.stages) || !out.stages.length) out.stages = FALLBACK_OPTIONS.stages;
        return out;
      }, function () { return FALLBACK_OPTIONS; });
    }
    return optionsPromise;
  }

  /** The signed-in account's characters: [{id, name, ...}]. */
  function loadCharacters() {
    return request("/api/account/characters", { auth: true }).then(function (list) {
      return Array.isArray(list) ? list : [];
    });
  }

  /** The sign-in address that comes back to `path` (js/signin-next.js; a path too long for it loses its #part). */
  function signinUrl(path) {
    var Next = root.HvNext;
    if (!Next) return "/#login-form";
    if (Next.safe(path)) return Next.signinUrl(path);
    return Next.signinUrl(path.split("#")[0]);
  }

  var api = { API: API, SHARE: API + "/share/set/", token: token, signedIn: signedIn, request: request,
              loadOptions: loadOptions, loadCharacters: loadCharacters, signinUrl: signinUrl,
              FALLBACK_OPTIONS: FALLBACK_OPTIONS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.CommunityApi = api;
})(typeof window !== "undefined" ? window : this);
