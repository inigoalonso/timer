'use strict';
const $ = id => document.getElementById(id);
const [,role,sid] = location.pathname.split('/'), token = location.hash.slice(1), display = role === 'display';
let state, socket, online=false, synced=false, pending=null, reconnectTimer, retry=1000, lastResponse=0, samples=[], anchor=0, clock=0, generation=0;
let activated=false, wakeLock, wakePending=false, fallback;
document.body.classList.toggle('display',display);
function message(text){$('message').textContent=text;}
function storageGet(){try{return localStorage.getItem(sid);}catch{return null;}}
function pairing(url){
  $('displayLink').value=url||''; $('open').href=url||'#'; $('open').hidden=!url; $('copy').disabled=!url; $('qr').replaceChildren();
  if(url && typeof qrcode==='function'){const qr=qrcode(0,'M');qr.addData(url);qr.make();$('qr').innerHTML=qr.createImgTag(4,8,'Scan to open read-only presenter display');}
  if(url)try{localStorage.setItem(sid,url);}catch{message('Display link is available here. Browser storage is unavailable; copy it now.');}
}
$('create').onclick=async()=>{ $('create').disabled=true;try{const r=await fetch('/api/sessions',{method:'POST'});if(!r.ok)throw Error('Could not create timer. Try again later.');const d=await r.json();try{localStorage.setItem(d.controller.split('/')[2].split('#')[0],location.origin+d.display);}catch{}location.href=d.controller;}catch(e){message(e.message);$('create').disabled=false;}};
function serverNow(){return clock+performance.now()-anchor;}
function probe(){if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify({type:'ping',sent:performance.now()}));}
function apply(s){if(!state||s.revision>=state.revision){state=s;$('title').textContent=s.title;if(document.activeElement!==$('titleInput')&&!$('titleInput').dataset.dirty)$('titleInput').value=s.title;$('presence').textContent=`${s.connected_display_count} display(s) connected · reset duration ${s.selected_duration_seconds/60} min`;$('expiry').textContent='Expires '+new Date(s.expires_at_ms).toLocaleString();render();}}
function command(action,payload={}){
  if(!online||!synced||pending||!state)return;
  const request_id=crypto.randomUUID();pending={request_id,action};message('Waiting for acknowledgement…');render();
  socket.send(JSON.stringify({type:'command',request_id,expected_revision:state.revision,action,payload}));
  setTimeout(()=>{if(pending?.request_id===request_id){pending=null;message('Outcome unknown. Reconnecting to retrieve current state; command will not be resent.');socket.close();}},10000);
}
function replace(action,payload={}){if(state?.mode==='running'&&!confirm('Replace the running countdown, including overtime?'))return;command(action,payload);}
function render(){
  const usable=online&&synced&&!pending;
  for(const b of document.querySelectorAll('#controller button'))b.disabled=!usable;
  $('copy').disabled=!$('displayLink').value;
  if(!state)return;
  const r=state.mode==='running'?state.deadline_utc_ms-serverNow():state.paused_remaining_ms;
  if(!anchor&&state.mode==='running')return;
  const n=r>0?Math.ceil(r/1000):Math.floor(-r/1000);
  const digits=(r<=0?'+':'')+(n>=3600?Math.floor(n/3600)+':'+String(Math.floor(n/60)%60).padStart(2,'0'):String(Math.floor(n/60)).padStart(2,'0'))+':'+String(n%60).padStart(2,'0');
  $('digits').textContent=digits;
  $('digits').style.fontSize=Math.min(display?350:155,($('digits').parentElement.clientWidth-24)/(digits.length*.66))+'px';
  $('digits').className='digits '+(r<=60000?'red':r<=300000?'yellow':'green');
  const status=state.mode+(r<=0?' · TIME UP':'');if($('status').textContent!==status)$('status').textContent=status;
  const phase=r<=0?(state.mode==='running'?'Overtime':'Overtime paused'):r<=60000?'Final minute':r<=300000?'5 minutes remaining':'';if($('phase').textContent!==phase)$('phase').textContent=phase;
  $('start').disabled=!usable||state.mode==='running';$('start').textContent=state.mode==='paused'?'Resume':'Start';$('pause').disabled=!usable||state.mode!=='running';
}
function disconnected(){online=false;synced=false;samples=[];if(pending){message('Connection lost. Command outcome unknown; review the recovered timer before retrying.');pending=null;}$('connection').textContent='Disconnected · countdown continues from last known state';render();}
function connect(){
  clearTimeout(reconnectTimer);const gen=++generation;const ws=new WebSocket((location.protocol==='https:'?'wss:':'ws:')+'//'+location.host+'/ws/'+sid);socket=ws;synced=false;samples=[];lastResponse=performance.now();
  $('connection').textContent='Connecting · synchronising';render();
  ws.onopen=()=>{if(gen!==generation)return;ws.send(JSON.stringify({type:'auth',role,token}));probe();};
  ws.onmessage=e=>{
    if(gen!==generation)return;
    const m=JSON.parse(e.data);lastResponse=performance.now();online=true;retry=1000;
    if(m.type==='pong'){
      const end=performance.now(),rtt=end-m.sent;samples=samples.filter(s=>end-s.at<15000);samples.push({at:end,rtt,time:m.server_now_ms+rtt/2});const best=samples.reduce((a,b)=>a.rtt<b.rtt?a:b);anchor=end;clock=best.time+(end-best.at);synced=true;
    }
    $('connection').textContent=synced?'Connected':'Connected · synchronising';
    if(m.state)apply(m.state);
    if((m.type==='ack'||m.type==='error')&&pending?.request_id===m.request_id){const action=pending.action;pending=null;if(m.type==='ack'){message('Saved');if(action==='set_title')delete $('titleInput').dataset.dirty;if(m.display_url)pairing(m.display_url);}else message(m.message);}
    else if(m.type==='error')message(m.message);
    render();
  };
  ws.onclose=e=>{if(gen!==generation)return;disconnected();if(e.code===1008){message('Invalid, expired or replaced session link. Use a current link.');return;}reconnectTimer=setTimeout(connect,retry*(.75+Math.random()*.5));retry=Math.min(15000,retry*2);};
  ws.onerror=()=>ws.close();
}
if(sid&&token){$('landing').hidden=true;$('session').hidden=false;$('controller').hidden=display;$('controllerLink').value=location.href;$('openController').href=location.href;pairing(storageGet());connect();}
for(const m of [10,15,20,30,45,60]){const b=document.createElement('button');b.textContent=m+' min';b.onclick=()=>replace('set_duration',{seconds:m*60});$('presets').append(b);}
$('custom').onclick=()=>{const m=Number($('minutes').value);if(!Number.isInteger(m)||m<1||m>180){message('Use 1–180 whole minutes');return;}replace('set_duration',{seconds:m*60});};
$('titleInput').oninput=()=>{$('titleInput').dataset.dirty='true';};
$('saveTitle').onclick=()=>command('set_title',{text:$('titleInput').value});$('start').onclick=()=>command('start');$('pause').onclick=()=>command('pause');$('reset').onclick=()=>replace('reset');$('minus').onclick=()=>command('adjust_time',{seconds:-60});$('plus').onclick=()=>command('adjust_time',{seconds:60});
$('rotate').onclick=()=>{if(state?.connected_display_count&&!confirm('Replace the display link? Connected displays must use the new link.'))return;command('rotate_display');};
async function copy(id){try{await navigator.clipboard.writeText($(id).value);message('Link copied');}catch{$(id).focus();$(id).select();message('Copy unavailable. Copy the selected link manually.');}}
$('copy').onclick=()=>copy('displayLink');$('copyController').onclick=()=>copy('controllerLink');
async function keepAwake(){
  if(wakePending||wakeLock&&!wakeLock.released)return;
  wakePending=true;
  try{
    let nativeActive=false;
    if(navigator.wakeLock){try{wakeLock=await navigator.wakeLock.request('screen');nativeActive=true;wakeLock.addEventListener('release',()=>{$('wake').textContent='Wake prevention released - tap Activate display';});}catch{nativeActive=false;}}
    if(!nativeActive){fallback??=new NoSleep();await fallback.enable();if(!fallback.isEnabled)throw Error('Unsupported');}
    $('wake').textContent='Screen wake prevention active';
  }catch{$('wake').textContent='Wake prevention unavailable · disable automatic screen lock in device settings.';}
  finally{wakePending=false;}
}
$('activate').onclick=()=>{activated=true;keepAwake();if(document.documentElement.requestFullscreen)document.documentElement.requestFullscreen().then(()=>{$('fullscreen').textContent='Full screen active';}).catch(()=>{$('fullscreen').textContent='Full screen declined; use browser full-screen controls if available.';});else $('fullscreen').textContent='Full screen unavailable';};
document.addEventListener('fullscreenchange',()=>{$('fullscreen').textContent=document.fullscreenElement?'Full screen active':'Full screen exited';});
document.addEventListener('visibilitychange',()=>{if(!document.hidden){synced=false;samples=[];$('connection').textContent='Synchronising after return';probe();render();if(activated)keepAwake();}else{wakeLock?.release();fallback?.disable();}});
window.addEventListener('pagehide',()=>{wakeLock?.release();fallback?.disable();});
setInterval(()=>{if(socket?.readyState===WebSocket.OPEN){if(performance.now()-lastResponse>=15000){disconnected();socket.close();}else probe();}},5000);
setInterval(render,200);render();
