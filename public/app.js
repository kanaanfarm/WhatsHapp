let authMode="login", me=null, users=[], activeUser=null, socket=null, statuses=[];
let typingTimer=null, deferredPrompt=null, mediaRecorder=null, audioChunks=[], isRecording=false;
let peer=null, localStream=null, screenStream=null, cameraVideoTrack=null, callPeerId=null, callMode="video", pendingCall=null, iceConfig=null, pendingIce=[];
let currentUserFilter="all";
let profileTarget=null;
let callsEnabled=true;
let aiBusy=false;
let aiStatus=null;
let activeConversation=[];
const AI_HISTORY_KEY="connectchat-ai-history-v1";
const AI_PROVIDER_KEY="connectchat-ai-provider-v1";
const DEFAULT_APPEARANCE={density:"compact",text:"standard",icons:"compact",sidebar:"narrow",insights:"show"};
const $=id=>document.getElementById(id);

function appearanceKey(){return `connectchat-appearance-${me?.id||"guest"}`}
function loadAppearance(){
  try{return {...DEFAULT_APPEARANCE,...JSON.parse(localStorage.getItem(appearanceKey())||"{}")}}
  catch{return {...DEFAULT_APPEARANCE}}
}
function applyAppearance(settings=loadAppearance()){
  const root=document.documentElement;
  root.dataset.density=settings.density;
  root.dataset.textSize=settings.text;
  root.dataset.iconSize=settings.icons;
  root.dataset.sidebarSize=settings.sidebar;
  root.dataset.insights=settings.insights;
}
function saveAppearance(settings){
  localStorage.setItem(appearanceKey(),JSON.stringify(settings));
  applyAppearance(settings);
}

function avatarHtml(user, fallbackText){
  const fallback=escapeHtml(fallbackText||initials(user?.username||"User"));
  const url=user?.avatar?safeFileUrl(user.avatar):"";
  return url?`<img src="${escapeHtml(url)}" alt="${escapeHtml(user?.username||"Profile photo")}">`:fallback;
}
function setAvatarElement(element,user,fallbackText){
  if(!element)return;
  element.innerHTML=avatarHtml(user,fallbackText);
}

function toast(text){
  $("toast").textContent=text;$("toast").classList.remove("hidden");
  setTimeout(()=>$("toast").classList.add("hidden"),2200);
}
function setMode(mode){
  authMode=mode;
  $("loginTab").classList.toggle("active",mode==="login");
  $("registerTab").classList.toggle("active",mode==="register");
  $("authSubmit").textContent=mode==="login"?"Login":"Create account";
  $("authSubtitle").textContent=mode==="login"?"Welcome back. Sign in to continue.":"Create a private account in a few seconds.";
  $("authPassword").autocomplete=mode==="login"?"current-password":"new-password";
  $("authError").textContent="";
}
$("loginTab").onclick=()=>setMode("login");
$("registerTab").onclick=()=>setMode("register");

async function api(url,options={}){
  const headers={"X-ConnectChat-Request":"1",...(options.headers||{})};
  if(!(options.body instanceof FormData))headers["Content-Type"]="application/json";
  const res=await fetch(url,{credentials:"same-origin",cache:"no-store",redirect:"error",...options,headers});
  const data=await res.json().catch(()=>({}));
  if(!res.ok){const error=new Error(data.error||"Request failed");error.code=data.code;error.status=res.status;error.details=data.details;error.retryable=data.retryable;throw error}
  return data;
}

$("authForm").onsubmit=async e=>{
  e.preventDefault();
  const username=$("authUsername").value.trim();
  const password=$("authPassword").value;
  if(username.length<3){$("authError").textContent="Username must contain at least 3 characters.";return}
  if(authMode==="register"&&password.length<10){$("authError").textContent="New passwords must contain at least 10 characters.";return}
  const submit=$("authSubmit");
  try{
    $("authError").textContent="";
    submit.disabled=true;submit.textContent=authMode==="login"?"Signing in…":"Creating account…";
    const requestOptions={method:"POST",body:JSON.stringify({username,password})};
    let data;
    try{
      data=await api(`/api/${authMode}`,requestOptions);
    }catch(error){
      // A cookie from an older server release can point to a session format
      // that no longer exists. Remove it once and retry the login safely.
      if(authMode!=="login"||error.status!==400||error.message!=="Request failed.")throw error;
      await api("/api/session-reset",{method:"POST",body:"{}"});
      data=await api("/api/login",requestOptions);
    }
    if(authMode==="register"&&data.pending){
      showSavedRecovery(data.recoveryCode,data.message);
      $("authPassword").value="";setMode("login");
      $("authError").textContent="Account created. Login will work after Abokanaan approves it.";
      return;
    }
    me=data;await startApp();
    if(me.recoveryCode){showSavedRecovery(me.recoveryCode);delete me.recoveryCode}
  }catch(error){$("authError").textContent=error.message}
  finally{submit.disabled=false;submit.textContent=authMode==="login"?"Login":"Create account"}
};
$("togglePasswordBtn").onclick=()=>{
  const field=$("authPassword");
  const showing=field.type==="text";field.type=showing?"password":"text";
  $("togglePasswordBtn").textContent=showing?"Show":"Hide";
  $("togglePasswordBtn").setAttribute("aria-label",showing?"Show password":"Hide password");
};

function openRecoveryForm(){
  $("savedCodePanel").classList.add("hidden");
  $("recoverFormPanel").classList.remove("hidden");
  $("recoveryIntro").textContent="Use the private recovery code supplied when the account was created.";
  $("recoveryResult").textContent="";
  $("recoveryCodeInput").value="";$("newPasswordInput").value="";
  $("recoveryOverlay").classList.remove("hidden");
}

function showSavedRecovery(code,message="Your account is ready. Save this private code now."){
  $("recoverFormPanel").classList.add("hidden");
  $("savedCodePanel").classList.remove("hidden");
  $("recoveryIntro").textContent=message;
  $("recoveryCodeText").textContent=code;$("recoveryResult").textContent="";
  $("recoveryOverlay").classList.remove("hidden");
}

$("forgotBtn").onclick=openRecoveryForm;
$("closeRecoveryBtn").onclick=()=>$("recoveryOverlay").classList.add("hidden");
$("recoveryOverlay").onclick=e=>{if(e.target===$("recoveryOverlay"))$("recoveryOverlay").classList.add("hidden")};
$("copyRecoveryBtn").onclick=async()=>{
  try{await navigator.clipboard.writeText($("recoveryCodeText").textContent);$("recoveryResult").textContent="Recovery code copied."}
  catch{$("recoveryResult").textContent="Select the code and copy it manually."}
};
$("findUsernameBtn").onclick=async()=>{
  try{
    const data=await api("/api/recover/username",{method:"POST",body:JSON.stringify({recoveryCode:$("recoveryCodeInput").value})});
    $("recoveryResult").textContent=`Your username is: ${data.username}`;
  }catch(e){$("recoveryResult").textContent=e.message}
};
$("resetPasswordBtn").onclick=async()=>{
  try{
    const data=await api("/api/recover/password",{method:"POST",body:JSON.stringify({recoveryCode:$("recoveryCodeInput").value,newPassword:$("newPasswordInput").value})});
    showSavedRecovery(data.recoveryCode,`Password changed for ${data.username}. Save this new recovery code now; the old code no longer works.`);
  }catch(e){$("recoveryResult").textContent=e.message}
};

function statusTimeLeft(expiresAt){
  const remaining=Math.max(0,new Date(expiresAt).getTime()-Date.now());
  const hours=Math.floor(remaining/3600000);
  const minutes=Math.max(1,Math.ceil((remaining%3600000)/60000));
  return hours?`${hours}h ${minutes}m left`:`${minutes}m left`;
}

async function loadStatuses(){
  $("statusResult").textContent="";
  $("statusesList").innerHTML='<div class="status-empty">Loading statuses…</div>';
  try{statuses=await api("/api/statuses");renderStatuses()}
  catch(error){$("statusesList").innerHTML="";$("statusResult").textContent=error.message}
}

function renderStatuses(){
  $("statusesList").innerHTML="";
  if(!statuses.length){$("statusesList").innerHTML='<div class="status-empty">No active statuses. Post the first one.</div>';return}
  statuses.forEach(status=>{
    const card=document.createElement("article");
    card.className=`status-card ${status.viewed&&!status.isOwn?"viewed":""}`;
    const fileUrl=escapeHtml(safeFileUrl(status.file_url));
    let content="";
    if(status.kind==="text")content=`<div class="status-text">${escapeHtml(status.body||"")}</div>`;
    if(status.kind==="image"&&fileUrl)content=`<img class="status-media" src="${fileUrl}" alt="${escapeHtml(status.username)} status">`;
    if(status.kind==="video"&&fileUrl)content=`<video class="status-media" src="${fileUrl}" controls playsinline preload="metadata"></video>`;
    const caption=status.kind!=="text"&&status.body?`<div class="status-caption">${escapeHtml(status.body)}</div>`:"";
    const details=status.isOwn?`${statusTimeLeft(status.expires_at)} · ${Number(status.viewCount||0)} view${Number(status.viewCount||0)===1?"":"s"}`:`${statusTimeLeft(status.expires_at)}${status.viewed?" · Viewed":""}`;
    card.innerHTML=`<div class="status-card-head"><div class="avatar ${status.isOwn?"saved-avatar":""}">${status.isOwn?"★":escapeHtml(initials(status.username))}</div><div><strong>${escapeHtml(status.isOwn?`${status.username} (You)`:status.username)}</strong><span>${details}</span></div>${status.isOwn||me.isAdmin?'<button type="button" class="status-delete">Delete</button>':""}</div>${content||'<div class="status-empty">Media unavailable</div>'}${caption}`;
    const deleteButton=card.querySelector(".status-delete");
    if(deleteButton)deleteButton.onclick=()=>deleteStatus(status,deleteButton);
    $("statusesList").appendChild(card);
    if(!status.isOwn&&!status.viewed){
      status.viewed=true;
      api(`/api/statuses/${status.id}/view`,{method:"POST",body:"{}"}).catch(()=>{});
    }
  });
}

async function postStatus(){
  const text=$("statusText").value.trim();
  const file=$("statusFile").files[0];
  if(!text&&!file){$("statusResult").textContent="Write text or choose a photo/video.";return}
  if(file&&file.size>12*1024*1024){$("statusResult").textContent="Status file must be 12 MB or smaller.";return}
  const button=$("postStatusBtn");
  try{
    button.disabled=true;button.textContent="Posting…";$("statusResult").textContent="";
    if(file){
      const form=new FormData();form.append("statusFile",file);form.append("caption",text);
      await api("/api/statuses/upload",{method:"POST",body:form});
    }else await api("/api/statuses/text",{method:"POST",body:JSON.stringify({body:text})});
    $("statusText").value="";$("statusFile").value="";$("statusResult").textContent="Status posted for 24 hours.";
    await loadStatuses();
  }catch(error){$("statusResult").textContent=error.message}
  finally{button.disabled=false;button.textContent="Post status"}
}

async function deleteStatus(status,button){
  if(!confirm("Permanently delete this status and its stored media?"))return;
  try{button.disabled=true;await api(`/api/statuses/${status.id}`,{method:"DELETE"});await loadStatuses();toast("Status deleted.")}
  catch(error){button.disabled=false;toast(error.message)}
}

$("statusBtn").onclick=()=>{$("statusOverlay").classList.remove("hidden");loadStatuses()};
$("closeStatusBtn").onclick=()=>$("statusOverlay").classList.add("hidden");
$("refreshStatusBtn").onclick=loadStatuses;
$("postStatusBtn").onclick=postStatus;
$("statusOverlay").onclick=e=>{if(e.target===$("statusOverlay"))$("statusOverlay").classList.add("hidden")};

async function startApp(){
  applyAppearance();
  $("authView").classList.add("hidden");$("appView").classList.remove("hidden");
  if($("railInitials"))setAvatarElement($("railInitials"),me,initials(me.username));
  $("adminBtn").classList.toggle("hidden",!me.isAdmin);
  users=await api("/api/users");
  try{const config=await getIceConfig();callsEnabled=config.enabled!==false}catch{callsEnabled=false}
  renderUsers();connectSocket();
  if(window.innerWidth<=760){$("chatPanel").classList.add("mobile-hidden")}
}

function connectSocket(){
  if(socket)socket.disconnect();
  socket=io();
  socket.on("connect",refreshUsers);
  socket.on("privateMessage",msg=>{
    const relevant=activeUser&&(Number(msg.sender_id)===Number(activeUser.id)||Number(msg.receiver_id)===Number(activeUser.id));
    if(relevant){
      addMessage(msg);
      if(Number(msg.receiver_id)===Number(me.id)&&Number(msg.sender_id)===Number(activeUser.id))socket.emit("message:read",{messageIds:[msg.id]});
    }
    refreshUsers();
  });
  socket.on("message:status",updateMessageReceipt);
  socket.on("message:deleted",payload=>{
    removeMessage(payload?.messageId);
    refreshUsers();
  });
  socket.on("presence",p=>{
    const u=users.find(x=>x.id===p.userId);
    if(u){u.online=p.online;if(p.lastSeenAt)u.lastSeenAt=p.lastSeenAt;renderUsers();updateHeader()}else refreshUsers()
  });
  socket.on("presence:snapshot",p=>{
    const activeIds=new Set((p.userIds||[]).map(Number));
    users.forEach(u=>u.online=u.isSelf||activeIds.has(Number(u.id)));
    renderUsers();updateHeader();
  });
  socket.on("users:changed",()=>{refreshUsers();if(!$("adminOverlay").classList.contains("hidden"))loadAdminUsers()});
  socket.on("status:changed",()=>{if(!$("statusOverlay").classList.contains("hidden"))loadStatuses()});
  socket.on("status:deleted",()=>{if(!$("statusOverlay").classList.contains("hidden"))loadStatuses()});
  socket.on("status:viewed",()=>{if(!$("statusOverlay").classList.contains("hidden"))loadStatuses()});
  socket.on("typing",p=>{
    if(activeUser&&p.userId===activeUser.id)$("typingText").textContent=p.isTyping?`${p.username} is typing...`:"";
  });
  socket.on("call:incoming",showIncomingCall);
  socket.on("call:answered",async p=>{
    if(!peer||p.userId!==callPeerId)return;
    await peer.setRemoteDescription(p.answer);
    await flushPendingIce();
    $("callStatus").textContent="Connected";
  });
  socket.on("call:ice",async p=>{
    if(p.userId!==callPeerId)return;
    if(!peer||!peer.remoteDescription){pendingIce.push(p.candidate);return}
    try{await peer.addIceCandidate(p.candidate)}catch(e){console.warn("ICE candidate failed",e)}
  });
  socket.on("call:rejected",()=>finishCall("Call declined",false));
  socket.on("call:ended",()=>finishCall("Call ended",false));
  socket.on("call:unavailable",()=>finishCall("User is unavailable",false));
  socket.on("message:error",p=>toast(p.error||"Message could not be sent."));
}
async function refreshUsers(){
  try{
    users=await api("/api/users");
    if(activeUser){
      const refreshed=users.find(u=>u.id===activeUser.id);
      if(refreshed)activeUser=refreshed;
      else{activeUser=null;resetConversation()}
    }
    renderUsers();updateHeader();
  }catch{}
}

function resetConversation(){
  $("chatName").textContent="Select a user";$("chatStatus").textContent="Start a private conversation";$("activeAvatar").textContent="?";
  $("messages").className="messages empty-state";$("messages").innerHTML="<div><h3>Your messages</h3><p>Select a user to start chatting.</p></div>";
  $("messageInput").disabled=true;$("sendBtn").disabled=true;$("audioCallBtn").disabled=true;$("videoCallBtn").disabled=true;
}

function initials(name){return name.split(/\s+/).map(x=>x[0]).join("").slice(0,2).toUpperCase()}
function escapeHtml(v=""){return String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}
function time(v){
  const value=String(v||"");
  const date=new Date(value.includes("T")?value:value.replace(" ","T")+"Z");
  return Number.isNaN(date.getTime())?"":date.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
}
function lastSeenText(value){
  if(!value)return "Offline";
  const date=new Date(value);if(Number.isNaN(date.getTime()))return "Offline";
  const seconds=Math.max(0,Math.floor((Date.now()-date.getTime())/1000));
  if(seconds<60)return "Last seen just now";
  if(seconds<3600)return `Last seen ${Math.floor(seconds/60)} min ago`;
  if(seconds<86400)return `Last seen ${Math.floor(seconds/3600)} hr ago`;
  return `Last seen ${date.toLocaleDateString()} ${date.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}`;
}

function updateWorkspaceOverview(){
  if(!me)return;
  const humanContacts=users.filter(u=>!u.isSelf&&!u.isAI&&!u.isGroup);
  const online=humanContacts.filter(u=>u.online).length;
  const unread=users.reduce((n,u)=>n+Number(u.unreadCount||u.unread_count||0),0);
  if($("workspaceProfileAvatar"))setAvatarElement($("workspaceProfileAvatar"),me,initials(me.username));
  if($("workspaceProfileName"))$("workspaceProfileName").textContent=me.username;
  if($("workspaceProfileRole"))$("workspaceProfileRole").textContent=me.isAdmin?"Administrator":"Workspace member";
  if($("accountAvatar"))setAvatarElement($("accountAvatar"),me,initials(me.username));
  if($("accountName"))$("accountName").textContent=me.username;
  if($("accountRole"))$("accountRole").textContent=me.isAdmin?"Administrator":"Workspace member";
  if($("workspaceContactCount"))$("workspaceContactCount").textContent=String(humanContacts.length);
  if($("workspaceOnlineCount"))$("workspaceOnlineCount").textContent=String(online);
  if($("workspaceUnreadCount"))$("workspaceUnreadCount").textContent=String(unread);
  if($("workspaceCallStatus"))$("workspaceCallStatus").textContent=callsEnabled?"Ready":"Off";
}

function renderUsers(){
  const q=$("userSearch").value.toLowerCase();
  const filtered=users.filter(u=>{
    const matches=(u.displayName||u.username).toLowerCase().includes(q)||u.username.toLowerCase().includes(q);
    if(!matches)return false;
    if(currentUserFilter==="unread")return Number(u.unreadCount||u.unread_count||0)>0;
    if(currentUserFilter==="groups")return Boolean(u.isGroup);
    if(currentUserFilter==="pinned")return Boolean(u.pinned);
    return true;
  });
  $("usersList").innerHTML="";
  filtered.forEach(u=>{
    const d=document.createElement("div");
    d.className=`user-item ${activeUser&&activeUser.id===u.id?"active":""}`;
    const name=u.isSelf?"Saved Messages":(u.displayName||u.username);
    const avatar=u.isAI?"AI":(u.isSelf&&!u.avatar?"★":avatarHtml(u,initials(u.username)));
    const preview=u.isSelf&&!u.lastPreview?"Notes and messages to yourself":(u.lastPreview||"Start a conversation");
    const unread=Number(u.unreadCount||u.unread_count||0);
    const stamp=u.lastMessageAt||u.last_message_at;
    d.innerHTML=`<div class="avatar ${u.isSelf?"saved-avatar":""} ${u.isAI?"ai-avatar":""}">${avatar}</div><div class="user-info"><strong>${escapeHtml(name)}</strong><span>${escapeHtml(preview)}</span></div><div class="user-side">${stamp?`<time>${time(stamp)}</time>`:""}${unread?`<b class="unread-count">${Math.min(unread,99)}</b>`:`<i class="dot ${u.online?"online":""}"></i>`}</div>`;
    d.onclick=()=>selectUser(u);
    const listAvatar=d.querySelector(".avatar");
    if(listAvatar&&!u.isAI){
      listAvatar.title=`View ${name} profile`;
      listAvatar.onclick=event=>{event.stopPropagation();openProfilePage(u)};
    }
    $("usersList").appendChild(d);
  });
  renderQuickContacts();
  updateWorkspaceOverview();
  const total=users.reduce((n,u)=>n+Number(u.unreadCount||u.unread_count||0),0);
  if($("railUnread")){ $("railUnread").textContent=String(Math.min(total,99)); $("railUnread").classList.toggle("hidden",!total); }
}
function renderQuickContacts(){
  const box=$("quickContacts");
  if(!box)return;
  box.innerHTML="";

  // Show only real approved human accounts returned by the server.
  // Demo names and placeholder contacts are never rendered here.
  const realContacts=users
    .filter(u=>!u.isSelf&&!u.isAI&&!u.isGroup)
    .sort((a,b)=>{
      if(Boolean(a.online)!==Boolean(b.online))return a.online?-1:1;
      const aTime=new Date(a.lastMessageAt||a.last_message_at||0).getTime();
      const bTime=new Date(b.lastMessageAt||b.last_message_at||0).getTime();
      return bTime-aTime;
    })
    .slice(0,4);

  box.classList.toggle("hidden",realContacts.length===0);
  realContacts.forEach(u=>{
    const b=document.createElement("button");
    b.type="button";
    b.className="quick-contact";
    const name=u.displayName||u.username;
    b.title=`Open chat with ${name}`;
    b.innerHTML=`<span class="avatar">${avatarHtml(u,initials(name))}</span><small>${escapeHtml(name.split(" ")[0])}</small><i class="quick-status ${u.online?"online":""}" aria-label="${u.online?"Online":"Offline"}"></i>`;
    b.onclick=()=>selectUser(u);
    box.appendChild(b);
  });
}
$("userSearch").oninput=renderUsers;

async function selectUser(u){
  activeUser=u;renderUsers();updateHeader();
  if($("aiProviderControl"))$("aiProviderControl").classList.toggle("hidden",!u.isAI);
  $("messageInput").disabled=false;$("sendBtn").disabled=false;
  $("audioCallBtn").disabled=!callsEnabled||u.isSelf||u.isAI;$("videoCallBtn").disabled=!callsEnabled||u.isSelf||u.isAI;
  $("messages").classList.remove("empty-state");$("messages").innerHTML="";
  if(u.isAI){
    activeConversation=[];
    loadAiHistory().forEach(addMessage);
    if(!$("messages").children.length)showAiWelcome();
    loadAiStatus();
  }else{
    const history=await api(`/api/messages/${u.id}`);
    activeConversation=history;
    history.forEach(addMessage);
  }
  if(window.innerWidth<=760){$("sidebar").classList.add("mobile-hidden");$("chatPanel").classList.remove("mobile-hidden")}
  $("messageInput").focus();
}

async function getIceConfig(){
  if(!iceConfig)iceConfig=await api("/api/call-config");
  return iceConfig;
}

async function getMedia(mode){
  return navigator.mediaDevices.getUserMedia({audio:true,video:mode==="video"});
}

async function createPeer(peerId){
  const config=await getIceConfig();
  const pc=new RTCPeerConnection({iceServers:config.iceServers});
  pc.onicecandidate=e=>{if(e.candidate)socket.emit("call:ice",{receiverId:peerId,candidate:e.candidate})};
  pc.ontrack=e=>{$("remoteVideo").srcObject=e.streams[0]};
  pc.onconnectionstatechange=()=>{
    if(pc.connectionState==="connected")$("callStatus").textContent="Connected";
    if(["failed","disconnected"].includes(pc.connectionState))$("callStatus").textContent="Connection interrupted";
  };
  return pc;
}

async function flushPendingIce(){
  if(!peer||!peer.remoteDescription)return;
  for(const candidate of pendingIce.splice(0)){
    try{await peer.addIceCandidate(candidate)}catch(e){console.warn("ICE candidate failed",e)}
  }
}

function showCallUi(name,status,mode,incoming=false){
  $("callName").textContent=name;$("callStatus").textContent=status;
  $("callOverlay").classList.remove("hidden");
  $("videoStage").classList.toggle("audio-only",mode==="audio");
  $("acceptCallBtn").classList.toggle("hidden",!incoming);
  $("declineCallBtn").classList.toggle("hidden",!incoming);
  $("muteBtn").classList.toggle("hidden",incoming);
  $("cameraToggleBtn").classList.toggle("hidden",incoming||mode==="audio");
  $("shareScreenBtn").classList.toggle("hidden",incoming||mode==="audio");
  $("endCallBtn").classList.toggle("hidden",incoming);
}

async function startCall(mode){
  if(!callsEnabled||!activeUser||peer)return;
  if(!activeUser.online)return toast("This user is offline.");
  try{
    callPeerId=activeUser.id;callMode=mode;
    showCallUi(activeUser.username,"Calling…",mode);
    localStream=await getMedia(mode);$("localVideo").srcObject=localStream;
    peer=await createPeer(callPeerId);
    localStream.getTracks().forEach(track=>peer.addTrack(track,localStream));
    const offer=await peer.createOffer();await peer.setLocalDescription(offer);
    socket.emit("call:start",{receiverId:callPeerId,mode,offer});
  }catch(e){finishCall("Could not start call",false);toast("Camera and microphone permission is required.")}
}

function showIncomingCall(data){
  if(!callsEnabled||peer||pendingCall){socket.emit("call:reject",{receiverId:data.callerId});return}
  pendingCall=data;callPeerId=data.callerId;callMode=data.mode;
  showCallUi(data.callerName,`Incoming ${data.mode} call`,data.mode,true);
}

async function acceptIncomingCall(){
  const data=pendingCall;if(!data)return;
  pendingCall=null;
  try{
    showCallUi(data.callerName,"Connecting…",data.mode);
    localStream=await getMedia(data.mode);$("localVideo").srcObject=localStream;
    peer=await createPeer(data.callerId);
    localStream.getTracks().forEach(track=>peer.addTrack(track,localStream));
    await peer.setRemoteDescription(data.offer);
    await flushPendingIce();
    const answer=await peer.createAnswer();await peer.setLocalDescription(answer);
    socket.emit("call:answer",{receiverId:data.callerId,answer});
  }catch(e){socket.emit("call:reject",{receiverId:data.callerId});finishCall("Call failed",false);toast("Camera and microphone permission is required.")}
}

async function toggleScreenShare(){
  if(!peer||callMode!=="video")return toast("Start a video call first.");
  const button=$("shareScreenBtn");
  if(screenStream){ stopScreenShare(); return; }
  try{
    screenStream=await navigator.mediaDevices.getDisplayMedia({video:{frameRate:{ideal:15,max:30}},audio:true});
    const screenTrack=screenStream.getVideoTracks()[0];
    const sender=peer.getSenders().find(x=>x.track&&x.track.kind==="video");
    if(!sender)throw new Error("Video sender is unavailable");
    cameraVideoTrack=sender.track;
    await sender.replaceTrack(screenTrack);
    $("localVideo").srcObject=screenStream;
    $("videoStage").classList.add("screen-sharing");
    button.textContent="⏹ Stop sharing";button.classList.add("share-active");
    $("callStatus").textContent="Sharing screen";
    screenTrack.onended=()=>stopScreenShare();
  }catch(error){
    if(error.name!=="NotAllowedError")toast("Screen sharing could not start.");
    screenStream=null;
  }
}
async function stopScreenShare(){
  if(!screenStream)return;
  const sender=peer?.getSenders().find(x=>x.track&&x.track.kind==="video");
  const returnTrack=cameraVideoTrack||localStream?.getVideoTracks()[0];
  try{if(sender&&returnTrack)await sender.replaceTrack(returnTrack)}catch{}
  screenStream.getTracks().forEach(t=>t.stop());screenStream=null;
  $("localVideo").srcObject=localStream;
  $("videoStage").classList.remove("screen-sharing");
  $("shareScreenBtn").textContent="🖥 Share screen";$("shareScreenBtn").classList.remove("share-active");
  $("callStatus").textContent="Connected";
}

function finishCall(message="Call ended",notify=true){
  if(notify&&callPeerId&&socket)socket.emit("call:end",{receiverId:callPeerId});
  if(screenStream){screenStream.getTracks().forEach(t=>t.stop());screenStream=null}
  if(peer){peer.onconnectionstatechange=null;peer.close();peer=null}
  if(localStream){localStream.getTracks().forEach(t=>t.stop());localStream=null}
  cameraVideoTrack=null;$("shareScreenBtn").textContent="🖥 Share screen";$("shareScreenBtn").classList.remove("share-active");$("videoStage").classList.remove("screen-sharing")
  $("localVideo").srcObject=null;$("remoteVideo").srcObject=null;
  pendingCall=null;callPeerId=null;pendingIce=[];
  $("callStatus").textContent=message;
  setTimeout(()=>$("callOverlay").classList.add("hidden"),500);
}

$("videoCallBtn").onclick=()=>startCall("video");
$("audioCallBtn").onclick=()=>startCall("audio");
$("acceptCallBtn").onclick=acceptIncomingCall;
$("declineCallBtn").onclick=()=>{if(callPeerId)socket.emit("call:reject",{receiverId:callPeerId});finishCall("Call declined",false)};
$("endCallBtn").onclick=()=>finishCall();
$("muteBtn").onclick=()=>{
  const track=localStream?.getAudioTracks()[0];if(!track)return;
  track.enabled=!track.enabled;$("muteBtn").textContent=track.enabled?"🎤 Mute":"🔇 Unmute";
};
$("shareScreenBtn").onclick=toggleScreenShare;
$("cameraToggleBtn").onclick=()=>{
  const track=localStream?.getVideoTracks()[0];if(!track)return;
  track.enabled=!track.enabled;$("cameraToggleBtn").textContent=track.enabled?"📹 Camera":"🚫 Camera";
};
function updateHeader(){
  if(!activeUser)return;
  $("chatName").textContent=activeUser.displayName||activeUser.username;
  $("chatStatus").textContent=activeUser.isAI?"AI assistant · Arabic & English":(activeUser.isSelf?"Private space for your messages and files":(activeUser.online?"Online":lastSeenText(activeUser.lastSeenAt)));
  $("activeAvatar").innerHTML=activeUser.isAI?"AI":avatarHtml(activeUser,activeUser.isSelf?"★":initials(activeUser.username));
  $("audioCallBtn").classList.toggle("hidden",Boolean(activeUser.isSelf)||Boolean(activeUser.isAI)||!callsEnabled);
  $("videoCallBtn").classList.toggle("hidden",Boolean(activeUser.isSelf)||Boolean(activeUser.isAI)||!callsEnabled);
}

if($("activeAvatar"))$("activeAvatar").onclick=()=>{if(activeUser&&!activeUser.isAI)openProfilePage(activeUser)};
if($("chatName"))$("chatName").onclick=()=>{if(activeUser&&!activeUser.isAI)openProfilePage(activeUser)};

function safeFileUrl(value){
  try{const url=new URL(value,location.origin);return url.protocol==="https:"||(!location.protocol.startsWith("https")&&url.protocol==="http:")?url.href:""}
  catch{return ""}
}
function messageContent(msg){
  const caption=msg.body?`<div class="caption">${escapeHtml(msg.body)}</div>`:"";
  const fileUrl=escapeHtml(safeFileUrl(msg.file_url));
  if(msg.kind==="image"&&fileUrl)return `<a href="${fileUrl}" target="_blank" rel="noopener noreferrer"><img class="chat-image" src="${fileUrl}" alt="Shared image"></a>${caption}`;
  if(msg.kind==="voice"&&fileUrl)return `<audio class="voice-note" controls preload="metadata" src="${fileUrl}"></audio>${caption}`;
  if(msg.kind==="file"&&fileUrl)return `<a class="file-link" href="${fileUrl}" target="_blank" rel="noopener noreferrer">📎 ${escapeHtml(msg.file_name||"Download file")}</a>${caption}`;
  if(msg.kind!=="text")return `<span>Attachment unavailable</span>${caption}`;
  return escapeHtml(msg.body||"");
}
function receiptInfo(value){
  const readAt=value.readAt||value.read_at;
  const deliveredAt=value.deliveredAt||value.delivered_at;
  if(readAt)return {text:"✓✓ Read",className:"receipt read"};
  if(deliveredAt)return {text:"✓✓ Delivered",className:"receipt"};
  return {text:"✓ Sent",className:"receipt"};
}
function updateMessageReceipt(payload){
  const id=Number(payload?.messageId);if(!Number.isSafeInteger(id)||id<=0)return;
  const row=[...$("messages").querySelectorAll(".msg")].find(item=>Number(item.dataset.messageId)===id);
  const receipt=row?.querySelector(".receipt");if(!receipt)return;
  const info=receiptInfo(payload);receipt.textContent=info.text;receipt.className=info.className;
}
function addMessage(msg){
  const own=Number(msg.sender_id)===Number(me.id);
  const canDelete=!msg.ai&&(own||me.isAdmin);
  const receipt=receiptInfo(msg);
  if($("messages").classList.contains("empty-state")){
    $("messages").classList.remove("empty-state");$("messages").innerHTML="";
  }
  const row=document.createElement("div");
  row.className=`msg ${own?"own":"other"} ${msg.aiError?"ai-error":""}`;
  row.dataset.messageId=String(msg.id);
  row.innerHTML=`<div class="meta"><span>${own?"You":escapeHtml(msg.sender_name)} · ${time(msg.created_at)}</span>${own?`<span class="${receipt.className}">${receipt.text}</span>`:""}${canDelete?'<button type="button" class="message-delete" title="Permanently delete this message">Delete</button>':""}</div><div class="bubble">${messageContent(msg)}</div>`;
  const deleteButton=row.querySelector(".message-delete");
  if(deleteButton)deleteButton.onclick=()=>deleteMessage(msg,deleteButton);
  $("messages").appendChild(row);$("messages").scrollTop=$("messages").scrollHeight;
}

function removeMessage(messageId){
  const id=Number(messageId);
  if(!Number.isSafeInteger(id)||id<=0)return;
  const row=[...$("messages").querySelectorAll(".msg")].find(item=>Number(item.dataset.messageId)===id);
  if(row)row.remove();
  if(activeUser&&!$("messages").querySelector(".msg")){
    $("messages").className="messages empty-state";
    $("messages").innerHTML="<div><h3>No messages</h3><p>Send a message or attachment to begin.</p></div>";
  }
}

async function deleteMessage(msg,button){
  const description=msg.kind==="text"?"this message":"this attachment and its stored file";
  if(!confirm(`Permanently delete ${description} for everyone?`))return;
  try{
    button.disabled=true;
    await api(`/api/messages/${msg.id}`,{method:"DELETE"});
    removeMessage(msg.id);await refreshUsers();toast("Message deleted.");
  }catch(error){
    button.disabled=false;toast(error.message);
  }
}

function loadAiHistory(){
  try{return JSON.parse(localStorage.getItem(AI_HISTORY_KEY)||"[]").filter(x=>x&&typeof x.body==="string").slice(-40)}catch{return []}
}
function saveAiHistory(items){localStorage.setItem(AI_HISTORY_KEY,JSON.stringify(items.slice(-40)))}
function aiMessage(role,body){
  return {id:`ai-${Date.now()}-${Math.random()}`,sender_id:role==="user"?me.id:-1,sender_name:role==="user"?me.username:"ConnectChat AI",kind:"text",body,created_at:new Date().toISOString(),ai:true};
}
function aiErrorMessage(error){
  const details=error.details?`\n\nDetails: ${error.details}`:"";
  return {...aiMessage("assistant",`⚠️ ${error.message}${details}\n\nCheck the selected provider or try again.`),aiError:true};
}
function showAiWelcome(){
  $("messages").className="messages empty-state";
  $("messages").innerHTML="<div><h3>ConnectChat AI</h3><p>Ask in Arabic or English, or use Smart actions in another conversation. AI history is private to this browser.</p></div>";
}
async function loadAiStatus(){
  try{
    aiStatus=await api("/api/ai/status");
    const selector=$("aiProviderSelect");
    if(selector){
      selector.value=localStorage.getItem(AI_PROVIDER_KEY)||"auto";
      [...selector.options].forEach(option=>{
        if(option.value==="openai")option.disabled=!aiStatus.providers?.openai?.available;
        if(option.value==="ollama")option.disabled=!aiStatus.providers?.ollama?.available;
      });
    }
    if(activeUser?.isAI){
      const readyProviders=Object.values(aiStatus.providers||{}).filter(item=>item.available).map(item=>item.label);
      $("chatStatus").textContent=aiStatus.enabled
        ? aiStatus.mode==="hybrid" ? `Hybrid AI · ${readyProviders.join(" + ")} ready` : `${aiStatus.provider} · ${aiStatus.model} · Ready`
        : `${aiStatus.provider} · Setup required`;
    }
  }catch{
    if(activeUser?.isAI)$("chatStatus").textContent="AI status unavailable";
  }
}
async function sendAi(body){
  if(aiBusy)return;
  aiBusy=true;$("sendBtn").disabled=true;$("messageInput").disabled=true;$("typingText").textContent="ConnectChat AI is thinking…";
  const items=loadAiHistory();const userMsg=aiMessage("user",body);items.push(userMsg);saveAiHistory(items);addMessage(userMsg);
  try{
    const history=items.slice(0,-1).filter(x=>!x.aiError).slice(-12).map(x=>({role:Number(x.sender_id)===Number(me.id)?"user":"assistant",content:x.body}));
    const provider=$("aiProviderSelect")?.value||"auto";
    const data=await api("/api/ai/chat",{method:"POST",body:JSON.stringify({message:body,history,provider})});
    const source=`${data.provider} · ${data.model}${data.fallbackUsed?" · automatic fallback":""}`;
    const reply=aiMessage("assistant",`${data.answer}\n\n— ${source}`);items.push(reply);saveAiHistory(items);addMessage(reply);
  }catch(error){
    const failure=aiErrorMessage(error);items.push(failure);saveAiHistory(items);addMessage(failure);toast(error.message);
  }
  finally{aiBusy=false;$("sendBtn").disabled=false;$("messageInput").disabled=false;$("typingText").textContent="";$("messageInput").focus()}
}

function conversationText(){
  return activeConversation
    .filter(item=>item.kind==="text"&&item.body)
    .slice(-40)
    .map(item=>`${Number(item.sender_id)===Number(me.id)?"You":(item.sender_name||activeUser?.username||"Contact")}: ${item.body}`)
    .join("\n")
    .slice(-12000);
}

async function runSmartAction(action,button){
  if(!activeUser)return toast("Select a conversation first.");
  if(activeUser.isAI){
    const prompts={summary:"Summarize our AI conversation.",tasks:"Extract the action items from our AI conversation.",translate:"Translate the latest message to the other language (Arabic or English)."};
    $("messageInput").value=prompts[action];updateComposer();$("messageInput").focus();return;
  }
  const transcript=conversationText();
  if(!transcript)return toast("This conversation has no text messages to analyze.");
  const instructions={
    summary:"Summarize the conversation clearly. Include decisions, important facts, and unresolved points.",
    tasks:"Extract action items. For each item identify the owner and deadline when stated; never invent missing details.",
    translate:"Translate the latest message into Arabic if it is English, or English if it is Arabic. Return only the translation."
  };
  const original=button.textContent;
  try{
    button.disabled=true;button.textContent="Working…";
    const provider=$("aiProviderSelect")?.value||localStorage.getItem(AI_PROVIDER_KEY)||"auto";
    const data=await api("/api/ai/chat",{method:"POST",body:JSON.stringify({message:`${instructions[action]}\n\nConversation:\n${transcript}`,history:[],provider})});
    const ai=users.find(user=>user.isAI);
    if(!ai)throw new Error("AI assistant is unavailable.");
    await selectUser(ai);
    const items=loadAiHistory();
    const label={summary:"Conversation summary",tasks:"Conversation action items",translate:"Latest-message translation"}[action];
    const reply=aiMessage("assistant",`${label}\n\n${data.answer}\n\n— ${data.provider} · ${data.model}${data.fallbackUsed?" · automatic fallback":""}`);
    items.push(reply);saveAiHistory(items);addMessage(reply);
  }catch(error){
    const ai=users.find(user=>user.isAI);
    if(ai){
      await selectUser(ai);
      const items=loadAiHistory(),failure=aiErrorMessage(error);
      items.push(failure);saveAiHistory(items);addMessage(failure);
    }
    toast(error.message);
  }
  finally{button.disabled=false;button.textContent=original}
}
function send(){
  const body=$("messageInput").value.trim();
  if(!body||!activeUser)return;
  $("messageInput").value="";updateComposer();
  if(activeUser.isAI){sendAi(body);return}
  socket.emit("privateMessage",{receiverId:activeUser.id,body});
  socket.emit("typing",{receiverId:activeUser.id,isTyping:false});
}

const EMOJIS=["😀","😁","😂","🤣","😊","😍","🥰","😎","🤔","😢","😭","😡","👍","👎","👏","🙏","💪","✅","🎉","❤️","🔥","⭐","💯","👋","👌","🤝","📌","📎"];
if($("emojiPicker")){
  $("emojiPicker").innerHTML=EMOJIS.map(e=>`<button type="button" aria-label="${e}">${e}</button>`).join("");
  $("emojiPicker").onclick=e=>{
    const button=e.target.closest("button");if(!button)return;
    const input=$("messageInput");
    const start=input.selectionStart??input.value.length,end=input.selectionEnd??start;
    input.value=input.value.slice(0,start)+button.textContent+input.value.slice(end);
    input.focus();input.selectionStart=input.selectionEnd=start+button.textContent.length;updateComposer();
  };
}
if($("emojiBtn"))$("emojiBtn").onclick=()=>{
  if(!activeUser)return toast("Select a user first.");
  $("emojiPicker").classList.toggle("hidden");
};
document.addEventListener("click",e=>{
  if($("emojiPicker")&&!e.target.closest("#emojiPicker")&&!e.target.closest("#emojiBtn"))$("emojiPicker").classList.add("hidden");
  if($("accountMenu")&&!e.target.closest("#accountMenu")&&!e.target.closest("#accountMenuBtn"))$("accountMenu").classList.add("hidden");
});

$("sendBtn").onclick=send;
$("messageInput").onkeydown=e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send()}};
$("messageInput").oninput=()=>{
  updateComposer();
  if(!activeUser||activeUser.isAI)return;
  socket.emit("typing",{receiverId:activeUser.id,isTyping:true});
  clearTimeout(typingTimer);typingTimer=setTimeout(()=>socket.emit("typing",{receiverId:activeUser.id,isTyping:false}),700);
};
function resizeMessageInput(){
  const input=$("messageInput");
  if(!input)return;
  input.style.height="auto";
  input.style.height=`${Math.min(input.scrollHeight,120)}px`;
}
function updateComposer(){
  $("messageInput").closest(".composer").classList.toggle("has-text",Boolean($("messageInput").value.trim()));
  resizeMessageInput();
}

async function uploadFile(file,kind){
  if(!activeUser)return toast("Select a user first.");
  if(activeUser.isAI)return toast("AI file analysis is not enabled in this version.");
  const fd=new FormData();fd.append("file",file);fd.append("receiverId",activeUser.id);fd.append("kind",kind);
  $("uploadStatus").classList.remove("hidden");
  try{await api("/api/upload",{method:"POST",body:fd});toast(kind==="voice"?"Voice sent":"File sent")}
  catch(e){toast(e.message)}
  finally{$("uploadStatus").classList.add("hidden")}
}
$("attachBtn").onclick=()=>activeUser&&$("fileInput").click();
$("cameraBtn").onclick=()=>activeUser&&$("cameraInput").click();
$("fileInput").onchange=e=>{
  const f=e.target.files[0];if(!f)return;
  const kind=f.type.startsWith("image/")?"image":f.type.startsWith("audio/")?"voice":"file";
  uploadFile(f,kind);e.target.value="";
};
$("cameraInput").onchange=e=>{const f=e.target.files[0];if(f)uploadFile(f,"image");e.target.value=""};

$("messageInput").addEventListener("paste",e=>{
  const items=[...(e.clipboardData?.items||[])];
  const imageItem=items.find(i=>i.type.startsWith("image/"));
  if(imageItem){
    e.preventDefault();
    const file=imageItem.getAsFile();
    if(file)uploadFile(file,"image");
  }
});

$("recordBtn").onclick=async()=>{
  if(!activeUser)return toast("Select a user first.");
  if(activeUser.isAI)return toast("AI file analysis is not enabled in this version.");
  if(isRecording){mediaRecorder.stop();return}
  try{
    const stream=await navigator.mediaDevices.getUserMedia({audio:true});
    audioChunks=[];
    mediaRecorder=new MediaRecorder(stream);
    mediaRecorder.ondataavailable=e=>{if(e.data.size)audioChunks.push(e.data)};
    mediaRecorder.onstop=()=>{
      stream.getTracks().forEach(t=>t.stop());
      const blob=new Blob(audioChunks,{type:mediaRecorder.mimeType||"audio/webm"});
      const file=new File([blob],`voice-${Date.now()}.webm`,{type:blob.type});
      isRecording=false;$("recordBtn").classList.remove("recording");$("recordBtn").textContent="🎤";
      uploadFile(file,"voice");
    };
    mediaRecorder.start();isRecording=true;$("recordBtn").classList.add("recording");$("recordBtn").textContent="■";
    toast("Recording… tap again to send");
  }catch(e){toast("Microphone permission is required.")}
};

$("backBtn").onclick=()=>{
  if(window.innerWidth<=760){$("chatPanel").classList.add("mobile-hidden");$("sidebar").classList.remove("mobile-hidden")}
};
async function logoutAndReturn(){
  if(socket)socket.disconnect();
  await api("/api/logout",{method:"POST"});
  location.reload();
}
$("logoutBtn").onclick=logoutAndReturn;
if($("switchAccountBtn"))$("switchAccountBtn").onclick=logoutAndReturn;
if($("accountMenuBtn"))$("accountMenuBtn").onclick=()=>{
  const menu=$("accountMenu");
  const open=menu.classList.toggle("hidden")===false;
  $("accountMenuBtn").setAttribute("aria-expanded",String(open));
};
function refreshProfilePage(){
  if(!me)return;
  const user=profileTarget||me;
  const isOwner=Number(user.id)===Number(me.id);
  setAvatarElement($("profilePhotoPreview"),user,isOwner?initials(me.username):initials(user.username));
  $("profilePageTitle").textContent=isOwner?"My profile":`${user.username}'s profile`;
  $("profilePageName").textContent=isOwner?me.username:user.username;
  const role=isOwner&&me.isAdmin?"Administrator":"Workspace member";
  $("profilePageRole").textContent=role;
  $("profileUsername").textContent=user.username;
  $("profileRole").textContent=role;
  $("profileStatus").textContent=user.online?"Online":lastSeenText(user.lastSeenAt);
  $("profileOwnerActions").classList.toggle("hidden",!isOwner);
  $("profileViewerActions").classList.toggle("hidden",isOwner||user.isSelf||user.isAI);
  $("profilePhotoHelp").textContent=isOwner
    ?"JPG, PNG, WEBP or GIF. Maximum 12 MB. Only you can change this photo."
    :"This profile is view-only. Only the account owner can change the profile photo.";
  $("profilePermissionNote").textContent=isOwner
    ?"Only you can upload, replace or remove your profile photo."
    :"You can view this profile, but you cannot edit the photo or account information.";
  $("removeProfilePhotoBtn").disabled=!isOwner||!me.avatar;
}
function openProfilePage(user=me){
  $("accountMenu")?.classList.add("hidden");
  profileTarget=user||me;
  refreshProfilePage();
  $("profilePage").classList.remove("hidden");
}
if($("profileBtn"))$("profileBtn").onclick=()=>openProfilePage(me);
if(document.querySelector(".rail-profile"))document.querySelector(".rail-profile").onclick=()=>openProfilePage(me);
$("closeProfilePageBtn").onclick=()=>{$("profilePage").classList.add("hidden");profileTarget=null};
$("profileMessageBtn").onclick=()=>{const user=profileTarget;$("profilePage").classList.add("hidden");if(user)selectUser(user)};
$("profileVoiceBtn").onclick=()=>{const user=profileTarget;$("profilePage").classList.add("hidden");if(user){selectUser(user).then(()=>$("audioCallBtn").click())}};
$("profileVideoBtn").onclick=()=>{const user=profileTarget;$("profilePage").classList.add("hidden");if(user){selectUser(user).then(()=>$("videoCallBtn").click())}};
$("profilePhotoInput").onchange=async e=>{
  const file=e.target.files?.[0];e.target.value="";if(!file)return;
  if(!profileTarget||Number(profileTarget.id)!==Number(me.id)){toast("You can only change your own profile photo.");return}
  const result=$("profilePhotoResult");
  try{
    result.textContent="Uploading profile photo…";
    const form=new FormData();form.append("avatar",file);
    const data=await api("/api/profile/avatar",{method:"POST",body:form});
    me.avatar=data.avatar||null;
    users=await api("/api/users");
    renderUsers();refreshProfilePage();updateHeader();
    result.textContent="Profile photo updated.";toast("Profile photo updated");
  }catch(error){result.textContent=error.message}
};
$("removeProfilePhotoBtn").onclick=async()=>{
  if(!profileTarget||Number(profileTarget.id)!==Number(me.id)){toast("You can only change your own profile photo.");return}
  if(!me.avatar||!confirm("Remove your profile photo?"))return;
  const result=$("profilePhotoResult");
  try{
    await api("/api/profile/avatar",{method:"DELETE"});
    me.avatar=null;users=await api("/api/users");renderUsers();refreshProfilePage();updateHeader();
    result.textContent="Profile photo removed.";toast("Profile photo removed");
  }catch(error){result.textContent=error.message}
};
if($("accountSettingsBtn"))$("accountSettingsBtn").onclick=()=>{
  $("accountMenu").classList.add("hidden");
  document.querySelector('[data-section="settings"]')?.click();
};
$("recoveryBtn").onclick=async()=>{
  if(!confirm("Generate a new recovery code? Any previous recovery code will stop working."))return;
  try{const data=await api("/api/recovery-code",{method:"POST"});showSavedRecovery(data.recoveryCode)}
  catch(e){toast(e.message)}
};

function adminStatusLabel(status){return status.charAt(0).toUpperCase()+status.slice(1)}
async function loadAdminUsers(){
  $("adminResult").textContent="";$("adminUsersList").innerHTML='<div class="admin-loading">Loading users…</div>';
  try{
    const adminUsers=await api("/api/admin/users");
    $("adminUsersList").innerHTML="";
    adminUsers.forEach(user=>{
      const row=document.createElement("div");row.className="admin-user";
      const protectedAccount=user.isAdmin||user.id===me.id;
      row.innerHTML=`<div class="admin-user-main"><div class="avatar">${escapeHtml(initials(user.username))}</div><div><strong>${escapeHtml(user.username)}${user.isAdmin?' <span class="admin-tag">Admin</span>':""}</strong><span><i class="status-pill status-${escapeHtml(user.status)}">${escapeHtml(adminStatusLabel(user.status))}</i> · ${user.online?"Online":"Offline"}</span></div></div><div class="admin-actions">${protectedAccount?'<span class="protected-account">Protected account</span>':`<button data-action="approve" ${user.status==="approved"?"disabled":""}>Approve</button><button data-action="block" class="warn" ${user.status==="blocked"?"disabled":""}>Block</button><button data-action="delete" class="danger">Delete</button>`}</div>`;
      row.querySelectorAll("button[data-action]").forEach(button=>button.onclick=()=>changeAdminUser(user,button.dataset.action));
      $("adminUsersList").appendChild(row);
    });
  }catch(error){$("adminUsersList").innerHTML="";$("adminResult").textContent=error.message}
}

async function changeAdminUser(user,action){
  if(action==="delete"&&!confirm(`Permanently delete ${user.username} and all messages?`))return;
  try{
    $("adminResult").textContent="Updating…";
    if(action==="delete")await api(`/api/admin/users/${user.id}`,{method:"DELETE"});
    else await api(`/api/admin/users/${user.id}/status`,{method:"POST",body:JSON.stringify({status:action==="approve"?"approved":"blocked"})});
    await loadAdminUsers();await refreshUsers();
    $("adminResult").textContent=action==="delete"?"User deleted.":`User ${action==="approve"?"approved":"blocked"}.`;
  }catch(error){$("adminResult").textContent=error.message}
}

$("adminBtn").onclick=()=>{$("adminOverlay").classList.remove("hidden");loadAdminUsers()};
$("closeAdminBtn").onclick=()=>$("adminOverlay").classList.add("hidden");
$("refreshAdminBtn").onclick=loadAdminUsers;
$("adminOverlay").onclick=e=>{if(e.target===$("adminOverlay"))$("adminOverlay").classList.add("hidden")};

document.querySelectorAll(".chat-filter").forEach(button=>button.onclick=()=>{
  document.querySelectorAll(".chat-filter").forEach(x=>x.classList.remove("active"));button.classList.add("active");
  currentUserFilter=button.dataset.filter||"all";renderUsers();
});
if($("refreshUsersBtn"))$("refreshUsersBtn").onclick=refreshUsers;
if($("newChatBtn"))$("newChatBtn").onclick=()=>{$("userSearch").focus();toast("Search and select a user to start a new conversation.")};
if($("searchChatBtn"))$("searchChatBtn").onclick=()=>{const term=prompt("Search visible messages for:");if(!term)return;const found=[...$("messages").querySelectorAll(".bubble")].find(x=>x.textContent.toLowerCase().includes(term.toLowerCase()));if(found){found.scrollIntoView({behavior:"smooth",block:"center"});found.classList.add("search-hit");setTimeout(()=>found.classList.remove("search-hit"),1600)}else toast("No matching visible message.")};
if($("moreChatBtn"))$("moreChatBtn").onclick=()=>toast("Conversation options: attachments, status and delete controls are available in the workspace.");

const LOCAL_GROUPS_KEY="connectchat-local-groups-v1";
const LOCAL_CHANNELS_KEY="connectchat-local-channels-v1";

function readLocalItems(key){
  try{return JSON.parse(localStorage.getItem(key)||"[]")}catch{return []}
}
function saveLocalItems(key,items){localStorage.setItem(key,JSON.stringify(items))}
function sectionEscape(value){return escapeHtml(String(value??""))}

function setMainWorkspaceVisible(showChat){
  $("chatPanel").classList.toggle("hidden",!showChat);
  $("sectionPage").classList.toggle("hidden",showChat);
  document.querySelector(".workspace-insights")?.classList.toggle("hidden",!showChat);
}

function workspaceEmpty(icon,title,description,action=""){
  return `<div class="workspace-empty"><div class="workspace-empty-icon">${icon}</div><h2>${sectionEscape(title)}</h2><p>${sectionEscape(description)}</p>${action}</div>`;
}

function openChatsWorkspace(){
  setMainWorkspaceVisible(true);
  $("workspaceHeading").textContent="Messages";
  currentUserFilter="all";
  document.querySelectorAll(".chat-filter").forEach(x=>x.classList.toggle("active",x.dataset.filter==="all"));
  renderUsers();
}

function renderPeopleCards(actionLabel,actionName){
  const contacts=users.filter(u=>!u.isSelf&&!u.isAI&&!u.isGroup);
  if(!contacts.length)return workspaceEmpty("👤","No contacts yet","Approved users will appear here.");
  return `<div class="workspace-card-grid">${contacts.map(u=>`
    <article class="workspace-person-card">
      <div class="avatar">${avatarMarkup(u,initials(u.username))}</div>
      <div><h3>${sectionEscape(u.username)}</h3><p>${u.online?"Online":sectionEscape(lastSeenText(u.lastSeenAt))}</p></div>
      <button type="button" data-work-action="${actionName}" data-user-id="${u.id}">${actionLabel}</button>
    </article>`).join("")}</div>`;
}

function bindWorkspaceUserActions(){
  $("sectionContent").querySelectorAll("[data-work-action]").forEach(btn=>btn.onclick=()=>{
    const user=users.find(u=>Number(u.id)===Number(btn.dataset.userId));
    if(!user)return;
    const action=btn.dataset.workAction;
    if(action==="message"){openChatsWorkspace();selectUser(user)}
    if(action==="voice"){openChatsWorkspace();selectUser(user);setTimeout(()=>startCall("audio"),80)}
    if(action==="video"){openChatsWorkspace();selectUser(user);setTimeout(()=>startCall("video"),80)}
    if(action==="profile")openProfilePage(user);
  });
}

async function renderGroupsWorkspace(){
  $("sectionContent").innerHTML=`<div class="workspace-loading">Loading groups…</div>`;
  try{
    const items=await api("/api/groups");
    $("sectionContent").innerHTML=`
      <div class="workspace-toolbar"><div><h2>Group conversations</h2><p>Server-synchronized private team conversations.</p></div><button id="createGroupBtn" class="primary">＋ Create group</button></div>
      <div class="workspace-list">${items.length?items.map(g=>`<article><div class="workspace-list-icon">👥</div><div><h3>${sectionEscape(g.name)}</h3><p>${sectionEscape(g.description||"Private group")} · ${sectionEscape(g.role)}</p></div><button data-open-group="${g.id}">Open</button>${g.role==="owner"?`<button class="danger-link" data-delete-group="${g.id}">Delete</button>`:""}</article>`).join(""):workspaceEmpty("👥","No groups yet","Create your first synchronized group.")}</div>`;
    $("createGroupBtn").onclick=async()=>{
      const name=prompt("Group name:")?.trim(); if(!name)return;
      const description=prompt("Description (optional):")?.trim()||"";
      await api("/api/groups",{method:"POST",body:JSON.stringify({name,description})});
      await renderGroupsWorkspace();
    };
    $("sectionContent").querySelectorAll("[data-open-group]").forEach(b=>b.onclick=()=>openGroupConversation(Number(b.dataset.openGroup),items.find(x=>Number(x.id)===Number(b.dataset.openGroup))));
    $("sectionContent").querySelectorAll("[data-delete-group]").forEach(b=>b.onclick=async()=>{if(confirm("Delete this group?")){await api(`/api/groups/${b.dataset.deleteGroup}`,{method:"DELETE"});await renderGroupsWorkspace()}});
  }catch(error){$("sectionContent").innerHTML=workspaceEmpty("⚠️","Groups unavailable",error.message)}
}
async function openGroupConversation(groupId,group){
  $("sectionTitle").textContent=group?.name||"Group";
  $("sectionDescription").textContent=group?.description||"Group conversation";
  $("sectionContent").innerHTML=`<div class="workspace-loading">Loading messages…</div>`;
  try{
    const messages=await api(`/api/groups/${groupId}/messages`);
    $("sectionContent").innerHTML=`<div class="workspace-chat-feed" id="workspaceChatFeed">${messages.map(m=>`<div class="workspace-chat-message"><strong>${sectionEscape(m.sender_name)}</strong><p>${sectionEscape(m.body)}</p><small>${sectionEscape(time(m.created_at))}</small></div>`).join("")||workspaceEmpty("💬","No messages","Send the first group message.")}</div><form id="workspaceChatForm" class="workspace-composer"><input id="workspaceChatInput" maxlength="4000" placeholder="Message the group…" required><button class="primary">Send</button></form>`;
    $("workspaceChatForm").onsubmit=async e=>{e.preventDefault();const body=$("workspaceChatInput").value.trim();if(!body)return;await api(`/api/groups/${groupId}/messages`,{method:"POST",body:JSON.stringify({body})});await openGroupConversation(groupId,group)};
  }catch(error){$("sectionContent").innerHTML=workspaceEmpty("⚠️","Group unavailable",error.message)}
}

async function renderChannelsWorkspace(){
  $("sectionContent").innerHTML=`<div class="workspace-loading">Loading channels…</div>`;
  try{
    const items=await api("/api/channels");
    $("sectionContent").innerHTML=`
      <div class="workspace-toolbar"><div><h2>Project channels</h2><p>Server-synchronized project discussions and announcements.</p></div><button id="createChannelBtn" class="primary">＋ Create channel</button></div>
      <div class="workspace-list">${items.length?items.map(c=>`<article><div class="workspace-list-icon">📣</div><div><h3># ${sectionEscape(c.name)}</h3><p>${sectionEscape(c.description||"Project channel")} · ${sectionEscape(c.visibility)}</p></div><button data-open-channel="${c.id}">Open</button>${c.role==="owner"?`<button class="danger-link" data-delete-channel="${c.id}">Delete</button>`:""}</article>`).join(""):workspaceEmpty("📣","No channels yet","Create General, HVAC, Electrical or another project channel.")}</div>`;
    $("createChannelBtn").onclick=async()=>{const name=prompt("Channel name:")?.trim();if(!name)return;const description=prompt("Description (optional):")?.trim()||"";const visibility=confirm("Make this channel public?")?"public":"private";await api("/api/channels",{method:"POST",body:JSON.stringify({name,description,visibility})});await renderChannelsWorkspace()};
    $("sectionContent").querySelectorAll("[data-open-channel]").forEach(b=>b.onclick=()=>openChannelConversation(Number(b.dataset.openChannel),items.find(x=>Number(x.id)===Number(b.dataset.openChannel))));
    $("sectionContent").querySelectorAll("[data-delete-channel]").forEach(b=>b.onclick=async()=>{if(confirm("Delete this channel?")){await api(`/api/channels/${b.dataset.deleteChannel}`,{method:"DELETE"});await renderChannelsWorkspace()}});
  }catch(error){$("sectionContent").innerHTML=workspaceEmpty("⚠️","Channels unavailable",error.message)}
}
async function openChannelConversation(channelId,channel){
  $("sectionTitle").textContent=`# ${channel?.name||"Channel"}`;
  $("sectionDescription").textContent=channel?.description||"Project discussion";
  $("sectionContent").innerHTML=`<div class="workspace-loading">Loading posts…</div>`;
  try{
    const posts=await api(`/api/channels/${channelId}/posts`);
    $("sectionContent").innerHTML=`<div class="workspace-chat-feed">${posts.map(p=>`<div class="workspace-chat-message ${p.is_announcement?"announcement":""}"><strong>${p.is_announcement?"📢 ":""}${sectionEscape(p.author_name)}</strong><p>${sectionEscape(p.body)}</p><small>${sectionEscape(time(p.created_at))}</small></div>`).join("")||workspaceEmpty("📣","No posts","Publish the first channel post.")}</div><form id="channelPostForm" class="workspace-composer"><input id="channelPostInput" maxlength="8000" placeholder="Write a channel post…" required><label><input id="announcementCheck" type="checkbox"> Announcement</label><button class="primary">Publish</button></form>`;
    $("channelPostForm").onsubmit=async e=>{e.preventDefault();const body=$("channelPostInput").value.trim();if(!body)return;await api(`/api/channels/${channelId}/posts`,{method:"POST",body:JSON.stringify({body,isAnnouncement:$("announcementCheck").checked})});await openChannelConversation(channelId,channel)};
  }catch(error){$("sectionContent").innerHTML=workspaceEmpty("⚠️","Channel unavailable",error.message)}
}

async function renderFilesWorkspace(){
  $("sectionContent").innerHTML=`<div class="workspace-loading">Loading shared files…</div>`;
  try{
    const files=await api("/api/files");
    $("sectionContent").innerHTML=`<div class="workspace-toolbar"><div><h2>Shared files</h2><p>Server-backed index of attachments from your private conversations.</p></div></div>${files.length?`<div class="file-workspace-list">${files.map(f=>`<article><div class="workspace-list-icon">${f.kind==="image"?"🖼️":f.kind==="voice"||f.kind==="audio"?"🎤":"📄"}</div><div><h3>${sectionEscape(f.file_name||f.kind||"Attachment")}</h3><p>${sectionEscape(f.mime_type||"File")} · ${sectionEscape(time(f.created_at))}</p></div>${f.file_url?`<a href="${sectionEscape(f.file_url)}" target="_blank" rel="noopener">Open</a>`:""}</article>`).join("")}</div>`:workspaceEmpty("📁","No shared files","Attachments sent in conversations will appear here.")}`;
  }catch(error){$("sectionContent").innerHTML=workspaceEmpty("⚠️","Files unavailable",error.message)}
}

async function renderCallsWorkspace(){
  $("sectionContent").innerHTML=`<div class="workspace-loading">Loading call history…</div>`;
  try{
    const calls=await api("/api/calls");
    $("sectionContent").innerHTML=`<div class="workspace-toolbar"><div><h2>Calls</h2><p>Call history and quick calling with approved contacts.</p></div></div>${renderPeopleCards("Voice call","voice")}<h2 class="workspace-subtitle">Recent call history</h2>${calls.length?`<div class="workspace-list">${calls.map(c=>{const other=Number(c.caller_id)===Number(me.id)?c.receiver:c.caller;return `<article><div class="workspace-list-icon">${c.mode==="video"?"🎥":"📞"}</div><div><h3>${sectionEscape(other?.username||"User")}</h3><p>${sectionEscape(c.status)} · ${sectionEscape(time(c.started_at))}</p></div></article>`}).join("")}</div>`:workspaceEmpty("📞","No calls yet","Voice and video calls will appear here.")}`;
    bindWorkspaceUserActions();
  }catch(error){$("sectionContent").innerHTML=workspaceEmpty("⚠️","Calls unavailable",error.message)}
}

function renderSettingsWorkspace(){
  const appearance=loadAppearance();
  $("sectionContent").innerHTML=`
    <div class="settings-workspace-grid">
      <section><h2>Profile</h2><p>View your profile and manage your own profile photo.</p><button id="settingsProfileBtn" class="primary">Open my profile</button></section>
      <section class="appearance-settings"><h2>My page appearance</h2><p>These settings belong to your account on this device.</p>
        <label>Layout density<select id="appearanceDensity"><option value="compact">Compact</option><option value="comfortable">Comfortable</option></select></label>
        <label>Text size<select id="appearanceText"><option value="small">Small</option><option value="standard">Standard</option><option value="large">Large</option></select></label>
        <label>Icon size<select id="appearanceIcons"><option value="compact">Compact</option><option value="standard">Standard</option></select></label>
        <label>Conversation sidebar<select id="appearanceSidebar"><option value="narrow">Narrow</option><option value="standard">Standard</option></select></label>
        <label>Overview panel<select id="appearanceInsights"><option value="show">Show</option><option value="hide">Hide</option></select></label>
        <div class="settings-button-row"><button id="settingsThemeBtn">Toggle theme</button><button id="settingsAccentBtn">Change accent</button><button id="appearanceResetBtn">Reset layout</button></div>
      </section>
      <section><h2>Account</h2><p>Status, recovery, switching accounts and logout.</p><div class="settings-button-row"><button id="settingsStatusBtn">Status</button><button id="settingsRecoveryBtn">Recovery code</button><button id="settingsSwitchBtn">Switch account</button><button id="settingsLogoutBtn" class="danger-link">Logout</button></div></section>
      ${me.isAdmin?`<section><h2>Administration</h2><p>Approve, block or remove user accounts.</p><button id="settingsAdminBtn">Manage users</button></section>`:""}
    </div>`;
  $("settingsProfileBtn").onclick=()=>openProfilePage(me);
  $("settingsThemeBtn").onclick=()=>$("themeBtn")?.click();
  $("settingsAccentBtn").onclick=()=>$("accentBtn")?.click();
  const controls={appearanceDensity:"density",appearanceText:"text",appearanceIcons:"icons",appearanceSidebar:"sidebar",appearanceInsights:"insights"};
  Object.entries(controls).forEach(([id,key])=>{
    $(id).value=appearance[key];
    $(id).onchange=()=>{const next=loadAppearance();next[key]=$(id).value;saveAppearance(next)};
  });
  $("appearanceResetBtn").onclick=()=>{saveAppearance({...DEFAULT_APPEARANCE});renderSettingsWorkspace();toast("Your page layout was reset.")};
  $("settingsStatusBtn").onclick=()=>$("statusBtn").click();
  $("settingsRecoveryBtn").onclick=()=>$("recoveryBtn").click();
  $("settingsSwitchBtn").onclick=logoutAndReturn;
  $("settingsLogoutBtn").onclick=logoutAndReturn;
  if($("settingsAdminBtn"))$("settingsAdminBtn").onclick=()=>$("adminBtn").click();
}

function renderAIWorkspace(){
  const ai=users.find(u=>u.isAI);
  if(ai){openChatsWorkspace();selectUser(ai);return}
  $("sectionContent").innerHTML=workspaceEmpty("🤖","AI is not configured","Add the AI provider settings on the server to activate the assistant.");
}

async function openWorkspaceSection(section){
  document.querySelectorAll(".rail-item[data-section]").forEach(x=>x.classList.toggle("active",x.dataset.section===section));
  if(section==="chats"){openChatsWorkspace();return}
  setMainWorkspaceVisible(false);
  const titles={
    ai:["AI Assistant","Ask questions, translate text and work with documents."],
    groups:["Groups","Multi-user private conversations."],
    channels:["Channels","Organized project and announcement spaces."],
    files:["Files","All attachments shared in your conversations."],
    calls:["Calls","Voice and video calling workspace."],
    settings:["Settings","Profile, appearance, privacy, account and administration."]
  };
  const [title,description]=titles[section]||["Workspace",""];
  $("workspaceHeading").textContent=title;
  $("sectionTitle").textContent=title;
  $("sectionDescription").textContent=description;
  $("sectionContent").innerHTML=`<div class="workspace-loading">Opening ${sectionEscape(title)}…</div>`;
  if(section==="ai")renderAIWorkspace();
  if(section==="groups")await renderGroupsWorkspace();
  if(section==="channels")await renderChannelsWorkspace();
  if(section==="files")await renderFilesWorkspace();
  if(section==="calls")await renderCallsWorkspace();
  if(section==="settings")renderSettingsWorkspace();
}

if($("sectionBackBtn"))$("sectionBackBtn").onclick=()=>openWorkspaceSection("chats");
document.querySelectorAll(".rail-item[data-section]").forEach(button=>button.onclick=()=>openWorkspaceSection(button.dataset.section));


window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();deferredPrompt=e;$("installBtn").classList.remove("hidden")});
$("installBtn").onclick=async()=>{if(!deferredPrompt)return;deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null;$("installBtn").classList.add("hidden")};

if("serviceWorker" in navigator)navigator.serviceWorker.register("/sw.js").catch(()=>{});
(async()=>{try{me=await api("/api/me");await startApp()}catch{}})();


// ConnectChat Pro v4 enterprise workspace controls
(()=>{
  const root=document.documentElement;
  const accents=["violet","blue","emerald","rose"];
  const savedTheme=localStorage.getItem("cc-theme")||"light";
  const savedAccent=localStorage.getItem("cc-accent")||"violet";
  root.dataset.theme=savedTheme;root.dataset.accent=savedAccent;
  const themeBtn=$("themeBtn"),accentBtn=$("accentBtn");
  if(themeBtn)themeBtn.onclick=()=>{const next=root.dataset.theme==="dark"?"light":"dark";root.dataset.theme=next;localStorage.setItem("cc-theme",next);toast(`${next[0].toUpperCase()+next.slice(1)} theme enabled.`)};
  if(accentBtn)accentBtn.onclick=()=>{const current=accents.indexOf(root.dataset.accent);const next=accents[(current+1)%accents.length];root.dataset.accent=next;localStorage.setItem("cc-accent",next);toast(`${next[0].toUpperCase()+next.slice(1)} accent enabled.`)};
  document.querySelectorAll("[data-coming]").forEach(button=>button.addEventListener("click",()=>toast(`${button.dataset.coming} is prepared for the next phase.`)));
  document.querySelectorAll(".workspace-tab").forEach(button=>button.addEventListener("click",()=>{
    if(button.dataset.coming)return;
    document.querySelectorAll(".workspace-tab").forEach(x=>x.classList.remove("active"));button.classList.add("active");
  }));
  document.querySelectorAll("[data-smart]").forEach(button=>button.addEventListener("click",()=>{
    runSmartAction(button.dataset.smart,button);
  }));
  if($("aiProviderSelect"))$("aiProviderSelect").onchange=()=>{
    localStorage.setItem(AI_PROVIDER_KEY,$("aiProviderSelect").value);
    toast(`AI provider: ${$("aiProviderSelect").selectedOptions[0].textContent}`);
  };
})();
