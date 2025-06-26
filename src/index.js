const { app, BrowserWindow, ipcMain, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const keytar = require('keytar');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

let mainWindow;
let globalAuthData = {
  userData: null,
  authHeaders: null,
  region: 'eu',
  shard: 'eu'
};

async function getTokensLogic(){
  try {
    const accessToken = await keytar.getPassword('valorant-client', 'access-token');
    const idToken = await keytar.getPassword('valorant-client', 'id-token');
    if (accessToken && idToken) {
      return { status: true, aToken: accessToken, iToken: idToken };
    }


    return { success: false };
  } catch (error) {
    return { success: false };
  }
}


async function getEntitlementToken(accessToken) {
  try {
    const response = await fetch('https://entitlements.auth.riotgames.com/api/token/v1', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Entitlement ${response.statusText}`);
    }

    const data = await response.json();
    if (data.entitlements_token) {
      globalAuthData.authHeaders['X-Riot-Entitlements-JWT'] = data.entitlements_token;
      return true;
    } else {
      return false;
    }
  } catch (error) {
    return false;
  }
}

async function getProfileInfo(){
  try{
    const response = await fetch("https://auth.riotgames.com/userinfo", {
      method: "GET",
      headers: {
        ...globalAuthData.authHeaders
      }
    });
    if(!response.ok) {
      throw new Error("PROFILE INFO FAILED");
    }

    const data = await response.json();
    globalAuthData.profileInfo = data;
    return data;
  }catch(e){
    globalAuthData.profileInfo = {};
    return {};
  }
}

async function determineRegion() {
  try {
    globalAuthData.region = 'eu';
    globalAuthData.shard = 'eu';
    return true;
  } catch (error) {
    return false;
  }
}

function setupIpcHandlers() {
  ipcMain.handle('save-tokens', async (event, { accessToken, idToken }) => {

    try {
      await keytar.setPassword('valorant-client', 'access-token', accessToken);
      await keytar.setPassword('valorant-client', 'id-token', idToken);

      return true;
    } catch (error) {
      return false;
    }
  });

  ipcMain.on('set-agent', async (event, agent) => {
    return await keytar.setPassword('valorant-client', 'select-agent', agent);
  });
  ipcMain.handle('get-agent', async (event) => {
    const agent = await keytar.getPassword('valorant-client', 'select-agent');
    if(agent){
      return agent;
    }else{
      return null;
    }
  });


  ipcMain.handle('get-tokens', async () => {
    return await getTokensLogic();
  });

  ipcMain.handle('logout', async () => {
    try {
      await keytar.deletePassword('valorant-client', 'access-token');
      await keytar.deletePassword('valorant-client', 'id-token');
      await keytar.deletePassword('valorant-client', 'select-agent');

      globalAuthData = {
        userData: null,
        authHeaders: null,
        region: 'eu',
        shard: 'eu'
      };

      mainWindow.loadFile(path.join(__dirname, 'pages/login.html'));

      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.on('start-riot-login', (event) => {
    const riotAuthConfig = {
      client_id: "play-valorant-web-prod",
      nonce: "1",
      redirect_uri: "https://playvalorant.com/opt_in",
      response_type: "token id_token",
      scope: "account openid"
    };

    const authUrl = `https://auth.riotgames.com/authorize?${new URLSearchParams(riotAuthConfig).toString()}`;

    const authWindow = new BrowserWindow({
      width: 450,
      height: 700,
      modal: true,
      parent: mainWindow,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      },
      autoHideMenuBar: true
    });

    authWindow.loadURL(authUrl);

    authWindow.webContents.on('will-redirect', (event, newUrl) => {
      handleRedirection(newUrl, authWindow);
    });

    authWindow.webContents.on('did-navigate', (event, newUrl) => {
      handleRedirection(newUrl, authWindow);
    });
  });

  async function handleRedirection(url, window) {
    const redirectUri = "https://playvalorant.com/opt_in";

    if (url.startsWith(redirectUri)) {
      const urlFragment = new URL(url).hash.substring(1);
      const params = new URLSearchParams(urlFragment);

      const accessToken = params.get('access_token');
      const idToken = params.get('id_token');
      if (accessToken && idToken) {
        await getEntitlementToken(accessToken);
        mainWindow.webContents.send('login-success', {
          accessToken,
          idToken
        });

        window.close();
      } else {
        mainWindow.webContents.send('login-failed', 'Token.');
        window.close();
      }
    }
  }

  ipcMain.handle('get-profile-info', async (event) => {
    try{
      if (!globalAuthData.profileInfo || Object.keys(globalAuthData.profileInfo).length === 0) {
        return await getProfileInfo();
      }
      return globalAuthData.profileInfo;
    }catch(e){
      return e;
    }
  });

  ipcMain.handle('api-request', async (event, { endpoint, method = 'GET', body = null }) => {
    try {
      if (!globalAuthData.authHeaders || !globalAuthData.authHeaders['X-Riot-Entitlements-JWT']) {
        throw new Error();
      }

      let baseUrl;
      
      if (endpoint.startsWith('/parties') || endpoint.startsWith('/pregame') || endpoint.startsWith('/core-game')) {
        baseUrl = `https://glz-${globalAuthData.region}-1.${globalAuthData.shard}.a.pvp.net`;
      } else {
        baseUrl = `https://pd.${globalAuthData.region}.a.pvp.net`;
      }
      
      const url = `${baseUrl}${endpoint}`;
      const options = {
        method,
        headers: {
          ...globalAuthData.authHeaders,
          'Content-Type': 'application/json'
        }
      };

      if (body && method !== 'GET') {
        options.body = body;
      }

      const response = await fetch(url, options);
      
      let data;
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        data = await response.json();
      } else {
        data = await response.text();
      }

      if (!response.ok) {
        throw new Error(
          typeof data === 'object' && data.message 
            ? data.message 
            : `${response.status}`
        );
      }
      return { success: true, data };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.on('navigate', (event, page) => {
    mainWindow.loadFile(path.join(__dirname, `pages/${page}.html`));
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1830,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'), // preload kullanmak güvenlik için önemlidir
      contextIsolation: true,
      nodeIntegration: true,
    },
    autoHideMenuBar: true,
    frame: true,
    titleBarStyle: 'hidden',
    backgroundColor: '#0f0f0f',
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  setupIpcHandlers();
  createWindow();

  const tokenResult = await getTokensLogic();
  if (tokenResult.status && tokenResult.aToken) {
    globalAuthData.userData = {
      accessToken: tokenResult.aToken,
      idToken: tokenResult.iToken
    };

    globalAuthData.authHeaders = {
      'Authorization': `Bearer ${tokenResult.aToken}`,
      'X-Riot-ClientPlatform': 'ew0KCSJwbGF0Zm9ybVR5cGUiOiAiUEMiLA0KCSJwbGF0Zm9ybU9TIjogIldpbmRvd3MiLA0KCSJwbGF0Zm9ybU9TVmVyc2lvbiI6ICIxMC4wLjE5MDQyLjEuMjU2LjY0Yml0IiwNCgkicGxhdGZvcm1DaGlwc2V0IjogIlVua25vd24iDQp9',
      'X-Riot-ClientVersion': 'release-10.11-shipping-6-3556814'
    };

    const enttoken = await getEntitlementToken(tokenResult.aToken);
    await getProfileInfo();
    await determineRegion();
    
    if(enttoken){
      mainWindow.loadFile(path.join(__dirname, 'pages/index.html'));
    }else{
      mainWindow.loadFile(path.join(__dirname, 'pages/login.html'));
    }
  } else {
    mainWindow.loadFile(path.join(__dirname, 'pages/login.html'));
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

