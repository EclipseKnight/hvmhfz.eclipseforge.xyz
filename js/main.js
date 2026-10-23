let accessToken;
let discordAccessToken;

const TURNSTILE_SITEKEY = '0x4AAAAAAFiqTP8B32NFqXS1';
let turnstileWidgetId = null;

document.getElementById("submit").addEventListener("click", validate);

// Cloudflare Turnstile, rendered explicitly once api.js is available.
function renderTurnstile() {
    if (turnstileWidgetId !== null) return;
    if (!window.turnstile) return;
    const slot = document.getElementById("turnstile-slot");
    if (!slot) return;
    turnstileWidgetId = window.turnstile.render(slot, {
        sitekey: TURNSTILE_SITEKEY,
        theme: "light",
        action: "login",
        callback: function () {
            const warning = document.getElementById("login-warning");
            if (warning) warning.hidden = true;
        },
        "expired-callback": function () {
            resetTurnstile();
        },
        "error-callback": function () {
            showWarning("Verification failed to load. Reload the page and try again.");
        }
    });
}

function resetTurnstile() {
    if (window.turnstile && turnstileWidgetId !== null) {
        window.turnstile.reset(turnstileWidgetId);
    }
}

function turnstileToken() {
    if (window.turnstile && turnstileWidgetId !== null) {
        return window.turnstile.getResponse(turnstileWidgetId) || "";
    }
    return "";
}

function showWarning(message) {
    const warning = document.getElementById("login-warning");
    if (!warning) return;
    if (message) warning.textContent = message;
    warning.hidden = false;
}

const turnstileWait = setInterval(function () {
    if (window.turnstile) {
        clearInterval(turnstileWait);
        renderTurnstile();
    }
}, 250);
setTimeout(function () { clearInterval(turnstileWait); }, 20000);

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

    const token = turnstileToken();
    if (!token) {
        showWarning("Complete the verification challenge, then press Submit again.");
        renderTurnstile();
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
        resetTurnstile();
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
    let user = await fetchUser();

    document.getElementById("login-warning").hidden = true;
    document.getElementById("username-box").remove();
    document.getElementById("password-box").remove();
    document.getElementById("submit").remove();
    const turnstileSlot = document.getElementById("turnstile-slot");
    if (turnstileSlot) turnstileSlot.remove();

    if (user == null) {
        document.getElementById("login-form").innerHTML +=
        `
        <div class="user-box" id="activation-code">
        There was an error when trying to fetch your account.
        <br/>
        <br/>
        <code>RIP</code>
        </div>
        `;
        return;
    }

   

    if (userData.discordActivationToken == null) {


        document.getElementById("login-form").innerHTML +=
        `
        <div class="user-box" id="activation-code">
        Discord account is already linked
        <br/>
        <br/>
        <code>discordId: ${user.discordId}</code>
        </div>
        `;
        return;
    } 

    document.getElementById("login-form").innerHTML +=
        `
        <div class="user-box" id="activation-code">
        Use this command in the #mhfrontier discord channel.
        <br/>
        <br/>
        <code>!f link ${userData.discordActivationToken}</code>
        </div>
        `;
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


