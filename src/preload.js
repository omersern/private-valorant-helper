// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
    getTokens: () => ipcRenderer.invoke('get-tokens'),
    logout: () => ipcRenderer.invoke('logout'),

    initializeSession: () => ipcRenderer.invoke('initialize-session'),

    apiRequest: (data) => ipcRenderer.invoke('api-request', data),
    getProfileInfo: () => ipcRenderer.invoke('get-profile-info'),
    startRiotLogin: () => ipcRenderer.send('start-riot-login'),
    onLoginSuccess: (callback) => ipcRenderer.on('login-success', (event, ...args) => callback(...args)),
    saveTokens: (tokens) => ipcRenderer.invoke('save-tokens', tokens),
    getAgent: () => ipcRenderer.invoke('get-agent'),
    setAgent: (agent) => ipcRenderer.send('set-agent', agent),
    navigate: (page) => ipcRenderer.send('navigate', page),
});