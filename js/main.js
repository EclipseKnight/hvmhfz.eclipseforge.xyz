let accessToken;
let discordAccessToken;

const PUBLIC_KEY = '6Leqx5IhAAAAAFemC2ve-LEU28ZrzKP_Hgb4yCWk';

document.getElementById("submit").addEventListener("click", validate);


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
    
    let username = document.getElementById("username").value;
    let password = document.getElementById("password").value;


    grecaptcha.ready(async function() {
        const token = await grecaptcha.execute(PUBLIC_KEY, {action: 'submit'})

        let userData;

        if (username && password) {
            userData = await sendLogin(username, password, token);
            await displayActivationCode(userData);
        }

    });
    
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
            displayLoginWarning();
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

function displayLoginWarning() {
    document.getElementById("login-warning").hidden = false;
}


