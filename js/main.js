let accessToken;
let discordAccessToken;

const TOKEN_KEY = "hvmhfz.token";

document.getElementById("submit").addEventListener("click", validate);

// Cloudflare Turnstile (js/turnstile.js), rendered as soon as api.js is available.
const loginTurnstile = window.HvTurnstile.mount(document.getElementById("turnstile-slot"), {
    action: "login",
    onSolved: function () {
        const warning = document.getElementById("login-warning");
        if (warning) warning.hidden = true;
    },
    onError: function () {
        showWarning("Verification failed to load. Reload the page and try again.");
    }
});

function showWarning(message) {
    const warning = document.getElementById("login-warning");
    if (!warning) return;
    if (message) warning.textContent = message;
    warning.hidden = false;
}

document.getElementById("password").addEventListener("keydown", function (event) {
    if (event.key === "Enter") validate(event);
});


// window.onload = async () => {
//     const params = new Proxy(new URLSearchParams(window.location.search), {
//         get: (searchParams, prop) => searchParams.get(prop),
//     });
//     const code = params.code;
//     console.log(code);

//     let response = await discordAuth(code);
//     console.log(response);
//     // if (!accessToken) {
//     //     console.log("no token");
//     //     return;
//     //     // return (document.getElementById('login').style.display = 'block');
//     // }

//     // fetch('https://discord.com/api/users/@me', {
//     //     headers: {
//     //         authorization: `${tokenType} ${accessToken}`,
//     //     },
//     // })
//     //     .then(result => result.json())
//     //     .then(response => {
//     //         const { username, discriminator } = response;
//     //         document.getElementById('info').innerText += ` ${username}#${discriminator}`;
//     //     })
//     //     .catch(console.error);
// };

async function discordAuth(code) {

    const options = {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
    };
    
    try {
        const response = await fetch(`https://api.hvmhfz.eclipseforge.xyz/api/auth/discordbotauth?code=${code}`, options)
        
        if (!response.ok) {
            console.log("discord auth failed.")
        }

        return await response.json();

    } catch (error) {
        return undefined;
    }
}


async function validate(event) {
    if (event) event.preventDefault();

    const username = document.getElementById("username").value.trim();
    const password = document.getElementById("password").value;
    const button = document.getElementById("submit");

    if (!username || !password) {
        showWarning("Enter your username and password.");
        return;
    }

    const token = loginTurnstile.token();
    if (!token) {
        showWarning("Complete the verification challenge, then press Submit again.");
        loginTurnstile.render();
        return;
    }

    if (button) button.disabled = true;
    try {
        const userData = await sendLogin(username, password, token);
        if (userData === undefined) {
            showWarning("The login service did not respond. Try again in a moment.");
            return;
        }
        if (userData === null) {
            return;
        }
        await displayActivationCode(userData);
    } finally {
        if (button) button.disabled = false;
        loginTurnstile.reset();
    }
}

async function sendLogin(username, password, token) {
    console.log("Sending credentials...");
    const options = {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: `{"username":"${username}","password":"${password}", "token":"${token}"}`
    };
    
    try {
        const response = await fetch('https://api.hvmhfz.eclipseforge.xyz/api/auth/signin', options)
        
        if (!response.ok) {
            displayLoginWarning(response.status);
            return null;
        }

        return await response.json();

    } catch (error) {
        return undefined;
    }
}


async function fetchUser() {
    const options = {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    };
  
    try {
      const response = await fetch('https://api.hvmhfz.eclipseforge.xyz/api/users/self', options);
  
      if (!response.ok) {
        // server returned some non-200 response, like 4xx, or 5xx.
        return undefined; 
      }
  
      return await response.json();
    }
    catch (error) {
      // some network error occurred or fetch otherwise failed, e.g., you're not connected to the internet, change of network, etc
      return undefined;
    }
}

async function displayActivationCode(userData) {
    if (userData == null) {
        return;
    }

    accessToken = userData.accessToken;
    saveSession(accessToken);

    // The account page owns the Discord linking step, so hand over immediately.
    window.location.replace("/account.html");
}

function appendAccountLink() {
    if (document.getElementById("account-link")) return;
    const form = document.getElementById("login-form");
    if (!form) return;
    const link = document.createElement("a");
    link.id = "account-link";
    link.className = "account-link";
    link.href = "/account.html";
    link.textContent = "Open your account";
    form.appendChild(link);
}

function saveSession(value) {
    try {
        localStorage.setItem(TOKEN_KEY, value);
    } catch (error) {
        /* private mode: the session simply will not persist */
    }
}

function storedSessionValid() {
    try {
        const value = localStorage.getItem(TOKEN_KEY);
        if (!value) return false;
        const payload = JSON.parse(atob(value.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
        return payload.exp * 1000 > Date.now() + 30000;
    } catch (error) {
        return false;
    }
}

if (storedSessionValid()) {
    fetch("https://api.hvmhfz.eclipseforge.xyz/api/account", {
        headers: { Authorization: "Bearer " + localStorage.getItem(TOKEN_KEY) }
    }).then(function (response) {
        if (response.ok) {
            window.location.replace("/account.html");
        } else if (response.status === 401) {
            localStorage.removeItem(TOKEN_KEY);
        }
    }).catch(function () {
        /* API unreachable: stay on the login form */
    });
}

function displayLoginWarning(status) {
    if (status === 403) {
        showWarning("Verification failed. Reload the page and try again.");
    } else if (status >= 500) {
        showWarning("The login service had an error. Try again in a moment.");
    } else {
        showWarning("Incorrect Username/Password.");
    }
}


