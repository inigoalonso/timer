'use strict';
const $ = id => document.getElementById(id);
const [,role,sid] = location.pathname.split('/'), token = location.hash.slice(1), display = role === 'display';
let state, socket, online=false, synced=false, pending=null, reconnectTimer, retry=1000, lastResponse=0, samples=[], anchor=0, clock=0, generation=0;
let activated=false, wakeLock, wakePending=false, fallback;
let displayRemembered=false;
let playlistDraft=[], playlistDirty=false, playlistBase='[]', playlistConflict=false, playlistFeedback='';
const notificationController=role==='control'&&!!sid&&!!token;
let notificationRequestPending=false;
const milestoneNotifications=new MilestoneNotifications((milestone,current)=>{
  if(!notificationController||!milestoneNotifications.enabled||Notification.permission!=='granted')return;
  try{
    new Notification(milestone,{body:current.title+(current.playlist_phase==='qa'?' · Q&A':''),tag:`stage-time-${sid}`});
  }catch{
    milestoneNotifications.enabled=false;
    $('notificationStatus').textContent='Notifications unavailable in this browser';
    $('notificationsEnabled').checked=false;
  }
});
document.body.classList.toggle('display',display);
let messageTimer, toolsTimer, dragIndex=null, runSignature='';
function icons(){window.lucide?.createIcons();}
function buttonContent(button,icon,text){
  if(button.dataset.label===text&&button.dataset.icon===icon)return;
  button.dataset.label=text;button.dataset.icon=icon;
  const glyph=document.createElement('i');glyph.setAttribute('data-lucide',icon);
  const label=document.createElement('span');label.textContent=text;button.replaceChildren(glyph,label);if(button.isConnected)icons();
}
function message(text){$('message').textContent=text;$('message').hidden=!text;clearTimeout(messageTimer);if(['Saved','Link copied','Playlist downloaded'].includes(text))messageTimer=setTimeout(()=>{$('message').hidden=true;},3000);}
function selectTab(name,focus=false){
  for(const tab of document.querySelectorAll('[data-tab]')){
    const selected=tab.dataset.tab===name;tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;$(tab.dataset.tab).hidden=!selected;if(selected&&focus)tab.focus();
  }
}
for(const tab of document.querySelectorAll('[data-tab]')){
  tab.onclick=()=>selectTab(tab.dataset.tab);
  tab.onkeydown=event=>{
    const names=['run','playlist','links'],index=names.indexOf(tab.dataset.tab);
    const target=event.key==='Home'?0:event.key==='End'?2:event.key==='ArrowRight'?(index+1)%3:event.key==='ArrowLeft'?(index+2)%3:null;
    if(target!==null){event.preventDefault();selectTab(names[target],true);}
  };
}
function revealDisplayTools(){
  if(!display)return;document.body.classList.remove('tools-idle');clearTimeout(toolsTimer);
  if(activated&&(document.fullscreenElement||window.DisplayApp?.standalone())&&wakeActive())toolsTimer=setTimeout(()=>document.body.classList.add('tools-idle'),4000);
}
function wakeActive(){return !!(wakeLock&&!wakeLock.released||fallback?.isEnabled);}
for(const event of ['pointermove','pointerdown','keydown','focusin'])document.addEventListener(event,revealDisplayTools);
document.addEventListener('keydown',event=>{if(event.key==='Escape')$('settings').open=false;});
document.addEventListener('pointerdown',event=>{if(!$('settings').contains(event.target))$('settings').open=false;});
window.addEventListener('beforeunload',event=>{if(playlistDirty){event.preventDefault();event.returnValue='';}});
function storageGet(){try{return localStorage.getItem(sid);}catch{return null;}}
function pairing(url){
  $('displayLink').value=url||''; $('open').href=url||'#'; $('open').hidden=!url; $('copy').disabled=!url; $('qr').replaceChildren();
  if(url && typeof qrcode==='function'){const qr=qrcode(0,'M');qr.addData(url);qr.make();$('qr').innerHTML=qr.createImgTag(4,8,'Scan to open read-only presenter display');}
  if(url)try{localStorage.setItem(sid,url);}catch{message('Display link is available here. Browser storage is unavailable; copy it now.');}
}
$('create').onclick=async()=>{ $('create').disabled=true;try{const r=await fetch('/api/sessions',{method:'POST'});if(!r.ok)throw Error('Could not create timer. Try again later.');const d=await r.json();try{localStorage.setItem(d.controller.split('/')[2].split('#')[0],location.origin+d.display);}catch{}location.href=d.controller;}catch(e){message(e.message);$('create').disabled=false;}};
function serverNow(){return clock+performance.now()-anchor;}
function probe(){if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify({type:'ping',sent:performance.now()}));}
function apply(s){if(!state||s.revision>=state.revision){state=s;syncPlaylist();$('title').textContent=s.title||'Untitled presentation';$('title').hidden=display&&!s.title;if(document.activeElement!==$('titleInput')&&!$('titleInput').dataset.dirty)$('titleInput').value=s.title;$('presence').textContent=`${s.connected_display_count} display(s) connected`;$('resetDuration').textContent=`Reset: ${s.selected_duration_seconds/60} min`;$('expiry').textContent='Expires '+new Date(s.expires_at_ms).toLocaleString();render();}}
function command(action,payload={}){
  if(!online||!synced||pending||!state)return;
  const request_id=crypto.randomUUID();pending={request_id,action};message('Waiting for acknowledgement…');render();
  socket.send(JSON.stringify({type:'command',request_id,expected_revision:state.revision,action,payload}));
  setTimeout(()=>{if(pending?.request_id===request_id){pending=null;message('Outcome unknown. Reconnecting to retrieve current state; command will not be resent.');socket.close();}},10000);
}
function replace(action,payload={}){if(state?.mode==='running'&&!confirm('Replace the running countdown, including overtime?'))return;command(action,payload);}
function render(){
  const usable=online&&synced&&!pending;
  for(const b of document.querySelectorAll('#controller button:not([role="tab"])'))b.disabled=!usable;
  $('copy').disabled=!$('displayLink').value;
  $('settings').hidden=!notificationController;
  $('displayTools').hidden=!display;
  if(display&&window.DisplayApp){
    const standalone=window.DisplayApp.standalone();
    $('installDisplayLink').hidden=standalone;
    if(standalone)buttonContent($('activate'),'sun','Keep screen awake');
    else if(!document.documentElement.requestFullscreen)buttonContent($('activate'),'sun','Keep screen awake');
  }
  $('displayConnection').hidden=!display||online&&synced;
  $('displayConnection').textContent=online&&synced?'':$('connection').textContent;
  renderPlaylistControls(usable);
  if(!state)return;
  $('presentationPhase').hidden=state.playlist_index==null;
  $('presentationPhase').textContent=state.playlist_index==null?'':`${state.playlist_index+1} / ${state.playlist.length} · ${state.playlist_phase==='qa'?'Q&A':'Presentation'}`;
  const r=state.mode==='running'?state.deadline_utc_ms-serverNow():state.paused_remaining_ms;
  if(notificationController)milestoneNotifications.update(state,r,online&&synced&&!!anchor);
  if(!anchor&&state.mode==='running')return;
  const n=r>0?Math.ceil(r/1000):Math.floor(-r/1000);
  const digits=(r<=0?'+':'')+(n>=3600?Math.floor(n/3600)+':'+String(Math.floor(n/60)%60).padStart(2,'0'):String(Math.floor(n/60)).padStart(2,'0'))+':'+String(n%60).padStart(2,'0');
  $('digits').textContent=digits;
  $('digits').style.fontSize=Math.min(display?Math.min(480,innerHeight*.45):155,($('digits').parentElement.clientWidth-24)/(digits.length*.66))+'px';
  $('digits').className='digits '+(r<=60000?'red':r<=300000?'yellow':'green');
  const status=r<=0?'Time up':state.mode==='paused'?'Paused':state.mode==='prepared'?'Ready':'';if($('status').textContent!==status)$('status').textContent=status;
  const phase=r<=0?(state.mode==='running'?'Overtime':'Overtime paused'):r<=60000?'Final minute':r<=300000?'5 minutes remaining':'';if($('phase').textContent!==phase)$('phase').textContent=phase;
  $('start').disabled=!usable;buttonContent($('start'),state.mode==='running'?'pause':'play',state.mode==='running'?'Pause':state.mode==='paused'?'Resume':'Start');$('pause').disabled=!usable||state.mode!=='running';
}
function disconnected(){online=false;synced=false;samples=[];if(pending){message('Connection lost. Command outcome unknown; review the recovered timer before retrying.');pending=null;}$('connection').textContent=state?'Disconnected · countdown continues from last known state':'Disconnected · waiting for timer state';render();}
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
    if(m.state){apply(m.state);if(display&&!displayRemembered){window.DisplayApp?.authenticated();displayRemembered=true;}}
    if((m.type==='ack'||m.type==='error')&&pending?.request_id===m.request_id){const action=pending.action;pending=null;if(m.type==='ack'){message('Saved');if(action==='set_title'||action==='load_presentation'||action==='next_presentation')delete $('titleInput').dataset.dirty;if(m.display_url)pairing(m.display_url);}else message(m.message);}
    else if(m.type==='error')message(m.message);
    render();
  };
  ws.onclose=e=>{if(gen!==generation)return;disconnected();if(e.code===1008){if(display&&window.DisplayApp){window.DisplayApp.invalid();return;}message('Invalid, expired or replaced session link. Use a current link.');return;}reconnectTimer=setTimeout(connect,retry*(.75+Math.random()*.5));retry=Math.min(15000,retry*2);};
  ws.onerror=()=>ws.close();
}
function validatePlaylist(entries){
  if(!Array.isArray(entries)||entries.length>100)throw Error('Use at most 100 presentations.');
  return entries.map(entry=>{
    const required=['title','duration_seconds','qa_duration_seconds'];
    if(!entry||typeof entry!=='object'||Array.isArray(entry)||!required.every(field=>Object.hasOwn(entry,field))||Object.keys(entry).some(field=>!required.includes(field)&&field!=='speaker'))throw Error('Each presentation needs a title, duration and Q&A duration.');
    if(typeof entry.title!=='string'||!entry.title.trim()||entry.title.length>120)throw Error('Presentation titles must contain 1–120 characters.');
    if(Object.hasOwn(entry,'speaker')&&(typeof entry.speaker!=='string'||entry.speaker.length>120))throw Error('Speaker must be text of at most 120 characters.');
    for(const [field,min] of [['duration_seconds',60],['qa_duration_seconds',0]]){
      const duration=entry[field];
      if(!Number.isInteger(duration)||duration<min||duration>10800||duration%60)throw Error('Talks need 1–180 whole minutes; Q&A needs 0–180.');
    }
    return {...entry};
  });
}
function syncPlaylist(){
  const saved=JSON.stringify(state.playlist||[]);
  if(!playlistDirty||saved===JSON.stringify(playlistDraft)){
    const changed=JSON.stringify(playlistDraft)!==saved;
    playlistBase=saved;playlistDirty=false;playlistConflict=false;
    if(changed){playlistDraft=JSON.parse(saved);buildPlaylist();}
  }else playlistConflict=saved!==playlistBase;
}
function editPlaylist(){playlistDirty=true;playlistFeedback='';render();}
function playlistError(error){playlistFeedback=error.message;message(error.message);render();}
function reorderPresentation(from,to){
  if(pending||!Number.isInteger(from)||!Number.isInteger(to)||from===to||from<0||to<0||from>=playlistDraft.length||to>=playlistDraft.length)return;
  const [moved]=playlistDraft.splice(from,1);playlistDraft.splice(to,0,moved);buildPlaylist();editPlaylist();
}
function buildPlaylist(){
  $('playlistEntries').replaceChildren();
  playlistDraft.forEach((entry,index)=>{
    const row=document.createElement('li');row.className='playlist-entry';
    row.draggable=true;
    row.ondragstart=event=>{if(pending||event.target.closest('input,button')){event.preventDefault();return;}dragIndex=index;event.dataTransfer.setData('text/plain',String(index));row.classList.add('dragging');};
    row.ondragend=()=>{dragIndex=null;row.classList.remove('dragging');};
    row.ondragover=event=>{if(dragIndex!==null)event.preventDefault();};
    row.ondrop=event=>{event.preventDefault();if(dragIndex===null)return;const source=dragIndex;dragIndex=null;reorderPresentation(source,index);};
    const details=document.createElement('details'),summary=document.createElement('summary');
    const grip=document.createElement('button');grip.className='drag-handle icon-button';grip.type='button';grip.title='Drag to reorder';grip.setAttribute('aria-label',`Drag presentation ${index+1}`);const gripIcon=document.createElement('i');gripIcon.setAttribute('data-lucide','grip-vertical');grip.append(gripIcon);
    let pointerTarget=null;
    grip.onclick=event=>{event.preventDefault();event.stopPropagation();};
    grip.onpointerdown=event=>{if(pending||event.button!==0)return;event.preventDefault();event.stopPropagation();pointerTarget=index;grip.setPointerCapture(event.pointerId);row.classList.add('dragging');};
    grip.onpointermove=event=>{if(!grip.hasPointerCapture(event.pointerId))return;const target=document.elementFromPoint(event.clientX,event.clientY)?.closest('.playlist-entry');if(target)pointerTarget=[...$('playlistEntries').children].indexOf(target);};
    grip.onpointerup=event=>{if(!grip.hasPointerCapture(event.pointerId))return;grip.releasePointerCapture(event.pointerId);row.classList.remove('dragging');reorderPresentation(index,pointerTarget);};
    grip.onpointercancel=()=>{pointerTarget=null;row.classList.remove('dragging');};
    const number=document.createElement('span');number.className='playlist-number';number.textContent=index+1;
    const description=document.createElement('span');description.className='playlist-summary';
    const name=document.createElement('strong'),durations=document.createElement('small');
    function summarize(){name.textContent=entry.title||'Untitled presentation';durations.textContent=`${entry.speaker?entry.speaker+' · ':''}${entry.duration_seconds/60} min talk · ${entry.qa_duration_seconds/60} min Q&A`;}
    summarize();description.append(name,durations);const edit=document.createElement('i');edit.setAttribute('data-lucide','pencil');summary.append(grip,number,description,edit);details.append(summary);
    const fields=document.createElement('div');fields.className='playlist-fields';
    for(const [field,label,type,min] of [['title','Title','text',null],['speaker','Speaker','text',null],['duration_seconds','Talk (min)','number',1],['qa_duration_seconds','Q&A (min)','number',0]]){
      const wrapper=document.createElement('label');wrapper.textContent=label;
      const input=document.createElement('input');input.type=type;input.dataset.field=field;input.setAttribute('aria-label',`${label}, presentation ${index+1}`);
      if(type==='text'){input.maxLength=120;input.value=entry[field]??'';input.required=field==='title';}
      else{input.min=min;input.max=180;input.step=1;input.required=true;input.value=entry[field]/60;}
      input.oninput=()=>{entry[field]=type==='text'?input.value:input.value===''?null:Number(input.value)*60;summarize();editPlaylist();};
      wrapper.append(input);fields.append(wrapper);
    }
    const actions=document.createElement('div');actions.className='playlist-actions';
    for(const [action,label,icon] of [['up','Move up','arrow-up'],['down','Move down','arrow-down'],['remove','Remove presentation','trash-2']]){
      const button=document.createElement('button');button.type='button';button.className='icon-button';const glyph=document.createElement('i');glyph.setAttribute('data-lucide',icon);button.append(glyph);button.title=label;button.setAttribute('aria-label',`${label} ${index+1}`);button.dataset.action=action;
      button.onclick=()=>{
        if(action==='talk'||action==='qa'){replace('load_presentation',{index,phase:action});return;}
        if(action==='remove')playlistDraft.splice(index,1);
        else{const target=index+(action==='up'?-1:1);[playlistDraft[index],playlistDraft[target]]=[playlistDraft[target],playlistDraft[index]];}
        buildPlaylist();editPlaylist();
        const targetRow=$('playlistEntries').children[Math.min(index,playlistDraft.length-1)];
        if(targetRow){targetRow.querySelector('details').open=true;targetRow.querySelector(action==='remove'?'summary':`[data-action="${action}"]`)?.focus();}
      };
      actions.append(button);
    }
    fields.append(actions);details.append(fields);row.append(details);$('playlistEntries').append(row);
  });
  icons();
}
function renderPlaylistControls(usable){
  const editable=!!state&&!pending;
  $('addPresentation').disabled=!editable||playlistDraft.length>=100;
  $('uploadPlaylist').disabled=!editable;
  $('downloadPlaylist').disabled=!editable;
  $('savePlaylist').disabled=!usable||!playlistDirty||playlistConflict;
  $('discardPlaylist').disabled=!editable||!playlistDirty;
  $('playlistSaveBar').hidden=!playlistDirty;
  $('draftBadge').hidden=!playlistDirty;
  $('runNotice').hidden=!playlistDirty;
  $('runNotice').textContent='Playlist has unsaved edits. Save or discard them in Playlist before loading a presentation.';
  $('playlistCount').textContent=`${playlistDraft.length} presentation${playlistDraft.length===1?'':'s'}`;
  $('playlistNotice').textContent=playlistConflict?'Playlist changed on another controller. Download your edits or discard them to use the saved list.':playlistFeedback|| (playlistDirty?'Unsaved changes':playlistDraft.length?'Saved':'No presentations');
  for(const [index,row] of [...$('playlistEntries').children].entries()){
    row.classList.toggle('active',!playlistDirty&&state?.playlist_index===index);
    for(const input of row.querySelectorAll('input'))input.disabled=!editable;
    for(const button of row.querySelectorAll('button')){
      const action=button.dataset.action;
      button.disabled=action==='talk'||action==='qa'?!usable||playlistDirty||(action==='qa'&&!playlistDraft[index].qa_duration_seconds):!editable||(action==='up'&&index===0)||(action==='down'&&index===playlistDraft.length-1);
    }
  }
  const active=state?.playlist_index, hasQA=active!=null&&state.playlist_phase==='talk'&&state.playlist[active]?.qa_duration_seconds;
  const finished=active!=null&&!hasQA&&active>=state.playlist.length-1;
  const nextIndex=active==null?0:hasQA?active:active+1,nextEntry=state?.playlist?.[nextIndex];
  $('nextTitle').textContent=finished?'Playlist complete':nextEntry?`${nextEntry.title}${hasQA?' · Q&A':''} · ${(hasQA?nextEntry.qa_duration_seconds:nextEntry.duration_seconds)/60} min`:'No presentation queued';
  buttonContent($('nextPresentation'),'skip-forward',active==null?'Load first presentation':hasQA?'Load Q&A':finished?'Playlist complete':'Load next talk');
  $('nextPresentation').disabled=!usable||playlistDirty||!playlistDraft.length||finished;
  const signature=JSON.stringify([state?.playlist,active,state?.playlist_phase]);
  if(runSignature!==signature){runSignature=signature;buildRunList();}
  for(const button of document.querySelectorAll('#runEntries button'))button.disabled=!usable||playlistDirty;
}
function buildRunList(){
  $('runEntries').replaceChildren();
  (state?.playlist||[]).forEach((entry,index)=>{
    const row=document.createElement('li');row.className='run-entry';row.classList.toggle('active',state.playlist_index===index);
    const qaNext=state.playlist_index!=null&&state.playlist_phase==='talk'&&state.playlist[state.playlist_index]?.qa_duration_seconds;
    row.classList.toggle('next',!qaNext&&index===(state.playlist_index==null?0:state.playlist_index+1));
    const text=document.createElement('div');text.className='run-entry-title';const title=document.createElement('h3');title.textContent=`${index+1}. ${entry.title}`;const durations=document.createElement('small');durations.textContent=`${entry.speaker?entry.speaker+' · ':''}${entry.duration_seconds/60} min talk${entry.qa_duration_seconds?` · ${entry.qa_duration_seconds/60} min Q&A`:''}`;text.append(title,durations);
    const actions=document.createElement('div');actions.className='row';
    for(const phase of entry.qa_duration_seconds?['talk','qa']:['talk']){const button=document.createElement('button');buttonContent(button,'corner-down-right',phase==='talk'?'Load talk':'Load Q&A');button.setAttribute('aria-label',`Load ${phase==='talk'?'talk':'Q&A'} ${index+1}`);button.onclick=()=>replace('load_presentation',{index,phase});actions.append(button);}
    row.append(text,actions);$('runEntries').append(row);
  });
  icons();
}
$('notificationControls').hidden=!notificationController;
if(notificationController){
  const supported='Notification' in window&&window.isSecureContext;
  $('notificationsEnabled').disabled=!supported||Notification.permission==='denied';
  $('notificationStatus').textContent=!supported?'Notifications require a supported browser and HTTPS (or localhost)':Notification.permission==='denied'?'Blocked in browser site settings':'Off';
  $('notificationsEnabled').onchange=async()=>{
    const enabled=$('notificationsEnabled').checked;
    milestoneNotifications.enabled=false;milestoneNotifications.previous=null;
    if(!enabled){$('notificationStatus').textContent='Off';return;}
    if(notificationRequestPending)return;
    notificationRequestPending=true;$('notificationsEnabled').disabled=true;
    try{
      const permission=Notification.permission==='granted'?'granted':await Notification.requestPermission();
      milestoneNotifications.enabled=permission==='granted';
      $('notificationsEnabled').checked=milestoneNotifications.enabled;
      $('notificationStatus').textContent=permission==='granted'?'On':permission==='denied'?'Blocked in browser site settings':'Permission not granted';
    }catch{
      $('notificationsEnabled').checked=false;$('notificationStatus').textContent='Notifications unavailable in this browser';
    }finally{
      notificationRequestPending=false;$('notificationsEnabled').disabled=Notification.permission==='denied';
    }
  };
}
$('addPresentation').onclick=()=>{playlistDraft.push({title:'',duration_seconds:1800,qa_duration_seconds:300});buildPlaylist();editPlaylist();const row=$('playlistEntries').lastElementChild;row.querySelector('details').open=true;row.querySelector('input').focus();};
$('savePlaylist').onclick=()=>{try{playlistFeedback='';command('set_playlist',{entries:validatePlaylist(playlistDraft)});}catch(error){playlistError(error);for(const row of $('playlistEntries').children){const input=[...row.querySelectorAll('input')].find(field=>!field.checkValidity());if(input){row.querySelector('details').open=true;input.focus();break;}}}};
$('discardPlaylist').onclick=()=>{playlistDirty=false;playlistFeedback='';syncPlaylist();render();};
$('nextPresentation').onclick=()=>replace('next_presentation');
$('downloadPlaylist').onclick=()=>{
  try{
    const data={version:1,presentations:validatePlaylist(playlistDraft)};
    const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)+'\n'],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;link.download='stage-time-playlist.json';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
    message('Playlist downloaded');
  }catch(error){playlistError(error);}
};
$('uploadPlaylist').onclick=()=>$('playlistFile').click();
$('playlistFile').onchange=async()=>{
  const file=$('playlistFile').files[0];$('playlistFile').value='';if(!file)return;
  const original=JSON.stringify(playlistDraft), revision=state?.revision;
  try{
    if(file.size>131072)throw Error('Playlist file must be at most 128 KiB.');
    const data=JSON.parse(await file.text());
    if(!data||typeof data!=='object'||Array.isArray(data)||data.version!==1||Object.keys(data).sort().join(',')!=='presentations,version')throw Error('Expected a Stage time playlist JSON file (version 1).');
    const entries=validatePlaylist(data.presentations);
    if(pending||revision!==state?.revision||original!==JSON.stringify(playlistDraft))throw Error('The playlist changed while reading the file. Upload it again.');
    if(playlistDraft.length&&!confirm('Replace the playlist with this file? The current countdown will not change.'))return;
    playlistDraft=entries;buildPlaylist();editPlaylist();message('Playlist uploaded. Save changes to apply it.');
  }catch(error){playlistError(error instanceof SyntaxError?Error('Invalid JSON playlist file.'):error);}
};
if(sid&&token){$('landing').hidden=true;$('session').hidden=false;$('controller').hidden=display;$('controllerLink').value=location.href;$('openController').href=location.href;pairing(storageGet());connect();}
for(const m of [10,15,20,30,45,60]){const b=document.createElement('button');b.textContent=m+' min';b.onclick=()=>replace('set_duration',{seconds:m*60});$('presets').append(b);}
$('custom').onclick=()=>{const m=Number($('minutes').value);if(!Number.isInteger(m)||m<1||m>180){$('timerFeedback').textContent='Use 1–180 whole minutes';return;}$('timerFeedback').textContent='';replace('set_duration',{seconds:m*60});};
$('titleInput').oninput=()=>{$('titleInput').dataset.dirty='true';};
$('saveTitle').onclick=()=>command('set_title',{text:$('titleInput').value});$('start').onclick=()=>command(state?.mode==='running'?'pause':'start');$('pause').onclick=()=>command('pause');$('reset').onclick=()=>replace('reset');$('minus').onclick=()=>command('adjust_time',{seconds:-60});$('plus').onclick=()=>command('adjust_time',{seconds:60});
$('rotate').onclick=()=>{if(!confirm('Replace the display link? Previous links will stop working and connected displays must use the new link.'))return;command('rotate_display');};
async function copy(id){try{await navigator.clipboard.writeText($(id).value);message('Link copied');}catch{$(id).focus();$(id).select();message('Copy unavailable. Copy the selected link manually.');}}
$('copy').onclick=()=>copy('displayLink');$('copyController').onclick=()=>copy('controllerLink');
async function keepAwake(){
  if(wakePending||wakeLock&&!wakeLock.released)return;
  wakePending=true;
  try{
    let nativeActive=false;
    if(navigator.wakeLock){try{wakeLock=await navigator.wakeLock.request('screen');nativeActive=true;wakeLock.addEventListener('release',()=>{$('wake').textContent='Wake prevention released - activate again';revealDisplayTools();});}catch{nativeActive=false;}}
    if(!nativeActive){fallback??=new NoSleep();await fallback.enable();if(!fallback.isEnabled)throw Error('Unsupported');}
    $('wake').textContent='Screen wake prevention active';
  }catch{$('wake').textContent='Wake prevention unavailable · disable automatic screen lock in device settings.';}
  finally{wakePending=false;revealDisplayTools();}
}
$('activate').onclick=event=>{if(!display)return;if(event?.detail)$('activate').blur();activated=true;keepAwake();if(window.DisplayApp?.standalone()){$('fullscreen').textContent='';revealDisplayTools();return;}if(document.fullscreenElement){document.exitFullscreen();return;}if(document.documentElement.requestFullscreen)document.documentElement.requestFullscreen().then(()=>{$('fullscreen').textContent='Full screen active';revealDisplayTools();}).catch(()=>{$('fullscreen').textContent='Full screen declined';revealDisplayTools();});else $('fullscreen').textContent='Browser full screen unavailable';};
document.addEventListener('fullscreenchange',()=>{$('fullscreen').textContent=document.fullscreenElement?'Full screen active':'Full screen exited';buttonContent($('activate'),document.fullscreenElement?'minimize':'maximize',document.fullscreenElement?'Exit full screen':'Enter full screen');revealDisplayTools();render();});
document.addEventListener('visibilitychange',()=>{if(!document.hidden){synced=false;samples=[];$('connection').textContent='Synchronising after return';probe();render();if(activated)keepAwake();}else{wakeLock?.release();fallback?.disable();}});
window.addEventListener('pagehide',()=>{wakeLock?.release();fallback?.disable();});
window.addEventListener('resize',render);
setInterval(()=>{if(socket?.readyState===WebSocket.OPEN){if(performance.now()-lastResponse>=15000){disconnected();socket.close();}else probe();}},5000);
icons();setInterval(render,200);render();
