// Run with Electron. Uses a hidden window and a disposable profile, never user notes.
const { app } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'badnotes-desktop-smoke-'));
process.env.BADNOTES_SMOKE_TEST = '1';
process.env.BADNOTES_DATA_DIR = path.join(profile, 'data');
if (process.env.BADNOTES_README_SCREENSHOT) app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.setPath('userData', profile);
let completed = false;
const timeout = setTimeout(() => { console.error('Desktop smoke timed out'); app.exit(1); }, 90000);
app.on('browser-window-created', (_, win) => {
  const errors = [];
  win.webContents.on('console-message', event => {
    if (event.level === 'error') errors.push(event.message);
  });
  win.webContents.once('did-finish-load', async () => {
    try {
      for (let attempt = 0; attempt < 100; attempt++) {
        const ready = await win.webContents.executeJavaScript("document.getElementById('app')?.style.display !== 'none' && typeof selectNotebook === 'function'");
        if (ready) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      const result = await win.webContents.executeJavaScript(`(async () => {
        const response = await fetch('/api/notebooks');
        const books = await response.json();
        return { status: response.status, visible: document.getElementById('app').style.display !== 'none',
          windowApi: typeof badnotesWindow.minimize === 'function',
          notebooks: Array.isArray(books), geometry: !!window.GeometryDetector,
          canvas: !!document.querySelector('canvas'), nodeDisabled: typeof require === 'undefined' };
      })()`);
      assert.deepEqual(result, { status: 200, visible: true, windowApi: true, notebooks: true, geometry: true, canvas: true, nodeDisabled: true });
      assert.equal(errors.length, 0, errors.join('\n'));
      if (process.env.BADNOTES_README_SCREENSHOT) {
        await win.webContents.executeJavaScript(`(async () => {
          const demo = await API.post('/api/notebooks', { name: 'Ideas in motion', color: '#7640fd', icon: 'pencil', template: 'dotted' });
          const book = demo.notebook, page = book.pages[0];
          const shapes = [], base = {tool:'pen',size:3,color:'#7640fd'};
          for (const [type, start, end, color] of [
            ['rounded-rectangle',{x:75,y:250},{x:305,y:380},'#7640fd'],
            ['arrow',{x:330,y:315},{x:465,y:315},'#9a4cfd'],
            ['circle',{x:510,y:255},{x:640,y:385},'#7640fd'],
            ['heart',{x:125,y:550},{x:270,y:690},'#cf5a9a'],
            ['hexagon',{x:440,y:550},{x:590,y:690},'#379886']]) {
            shapes.push(GeometryDetector.createShape(type,start,end,{...base,id:Math.random(),color}));
          }
          shapes.push({...base,id:42,color:'#9a4cfd',points:Array.from({length:150},(_,i)=>({x:85+i*3.7,y:465+Math.sin(i/13)*24,size:3}))});
          await API.put('/api/notebooks/'+book.id+'/pages/'+page, { width:760,height:960,template:'dotted',strokes:shapes,textFields:[
            {id:'title',x:75,y:80,width:600,height:60,text:'Make room for your ideas.',fontSize:32,color:'#34313f'},
            {id:'subtitle',x:75,y:145,width:600,height:50,text:'Sketch. Connect. Keep going.',fontSize:19,color:'#777183'},
            {id:'footer',x:75,y:800,width:610,height:70,text:'A quiet place for thoughts that are still taking shape.',fontSize:18,color:'#777183'}] });
          await API.post('/api/notebooks', {name:'Design journal',color:'#cf5a9a',icon:'leaf',template:'grid'});
          await API.post('/api/notebooks', {name:'The next chapter',color:'#379886',icon:'book',template:'blank'});
          await loadNotebooks(); await selectNotebook(book.id);
          document.documentElement.setAttribute('data-theme','light');
          if(typeof applyTheme==='function')applyTheme('light');
          const left=document.querySelector('.sidebar').getBoundingClientRect().right;
          const right=document.getElementById('pageNav').getBoundingClientRect().left;
          zoom=Math.min((right-left-140)/760,(innerHeight-190)/960);
          panX=left+(right-left-760*zoom)/2;panY=80;
          updateCanvasTransform();
        })()`);
        await new Promise(resolve => setTimeout(resolve, 1800));
        const screenshot = await win.webContents.capturePage();
        fs.writeFileSync(process.env.BADNOTES_README_SCREENSHOT, screenshot.toPNG());
      }
      completed = true;
      console.log('Desktop smoke passed:', JSON.stringify(result));
      clearTimeout(timeout);
      win.close();
    } catch (error) { console.error(error); app.exit(1); }
  });
});
app.on('will-quit', () => { if (!completed) process.exitCode = 1; });
require('../electron/main.cjs');
