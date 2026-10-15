const { contextBridge, ipcRenderer } = require('electron');

const reportViewport = () => ipcRenderer.send('badnotes-direct:viewport', { width: window.innerWidth, height: window.innerHeight });
window.addEventListener('DOMContentLoaded', reportViewport);
window.addEventListener('resize', reportViewport);

contextBridge.exposeInMainWorld('badnotesTouch', Object.freeze({
  geometry: () => ipcRenderer.invoke('badnotes-direct:geometry'),
  subscribe: callback => {
    const listener = (_event, packet) => callback(packet);
    ipcRenderer.on('badnotes-direct:input', listener);
    ipcRenderer.invoke('badnotes-direct:state').then(packets => packets.forEach(callback));
    return () => ipcRenderer.removeListener('badnotes-direct:input', listener);
  },
}));

contextBridge.exposeInMainWorld('badnotesWindow', Object.freeze({
  minimize: () => ipcRenderer.send('badnotes-window:minimize'),
  toggleMaximize: () => ipcRenderer.send('badnotes-window:toggle-maximize'),
  close: () => ipcRenderer.send('badnotes-window:close'),
  startResize: (edge, x, y) => ipcRenderer.send('badnotes-window:resize-start', { edge, x, y }),
  resizeTo: (x, y) => ipcRenderer.send('badnotes-window:resize-move', { x, y }),
  endResize: () => ipcRenderer.send('badnotes-window:resize-end'),
  onState: (callback) => {
    let subscribed = true;
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('badnotes-window:state', listener);
    ipcRenderer.invoke('badnotes-window:state').then(state => { if (subscribed && state) callback(state); });
    return () => { subscribed = false; ipcRenderer.removeListener('badnotes-window:state', listener); };
  },
}));
