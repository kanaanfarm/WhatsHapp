let authMode="login", me=null, users=[], activeUser=null, socket=null, statuses=[];
let typingTimer=null, deferredPrompt=null, mediaRecorder=null, audioChunks=[], isRecording=false;
let voiceHoldActive=false,cameraPointerHeld=false,cameraLongPressTriggered=false,cameraHoldTimer=null,voiceHoldTimer=null;
let voicePointerId=null,cameraPointerId=null;
let videoRecorder=null,videoChunks=[],videoStream=null,videoRecording=false,recordingLimitTimer=null;
let mediaUploadInFlight=false,captureSendInFlight=false;
let pendingMediaConfirmation=null,pendingMediaObjectUrl=null;
let peer=null, localStream=null, screenStream=null, cameraVideoTrack=null, callPeerId=null, callMode="video", pendingCall=null, iceConfig=null, pendingIce=[];
let cameraFilter="normal";
let callProcessedStream=null,callProcessorVideo=null,callProcessorCanvas=null,callProcessorRaf=0,callTrackReader=null,callTrackWriter=null,callProcessorAbort=false;
const CAMERA_FILTERS={normal:"none",beauty:"brightness(1.06) contrast(.96) saturate(1.04)",warm:"sepia(.12) saturate(1.18) hue-rotate(-6deg)",cool:"saturate(.95) hue-rotate(10deg) brightness(1.03)",bw:"grayscale(1) contrast(1.08)",bright:"brightness(1.18) contrast(1.02)",soft:"brightness(1.06) contrast(.9) saturate(.94)"};
let currentUserFilter="all";
let currentWorkspaceSection="chats";
let profileTarget=null;
let callsEnabled=true;
let aiBusy=false;
let aiStatus=null;
let activeConversation=[];
let archivedUserIds=new Set();
let currentInsightTab="overview";
let currentCalculationPreviewId=null,currentCalculationPreviewCanDownload=false,calculationPreviewObjectUrl=null;
let avatarCropImage=null,avatarCropObjectUrl=null,avatarCropBaseScale=1,avatarCropZoom=1,avatarCropX=0,avatarCropY=0,avatarCropDragging=false,avatarCropPointerX=0,avatarCropPointerY=0;
let profilePhotoViewerScale=1;
let currentGroupId=null,currentGroup=null,groupCallMode=null,groupCallStream=null;
let refreshUsersPromise=null,refreshUsersTimer=null,lastUsersRefreshAt=0,usersRenderFrame=0;
let networkQualityTimer=null;
const groupPeers=new Map(),groupPendingIce=new Map();
const AI_HISTORY_KEY="connectchat-ai-history-v1";
const AI_PROVIDER_KEY="connectchat-ai-provider-v1";
const NOTIFICATIONS_KEY="connectchat-message-notifications";
const PHONE_ICON_SVG='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.7 3.3 9.2 7 7.6 9.1c1.2 2.7 3.3 4.8 6 6l2.1-1.6 3.7 2.5c.5.3.7.9.5 1.5l-.7 2.2c-.2.7-.9 1.1-1.6 1.1C9.7 20.3 3.7 14.3 3.2 6.4c0-.7.4-1.4 1.1-1.6l2.2-.7c.6-.2 1.2.1 1.5.5Z"></path></svg>';
const VIDEO_ICON_SVG='<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="6" width="13.5" height="12" rx="2.5"></rect><path d="m16 10 5-3v10l-5-3Z"></path></svg>';
const DEFAULT_APPEARANCE={density:"compact",text:"standard",icons:"compact",sidebar:"narrow",insights:"show",composer:"essential",avatarFit:"cover"};
const $=id=>document.getElementById(id);

const INTERNAL_SCROLL_SELECTOR=[
  ".rail",".users-list",".quick-contacts",".messages",".workspace-insights",
  ".section-page",".profile-page",".dialog-overlay",".statuses-list",
  ".admin-users",".calculation-preview-content",".calculation-table-wrap",
  ".calculation-preview-tabs",".emoji-picker",".smart-strip",
  "textarea","select"
].join(",");

document.addEventListener("wheel",event=>{
  const app=$("appView");
  if(!app||app.classList.contains("hidden"))return;
  if(event.ctrlKey||event.metaKey){
    event.preventDefault();
    return;
  }
  if(!event.target.closest(INTERNAL_SCROLL_SELECTOR))event.preventDefault();
},{passive:false});

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
  root.dataset.composer=settings.composer;
  root.dataset.avatarFit=settings.avatarFit;
}
function saveAppearance(settings){
  localStorage.setItem(appearanceKey(),JSON.stringify(settings));
  applyAppearance(settings);
}

function avatarHtml(user, fallbackText){
  const fallback=escapeHtml(fallbackText||initials(user?.username||"User"));
  const url=user?.avatar?safeFileUrl(user.avatar):"";
  return url?`<img src="${escapeHtml(url)}" loading="lazy" decoding="async" data-avatar-fallback="${fallback}" alt="${escapeHtml(user?.username||"Profile photo")}">`:fallback;
}
function setAvatarElement(element,user,fallbackText){
  if(!element)return;
  const signature=`${user?.avatar||""}|${fallbackText||""}`;
  if(element.dataset.avatarSignature===signature)return;
  element.dataset.avatarSignature=signature;
  element.innerHTML=avatarHtml(user,fallbackText);
}

document.addEventListener("error",event=>{
  const image=event.target;
  if(!(image instanceof HTMLImageElement)||!image.dataset.avatarFallback)return;
  image.replaceWith(document.createTextNode(image.dataset.avatarFallback));
},true);

function synchronizeCurrentAccount(){
  if(!me)return;
  const self=users.find(user=>Number(user.id)===Number(me.id));
  if(self){
    me.avatar=self.avatar||null;
    me.username=self.username||me.username;
  }
  if($("railInitials"))setAvatarElement($("railInitials"),me,initials(me.username));
  if($("accountAvatar"))setAvatarElement($("accountAvatar"),me,initials(me.username));
  if($("workspaceProfileAvatar"))setAvatarElement($("workspaceProfileAvatar"),me,initials(me.username));
  if(profileTarget&&Number(profileTarget.id)===Number(me.id)){
    profileTarget={...profileTarget,...me};
    refreshProfilePage();
  }
}

function toast(text){
  $("toast").textContent=text;$("toast").classList.remove("hidden");
  setTimeout(()=>$("toast").classList.add("hidden"),2200);
}

function notificationsEnabled(){
  return "Notification" in window&&Notification.permission==="granted"&&localStorage.getItem(NOTIFICATIONS_KEY)!=="off";
}

function notificationPermissionText(){
  if(!("Notification" in window))return "Not supported on this device";
  if(Notification.permission==="granted")return notificationsEnabled()?"On · Tap to disable":"Off · Tap to enable";
  if(Notification.permission==="denied")return "Blocked in browser settings";
  return "Tap to enable";
}

function urlBase64ToUint8Array(base64String){
  const padding="=".repeat((4-base64String.length%4)%4);
  const base64=(base64String+padding).replace(/-/g,"+").replace(/_/g,"/");
  const raw=atob(base64);
  return Uint8Array.from([...raw].map(ch=>ch.charCodeAt(0)));
}
async function syncPushSubscription(){
  if(!("serviceWorker" in navigator)||!("PushManager" in window)||Notification.permission!=="granted")return false;
  try{
    const cfg=await api("/api/push/public-key");
    if(!cfg.enabled||!cfg.publicKey)return false;
    const reg=await navigator.serviceWorker.ready;
    let sub=await reg.pushManager.getSubscription();
    if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlBase64ToUint8Array(cfg.publicKey)});
    await api("/api/push/subscribe",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({subscription:sub.toJSON()})});
    return true;
  }catch(error){console.warn("Push subscription failed:",error);return false}
}

async function requestMessageNotifications(){
  if(!("Notification" in window)){
    toast("Notifications are not supported by this browser.");
    return;
  }
  if(Notification.permission==="denied"){
    toast("Notifications are blocked. Enable them in your browser or phone settings.");
    return;
  }
  if(Notification.permission==="granted"){
    const nextEnabled=!notificationsEnabled();
    localStorage.setItem(NOTIFICATIONS_KEY,nextEnabled?"on":"off");
    if(nextEnabled)await syncPushSubscription();
    toast(nextEnabled?"Message notifications enabled.":"Message notifications disabled.");
    const status=$("settingsNotificationStatus");
    if(status)status.textContent=notificationPermissionText();
    return;
  }
  try{
    const permission=await Notification.requestPermission();
    if(permission==="granted"){localStorage.setItem(NOTIFICATIONS_KEY,"on");await syncPushSubscription();}
    toast(permission==="granted"?"Message notifications enabled.":"Notifications were not enabled.");
    const status=$("settingsNotificationStatus");
    if(status)status.textContent=notificationPermissionText();
  }catch{
    toast("Notification permission could not be requested.");
  }
}

async function showMessageNotification(title,body,tag){
  if(!notificationsEnabled())return;
  if(document.visibilityState==="visible"&&document.hasFocus())return;
  const options={
    body:String(body||"New message").slice(0,160),
    icon:"/logo.svg",
    badge:"/logo.svg",
    tag,
    renotify:true,
    data:{url:"/?v=6781"}
  };
  try{
    if("serviceWorker" in navigator){
      const registration=await navigator.serviceWorker.ready;
      await registration.showNotification(title,options);
    }else{
      new Notification(title,options);
    }
  }catch(error){
    console.warn("Notification failed:",error);
  }
}

function setNetworkQuality(level,label,detail=""){
  const indicators=[$("networkQuality"),$("callNetworkQuality")].filter(Boolean);
  for(const indicator of indicators){
    const extra=indicator.id==="callNetworkQuality"?" call-network-quality":"";
    indicator.className=`network-quality ${level}${extra}`;
    const text=indicator.querySelector("span");
    if(text)text.textContent=label;
    indicator.title=detail||`Internet quality: ${label}`;
  }
}

async function measureNetworkQuality(){
  if(!navigator.onLine){
    setNetworkQuality("offline","Offline","No internet connection");
    return;
  }
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),6000);
  const started=performance.now();
  try{
    await fetch(`/api/health?network=${Date.now()}`,{cache:"no-store",signal:controller.signal});
    const latency=Math.round(performance.now()-started);
    const connection=navigator.connection||navigator.mozConnection||navigator.webkitConnection;
    const effective=connection?.effectiveType||"";
    const downlink=Number(connection?.downlink||0);
    let level="good",label="Good";
    if(latency>1200||effective==="slow-2g"){level="poor";label="Bad"}
    else if(latency>650||effective==="2g"){level="fair";label="Fair"}
    else if(effective==="3g"){level="fair";label="Fair"}
    const speed=downlink?` · ${downlink.toFixed(1)} Mbps`:"";
    setNetworkQuality(level,label,`${latency} ms${speed}`);
  }catch{
    setNetworkQuality("poor","Bad","The server is responding slowly or cannot be reached");
  }finally{
    clearTimeout(timeout);
  }
}

function startNetworkQualityMonitor(){
  clearInterval(networkQualityTimer);
  measureNetworkQuality();
  networkQualityTimer=setInterval(measureNetworkQuality,15000);
}

window.addEventListener("online",measureNetworkQuality);
window.addEventListener("offline",measureNetworkQuality);
const browserConnection=navigator.connection||navigator.mozConnection||navigator.webkitConnection;
browserConnection?.addEventListener?.("change",measureNetworkQuality);
function setMode(mode){
  authMode=mode;
  $("loginTab").classList.toggle("active",mode==="login");
  $("registerTab").classList.toggle("active",mode==="register");
  $("authSubmit").textContent=mode==="login"?"Login":"Create account";
  $("authSubtitle").textContent=mode==="login"?"Welcome back. Sign in to continue.":"Create a private account in a few seconds.";
  $("authUsername").placeholder=mode==="login"?"Username, email or phone":"Choose a username";
  $("authUsername").maxLength=mode==="login"?254:30;
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

async function downloadApiFile(url,options={},fallbackName="download"){
  const headers={"X-ConnectChat-Request":"1",...(options.headers||{})};
  if(!(options.body instanceof FormData))headers["Content-Type"]="application/json";
  const response=await fetch(url,{credentials:"same-origin",cache:"no-store",...options,headers});
  if(!response.ok){
    const data=await response.json().catch(()=>({}));
    const error=new Error(data.error||"Download failed");error.details=data.details;throw error;
  }
  const disposition=response.headers.get("content-disposition")||"";
  const match=disposition.match(/filename="([^"]+)"/i);
  const blob=await response.blob();
  const link=document.createElement("a");
  link.href=URL.createObjectURL(blob);link.download=match?.[1]||fallbackName;
  document.body.appendChild(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(link.href),1000);
}

$("authForm").onsubmit=async e=>{
  e.preventDefault();
  const username=$("authUsername").value.trim();
  const password=$("authPassword").value;
  if(username.length<3){$("authError").textContent=authMode==="login"?"Enter your username, email or phone.":"Username must contain at least 3 characters.";return}
  if(authMode==="register"&&password.length<6){$("authError").textContent="New passwords must contain at least 6 characters.";return}
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
    card.innerHTML=`<div class="status-card-head"><div class="avatar ${status.isOwn?"saved-avatar":""}">${avatarHtml(status,status.isOwn?"★":initials(status.username))}</div><div><strong>${escapeHtml(status.isOwn?`${status.username} (You)`:status.username)}</strong><span>${details}</span></div>${status.isOwn||me.isAdmin?'<button type="button" class="status-delete">Delete</button>':""}</div>${content||'<div class="status-empty">Media unavailable</div>'}${caption}`;
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
  await loadArchivedConversations();
  lastUsersRefreshAt=Date.now();
  synchronizeCurrentAccount();
  try{const config=await getIceConfig();callsEnabled=config.enabled!==false}catch{callsEnabled=false}
  renderUsers();connectSocket();
  startNetworkQualityMonitor();
  if(window.innerWidth<=760){$("chatPanel").classList.add("mobile-hidden")}
}

function connectSocket(){
  if(socket)socket.disconnect();
  socket=io();
  socket.on("connect",()=>{refreshUsers();measureNetworkQuality();if(notificationsEnabled())syncPushSubscription()});
  socket.on("disconnect",()=>{if(navigator.onLine)setNetworkQuality("poor","Bad","Disconnected from the ConnectChat server")});
  socket.on("privateMessage",msg=>{
    const incoming=Number(msg.receiver_id)===Number(me.id)&&Number(msg.sender_id)!==Number(me.id);
    const relevant=activeUser&&(Number(msg.sender_id)===Number(activeUser.id)||Number(msg.receiver_id)===Number(activeUser.id));
    if(relevant){
      addMessage(msg);
      if(Number(msg.receiver_id)===Number(me.id)&&Number(msg.sender_id)===Number(activeUser.id))socket.emit("message:read",{messageIds:[msg.id]});
    }
    if(incoming){
      const sender=users.find(user=>Number(user.id)===Number(msg.sender_id));
      const senderName=msg.sender_name||sender?.displayName||sender?.username||"New message";
      const preview=msg.kind==="text"?msg.body:(msg.kind==="image"?"Sent a photo":msg.kind==="voice"||msg.kind==="audio"?"Sent a voice message":String(msg.mime_type||"").startsWith("video/")?"Sent a video":"Sent an attachment");
      showMessageNotification(senderName,preview,`private-${msg.sender_id}`);
    }
    refreshUsers();
  });
  socket.on("message:status",updateMessageReceipt);
  socket.on("message:deleted",payload=>{
    removeMessage(payload?.messageId);
    refreshUsers();
  });
  socket.on("conversation:cleared",payload=>{
    if(activeUser&&[Number(payload?.userId),Number(payload?.otherId)].includes(Number(activeUser.id))){
      activeConversation=[];$("messages").innerHTML="";updateWorkspaceOverview();
    }
    refreshUsers();
  });
  socket.on("presence",p=>{
    const u=users.find(x=>x.id===p.userId);
    if(u){u.online=p.online;if(p.lastSeenAt)u.lastSeenAt=p.lastSeenAt;scheduleUsersRender()}else refreshUsers()
  });
  socket.on("presence:snapshot",p=>{
    const activeIds=new Set((p.userIds||[]).map(Number));
    users.forEach(u=>u.online=u.isSelf||activeIds.has(Number(u.id)));
    scheduleUsersRender();
  });
  socket.on("users:changed",()=>{refreshUsers();if(!$("adminOverlay").classList.contains("hidden"))loadAdminUsers()});
  socket.on("profile:updated",payload=>{
    if(Number(payload?.userId)===Number(me?.id)||users.some(user=>Number(user.id)===Number(payload?.userId)))refreshUsers();
  });
  socket.on("group:invitation",payload=>{
    toast(`${payload?.inviterName||"A group administrator"} invited you to a group.`);
    if(currentWorkspaceSection==="groups")renderGroupsWorkspace();
  });
  socket.on("group:added",()=>{
    toast("You were added to a group.");
    if(currentWorkspaceSection==="groups")renderGroupsWorkspace();
  });
  socket.on("group:removed",payload=>{
    toast("You were removed from a group.");
    if(currentWorkspaceSection==="groups"){
      if(Number(currentGroupId)===Number(payload?.groupId))renderGroupsWorkspace();
      else renderGroupsWorkspace();
    }
  });
  socket.on("group:members-changed",payload=>{
    if(Number(currentGroupId)===Number(payload?.groupId)&&$("groupMemberPanel")&&!$("groupMemberPanel").classList.contains("hidden"))loadGroupMemberPanel();
  });
  socket.on("status:changed",()=>{if(!$("statusOverlay").classList.contains("hidden"))loadStatuses()});
  socket.on("status:deleted",()=>{if(!$("statusOverlay").classList.contains("hidden"))loadStatuses()});
  socket.on("status:viewed",()=>{if(!$("statusOverlay").classList.contains("hidden"))loadStatuses()});
  socket.on("typing",p=>{
    if(activeUser&&p.userId===activeUser.id)$("typingText").textContent=p.isTyping?`${p.username} is typing...`:"";
  });
  socket.on("group:message",msg=>{
    const isCurrent=Number(msg?.group_id)===Number(currentGroupId);
    if(isCurrent)appendGroupMessage(msg);
    if(Number(msg?.sender_id)!==Number(me.id)){
      const title=currentGroup&&Number(currentGroup.id)===Number(msg.group_id)?currentGroup.name:"New group message";
      showMessageNotification(title,`${msg.sender_name||"Member"}: ${msg.body||"Sent an attachment"}`,`group-${msg.group_id}`);
    }
  });
  socket.on("group-call:invite",async payload=>{
    if(groupCallStream||Number(payload?.callerId)===Number(me.id))return;
    if(!confirm(`${payload.callerName} started a group ${payload.mode} call. Join now?`))return;
    if(Number(payload.groupId)!==Number(currentGroupId)){
      const groups=await api("/api/groups");
      const group=groups.find(item=>Number(item.id)===Number(payload.groupId));
      if(!group)return toast("This group is unavailable.");
      setMainWorkspaceVisible(false);
      $("sectionTitle").textContent=group.name;
      await openGroupConversation(Number(group.id),group);
    }
    joinGroupCall(payload.mode);
  });
  socket.on("group-call:participants",async payload=>{
    if(Number(payload?.groupId)!==Number(currentGroupId))return;
    for(const participant of payload.participants||[])await createGroupOffer(participant.userId,participant.username);
    updateGroupCallStatus();
  });
  socket.on("group-call:participant-joined",payload=>{
    if(Number(payload?.groupId)===Number(currentGroupId)&&groupCallStream)updateGroupCallStatus();
  });
  socket.on("group-call:offer",handleGroupCallOffer);
  socket.on("group-call:answer",handleGroupCallAnswer);
  socket.on("group-call:ice",handleGroupCallIce);
  socket.on("group-call:participant-left",payload=>{
    if(Number(payload?.groupId)!==Number(currentGroupId))return;
    removeGroupPeer(Number(payload.userId));updateGroupCallStatus();
  });
  socket.on("group-call:full",payload=>{
    if(Number(payload?.groupId)===Number(currentGroupId)){toast("This group call already has six participants.");leaveGroupCall(false)}
  });
  socket.on("call:incoming",data=>{
    showMessageNotification(`Incoming ${data.mode==="video"?"video":"voice"} call`,data.callerName||"ConnectChat user",`incoming-call-${data.callerId}`);
    showIncomingCall(data);
  });
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
  socket.on("call:filter",p=>{
    if(Number(p?.userId)!==Number(callPeerId))return;
    const filter=CAMERA_FILTERS[p?.filter]?p.filter:"normal";
    const remote=$("remoteVideo");
    if(remote)remote.style.filter=CAMERA_FILTERS[filter]||"none";
  });
  socket.on("call:rejected",()=>finishCall("Call declined",false));
  socket.on("call:ended",()=>finishCall("Call ended",false));
  socket.on("call:unavailable",()=>finishCall("User is unavailable",false));
  socket.on("call:queued",payload=>{
    toast(`${payload?.receiverName||"This user"} is offline. A missed-call notification was saved.`);
  });
  socket.on("call:missed",payload=>{
    const mode=payload?.mode==="video"?"video":"voice";
    toast(`Missed ${mode} call from ${payload?.callerName||"a ConnectChat user"}.`);
    showMessageNotification(`Missed ${mode} call`,payload?.callerName||"ConnectChat user",`missed-call-${payload?.callId||payload?.callerId}`);
    showMissedCallAlert(payload);
    if(currentWorkspaceSection==="calls")renderCallsWorkspace();
    else refreshCallsBadge();
  });
  socket.on("message:error",p=>toast(p.error||"Message could not be sent."));
}
function refreshUsers(force=false){
  force=force===true;
  if(refreshUsersPromise)return refreshUsersPromise;
  const remaining=1200-(Date.now()-lastUsersRefreshAt);
  if(!force&&remaining>0){
    if(!refreshUsersTimer)refreshUsersTimer=setTimeout(()=>{refreshUsersTimer=null;refreshUsers(true)},remaining);
    return Promise.resolve();
  }
  refreshUsersPromise=(async()=>{
    try{
      users=await api("/api/users");
      await loadArchivedConversations();
      synchronizeCurrentAccount();
      if(activeUser){
        const refreshed=users.find(u=>u.id===activeUser.id);
        if(refreshed)activeUser=refreshed;
        else{activeUser=null;resetConversation()}
      }
      renderUsers();updateHeader();
      lastUsersRefreshAt=Date.now();
    }catch{}
    finally{refreshUsersPromise=null}
  })();
  return refreshUsersPromise;
}
function scheduleUsersRender(){
  if(currentWorkspaceSection!=="chats")return;
  if(usersRenderFrame)return;
  usersRenderFrame=requestAnimationFrame(()=>{
    usersRenderFrame=0;
    renderUsers();
    updateHeader();
  });
}

window.addEventListener("focus",()=>{if(me)refreshUsers()});
document.addEventListener("visibilitychange",()=>{if(me&&document.visibilityState==="visible")refreshUsers()});

function resetConversation(){
  $("chatName").textContent="Select a user";$("chatStatus").textContent="Start a private conversation";$("activeAvatar").textContent="?";
  $("messages").className="messages empty-state";$("messages").innerHTML="<div><h3>Your messages</h3><p>Select a user to start chatting.</p></div>";
  $("messageInput").disabled=true;$("sendBtn").disabled=true;$("callMenuBtn").disabled=true;
  $("attachBtn").disabled=true;
  if($("chatAiBtn"))$("chatAiBtn").disabled=true;
  $("smartStrip")?.classList.add("hidden");$("conversationMenu")?.classList.add("hidden");
}

async function loadArchivedConversations(){
  try{
    const data=await api("/api/conversations/archived");
    archivedUserIds=new Set((data.userIds||[]).map(Number));
  }catch{archivedUserIds=new Set()}
  if(localStorage.getItem(`connectchat-ai-archived-${me?.id}`)==="1")archivedUserIds.add(-1);
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
  if($("workspaceConversationSummary"))$("workspaceConversationSummary").textContent=activeUser
    ? `${activeUser.displayName||activeUser.username} · ${activeConversation.length} visible message${activeConversation.length===1?"":"s"}`
    : "Select a real contact from the left panel.";
  if(window.innerWidth>1200&&document.documentElement.dataset.insights!=="hide")renderWorkspaceInsightTab(currentInsightTab);
}

function renderWorkspaceInsightTab(tab="overview"){
  currentInsightTab=tab;
  document.querySelectorAll("[data-insight-tab]").forEach(button=>button.classList.toggle("active",button.dataset.insightTab===tab));
  ["overview","files","media"].forEach(name=>$(`insight${name[0].toUpperCase()+name.slice(1)}Panel`)?.classList.toggle("hidden",name!==tab));
  if(tab==="overview")return;
  const attachments=activeConversation.filter(item=>item.file_url);
  const selected=tab==="media"
    ? attachments.filter(item=>["image","voice","audio"].includes(item.kind))
    : attachments.filter(item=>!["image","voice","audio"].includes(item.kind));
  const panel=$(tab==="media"?"insightMediaPanel":"insightFilesPanel");
  panel.innerHTML=selected.length?`<div class="insight-file-list">${selected.map(item=>`<a href="${escapeHtml(safeFileUrl(item.file_url))}" target="_blank" rel="noopener"><b>${tab==="media"?(item.kind==="image"?"🖼":"🎤"):"📄"}</b><span>${escapeHtml(item.file_name||item.kind||"Attachment")}<small>${escapeHtml(time(item.created_at))}</small></span></a>`).join("")}</div>`:`<div class="insight-empty">No ${tab} in the selected conversation.</div>`;
}

function renderUsers(){
  const totalUnread=users.reduce((n,u)=>n+Number(u.unreadCount||u.unread_count||0),0);
  if($("railUnread")){
    $("railUnread").textContent=String(Math.min(totalUnread,99));
    $("railUnread").classList.toggle("hidden",!totalUnread);
  }
  if(currentWorkspaceSection!=="chats")return;
  const q=$("userSearch").value.toLowerCase();
  const filtered=users.filter(u=>{
    // ConnectChat AI has its own primary navigation destination. Keeping a
    // second AI row among private conversations is confusing, especially on
    // phones where the AI tab is always visible in the bottom navigation.
    if(u.isAI)return false;
    const matches=(u.displayName||u.username).toLowerCase().includes(q)||u.username.toLowerCase().includes(q);
    if(!matches)return false;
    const archived=archivedUserIds.has(Number(u.id));
    if(currentUserFilter==="archived")return archived&&!u.isSelf;
    if(archived&&!u.isSelf)return false;
    if(currentUserFilter==="unread")return Number(u.unreadCount||u.unread_count||0)>0;
    if(currentUserFilter==="groups")return Boolean(u.isGroup);
    if(currentUserFilter==="pinned")return Boolean(u.pinned);
    return true;
  });
  const list=$("usersList"),fragment=document.createDocumentFragment();
  list.innerHTML="";
  filtered.forEach(u=>{
    const d=document.createElement("div");
    d.className=`user-item ${activeUser&&activeUser.id===u.id?"active":""}`;
    d.dataset.userId=String(u.id);
    const name=u.isSelf?"Saved Messages":(u.displayName||u.username);
    const avatar=u.isAI?"AI":(u.isSelf&&!u.avatar?"★":avatarHtml(u,initials(u.username)));
    const preview=u.isSelf&&!u.lastPreview?"Notes and messages to yourself":(u.lastPreview||"Start a conversation");
    const unread=Number(u.unreadCount||u.unread_count||0);
    const stamp=u.lastMessageAt||u.last_message_at;
    d.innerHTML=`<div class="avatar ${u.isSelf?"saved-avatar":""} ${u.isAI?"ai-avatar":""}">${avatar}</div><div class="user-info"><strong>${escapeHtml(name)}</strong><span>${escapeHtml(preview)}</span></div>${!u.isAI?`<button type="button" class="user-ai-tool" title="AI tools for ${escapeHtml(name)}">✦</button>`:""}<div class="user-side">${stamp?`<time>${time(stamp)}</time>`:""}${unread?`<b class="unread-count">${Math.min(unread,99)}</b>`:`<i class="dot ${u.online?"online":""}"></i>`}</div>`;
    d.onclick=()=>selectUser(u);
    const aiTool=d.querySelector(".user-ai-tool");
    if(aiTool)aiTool.onclick=async event=>{event.stopPropagation();await selectUser(u);toggleSmartPopup(true)};
    const listAvatar=d.querySelector(".avatar");
    if(listAvatar&&!u.isAI&&!u.isSelf){
      listAvatar.title=`View ${name} profile`;
      listAvatar.onclick=event=>{event.stopPropagation();openProfilePage(u)};
    }
    fragment.appendChild(d);
  });
  list.appendChild(fragment);
  renderQuickContacts();
  updateWorkspaceOverview();
}
function renderQuickContacts(){
  const box=$("quickContacts");
  if(!box)return;
  box.innerHTML="";
  if(window.innerWidth<=800){box.classList.add("hidden");return}

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
  activeUser=u;
  document.querySelectorAll("#usersList .user-item").forEach(item=>item.classList.toggle("active",Number(item.dataset.userId)===Number(u.id)));
  updateHeader();
  $("smartStrip")?.classList.add("hidden");$("conversationMenu")?.classList.add("hidden");
  if($("aiProviderControl"))$("aiProviderControl").classList.toggle("hidden",!u.isAI);
  $("messageInput").disabled=false;$("sendBtn").disabled=false;
  $("callMenuBtn").disabled=!callsEnabled||u.isSelf||u.isAI;
  $("messages").classList.remove("empty-state");$("messages").innerHTML="";
  // Reveal the selected conversation immediately on phones. Message history
  // may continue loading, but the header and composer should never wait for it.
  if(window.innerWidth<=760){
    $("sidebar").classList.add("mobile-hidden");
    $("chatPanel").classList.remove("mobile-hidden");
  }
  updateComposer();
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
  updateWorkspaceOverview();
  $("messageInput").focus();
}

async function getIceConfig(){
  if(!iceConfig)iceConfig=await api("/api/call-config");
  return iceConfig;
}

let currentFacingMode="user";
async function getMedia(mode){
  const video=mode==="video"
    ?{facingMode:{ideal:currentFacingMode},width:{ideal:1280},height:{ideal:720}}
    :false;
  return navigator.mediaDevices.getUserMedia({audio:true,video});
}

function applyCameraFilter(){
  const css=CAMERA_FILTERS[cameraFilter]||"none";
  const capture=$("captureVideo"),local=$("localVideo");
  if(capture)capture.style.filter=css;
  if(local)local.style.filter=(screenStream||callProcessedStream?"none":css);
  const captureSelect=$("cameraFilterSelect"),callSelect=$("callFilterSelect");
  if(captureSelect&&captureSelect.value!==cameraFilter)captureSelect.value=cameraFilter;
  if(callSelect&&callSelect.value!==cameraFilter)callSelect.value=cameraFilter;
  document.querySelectorAll("[data-camera-filter]").forEach(btn=>btn.classList.toggle("active",btn.dataset.cameraFilter===cameraFilter));
}

function syncFrontCameraOrientation(){
  // Build 6781: call video is processed into true left/right orientation.
  // Local preview and the transmitted video use the same processed frames.
  const local=$("localVideo");
  if(local)local.classList.remove("front-camera-corrected");
  const capture=$("captureVideo");
  if(capture)capture.classList.toggle("front-camera-corrected",captureFacing==="user"&&Boolean(captureStream));
  applyCameraFilter();
}

function stopCallVideoProcessor(){
  callProcessorAbort=true;
  if(callProcessorRaf)cancelAnimationFrame(callProcessorRaf);
  callProcessorRaf=0;
  try{callTrackReader?.cancel()}catch{}
  try{callTrackWriter?.close()}catch{}
  callTrackReader=null;callTrackWriter=null;
  try{callProcessedStream?.getVideoTracks().forEach(t=>t.stop())}catch{}
  try{if(callProcessorVideo){callProcessorVideo.pause();callProcessorVideo.srcObject=null}}catch{}
  callProcessedStream=null;callProcessorVideo=null;callProcessorCanvas=null;
}

async function buildCallProcessedStream(rawStream){
  if(!rawStream?.getVideoTracks?.().length||typeof HTMLCanvasElement==="undefined")return rawStream;
  stopCallVideoProcessor();callProcessorAbort=false;
  const rawTrack=rawStream.getVideoTracks()[0];

  // Preferred path (desktop/Android and browsers that expose canvas.captureStream).
  const canvas=document.createElement("canvas");
  const source=document.createElement("video");
  source.muted=true;source.playsInline=true;source.autoplay=true;source.srcObject=rawStream;
  await source.play().catch(()=>{});
  await new Promise(resolve=>{if(source.videoWidth)resolve();else{const done=()=>resolve();source.addEventListener("loadedmetadata",done,{once:true});setTimeout(resolve,700)}});
  canvas.width=source.videoWidth||720;canvas.height=source.videoHeight||1280;
  const ctx=canvas.getContext("2d",{alpha:false});

  if(typeof canvas.captureStream==="function"){
    const draw=()=>{
      if(callProcessorAbort||!ctx||!source.srcObject)return;
      const w=canvas.width,h=canvas.height;
      ctx.save();ctx.clearRect(0,0,w,h);ctx.filter=CAMERA_FILTERS[cameraFilter]||"none";
      if(currentFacingMode==="user"){ctx.translate(w,0);ctx.scale(-1,1)}
      try{ctx.drawImage(source,0,0,w,h)}catch{}
      ctx.restore();callProcessorRaf=requestAnimationFrame(draw);
    };
    draw();
    const videoTrack=canvas.captureStream(24).getVideoTracks()[0];
    if(videoTrack){
      callProcessorVideo=source;callProcessorCanvas=canvas;
      callProcessedStream=new MediaStream([videoTrack,...rawStream.getAudioTracks()]);
      return callProcessedStream;
    }
  }

  // iPhone/Safari fallback. CSS filters never affect the WebRTC track, so when
  // canvas.captureStream is unavailable we process VideoFrames and generate a
  // real outbound track if the browser exposes the Insertable Streams APIs.
  const Processor=window.MediaStreamTrackProcessor;
  const Generator=window.MediaStreamTrackGenerator;
  if(Processor&&Generator&&window.VideoFrame){
    try{
      const processor=new Processor({track:rawTrack});
      const generator=new Generator({kind:"video"});
      callTrackReader=processor.readable.getReader();
      callTrackWriter=generator.writable.getWriter();
      callProcessorCanvas=canvas;
      const loop=async()=>{
        while(!callProcessorAbort){
          const {value:frame,done}=await callTrackReader.read();
          if(done||!frame)break;
          try{
            const w=frame.displayWidth||frame.codedWidth||canvas.width||720;
            const h=frame.displayHeight||frame.codedHeight||canvas.height||1280;
            if(canvas.width!==w)canvas.width=w;if(canvas.height!==h)canvas.height=h;
            const c=canvas.getContext("2d",{alpha:false});
            c.save();c.clearRect(0,0,w,h);c.filter=CAMERA_FILTERS[cameraFilter]||"none";
            if(currentFacingMode==="user"){c.translate(w,0);c.scale(-1,1)}
            c.drawImage(frame,0,0,w,h);c.restore();
            const out=new VideoFrame(canvas,{timestamp:frame.timestamp||0,duration:frame.duration||undefined});
            await callTrackWriter.write(out);out.close();
          }catch(error){console.warn("Mobile call video frame processing failed",error)}
          finally{try{frame.close()}catch{}}
        }
      };
      loop().catch(error=>console.warn("Mobile call video processor stopped",error));
      callProcessedStream=new MediaStream([generator,...rawStream.getAudioTracks()]);
      source.pause();source.srcObject=null;
      return callProcessedStream;
    }catch(error){console.warn("Mobile filtered call track unavailable",error)}
  }

  // Last-resort compatibility fallback: keep the call working. The UI will
  // explain that filters are local-preview only on this browser.
  source.pause();source.srcObject=null;
  return rawStream;
}

async function createPeer(peerId){
  const config=await getIceConfig();
  const pc=new RTCPeerConnection({iceServers:config.iceServers});
  pc.onicecandidate=e=>{if(e.candidate)socket.emit("call:ice",{receiverId:peerId,candidate:e.candidate})};
  pc.ontrack=e=>{
    $("remoteVideo").srcObject=e.streams[0];
    $("remoteVideo").play().catch(()=>{});
    if(e.track.kind==="video"){
      $("videoStage").classList.remove("waiting-remote");
      e.track.onmute=()=>$("videoStage").classList.add("waiting-remote");
      e.track.onunmute=()=>$("videoStage").classList.remove("waiting-remote");
    }
  };
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
  document.body.appendChild($("callOverlay"));
  document.body.classList.add("call-active");
  $("callName").textContent=name;$("callStatus").textContent=status;
  $("callOverlay").classList.remove("hidden");
  $("videoStage").classList.toggle("audio-only",mode==="audio");
  $("videoStage").classList.toggle("waiting-remote",mode==="video");
  $("videoStage").classList.remove("local-camera-off");
  $("cameraToggleBtn").textContent="📹 Camera";
  $("acceptCallBtn").classList.toggle("hidden",!incoming);
  $("declineCallBtn").classList.toggle("hidden",!incoming);
  $("muteBtn").classList.toggle("hidden",incoming);
  $("cameraToggleBtn").classList.toggle("hidden",incoming||mode==="audio");
  $("switchCameraBtn").classList.toggle("hidden",incoming||mode==="audio");
  $("shareScreenBtn").classList.toggle("hidden",incoming||mode==="audio");
  $("endCallBtn").classList.toggle("hidden",incoming);
}

async function startCall(mode){
  if(!callsEnabled||!activeUser||peer)return;
  if(!activeUser.online){
    socket.emit("call:notify",{receiverId:activeUser.id,mode});
    return;
  }
  try{
    callPeerId=activeUser.id;callMode=mode;
    showCallUi(activeUser.username,"Calling…",mode);
    localStream=await getMedia(mode);
    const outboundStream=mode==="video"?await buildCallProcessedStream(localStream):localStream;
    $("localVideo").srcObject=outboundStream;syncFrontCameraOrientation();$("localVideo").play().catch(()=>{});
    peer=await createPeer(callPeerId);
    outboundStream.getTracks().forEach(track=>peer.addTrack(track,outboundStream));
    const offer=await peer.createOffer();await peer.setLocalDescription(offer);
    socket.emit("call:start",{receiverId:callPeerId,mode,offer});
  }catch(e){finishCall("Could not start call",false);toast("Camera and microphone permission is required.")}
}

function showIncomingCall(data){
  if(!callsEnabled||peer||pendingCall){socket.emit("call:reject",{receiverId:data.callerId});return}
  pendingCall=data;callPeerId=data.callerId;callMode=data.mode;
  showCallUi(data.callerName,`Incoming ${data.mode} call`,data.mode,true);
}

function showMissedCallAlert(payload){
  const existing=document.getElementById("missedCallAlert");if(existing)existing.remove();
  const mode=payload?.mode==="video"?"video":"voice";
  const caller=payload?.callerName||"ConnectChat user";
  const when=payload?.startedAt?time(payload.startedAt):"Just now";
  const overlay=document.createElement("div");
  overlay.id="missedCallAlert";overlay.className="missed-call-alert-overlay";
  overlay.innerHTML=`<div class="missed-call-alert-card" role="alertdialog" aria-modal="true" aria-label="Missed call"><div class="missed-call-alert-icon">${mode==="video"?VIDEO_ICON_SVG:PHONE_ICON_SVG}</div><div class="missed-call-alert-copy"><small>Missed ${mode} call</small><h2>${sectionEscape(caller)}</h2><p>${sectionEscape(when)}</p></div><div class="missed-call-alert-actions"><button type="button" class="secondary" data-action="dismiss">Dismiss</button><button type="button" data-action="calls">View calls</button></div></div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('[data-action="dismiss"]').onclick=()=>overlay.remove();
  overlay.querySelector('[data-action="calls"]').onclick=async()=>{overlay.remove();await openWorkspaceSection("calls")};
  if(navigator.vibrate)try{navigator.vibrate([250,120,250,120,450])}catch{}
}

async function refreshCallsBadge(){
  try{
    const calls=await api("/api/calls");
    const count=(calls||[]).filter(c=>String(c.status).toLowerCase()==="missed"&&Number(c.receiver_id)===Number(me.id)).length;
    const btn=document.querySelector('[data-section="calls"]');if(!btn)return;
    let badge=btn.querySelector(".calls-missed-badge");
    if(count){if(!badge){badge=document.createElement("b");badge.className="calls-missed-badge";btn.appendChild(badge)}badge.textContent=count>99?"99+":String(count);btn.classList.add("has-missed-calls")}
    else{badge?.remove();btn.classList.remove("has-missed-calls")}
  }catch{}
}

async function acceptIncomingCall(){
  const data=pendingCall;if(!data)return;
  pendingCall=null;
  try{
    showCallUi(data.callerName,"Connecting…",data.mode);
    localStream=await getMedia(data.mode);
    const outboundStream=data.mode==="video"?await buildCallProcessedStream(localStream):localStream;
    $("localVideo").srcObject=outboundStream;syncFrontCameraOrientation();$("localVideo").play().catch(()=>{});
    peer=await createPeer(data.callerId);
    outboundStream.getTracks().forEach(track=>peer.addTrack(track,outboundStream));
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
    $("localVideo").srcObject=screenStream;$("localVideo").classList.remove("front-camera-corrected");$("localVideo").style.filter="none";
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
  $("localVideo").srcObject=localStream;syncFrontCameraOrientation();
  $("videoStage").classList.remove("screen-sharing");
  $("shareScreenBtn").textContent="🖥 Share screen";$("shareScreenBtn").classList.remove("share-active");
  $("callStatus").textContent="Connected";
}

function finishCall(message="Call ended",notify=true){
  const remoteFilterVideo=$("remoteVideo");if(remoteFilterVideo)remoteFilterVideo.style.filter="none";
  if(notify&&callPeerId&&socket)socket.emit("call:end",{receiverId:callPeerId});
  if(screenStream){screenStream.getTracks().forEach(t=>t.stop());screenStream=null}
  if(peer){peer.onconnectionstatechange=null;peer.close();peer=null}
  stopCallVideoProcessor();
  if(localStream){localStream.getTracks().forEach(t=>t.stop());localStream=null}
  cameraVideoTrack=null;$("shareScreenBtn").textContent="🖥 Share screen";$("shareScreenBtn").classList.remove("share-active");$("videoStage").classList.remove("screen-sharing","waiting-remote","local-camera-off")
  $("localVideo").srcObject=null;$("localVideo").classList.remove("front-camera-corrected");$("remoteVideo").srcObject=null;
  pendingCall=null;callPeerId=null;pendingIce=[];
  $("callStatus").textContent=message;
  setTimeout(()=>{$("callOverlay").classList.add("hidden");document.body.classList.remove("call-active")},500);
}

function closeCallChoice(){
  const overlay=$("callChoiceOverlay");
  overlay.classList.add("hidden");
  // Keep the global DOM clean after closing. On mobile the chooser is mounted
  // inside the active chat so it can never appear over the conversation list.
  if(overlay.parentElement!==document.body)document.body.appendChild(overlay);
}
function openCallChoice(){
  if(!callsEnabled||!activeUser||activeUser.isSelf||activeUser.isAI)return;
  const overlay=$("callChoiceOverlay");
  if(window.innerWidth<=800){
    // Mobile: the call chooser belongs to the selected conversation.
    // Mount it inside chatPanel so hiding/leaving that conversation also hides
    // the chooser, preventing it from appearing on the all-users Messages page.
    $("chatPanel").appendChild(overlay);
  }else if(overlay.parentElement!==document.body){
    document.body.appendChild(overlay);
  }
  $("callChoiceContact").textContent=`Call ${activeUser.displayName||activeUser.username}`;
  $("callChoiceOfflineNote").classList.toggle("hidden",Boolean(activeUser.online));
  overlay.classList.remove("hidden");
}
$("callMenuBtn").onclick=openCallChoice;
$("closeCallChoiceBtn").onclick=closeCallChoice;
$("callChoiceOverlay").onclick=event=>{if(event.target===$("callChoiceOverlay"))closeCallChoice()};
$("chooseVoiceCallBtn").onclick=()=>{closeCallChoice();startCall("audio")};
$("chooseVideoCallBtn").onclick=()=>{closeCallChoice();startCall("video")};
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
  track.enabled=!track.enabled;
  $("videoStage").classList.toggle("local-camera-off",!track.enabled);
  $("cameraToggleBtn").textContent=track.enabled?"📹 Camera":"🚫 Camera off";
};
$("switchCameraBtn").onclick=async()=>{
  if(!peer||callMode!=="video"||screenStream)return;
  const button=$("switchCameraBtn"),previous=currentFacingMode;
  try{
    button.disabled=true;
    currentFacingMode=currentFacingMode==="user"?"environment":"user";
    const replacement=await navigator.mediaDevices.getUserMedia({
      video:{facingMode:{ideal:currentFacingMode},width:{ideal:1280},height:{ideal:720}},
      audio:false
    });
    const newTrack=replacement.getVideoTracks()[0];
    if(!newTrack)throw new Error("Camera track unavailable");
    const sender=peer.getSenders().find(item=>item.track?.kind==="video");
    localStream?.getVideoTracks().forEach(track=>{localStream.removeTrack(track);track.stop()});
    localStream.addTrack(newTrack);
    const rebuilt=await buildCallProcessedStream(localStream);
    const processedTrack=rebuilt.getVideoTracks()[0]||newTrack;
    if(sender)await sender.replaceTrack(processedTrack);
    $("localVideo").srcObject=rebuilt;
    syncFrontCameraOrientation();
    $("localVideo").play().catch(()=>{});
    $("videoStage").classList.remove("local-camera-off");
    $("cameraToggleBtn").textContent="📹 Camera";
  }catch(error){
    currentFacingMode=previous;
    toast("Could not switch camera on this device.");
  }finally{button.disabled=false}
};
function updateHeader(){
  if(!activeUser)return;
  $("chatName").textContent=activeUser.displayName||activeUser.username;
  $("chatStatus").textContent=activeUser.isAI?"AI assistant · Arabic & English":(activeUser.isSelf?"Private space for your messages and files":(activeUser.online?"Online":lastSeenText(activeUser.lastSeenAt)));
  $("activeAvatar").innerHTML=activeUser.isAI?"AI":avatarHtml(activeUser,activeUser.isSelf?"★":initials(activeUser.username));
  $("callMenuBtn").classList.toggle("hidden",Boolean(activeUser.isSelf)||Boolean(activeUser.isAI)||!callsEnabled);
  $("moreChatBtn").classList.remove("hidden");
  if($("chatAiBtn"))$("chatAiBtn").disabled=false;
  $("attachBtn").disabled=Boolean(activeUser.isAI);
  if($("archiveChatBtn")){
    const archived=archivedUserIds.has(Number(activeUser.id));
    $("archiveChatBtn").textContent=archived?"📤 Restore chat":"🗃 Archive chat";
    $("archiveChatBtn").disabled=Boolean(activeUser.isSelf);
  }
  if($("deleteConversationBtn"))$("deleteConversationBtn").disabled=false;
}

if($("activeAvatar"))$("activeAvatar").onclick=()=>{if(activeUser&&!activeUser.isAI)openProfilePage(activeUser)};
if($("chatName"))$("chatName").onclick=()=>{if(activeUser&&!activeUser.isAI)openProfilePage(activeUser)};

function safeFileUrl(value){
  try{const url=new URL(value,location.origin);return url.protocol==="https:"||(!location.protocol.startsWith("https")&&url.protocol==="http:")?url.href:""}
  catch{return ""}
}
function messageContent(msg){
  const caption=msg.body?`<div class="caption">${escapeHtml(msg.body)}</div>`:"";
  const signedUrl=safeFileUrl(msg.file_url);
  const mediaUrl=msg?.id?`/api/message-media/${encodeURIComponent(msg.id)}`:signedUrl;
  const fileUrl=escapeHtml(mediaUrl);
  if(msg.kind==="image"&&fileUrl)return `<img class="chat-image" src="${fileUrl}" alt="Photo" loading="lazy" onclick="window.open(this.src,'_blank')">${caption}`;
  if(msg.kind==="voice"&&fileUrl)return `<audio class="voice-note" controls preload="metadata" src="${fileUrl}"></audio>${caption}`;
  if(String(msg.mime_type||"").startsWith("video/")&&fileUrl)return `<video class="chat-video" controls playsinline preload="metadata" src="${fileUrl}" onerror="this.classList.add('media-playback-error');this.nextElementSibling?.classList.remove('hidden')"></video><a class="file-link hidden" href="${fileUrl}" target="_blank" rel="noopener noreferrer">Open video</a>${caption}`;
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
  // A message can arrive from the upload response/history refresh and Socket.IO nearly at the same time.
  // Render each persisted message ID only once on this client.
  if(msg?.id!=null){
    const existing=[...$("messages").querySelectorAll(".msg")].find(item=>String(item.dataset.messageId)===String(msg.id));
    if(existing){
      const index=activeConversation.findIndex(item=>String(item.id)===String(msg.id));
      if(index>=0)activeConversation[index]={...activeConversation[index],...msg};
      return existing;
    }
  }
  if(!activeUser?.isAI&&msg?.id&&!activeConversation.some(item=>Number(item.id)===Number(msg.id))){
    activeConversation.push(msg);
    if(currentInsightTab!=="overview")renderWorkspaceInsightTab(currentInsightTab);
  }
  const own=Number(msg.sender_id)===Number(me.id);
  const canDelete=!msg.ai&&(own||me.isAdmin);
  const receipt=receiptInfo(msg);
  if($("messages").classList.contains("empty-state")){
    $("messages").classList.remove("empty-state");$("messages").innerHTML="";
  }
  const row=document.createElement("div");
  row.className=`msg ${own?"own":"other"} ${msg.ai?"ai-message":""} ${msg.aiError?"ai-error":""}`;
  row.dataset.messageId=String(msg.id);
  const aiExports=msg.ai&&!own&&!msg.aiError?'<div class="ai-export-actions"><button type="button" data-export="docx" title="Export this AI answer to Word">W Word</button><button type="button" data-export="pdf" title="Export this AI answer to PDF">PDF</button><button type="button" data-export="xlsx" title="Export this AI answer to Excel">XLS Excel</button></div>':"";
  row.innerHTML=`<div class="meta"><span>${own?"You":escapeHtml(msg.sender_name)} · ${time(msg.created_at)}</span>${own?`<span class="${receipt.className}">${receipt.text}</span>`:""}${canDelete?'<button type="button" class="message-delete" title="Permanently delete this message">Delete</button>':""}</div><div class="bubble">${messageContent(msg)}</div>${aiExports}`;
  const deleteButton=row.querySelector(".message-delete");
  if(deleteButton)deleteButton.onclick=()=>deleteMessage(msg,deleteButton);
  row.querySelectorAll("[data-export]").forEach(button=>button.onclick=()=>exportAiMessage(msg,button.dataset.export,button));
  $("messages").appendChild(row);$("messages").scrollTop=$("messages").scrollHeight;
}

async function exportAiMessage(msg,format,button){
  const original=button.textContent;
  try{
    button.disabled=true;button.textContent="…";
    await downloadApiFile("/api/ai/export",{
      method:"POST",
      body:JSON.stringify({format,title:"ConnectChat AI Export",content:msg.body})
    },`ConnectChat-AI-Export.${format}`);
    toast(`AI answer exported to ${format.toUpperCase()}.`);
  }catch(error){toast(error.message)}
  finally{button.disabled=false;button.textContent=original}
}

function removeMessage(messageId){
  const id=Number(messageId);
  if(!Number.isSafeInteger(id)||id<=0)return;
  activeConversation=activeConversation.filter(item=>Number(item.id)!==id);
  updateWorkspaceOverview();
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
        if(option.value==="deepseek")option.disabled=!aiStatus.providers?.deepseek?.available;
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
  if($("groupEmojiPicker")&&!e.target.closest("#groupEmojiPicker")&&!e.target.closest("#groupEmojiBtn"))$("groupEmojiPicker").classList.add("hidden");
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

function formatMediaSize(bytes){
  if(bytes<1024)return `${bytes} B`;
  if(bytes<1024*1024)return `${(bytes/1024).toFixed(1)} KB`;
  return `${(bytes/(1024*1024)).toFixed(1)} MB`;
}
function closeMediaConfirmation(confirmed=false){
  const pending=pendingMediaConfirmation;
  pendingMediaConfirmation=null;
  $("mediaConfirmOverlay").classList.add("hidden");
  $("mediaConfirmPreview").replaceChildren();
  if(pendingMediaObjectUrl)URL.revokeObjectURL(pendingMediaObjectUrl);
  pendingMediaObjectUrl=null;
  if(pending)pending.resolve(Boolean(confirmed));
}
function confirmMediaUpload(file,kind){
  if(!["image","voice","video"].includes(kind))return Promise.resolve(true);
  if(pendingMediaConfirmation)closeMediaConfirmation(false);
  return new Promise(resolve=>{
    pendingMediaConfirmation={resolve};
    pendingMediaObjectUrl=URL.createObjectURL(file);
    const preview=$("mediaConfirmPreview");
    preview.replaceChildren();
    let media;
    if(kind==="image"){
      media=document.createElement("img");
      media.alt="Photo preview";
      $("mediaConfirmTitle").textContent="Send this photo?";
    }else if(kind==="video"){
      media=document.createElement("video");
      media.controls=true;media.playsInline=true;
      $("mediaConfirmTitle").textContent="Send this video?";
    }else{
      media=document.createElement("audio");
      media.controls=true;
      $("mediaConfirmTitle").textContent="Send this voice recording?";
    }
    media.src=pendingMediaObjectUrl;
    preview.appendChild(media);
    $("mediaConfirmName").textContent=file.name||({image:"Photo",video:"Video",voice:"Voice recording"}[kind]);
    $("mediaConfirmSize").textContent=formatMediaSize(file.size);
    $("mediaConfirmOverlay").classList.remove("hidden");
  });
}
async function previewAndUploadMedia(file,kind){
  const receiverId=Number(activeUser?.id);
  if(!await confirmMediaUpload(file,kind))return false;
  if(!activeUser||Number(activeUser.id)!==receiverId){toast("The conversation changed. Media was not sent.");return false}
  return uploadFile(file,kind);
}
$("closeMediaConfirmBtn").onclick=()=>closeMediaConfirmation(false);
$("cancelMediaConfirmBtn").onclick=()=>closeMediaConfirmation(false);
$("sendMediaConfirmBtn").onclick=()=>closeMediaConfirmation(true);
$("mediaConfirmOverlay").onclick=event=>{if(event.target===$("mediaConfirmOverlay"))closeMediaConfirmation(false)};

async function uploadFile(file,kind){
  if(mediaUploadInFlight){toast("Please wait for the current upload to finish.");return false}
  if(!activeUser){toast("Select a user first.");return false}
  if(activeUser.isAI){toast("Attachments are available in human chats. AI document analysis is not enabled yet.");return false}
  if(file.size>30*1024*1024){toast(`${file.name} is larger than 30 MB.`);return false}
  const caption=$("messageInput").value.trim();
  const receiverId=Number(activeUser.id);
  const uploadId=`${kind}:${receiverId}:${file.name}:${file.size}:${file.lastModified||0}`;
  const fd=new FormData();fd.append("file",file);fd.append("receiverId",receiverId);fd.append("kind",kind);fd.append("caption",caption);fd.append("uploadId",uploadId);
  mediaUploadInFlight=true;
  $("uploadStatus").textContent=`Uploading ${file.name}…`;$("uploadStatus").classList.remove("hidden");$("attachBtn").disabled=true;
  try{
    const saved=await api("/api/upload",{method:"POST",body:fd});
    if(!saved?.id)throw new Error(`${kind==="video"?"Video":"Media"} upload did not create a message.`);
    if(caption&&activeUser&&Number(activeUser.id)===receiverId){$("messageInput").value="";updateComposer()}
    toast(kind==="voice"?"Voice sent":kind==="image"?"Photo sent":kind==="video"?"Video sent":"Document sent");return true
  }catch(e){
    console.error("Media upload failed",{kind,name:file.name,size:file.size,type:file.type,error:e});
    toast(kind==="video"?`Video send failed: ${e.message}`:e.message);return false
  }
  finally{mediaUploadInFlight=false;$("uploadStatus").classList.add("hidden");$("uploadStatus").textContent="Uploading…";$("attachBtn").disabled=false}
}
function attachmentKind(file){return file.type.startsWith("image/")?"image":file.type.startsWith("audio/")?"voice":file.type.startsWith("video/")?"video":"file"}
async function uploadFiles(fileList){
  const files=[...fileList].slice(0,10);
  if(!files.length)return;
  for(const file of files){
    const kind=attachmentKind(file);
    if(["image","voice","video"].includes(kind))await previewAndUploadMedia(file,kind);
    else await uploadFile(file,kind);
  }
  if(fileList.length>10)toast("A maximum of 10 files can be added at one time.");
}
$("attachBtn").onclick=()=>{
  if(!activeUser)return toast("Select a user first.");
  if(activeUser.isAI)return toast("Attachments are available in human chats.");
  $("fileInput").click();
};
$("fileInput").onchange=e=>{
  uploadFiles(e.target.files);e.target.value="";
};
$("cameraInput").onchange=e=>{const f=e.target.files[0];if(f)previewAndUploadMedia(f,"image");e.target.value=""};
$("videoCameraInput").onchange=e=>{const f=e.target.files[0];if(f)previewAndUploadMedia(f,"video");e.target.value=""};

const chatDropTarget=$("chatPanel");
["dragenter","dragover"].forEach(type=>chatDropTarget.addEventListener(type,event=>{
  if(!activeUser||activeUser.isAI)return;
  event.preventDefault();event.dataTransfer.dropEffect="copy";chatDropTarget.classList.add("file-drop-active");
}));
["dragleave","drop"].forEach(type=>chatDropTarget.addEventListener(type,event=>{
  if(type==="drop"){event.preventDefault();event.stopPropagation();if(event.dataTransfer?.files?.length&&activeUser&&!activeUser.isAI)uploadFiles(event.dataTransfer.files)}
  if(type==="dragleave"&&event.relatedTarget&&chatDropTarget.contains(event.relatedTarget))return;
  chatDropTarget.classList.remove("file-drop-active");
}));
document.addEventListener("dragover",event=>{
  if(activeUser&&!activeUser.isAI&&$("chatPanel")?.contains(event.target))event.preventDefault();
});
document.addEventListener("drop",event=>{
  if($("chatPanel")?.contains(event.target))event.preventDefault();
});

$("messageInput").addEventListener("paste",e=>{
  const items=[...(e.clipboardData?.items||[])];
  const imageItem=items.find(i=>i.type.startsWith("image/"));
  if(imageItem){
    e.preventDefault();
    const file=imageItem.getAsFile();
    if(file)previewAndUploadMedia(file,"image");
  }
});

function recordingFeedback(text){
  const status=$("uploadStatus");
  status.textContent=text;
  status.classList.remove("hidden");
}
function clearRecordingFeedback(){
  const status=$("uploadStatus");
  status.classList.add("hidden");
  status.textContent="Uploading…";
}
function preferredRecorderType(types){
  return types.find(type=>MediaRecorder.isTypeSupported?.(type))||"";
}
async function startVoiceHoldRecording(){
  if(!activeUser)return toast("Select a user first.");
  if(activeUser.isAI)return toast("AI file analysis is not enabled in this version.");
  if(!navigator.mediaDevices?.getUserMedia||!("MediaRecorder" in window))return toast("Voice recording is not supported by this browser.");
  if(isRecording||videoRecording)return;
  try{
    const stream=await navigator.mediaDevices.getUserMedia({audio:true});
    if(!voiceHoldActive){stream.getTracks().forEach(track=>track.stop());return}
    audioChunks=[];
    const mimeType=preferredRecorderType(["audio/webm;codecs=opus","audio/mp4","audio/webm"]);
    mediaRecorder=new MediaRecorder(stream,mimeType?{mimeType,audioBitsPerSecond:64000}:undefined);
    mediaRecorder.ondataavailable=e=>{if(e.data.size)audioChunks.push(e.data)};
    mediaRecorder.onstop=()=>{
      stream.getTracks().forEach(t=>t.stop());
      const blob=new Blob(audioChunks,{type:mediaRecorder.mimeType||"audio/webm"});
      const extension=blob.type.includes("mp4")?"m4a":blob.type.includes("ogg")?"ogg":"webm";
      const file=new File([blob],`voice-${Date.now()}.${extension}`,{type:blob.type});
      isRecording=false;$("recordBtn").classList.remove("recording");
      clearRecordingFeedback();
      if(blob.size>500)previewAndUploadMedia(file,"voice");
    };
    mediaRecorder.start(250);isRecording=true;$("recordBtn").classList.add("recording");
    recordingFeedback("Recording voice… release to send");
  }catch(e){toast("Microphone permission is required.")}
}
function stopVoiceHoldRecording(){
  voiceHoldActive=false;
  if(mediaRecorder?.state==="recording")mediaRecorder.stop();
}

async function startVideoHoldRecording(){
  if(!activeUser)return toast("Select a user first.");
  if(activeUser.isAI)return toast("Video attachments are available in human chats.");
  if(!navigator.mediaDevices?.getUserMedia||!("MediaRecorder" in window))return toast("Video recording is not supported by this browser.");
  if(videoRecording||isRecording)return;
  try{
    videoStream=await navigator.mediaDevices.getUserMedia({
      video:{facingMode:{ideal:"environment"},width:{ideal:720},height:{ideal:1280}},
      audio:true
    });
    if(!cameraPointerHeld){videoStream.getTracks().forEach(track=>track.stop());videoStream=null;return}
    videoChunks=[];
    const mimeType=preferredRecorderType(["video/webm;codecs=vp8,opus","video/mp4","video/webm"]);
    videoRecorder=new MediaRecorder(videoStream,mimeType?{mimeType,videoBitsPerSecond:700000,audioBitsPerSecond:64000}:undefined);
    videoRecorder.ondataavailable=event=>{if(event.data.size)videoChunks.push(event.data)};
    videoRecorder.onstop=()=>{
      clearTimeout(recordingLimitTimer);
      videoStream?.getTracks().forEach(track=>track.stop());
      const type=videoRecorder.mimeType||"video/webm";
      const blob=new Blob(videoChunks,{type});
      const extension=type.includes("mp4")?"mp4":"webm";
      const file=new File([blob],`video-${Date.now()}.${extension}`,{type});
      videoRecording=false;videoStream=null;
      $("cameraBtn").classList.remove("recording","camera-recording");
      clearRecordingFeedback();
      if(blob.size>1000)previewAndUploadMedia(file,"video");
    };
    videoRecorder.start(250);
    videoRecording=true;
    $("cameraBtn").classList.add("recording","camera-recording");
    recordingFeedback("Recording video… release to send");
    recordingLimitTimer=setTimeout(()=>{
      cameraPointerHeld=false;
      if(videoRecorder?.state==="recording"){toast("Maximum video length is 30 seconds.");videoRecorder.stop()}
    },30000);
  }catch(error){
    cameraPointerHeld=false;
    $("cameraBtn").classList.remove("recording","camera-recording");
    clearRecordingFeedback();
    toast("Camera and microphone permission are required.");
  }
}
function stopVideoHoldRecording(){
  cameraPointerHeld=false;
  if(videoRecorder?.state==="recording")videoRecorder.stop();
}

const recordButton=$("recordBtn");
const cameraButton=$("cameraBtn");

let captureMode="photo",captureStream=null,captureRecorder=null,captureChunks=[],captureBlob=null,captureStartedAt=0,captureClock=null,captureFacing="environment",capturePreviewUrl=null,captureStopping=false,capturePreviewPlaying=false,captureAutoStopTimer=null,captureReceiverId=null,capturePhotoScale=1;
function isAppleSafariRecorder(){
  const ua=navigator.userAgent||"";
  return /Safari/i.test(ua)&&!/Chrome|CriOS|Edg|EdgiOS|OPR|Android/i.test(ua);
}
function captureMime(types){return types.find(t=>MediaRecorder.isTypeSupported?.(t))||""}
function captureRecorderMime(){
  return isAppleSafariRecorder()
    ? captureMime(["video/mp4;codecs=avc1.42E01E,mp4a.40.2","video/mp4"])
    : captureMime(["video/webm;codecs=vp8,opus","video/webm","video/mp4"]);
}
function captureVideoConstraints(){
  const mobile=window.matchMedia?.("(max-width: 800px)")?.matches;
  return {
    facingMode:{ideal:captureFacing},
    width:{ideal:mobile?720:960},
    height:{ideal:mobile?1280:720},
    aspectRatio:{ideal:mobile?(9/16):(4/3)}
  };
}
function clearCapturePreviewUrl(){if(capturePreviewUrl){URL.revokeObjectURL(capturePreviewUrl);capturePreviewUrl=null}}
function stopCaptureStream(){
  captureStream?.getTracks().forEach(t=>t.stop());captureStream=null;
  const v=$("captureVideo");
  if(v){
    v.pause();v.srcObject=null;v.classList.remove("front-camera-corrected");v.style.transform="none";
    if(v.src&&v.src.startsWith("blob:")){URL.revokeObjectURL(v.src);v.removeAttribute("src")}
    v.controls=false;v.muted=true;
  }
}
function captureFilterCss(){return CAMERA_FILTERS[cameraFilter]||"none"}
function applyCaptureFilterOnly(){const v=$("captureVideo");if(v)v.style.filter=captureFilterCss()}
function setCaptureSendReady(ready){
  const send=$("captureSendBtn");send.disabled=!ready;send.classList.toggle("hidden",!ready);
  send.textContent="➤ Send";send.title="Send";send.setAttribute("aria-label","Send");
  $("captureOverlay").classList.toggle("result-ready",Boolean(ready));
}
function setCapturePreviewReady(ready){
  const preview=$("capturePreviewBtn"),show=Boolean(ready&&captureMode==="video");
  preview.disabled=!show;preview.classList.toggle("hidden",!show);preview.textContent="▶ Preview";capturePreviewPlaying=false;
}
function setCaptureSaveReady(ready){
  const save=$("captureSaveBtn");if(save)save.classList.toggle("hidden",!(ready&&captureMode==="photo"));
}
function resetCaptureResult(){
  clearCapturePreviewUrl();captureBlob=null;captureStopping=false;capturePreviewPlaying=false;capturePhotoScale=1;
  const canvas=$("captureCanvas");canvas.style.transform="scale(1)";canvas.classList.add("hidden");
  $("captureRetakeBtn").classList.add("hidden");setCaptureSendReady(false);setCapturePreviewReady(false);setCaptureSaveReady(false);
  $("captureMainBtn").classList.remove("hidden");$("captureMainBtn").disabled=false;
  $("captureMainBtn").setAttribute("aria-label",captureMode==="photo"?"Take photo":"Start recording");
  $("captureSwitchBtn").classList.remove("hidden");
  const v=$("captureVideo");v.classList.remove("hidden");v.style.transform="none";applyCaptureFilterOnly();
  const voice=$("voiceWave");if(voice)voice.classList.add("hidden");
  const aud=$("captureAudio");if(aud){aud.pause();aud.removeAttribute("src");aud.load();aud.classList.add("hidden")}
}
function stopCaptureClock(reset=true){
  clearInterval(captureClock);captureClock=null;clearTimeout(captureAutoStopTimer);captureAutoStopTimer=null;
  if(reset)$("captureTimer").textContent="00:00";
}
function startCaptureClock(){
  captureStartedAt=Date.now();
  captureClock=setInterval(()=>{
    const sec=Math.floor((Date.now()-captureStartedAt)/1000);
    $("captureTimer").textContent=`${String(Math.floor(sec/60)).padStart(2,"0")}:${String(sec%60).padStart(2,"0")}`;
  },250);
}
async function prepareCapture(mode){
  if(!["photo","video"].includes(mode))mode="photo";
  captureMode=mode;
  if(captureRecorder?.state==="recording"){try{captureRecorder.stop()}catch{}}
  captureRecorder=null;captureChunks=[];stopCaptureStream();stopCaptureClock();resetCaptureResult();
  $("captureOverlay").classList.toggle("video-mode",mode==="video");
  $("captureOverlay").classList.remove("voice-mode","recording");
  $("captureTitle").textContent=mode==="photo"?"Photo":"Video";
  document.querySelectorAll(".capture-tabs button").forEach(b=>b.classList.toggle("active",b.dataset.mode===mode));
  try{
    captureStream=await navigator.mediaDevices.getUserMedia({video:captureVideoConstraints(),audio:mode==="video"});
    const live=$("captureVideo");live.autoplay=true;live.muted=true;live.controls=false;live.srcObject=captureStream;
    live.classList.remove("front-camera-corrected");live.style.transform="none";applyCaptureFilterOnly();
    await live.play().catch(()=>{});
  }catch{
    toast(mode==="video"?"Camera and microphone permission are required.":"Camera permission is required.");
    closeCapture();
  }
}
function openCapture(mode){
  if(!activeUser)return toast("Select a user first.");
  if(activeUser.isAI)return toast("Media recording is available in human chats.");
  if(!navigator.mediaDevices?.getUserMedia)return toast("Camera recording is not supported by this browser.");
  captureReceiverId=Number(activeUser.id);$("captureOverlay").classList.remove("hidden");prepareCapture(mode);
}
function closeCapture(){
  if(captureRecorder?.state==="recording"){try{captureRecorder.stop()}catch{}}
  captureRecorder=null;captureChunks=[];captureStopping=false;clearCapturePreviewUrl();stopCaptureStream();stopCaptureClock();captureBlob=null;captureReceiverId=null;
  $("captureOverlay").classList.add("hidden");$("captureOverlay").classList.remove("recording","result-ready");
}
function showCaptureResult(){
  stopCaptureClock(false);
  $("captureMainBtn").classList.add("hidden");$("captureRetakeBtn").classList.remove("hidden");$("captureSwitchBtn").classList.add("hidden");
  const ready=Boolean(captureBlob&&captureBlob.size>=1024);
  if(captureMode==="video"&&ready){
    stopCaptureStream();clearCapturePreviewUrl();capturePreviewUrl=URL.createObjectURL(captureBlob);
    const v=$("captureVideo");v.srcObject=null;v.src=capturePreviewUrl;v.autoplay=false;v.controls=false;v.muted=false;v.loop=false;
    v.classList.remove("hidden","front-camera-corrected");v.style.transform="none";v.style.filter="none";v.preload="metadata";v.load();
    try{v.pause();v.currentTime=0}catch{}
  }
  setCapturePreviewReady(ready);setCaptureSendReady(ready);setCaptureSaveReady(ready);
}
async function finalizeCaptureRecording(recorder,mime){
  const actualType=recorder.mimeType||mime||(isAppleSafariRecorder()?"video/mp4":"video/webm");
  captureBlob=new Blob(captureChunks,{type:actualType});captureStopping=false;$("captureOverlay").classList.remove("recording");
  if(captureBlob.size<1024){toast("The recording was empty. Please record again.");await prepareCapture("video");return}
  showCaptureResult();
}
async function captureMain(){
  if(captureMode==="photo"){
    const v=$("captureVideo"),canvas=$("captureCanvas");
    if(!v.videoWidth||!v.videoHeight)return toast("Camera is not ready yet.");
    canvas.width=v.videoWidth;canvas.height=v.videoHeight;
    const ctx=canvas.getContext("2d");ctx.save();ctx.filter=captureFilterCss();ctx.drawImage(v,0,0,canvas.width,canvas.height);ctx.restore();
    captureBlob=await new Promise(r=>canvas.toBlob(r,"image/jpeg",.92));
    if(!captureBlob||captureBlob.size<1024)return toast("Photo capture failed. Please try again.");
    stopCaptureStream();canvas.classList.remove("hidden");v.classList.add("hidden");canvas.style.transform="scale(1)";
    showCaptureResult();return;
  }

  if(captureRecorder?.state==="recording"){
    if(captureStopping)return;captureStopping=true;$("captureMainBtn").disabled=true;$("captureMainBtn").setAttribute("aria-label","Finishing recording");
    if(!isAppleSafariRecorder()){try{captureRecorder.requestData()}catch{}}
    captureRecorder.stop();return;
  }
  if(!captureStream?.active)return toast("Camera is not ready.");
  captureChunks=[];captureBlob=null;captureStopping=false;
  const mime=captureRecorderMime(),options=mime?{mimeType:mime,videoBitsPerSecond:1200000,audioBitsPerSecond:64000}:{videoBitsPerSecond:1200000,audioBitsPerSecond:64000};
  let recorder;try{recorder=new MediaRecorder(captureStream,options)}catch{recorder=new MediaRecorder(captureStream)}
  captureRecorder=recorder;
  recorder.ondataavailable=e=>{if(e.data&&e.data.size)captureChunks.push(e.data)};
  recorder.onerror=()=>{captureStopping=false;$("captureOverlay").classList.remove("recording");toast("Recording failed. Please try again.");prepareCapture("video")};
  recorder.onstop=()=>setTimeout(()=>finalizeCaptureRecording(recorder,mime),120);
  recorder.start();$("captureOverlay").classList.add("recording");$("captureMainBtn").setAttribute("aria-label","Stop recording");startCaptureClock();
  captureAutoStopTimer=setTimeout(()=>{if(captureRecorder?.state==="recording")captureMain()},60000);
}
const cameraFilterSelect=$("cameraFilterSelect"),callFilterSelect=$("callFilterSelect");
function setCameraFilter(value){
  cameraFilter=CAMERA_FILTERS[value]?value:"normal";applyCameraFilter();applyCaptureFilterOnly();
  if(peer&&callPeerId&&callMode==="video"){try{socket.emit("call:filter",{receiverId:callPeerId,filter:cameraFilter})}catch{}}
}
if(cameraFilterSelect)cameraFilterSelect.onchange=e=>setCameraFilter(e.target.value);
if(callFilterSelect)callFilterSelect.onchange=e=>setCameraFilter(e.target.value);

$("captureMainBtn").onclick=captureMain;
$("captureCloseBtn").onclick=closeCapture;
$("captureRetakeBtn").onclick=()=>prepareCapture(captureMode);
$("capturePreviewBtn").onclick=async()=>{
  if(!captureBlob||captureBlob.size<1024||captureMode!=="video")return;
  const player=$("captureVideo"),btn=$("capturePreviewBtn");
  try{
    if(capturePreviewPlaying&&!player.paused){player.pause();capturePreviewPlaying=false;btn.textContent="▶ Preview";return}
    player.currentTime=0;await player.play();capturePreviewPlaying=true;btn.textContent="⏸ Pause";
    player.onended=()=>{capturePreviewPlaying=false;btn.textContent="▶ Preview";try{player.currentTime=0}catch{}};
    player.onpause=()=>{if(!player.ended){capturePreviewPlaying=false;btn.textContent="▶ Preview"}};
  }catch{capturePreviewPlaying=false;btn.textContent="▶ Preview";toast("Preview could not play on this device.")}
};
$("captureSaveBtn").onclick=()=>{
  if(captureMode!=="photo"||!captureBlob)return;
  const url=URL.createObjectURL(captureBlob),link=document.createElement("a");
  link.href=url;link.download=`ConnectChat-photo-${Date.now()}.jpg`;document.body.appendChild(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1500);
};
$("captureSendBtn").onclick=async()=>{
  if(!captureBlob||captureBlob.size<1024||captureSendInFlight||captureStopping)return;
  if(!captureReceiverId)return toast("The selected conversation is no longer available.");
  captureSendInFlight=true;setCaptureSendReady(false);
  try{
    const type=captureBlob.type||(captureMode==="photo"?"image/jpeg":"video/webm");
    const ext=type.includes("jpeg")?"jpg":type.includes("mp4")?"mp4":"webm";
    const kind=captureMode==="photo"?"image":"video";
    const file=new File([captureBlob],`${kind}-${Date.now()}.${ext}`,{type,lastModified:Date.now()});
    if(!activeUser||Number(activeUser.id)!==Number(captureReceiverId))return toast("Return to the chat where you opened the camera before sending.");
    const sent=await uploadFile(file,kind);
    if(sent)closeCapture();else setCaptureSendReady(true);
  }finally{
    captureSendInFlight=false;
    if(captureBlob&&!$("captureOverlay").classList.contains("hidden"))setCaptureSendReady(true);
  }
};
$("captureSwitchBtn").onclick=async()=>{captureFacing=captureFacing==="environment"?"user":"environment";await prepareCapture(captureMode)};
document.querySelectorAll(".capture-tabs button").forEach(b=>b.onclick=()=>prepareCapture(b.dataset.mode));
recordButton.title="Record voice";recordButton.setAttribute("aria-label","Record voice");
cameraButton.onclick=()=>openCapture("photo");cameraButton.title="Photo or video";cameraButton.setAttribute("aria-label","Open photo or video recorder");

let capturePinchStart=0,capturePinchBase=1;
function setCapturePhotoScale(value){
  capturePhotoScale=Math.max(1,Math.min(4,value));
  const canvas=$("captureCanvas");if(canvas){canvas.style.transform=`scale(${capturePhotoScale})`;canvas.style.transformOrigin="center center";}
}
$("capturePreview").addEventListener("wheel",event=>{
  if(captureMode!=="photo"||!captureBlob)return;event.preventDefault();setCapturePhotoScale(capturePhotoScale+(event.deltaY<0?.2:-.2));
},{passive:false});
$("capturePreview").addEventListener("touchstart",event=>{
  if(captureMode!=="photo"||!captureBlob||event.touches.length!==2)return;
  capturePinchStart=Math.hypot(event.touches[0].clientX-event.touches[1].clientX,event.touches[0].clientY-event.touches[1].clientY);capturePinchBase=capturePhotoScale;
},{passive:true});
$("capturePreview").addEventListener("touchmove",event=>{
  if(captureMode!=="photo"||!captureBlob||event.touches.length!==2||!capturePinchStart)return;
  const d=Math.hypot(event.touches[0].clientX-event.touches[1].clientX,event.touches[0].clientY-event.touches[1].clientY);setCapturePhotoScale(capturePinchBase*(d/capturePinchStart));
},{passive:true});

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
  $("profileStatus").textContent=isOwner||user.online?"Online":lastSeenText(user.lastSeenAt);
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
  $("profilePhotoResult").textContent="";
  refreshProfilePage();
  $("profilePage").classList.remove("hidden");
}
if($("profileBtn"))$("profileBtn").onclick=()=>openProfilePage(me);
if(document.querySelector(".rail-profile"))document.querySelector(".rail-profile").onclick=()=>openProfilePage(me);
$("closeProfilePageBtn").onclick=()=>{$("profilePage").classList.add("hidden");profileTarget=null};
$("profileMessageBtn").onclick=()=>{const user=profileTarget;$("profilePage").classList.add("hidden");if(user)selectUser(user)};
$("profileCallBtn").onclick=()=>{const user=profileTarget;$("profilePage").classList.add("hidden");if(user){selectUser(user).then(openCallChoice)}};
function updateProfilePhotoViewerZoom(){
  const image=$("profilePhotoViewerImage");
  if(!image)return;
  profilePhotoViewerScale=Math.min(4,Math.max(.5,profilePhotoViewerScale));
  image.style.transform=`scale(${profilePhotoViewerScale})`;
  $("profilePhotoZoomReset").textContent=`${Math.round(profilePhotoViewerScale*100)}%`;
}
function openProfilePhotoViewer(){
  const user=profileTarget||me;
  const url=user?.avatar?safeFileUrl(user.avatar):"";
  if(!url)return toast("This user has no profile photo.");
  profilePhotoViewerScale=1;
  $("profilePhotoViewerName").textContent=user.username||"User";
  $("profilePhotoViewerImage").src=url;
  $("profilePhotoViewer").classList.remove("hidden");
  updateProfilePhotoViewerZoom();
  $("closeProfilePhotoViewer").focus();
}
function closeProfilePhotoViewer(){
  $("profilePhotoViewer").classList.add("hidden");
  $("profilePhotoViewerImage").removeAttribute("src");
  profilePhotoViewerScale=1;
}
$("profilePhotoPreview").onclick=openProfilePhotoViewer;
$("profilePhotoPreview").onkeydown=event=>{
  if(event.key==="Enter"||event.key===" "){event.preventDefault();openProfilePhotoViewer()}
};
$("closeProfilePhotoViewer").onclick=closeProfilePhotoViewer;
$("profilePhotoZoomOut").onclick=()=>{profilePhotoViewerScale-=.25;updateProfilePhotoViewerZoom()};
$("profilePhotoZoomIn").onclick=()=>{profilePhotoViewerScale+=.25;updateProfilePhotoViewerZoom()};
$("profilePhotoZoomReset").onclick=()=>{profilePhotoViewerScale=1;updateProfilePhotoViewerZoom()};
$("profilePhotoViewer").onclick=event=>{if(event.target===$("profilePhotoViewer"))closeProfilePhotoViewer()};
$("profilePhotoViewerImage").oncontextmenu=event=>event.preventDefault();
$("profilePhotoViewerStage").onwheel=event=>{
  event.preventDefault();
  profilePhotoViewerScale+=event.deltaY<0?.15:-.15;
  updateProfilePhotoViewerZoom();
};
document.addEventListener("keydown",event=>{
  if(event.key==="Escape"&&!$("profilePhotoViewer").classList.contains("hidden"))closeProfilePhotoViewer();
});
function avatarCropScale(){return avatarCropBaseScale*avatarCropZoom}
function clampAvatarCrop(){
  const canvas=$("avatarCropCanvas"),scale=avatarCropScale();
  const width=avatarCropImage.width*scale,height=avatarCropImage.height*scale;
  avatarCropX=Math.min(0,Math.max(canvas.width-width,avatarCropX));
  avatarCropY=Math.min(0,Math.max(canvas.height-height,avatarCropY));
}
function drawAvatarCrop(){
  if(!avatarCropImage)return;
  const canvas=$("avatarCropCanvas"),context=canvas.getContext("2d");
  clampAvatarCrop();context.clearRect(0,0,canvas.width,canvas.height);
  context.drawImage(avatarCropImage,avatarCropX,avatarCropY,avatarCropImage.width*avatarCropScale(),avatarCropImage.height*avatarCropScale());
}
function closeAvatarCrop(){
  $("avatarCropOverlay").classList.add("hidden");avatarCropImage=null;avatarCropDragging=false;
  if(avatarCropObjectUrl){URL.revokeObjectURL(avatarCropObjectUrl);avatarCropObjectUrl=null}
}
function openAvatarCrop(file){
  if(!file.type.startsWith("image/"))return toast("Choose a JPG, PNG, WEBP or GIF image.");
  if(file.size>12*1024*1024)return toast("Profile photo must be 12 MB or smaller.");
  if(avatarCropObjectUrl)URL.revokeObjectURL(avatarCropObjectUrl);
  avatarCropObjectUrl=URL.createObjectURL(file);
  const image=new Image();
  image.onload=()=>{
    avatarCropImage=image;avatarCropZoom=1;$("avatarZoomRange").value="1";
    const canvas=$("avatarCropCanvas");
    avatarCropBaseScale=Math.max(canvas.width/image.width,canvas.height/image.height);
    avatarCropX=(canvas.width-image.width*avatarCropBaseScale)/2;
    avatarCropY=(canvas.height-image.height*avatarCropBaseScale)/2;
    $("avatarCropResult").textContent="";$("avatarCropOverlay").classList.remove("hidden");drawAvatarCrop();
  };
  image.onerror=()=>{closeAvatarCrop();toast("This photo could not be opened.")};
  image.src=avatarCropObjectUrl;
}
async function uploadCroppedAvatar(blob){
  const result=$("avatarCropResult"),button=$("saveAvatarCropBtn");
  try{
    button.disabled=true;button.textContent="Uploading…";result.textContent="";
    const form=new FormData();
    form.append("avatar",new File([blob],`profile-${Date.now()}.jpg`,{type:"image/jpeg"}));
    const data=await api("/api/profile/avatar",{method:"POST",body:form});
    me.avatar=data.avatar||null;users=await api("/api/users");
    synchronizeCurrentAccount();renderUsers();refreshProfilePage();updateHeader();closeAvatarCrop();
    $("profilePhotoResult").textContent="Profile photo updated.";toast("Profile photo cropped and updated");
  }catch(error){result.textContent=error.message}
  finally{button.disabled=false;button.textContent="Crop and upload"}
}
$("profilePhotoInput").onchange=e=>{
  const file=e.target.files?.[0];e.target.value="";if(!file)return;
  if(!profileTarget||Number(profileTarget.id)!==Number(me.id)){toast("You can only change your own profile photo.");return}
  openAvatarCrop(file);
};
$("avatarZoomRange").oninput=event=>{
  if(!avatarCropImage)return;
  const canvas=$("avatarCropCanvas"),oldScale=avatarCropScale();
  const sourceCenterX=(canvas.width/2-avatarCropX)/oldScale,sourceCenterY=(canvas.height/2-avatarCropY)/oldScale;
  avatarCropZoom=Number(event.target.value);
  const newScale=avatarCropScale();
  avatarCropX=canvas.width/2-sourceCenterX*newScale;avatarCropY=canvas.height/2-sourceCenterY*newScale;drawAvatarCrop();
};
const avatarCanvas=$("avatarCropCanvas");
avatarCanvas.onpointerdown=event=>{if(!avatarCropImage)return;avatarCropDragging=true;avatarCropPointerX=event.clientX;avatarCropPointerY=event.clientY;avatarCanvas.setPointerCapture(event.pointerId)};
avatarCanvas.onpointermove=event=>{
  if(!avatarCropDragging)return;
  const rect=avatarCanvas.getBoundingClientRect(),ratio=avatarCanvas.width/rect.width;
  avatarCropX+=(event.clientX-avatarCropPointerX)*ratio;avatarCropY+=(event.clientY-avatarCropPointerY)*ratio;
  avatarCropPointerX=event.clientX;avatarCropPointerY=event.clientY;drawAvatarCrop();
};
avatarCanvas.onpointerup=avatarCanvas.onpointercancel=()=>{avatarCropDragging=false};
$("closeAvatarCropBtn").onclick=closeAvatarCrop;$("cancelAvatarCropBtn").onclick=closeAvatarCrop;
$("avatarCropOverlay").onclick=event=>{if(event.target===$("avatarCropOverlay"))closeAvatarCrop()};
$("saveAvatarCropBtn").onclick=()=>{
  if(!avatarCropImage)return;
  drawAvatarCrop();$("avatarCropCanvas").toBlob(blob=>{if(blob)uploadCroppedAvatar(blob);else $("avatarCropResult").textContent="The cropped photo could not be created."},"image/jpeg",.9);
};
$("removeProfilePhotoBtn").onclick=async()=>{
  if(!profileTarget||Number(profileTarget.id)!==Number(me.id)){toast("You can only change your own profile photo.");return}
  if(!me.avatar||!confirm("Remove your profile photo?"))return;
  const result=$("profilePhotoResult");
  try{
    await api("/api/profile/avatar",{method:"DELETE"});
    me.avatar=null;users=await api("/api/users");synchronizeCurrentAccount();renderUsers();refreshProfilePage();updateHeader();
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
function toggleSmartPopup(forceOpen){
  if(!activeUser)return toast("Select a conversation first.");
  $("conversationMenu")?.classList.add("hidden");
  const shouldOpen=forceOpen===true||$("smartStrip").classList.contains("hidden");
  $("smartStrip").classList.toggle("hidden",!shouldOpen);
}
if($("chatAiBtn"))$("chatAiBtn").onclick=()=>toggleSmartPopup();
if($("moreChatBtn"))$("moreChatBtn").onclick=()=>{
  if(!activeUser)return toast("Select a conversation first.");
  $("smartStrip")?.classList.add("hidden");
  $("conversationMenu").classList.toggle("hidden");
};
if($("archiveChatBtn"))$("archiveChatBtn").onclick=async()=>{
  if(!activeUser||activeUser.isSelf)return;
  const archived=archivedUserIds.has(Number(activeUser.id));
  if(activeUser.isAI){
    if(archived){archivedUserIds.delete(-1);localStorage.removeItem(`connectchat-ai-archived-${me.id}`)}
    else{archivedUserIds.add(-1);localStorage.setItem(`connectchat-ai-archived-${me.id}`,"1")}
    $("conversationMenu").classList.add("hidden");renderUsers();updateHeader();
    toast(archived?"AI chat restored.":"AI chat archived on this device.");
    return;
  }
  try{
    await api(`/api/conversations/${activeUser.id}/archive`,{method:archived?"DELETE":"POST",body:archived?undefined:"{}"});
    if(archived)archivedUserIds.delete(Number(activeUser.id));else archivedUserIds.add(Number(activeUser.id));
    $("conversationMenu").classList.add("hidden");renderUsers();updateHeader();
    toast(archived?"Chat restored.":"Chat archived.");
  }catch(error){toast(error.message)}
};
if($("deleteConversationBtn"))$("deleteConversationBtn").onclick=async()=>{
  if(!activeUser)return;
  const name=activeUser.isSelf?"Saved Messages":(activeUser.displayName||activeUser.username);
  if(activeUser.isAI){
    if(!confirm("Delete all private ConnectChat AI history on this device? This cannot be undone."))return;
    saveAiHistory([]);activeConversation=[];$("messages").innerHTML="";$("conversationMenu").classList.add("hidden");
    showAiWelcome();updateWorkspaceOverview();renderUsers();toast("AI conversation history deleted.");
    return;
  }
  if(!confirm(`Delete all messages and attachments in “${name}”? This removes the conversation for both participants and cannot be undone.`))return;
  try{
    await api(`/api/conversations/${activeUser.id}`,{method:"DELETE",body:JSON.stringify({confirm:"DELETE ALL"})});
    activeConversation=[];$("messages").innerHTML="";$("conversationMenu").classList.add("hidden");
    updateWorkspaceOverview();await refreshUsers();toast("All chat messages were deleted.");
  }catch(error){toast(error.message)}
};

document.addEventListener("click",event=>{
  if(!event.target.closest("#smartStrip,#chatAiBtn,.user-ai-tool"))$("smartStrip")?.classList.add("hidden");
  if(!event.target.closest("#conversationMenu,#moreChatBtn"))$("conversationMenu")?.classList.add("hidden");
});
document.querySelectorAll("[data-insight-tab]").forEach(button=>button.onclick=()=>renderWorkspaceInsightTab(button.dataset.insightTab));

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
  const listNeedsRefresh=currentUserFilter!=="all";
  currentWorkspaceSection="chats";
  setMainWorkspaceVisible(true);
  $("workspaceHeading").textContent="Messages";
  currentUserFilter="all";
  document.querySelectorAll(".chat-filter").forEach(x=>x.classList.toggle("active",x.dataset.filter==="all"));
  // Workspace pages only cover the conversation list; the list remains
  // current underneath them and does not need rebuilding on every mobile tap.
  if(listNeedsRefresh)renderUsers();
}

function renderPeopleCards(actionLabel,actionName){
  const contacts=users.filter(u=>!u.isSelf&&!u.isAI&&!u.isGroup);
  if(!contacts.length)return workspaceEmpty("👤","No contacts yet","Approved users will appear here.");
  return `<div class="workspace-card-grid">${contacts.map(u=>`
    <article class="workspace-person-card">
      <div class="avatar">${avatarHtml(u,initials(u.username))}</div>
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
    if(action==="call"){openChatsWorkspace();selectUser(user);setTimeout(openCallChoice,80)}
    if(action==="voice"){openChatsWorkspace();selectUser(user);setTimeout(()=>startCall("audio"),80)}
    if(action==="video"){openChatsWorkspace();selectUser(user);setTimeout(()=>startCall("video"),80)}
    if(action==="profile")openProfilePage(user);
  });
}

async function renderGroupsWorkspace(){
  if(groupCallStream)leaveGroupCall();
  currentGroupId=null;currentGroup=null;
  $("sectionContent").innerHTML=`<div class="workspace-loading">Loading groups…</div>`;
  try{
    const [items,invitations]=await Promise.all([api("/api/groups"),api("/api/group-invitations")]);
    const contacts=users.filter(u=>!u.isSelf&&!u.isAI&&!u.isGroup);
    $("sectionContent").innerHTML=`
      <div class="workspace-toolbar"><div><h2>Group conversations</h2><p>Private chats with group voice and video conference.</p></div><button id="createGroupBtn" class="primary">＋ Create group</button></div>
      <form id="createGroupPanel" class="group-create-panel hidden">
        <label>Group name<input id="newGroupName" maxlength="80" placeholder="Example: DG1 MEP Team" required></label>
        <label>Description<input id="newGroupDescription" maxlength="500" placeholder="Optional description"></label>
        <div><b>Select members</b><div class="group-member-picker">${contacts.map(u=>`<label><input type="checkbox" value="${Number(u.id)}"><span class="avatar">${avatarHtml(u,initials(u.username))}</span>${sectionEscape(u.displayName||u.username)}</label>`).join("")||"<small>No approved contacts are available.</small>"}</div></div>
        <div class="settings-button-row"><button class="primary" type="submit">Create group</button><button id="cancelGroupCreate" type="button">Cancel</button></div>
      </form>
      <section class="group-invitations ${invitations.length?"has-invitations":"no-invitations"}">
        <div class="group-invitations-head">
          <div><h3>Pending invitations</h3><small>${invitations.length?`${invitations.length} invitation${invitations.length===1?"":"s"} waiting for your answer`:"No invitations are waiting for this account"}</small></div>
          <button id="refreshGroupInvitationsBtn" type="button" title="Refresh invitations">↻ Refresh</button>
        </div>
        ${invitations.map(invitation=>`
        <article>
          <div><b>Invitation to ${sectionEscape(invitation.group?.name||"Group")}</b><small>Sent by ${sectionEscape(invitation.inviterName||"group administrator")}</small></div>
          <button type="button" class="accept-invitation" data-invitation-action="accept" data-invitation-id="${Number(invitation.id)}">Accept</button>
          <button type="button" data-invitation-action="decline" data-invitation-id="${Number(invitation.id)}" class="danger-link">Decline</button>
        </article>`).join("")}
      </section>
      <div class="workspace-list">${items.length?items.map(g=>`<article><div class="workspace-list-icon">👥</div><div><h3>${sectionEscape(g.name)}</h3><p>${sectionEscape(g.description||"Private group")} · ${sectionEscape(g.role)}</p></div><button data-open-group="${g.id}">Open</button>${g.role==="owner"?`<button class="danger-link" data-delete-group="${g.id}">Delete</button>`:""}</article>`).join(""):workspaceEmpty("👥","No groups yet","Create your first synchronized group.")}</div>`;
    $("refreshGroupInvitationsBtn").onclick=()=>renderGroupsWorkspace();
    $("createGroupBtn").onclick=()=>$("createGroupPanel").classList.remove("hidden");
    $("cancelGroupCreate").onclick=()=>$("createGroupPanel").classList.add("hidden");
    $("createGroupPanel").onsubmit=async event=>{
      event.preventDefault();
      const name=$("newGroupName").value.trim(),description=$("newGroupDescription").value.trim();
      const memberIds=[...$("createGroupPanel").querySelectorAll('input[type="checkbox"]:checked')].map(input=>Number(input.value));
      const created=await api("/api/groups",{method:"POST",body:JSON.stringify({name,description,memberIds})});
      toast(created.invitationsSent
        ?`Group created. ${created.invitationsSent} invitation${created.invitationsSent===1?"":"s"} sent.`
        :"Group created.");
      await renderGroupsWorkspace();
    };
    $("sectionContent").querySelectorAll("[data-invitation-action]").forEach(button=>button.onclick=async()=>{
      try{
        button.disabled=true;
        await api(`/api/group-invitations/${button.dataset.invitationId}/respond`,{method:"POST",body:JSON.stringify({action:button.dataset.invitationAction})});
        toast(button.dataset.invitationAction==="accept"?"Group invitation accepted.":"Group invitation declined.");
        await renderGroupsWorkspace();
      }catch(error){toast(error.message);button.disabled=false}
    });
    $("sectionContent").querySelectorAll("[data-open-group]").forEach(b=>b.onclick=()=>openGroupConversation(Number(b.dataset.openGroup),items.find(x=>Number(x.id)===Number(b.dataset.openGroup))));
    $("sectionContent").querySelectorAll("[data-delete-group]").forEach(b=>b.onclick=async()=>{if(confirm("Delete this group?")){await api(`/api/groups/${b.dataset.deleteGroup}`,{method:"DELETE"});await renderGroupsWorkspace()}});
  }catch(error){$("sectionContent").innerHTML=workspaceEmpty("⚠️","Groups unavailable",error.message)}
}
async function openGroupConversation(groupId,group){
  currentGroupId=groupId;currentGroup=group;
  $("sectionTitle").textContent=group?.name||"Group";
  $("sectionDescription").textContent=group?.description||"Group conversation";
  $("sectionContent").innerHTML=`<div class="workspace-loading">Loading messages…</div>`;
  try{
    const messages=await api(`/api/groups/${groupId}/messages`);
    $("sectionContent").innerHTML=`
      <div class="group-chat-shell">
        <header class="group-chat-head">
          <div class="group-chat-avatar">👥</div>
          <div><h2>${sectionEscape(group?.name||"Group")}</h2><p>${sectionEscape(group?.description||"Private group conversation")}</p></div>
          <div class="group-call-actions">
            ${["owner","admin"].includes(group?.role)?'<button id="groupManageMembersBtn" type="button" title="Manage members">👤＋</button>':""}
            <button id="groupAudioCallBtn" class="call-symbol" type="button" title="Start group voice call" aria-label="Start group voice call">${PHONE_ICON_SVG}</button>
            <button id="groupVideoCallBtn" class="call-symbol" type="button" title="Start group video call" aria-label="Start group video call">${VIDEO_ICON_SVG}</button>
          </div>
        </header>
        <section id="groupMemberPanel" class="group-member-panel hidden"></section>
        <section id="groupCallPanel" class="group-call-panel hidden">
          <div class="group-call-title"><b id="groupCallStatus">Group call</b><span>Up to 6 participants</span></div>
          <div id="groupVideoGrid" class="group-video-grid"></div>
          <div class="group-call-controls"><button id="groupMuteBtn" type="button">🎤 Mute</button><button id="groupCameraBtn" type="button">📹 Camera</button><button id="groupLeaveCallBtn" class="danger-link" type="button">End call</button></div>
        </section>
        <div class="whatsapp-group-feed" id="workspaceChatFeed"></div>
        <form id="workspaceChatForm" class="whatsapp-group-composer">
          <input id="groupFileInput" type="file" accept="image/*,audio/*,application/pdf,text/plain,text/csv,.docx,.xls,.xlsx,.pptx,.zip" multiple hidden>
          <button id="groupEmojiBtn" type="button" title="Emoji">😊</button>
          <button id="groupAttachBtn" type="button" title="Attachment">📎</button>
          <div class="group-message-entry">
            <div id="groupEmojiPicker" class="emoji-picker group-emoji-picker hidden" aria-label="Group emoji picker"></div>
            <input id="workspaceChatInput" maxlength="4000" placeholder="Type a message" autocomplete="off" required>
          </div>
          <button class="group-send-arrow" type="submit" title="Send message" aria-label="Send message">➤</button>
        </form>
      </div>`;
    messages.forEach(appendGroupMessage);
    if(!messages.length)$("workspaceChatFeed").innerHTML='<div class="group-chat-empty">No messages yet. Send the first message.</div>';
    $("workspaceChatForm").onsubmit=async event=>{
      event.preventDefault();const input=$("workspaceChatInput"),body=input.value.trim();if(!body)return;
      input.value="";
      const saved=await api(`/api/groups/${groupId}/messages`,{method:"POST",body:JSON.stringify({body})});
      appendGroupMessage({...saved,sender_name:me.username});
    };
    $("groupEmojiPicker").innerHTML=EMOJIS.map(emoji=>`<button type="button" aria-label="${emoji}">${emoji}</button>`).join("");
    $("groupEmojiPicker").onclick=event=>{
      const button=event.target.closest("button");if(!button)return;
      const input=$("workspaceChatInput");
      const start=input.selectionStart??input.value.length,end=input.selectionEnd??start;
      input.value=input.value.slice(0,start)+button.textContent+input.value.slice(end);
      input.focus();input.selectionStart=input.selectionEnd=start+button.textContent.length;
    };
    $("groupEmojiBtn").onclick=event=>{
      event.stopPropagation();
      $("groupEmojiPicker").classList.toggle("hidden");
    };
    if($("groupManageMembersBtn"))$("groupManageMembersBtn").onclick=async()=>{
      const panel=$("groupMemberPanel"),shell=panel.closest(".group-chat-shell");
      const opening=panel.classList.contains("hidden");
      panel.classList.toggle("hidden",!opening);shell.classList.toggle("member-panel-open",opening);
      if(opening)await loadGroupMemberPanel();
    };
    $("groupAttachBtn").onclick=()=>$("groupFileInput").click();
    $("groupFileInput").onchange=event=>{uploadGroupFiles(event.target.files);event.target.value=""};
    bindGroupDropZone();
    $("groupAudioCallBtn").onclick=()=>joinGroupCall("audio");
    $("groupVideoCallBtn").onclick=()=>joinGroupCall("video");
    $("groupLeaveCallBtn").onclick=()=>leaveGroupCall();
    $("groupMuteBtn").onclick=toggleGroupMute;
    $("groupCameraBtn").onclick=toggleGroupCamera;
  }catch(error){
    if(error.status===403){
      currentGroupId=null;currentGroup=null;
      toast("Accept the group invitation before opening this conversation.");
      await renderGroupsWorkspace();
      return;
    }
    $("sectionContent").innerHTML=workspaceEmpty("⚠️","Group unavailable",error.message);
  }
}

async function loadGroupMemberPanel(){
  const panel=$("groupMemberPanel");
  if(!panel||!currentGroupId)return;
  panel.innerHTML='<div class="workspace-loading">Loading members…</div>';
  try{
    const data=await api(`/api/groups/${currentGroupId}/members`);
    const memberIds=new Set(data.members.map(member=>Number(member.id)));
    const invitationByUser=new Map((data.invitations||[]).map(invitation=>[Number(invitation.userId),invitation]));
    const available=users.filter(user=>!user.isSelf&&!user.isAI&&!user.isGroup&&!memberIds.has(Number(user.id)));
    const canManage=["owner","admin"].includes(data.viewerRole);
    panel.innerHTML=`
      <div class="group-member-panel-head"><div><b>Group members</b><small>${data.members.length} member${data.members.length===1?"":"s"}</small></div><button id="closeGroupMemberPanel" type="button">×</button></div>
      <div class="group-member-list">${data.members.map(member=>{
        const protectedOwner=member.role==="owner";
        const adminProtected=data.viewerRole==="admin"&&member.role==="admin";
        const canChangeRole=data.viewerRole==="owner"&&!protectedOwner;
        return `<article>
          <span class="avatar">${avatarHtml({username:member.username,avatar:member.avatar},initials(member.username))}</span>
          <span><b>${sectionEscape(member.username)}</b><small>${sectionEscape(member.role)}</small></span>
          ${canChangeRole?`<select data-group-role-user="${member.id}"><option value="member" ${member.role==="member"?"selected":""}>Member</option><option value="admin" ${member.role==="admin"?"selected":""}>Admin</option></select>`:`<em>${sectionEscape(member.role)}</em>`}
          ${canManage&&!protectedOwner&&!adminProtected?`<button type="button" class="danger-link" data-remove-group-user="${member.id}">Remove</button>`:""}
        </article>`;
      }).join("")}</div>
      ${canManage?`<div class="group-add-members"><h3>Invite or add approved users</h3>${available.length?available.map(user=>{
        const pending=invitationByUser.get(Number(user.id));
        return `<article>
          <span class="avatar">${avatarHtml(user,initials(user.username))}</span>
          <span><b>${sectionEscape(user.displayName||user.username)}</b><small>${pending?"Invitation pending":"Not in this group"}</small></span>
          <button type="button" data-invite-group-user="${user.id}" ${pending?"disabled":""}>${pending?"Invited":"Invite"}</button>
          <button type="button" data-add-group-user="${user.id}">Add now</button>
        </article>`;
      }).join(""):"<p>All approved contacts are already members.</p>"}</div>`:""}`;
    $("closeGroupMemberPanel").onclick=()=>{
      panel.classList.add("hidden");
      panel.closest(".group-chat-shell").classList.remove("member-panel-open");
    };
    panel.querySelectorAll("[data-invite-group-user]").forEach(button=>button.onclick=async()=>{
      try{
        button.disabled=true;button.textContent="Sending…";
        await api(`/api/groups/${currentGroupId}/invitations`,{method:"POST",body:JSON.stringify({userId:Number(button.dataset.inviteGroupUser)})});
        toast("Group invitation sent.");await loadGroupMemberPanel();
      }catch(error){toast(error.message);button.disabled=false;button.textContent="Invite"}
    });
    panel.querySelectorAll("[data-add-group-user]").forEach(button=>button.onclick=async()=>{
      try{
        button.disabled=true;button.textContent="Adding…";
        await api(`/api/groups/${currentGroupId}/members`,{method:"POST",body:JSON.stringify({userId:Number(button.dataset.addGroupUser)})});
        toast("Member added.");await loadGroupMemberPanel();
      }catch(error){toast(error.message);button.disabled=false;button.textContent="Add now"}
    });
    panel.querySelectorAll("[data-remove-group-user]").forEach(button=>button.onclick=async()=>{
      const member=data.members.find(item=>Number(item.id)===Number(button.dataset.removeGroupUser));
      if(!confirm(`Remove ${member?.username||"this user"} from the group?`))return;
      try{
        button.disabled=true;
        await api(`/api/groups/${currentGroupId}/members/${button.dataset.removeGroupUser}`,{method:"DELETE"});
        toast("Member removed.");await loadGroupMemberPanel();
      }catch(error){toast(error.message);button.disabled=false}
    });
    panel.querySelectorAll("[data-group-role-user]").forEach(select=>select.onchange=async()=>{
      try{
        select.disabled=true;
        await api(`/api/groups/${currentGroupId}/members/${select.dataset.groupRoleUser}/role`,{method:"PATCH",body:JSON.stringify({role:select.value})});
        toast(select.value==="admin"?"Group administrator assigned.":"Administrator changed to member.");
        await loadGroupMemberPanel();
      }catch(error){toast(error.message);select.disabled=false}
    });
  }catch(error){panel.innerHTML=`<div class="group-member-error">${sectionEscape(error.message)}</div>`}
}

function appendGroupMessage(message){
  const feed=$("workspaceChatFeed");if(!feed)return;
  feed.querySelector(".group-chat-empty")?.remove();
  if(message.id&&feed.querySelector(`[data-group-message-id="${Number(message.id)}"]`))return;
  const own=Number(message.sender_id)===Number(me.id);
  const item=document.createElement("article");
  item.className=`group-message-bubble ${own?"own":"other"}`;
  if(message.id)item.dataset.groupMessageId=Number(message.id);
  item.innerHTML=`${own?"":`<strong>${sectionEscape(message.sender_name||"Member")}</strong>`}<div class="group-message-content">${messageContent(message)}</div><small>${sectionEscape(time(message.created_at||new Date().toISOString()))} ${own?"✓✓":""}</small>`;
  feed.appendChild(item);feed.scrollTop=feed.scrollHeight;
}

async function uploadGroupFile(file){
  if(!currentGroupId)return false;
  if(file.size>30*1024*1024){toast(`${file.name} is larger than 30 MB.`);return false}
  const caption=$("workspaceChatInput")?.value.trim()||"";
  const form=new FormData();form.append("file",file);form.append("caption",caption);
  const input=$("workspaceChatInput"),attach=$("groupAttachBtn");
  if(attach)attach.disabled=true;
  try{
    const saved=await api(`/api/groups/${currentGroupId}/upload`,{method:"POST",body:form});
    appendGroupMessage(saved);
    if(caption&&input)input.value="";
    toast(`${file.name} sent`);return true;
  }catch(error){toast(error.message);return false}
  finally{if(attach)attach.disabled=false}
}
async function uploadGroupFiles(fileList){
  const files=[...fileList].slice(0,10);
  for(const file of files)await uploadGroupFile(file);
  if(fileList.length>10)toast("A maximum of 10 files can be added at one time.");
}
function bindGroupDropZone(){
  const shell=document.querySelector(".group-chat-shell");if(!shell)return;
  ["dragenter","dragover"].forEach(type=>shell.addEventListener(type,event=>{
    event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect="copy";shell.classList.add("file-drop-active");
  }));
  shell.addEventListener("dragleave",event=>{
    if(event.relatedTarget&&shell.contains(event.relatedTarget))return;
    shell.classList.remove("file-drop-active");
  });
  shell.addEventListener("drop",event=>{
    event.preventDefault();event.stopPropagation();shell.classList.remove("file-drop-active");
    if(event.dataTransfer?.files?.length)uploadGroupFiles(event.dataTransfer.files);
  });
}

async function createGroupPeer(userId,username){
  const id=Number(userId);if(groupPeers.has(id))return groupPeers.get(id).pc;
  const config=await getIceConfig(),pc=new RTCPeerConnection({iceServers:config.iceServers});
  const state={pc,username,pending:[]};groupPeers.set(id,state);
  state.pending.push(...(groupPendingIce.get(id)||[]));groupPendingIce.delete(id);
  groupCallStream.getTracks().forEach(track=>pc.addTrack(track,groupCallStream));
  pc.onicecandidate=event=>{if(event.candidate)socket.emit("group-call:ice",{groupId:currentGroupId,receiverId:id,candidate:event.candidate})};
  pc.ontrack=event=>addGroupVideoTile(id,username,event.streams[0],false);
  pc.onconnectionstatechange=()=>{if(["failed","closed"].includes(pc.connectionState))removeGroupPeer(id);updateGroupCallStatus()};
  return pc;
}
async function createGroupOffer(userId,username){
  const pc=await createGroupPeer(userId,username),offer=await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit("group-call:offer",{groupId:currentGroupId,receiverId:Number(userId),offer});
}
async function handleGroupCallOffer(payload){
  if(Number(payload?.groupId)!==Number(currentGroupId)||!groupCallStream)return;
  const pc=await createGroupPeer(payload.userId,payload.username);
  await pc.setRemoteDescription(payload.offer);
  const state=groupPeers.get(Number(payload.userId));
  for(const candidate of state.pending.splice(0))await pc.addIceCandidate(candidate).catch(()=>{});
  const answer=await pc.createAnswer();await pc.setLocalDescription(answer);
  socket.emit("group-call:answer",{groupId:currentGroupId,receiverId:Number(payload.userId),answer});
}
async function handleGroupCallAnswer(payload){
  if(Number(payload?.groupId)!==Number(currentGroupId))return;
  const state=groupPeers.get(Number(payload.userId));if(!state)return;
  await state.pc.setRemoteDescription(payload.answer);
  for(const candidate of state.pending.splice(0))await state.pc.addIceCandidate(candidate).catch(()=>{});
}
async function handleGroupCallIce(payload){
  if(Number(payload?.groupId)!==Number(currentGroupId))return;
  const state=groupPeers.get(Number(payload.userId));
  if(!state)return groupPendingIce.set(Number(payload.userId),[...(groupPendingIce.get(Number(payload.userId))||[]),payload.candidate]);
  if(!state.pc.remoteDescription)state.pending.push(payload.candidate);
  else await state.pc.addIceCandidate(payload.candidate).catch(()=>{});
}
function addGroupVideoTile(userId,username,stream,local=false){
  const grid=$("groupVideoGrid");if(!grid)return;
  const tileId=`group-video-${local?"local":Number(userId)}`;
  let tile=$(tileId);
  if(!tile){tile=document.createElement("div");tile.id=tileId;tile.className="group-video-tile";tile.innerHTML=`<video autoplay playsinline ${local?"muted":""}></video><span>${sectionEscape(username)}${local?" (You)":""}</span>`;grid.appendChild(tile)}
  tile.querySelector("video").srcObject=stream;
}
async function joinGroupCall(mode){
  if(!callsEnabled)return toast("Calls are disabled in the server settings.");
  if(!currentGroupId||groupCallStream)return;
  try{
    groupCallMode=mode;groupCallStream=await getMedia(mode);
    $("groupCallPanel").classList.remove("hidden");
    $("groupCameraBtn").classList.toggle("hidden",mode==="audio");
    addGroupVideoTile(me.id,me.username,groupCallStream,true);
    socket.emit("group-call:join",{groupId:currentGroupId,mode});
    updateGroupCallStatus();
  }catch{groupCallStream=null;toast("Allow camera and microphone access to join the group call.")}
}
function removeGroupPeer(userId){
  const state=groupPeers.get(Number(userId));if(state){state.pc.close();groupPeers.delete(Number(userId))}
  $(`group-video-${Number(userId)}`)?.remove();
}
function leaveGroupCall(notify=true){
  if(notify&&currentGroupId)socket.emit("group-call:leave",{groupId:currentGroupId});
  groupPeers.forEach(state=>state.pc.close());groupPeers.clear();groupPendingIce.clear();
  groupCallStream?.getTracks().forEach(track=>track.stop());groupCallStream=null;groupCallMode=null;
  $("groupVideoGrid")?.replaceChildren();$("groupCallPanel")?.classList.add("hidden");
}
function updateGroupCallStatus(){
  if($("groupCallStatus"))$("groupCallStatus").textContent=`Group ${groupCallMode==="audio"?"voice":"video"} call · ${groupPeers.size+1} participant${groupPeers.size?"s":""}`;
}
function toggleGroupMute(){
  const track=groupCallStream?.getAudioTracks()[0];if(!track)return;
  track.enabled=!track.enabled;$("groupMuteBtn").textContent=track.enabled?"🎤 Mute":"🔇 Unmute";
}
function toggleGroupCamera(){
  const track=groupCallStream?.getVideoTracks()[0];if(!track)return;
  track.enabled=!track.enabled;$("groupCameraBtn").textContent=track.enabled?"📹 Camera":"🚫 Camera";
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

function readableBytes(value){
  const bytes=Number(value||0);
  if(bytes<1024)return `${bytes} B`;
  if(bytes<1024*1024)return `${(bytes/1024).toFixed(1)} KB`;
  return `${(bytes/(1024*1024)).toFixed(1)} MB`;
}

async function openCalculationPreview(sheetId,sheetName="",canDownload=currentCalculationPreviewCanDownload){
  const id=Number(sheetId);if(!Number.isSafeInteger(id)||id<=0)return;
  const overlay=$("calculationPreviewOverlay"),content=$("calculationPreviewContent"),tabs=$("calculationPreviewTabs");
  currentCalculationPreviewId=id;currentCalculationPreviewCanDownload=Boolean(canDownload);
  $("calculationPreviewDownload").classList.toggle("hidden",!currentCalculationPreviewCanDownload);
  content.innerHTML='<div class="workspace-loading">Opening calculation sheet…</div>';tabs.innerHTML="";$("calculationPreviewNote").textContent="";
  overlay.classList.remove("hidden");
  try{
    const suffix=sheetName?`?sheet=${encodeURIComponent(sheetName)}`:"";
    const response=await fetch(`/api/calculation-sheets/${id}/preview${suffix}`,{credentials:"same-origin",cache:"no-store",headers:{"X-ConnectChat-Request":"1"}});
    if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(data.error||"Preview failed.")}
    const type=response.headers.get("content-type")||"";
    if(type.includes("application/pdf")){
      if(calculationPreviewObjectUrl)URL.revokeObjectURL(calculationPreviewObjectUrl);
      calculationPreviewObjectUrl=URL.createObjectURL(await response.blob());
      $("calculationPreviewTitle").textContent="PDF calculation sheet";
      content.innerHTML=`<iframe class="calculation-pdf-preview" src="${calculationPreviewObjectUrl}" title="Calculation sheet PDF preview"></iframe>`;
      return;
    }
    const data=await response.json();
    $("calculationPreviewTitle").textContent=data.title||data.fileName||"Calculation sheet";
    $("calculationPreviewNote").textContent=data.note||"";
    tabs.innerHTML=(data.sheetNames||[]).map(name=>`<button type="button" class="${name===data.activeSheet?"active":""}" data-preview-sheet="${sectionEscape(name)}">${sectionEscape(name)}</button>`).join("");
    const maxColumns=Math.max(0,...(data.rows||[]).map(row=>row.length));
    content.innerHTML=data.rows?.length?`<div class="calculation-table-wrap"><table><tbody>${data.rows.map((row,rowIndex)=>`<tr>${Array.from({length:maxColumns},(_,columnIndex)=>`${rowIndex===0?"<th>":"<td>"}${sectionEscape(row[columnIndex]??"")}${rowIndex===0?"</th>":"</td>"}`).join("")}</tr>`).join("")}</tbody></table></div>${data.truncated?'<p class="preview-warning">Preview limited to 500 rows and 100 columns. Download the original file for the complete workbook.</p>':""}`:workspaceEmpty("📊","Empty worksheet","This worksheet does not contain saved display values.");
    tabs.querySelectorAll("[data-preview-sheet]").forEach(button=>button.onclick=()=>openCalculationPreview(id,button.dataset.previewSheet,currentCalculationPreviewCanDownload));
  }catch(error){content.innerHTML=workspaceEmpty("⚠️","Preview unavailable",error.message)}
}

function closeCalculationPreview(){
  $("calculationPreviewOverlay").classList.add("hidden");
  if(calculationPreviewObjectUrl){URL.revokeObjectURL(calculationPreviewObjectUrl);calculationPreviewObjectUrl=null}
  currentCalculationPreviewId=null;currentCalculationPreviewCanDownload=false;
}
if($("closeCalculationPreview"))$("closeCalculationPreview").onclick=closeCalculationPreview;
if($("calculationPreviewOverlay"))$("calculationPreviewOverlay").onclick=event=>{if(event.target===$("calculationPreviewOverlay"))closeCalculationPreview()};
if($("calculationPreviewDownload"))$("calculationPreviewDownload").onclick=async()=>{
  if(!currentCalculationPreviewId)return;
  try{await downloadApiFile(`/api/calculation-sheets/${currentCalculationPreviewId}/download`,{},"calculation-sheet")}
  catch(error){toast(error.message)}
};

async function renderCalculationSheetsWorkspace(){
  $("sectionContent").innerHTML='<div class="workspace-loading">Loading calculation sheets…</div>';
  try{
    const sheets=await api("/api/calculation-sheets");
    const shareableUsers=users.filter(user=>!user.isAI&&!user.isSelf&&!user.isGroup);
    const permissionControls=me.isAdmin?`
      <div class="calculation-permissions">
        <label>Who can preview?<select id="calculationAccessScope"><option value="all" selected>All approved users</option><option value="admins">Administrators only</option><option value="selected">Selected users</option></select></label>
        <div id="calculationSelectedUsers" class="calculation-selected-users hidden">${shareableUsers.map(user=>`<label><input type="checkbox" value="${Number(user.id)}"> ${sectionEscape(user.displayName||user.username)}</label>`).join("")||"<small>No other approved users are available.</small>"}</div>
      </div>`:"";
    $("sectionContent").innerHTML=`
      <div class="workspace-toolbar"><div><h2>Shared calculation sheets</h2><p>Approved users can preview results by double-clicking. Administrator originals remain download-protected.</p></div></div>
      <form id="calculationUploadForm" class="calculation-upload-card">
        <div><label>Sheet title<input id="calculationTitle" maxlength="120" placeholder="Example: FAHU cooling-load calculation" required></label><label>Description<input id="calculationDescription" maxlength="500" placeholder="Optional revision, project, or design note"></label></div>
        <div><label>Calculation file<input id="calculationFile" type="file" accept=".xlsx,.xls,.csv,.pdf" required></label><button id="calculationUploadBtn" class="primary" type="submit">Upload sheet</button></div>
        ${permissionControls}
        <small>XLSX, XLS, CSV, or PDF · maximum 12 MB</small><p id="calculationResult"></p>
      </form>
      ${sheets.length?`<div class="calculation-sheet-grid">${sheets.map(sheet=>`
        <article data-sheet-id="${sheet.id}">
          <div class="calculation-file-icon">${sheet.mimeType==="application/pdf"?"PDF":"XLS"}</div>
          <div><h3>${sectionEscape(sheet.title)}</h3><p>${sectionEscape(sheet.description||sheet.fileName)}</p><small>${sectionEscape(sheet.uploaderName)} · ${readableBytes(sheet.fileSize)} · ${sectionEscape(time(sheet.createdAt))} · ${sheet.accessScope==="admins"?"Administrators only":sheet.accessScope==="selected"?"Selected users":"All users"}</small></div>
          <div class="calculation-actions"><button type="button" data-sheet-open="${sheet.id}" data-can-download="${sheet.canDownload?"1":"0"}">Open</button>${sheet.canDownload?`<button type="button" data-sheet-download="${sheet.id}">Download</button>`:"<span class=\"preview-only-badge\">Preview only</span>"}${Number(sheet.uploaderId)===Number(me.id)||me.isAdmin?`<button type="button" class="danger-link" data-sheet-delete="${sheet.id}">Delete</button>`:""}</div>
        </article>`).join("")}</div>`:workspaceEmpty("📊","No calculation sheets","Upload the first calculation sheet for the team.")}`;
    $("calculationUploadForm").onsubmit=uploadCalculationSheet;
    if($("calculationAccessScope"))$("calculationAccessScope").onchange=()=>$("calculationSelectedUsers").classList.toggle("hidden",$("calculationAccessScope").value!=="selected");
    document.querySelectorAll("[data-sheet-open]").forEach(button=>button.onclick=()=>openCalculationPreview(button.dataset.sheetOpen,"",button.dataset.canDownload==="1"));
    document.querySelectorAll(".calculation-sheet-grid article").forEach(card=>card.ondblclick=event=>{if(!event.target.closest("button")){const open=card.querySelector("[data-sheet-open]");openCalculationPreview(card.dataset.sheetId,"",open?.dataset.canDownload==="1")}});
    document.querySelectorAll("[data-sheet-download]").forEach(button=>button.onclick=async()=>{
      try{button.disabled=true;await downloadApiFile(`/api/calculation-sheets/${button.dataset.sheetDownload}/download`,{}, "calculation-sheet");}
      catch(error){toast(error.message)}finally{button.disabled=false}
    });
    document.querySelectorAll("[data-sheet-delete]").forEach(button=>button.onclick=async()=>{
      if(!confirm("Permanently delete this shared calculation sheet?"))return;
      try{button.disabled=true;await api(`/api/calculation-sheets/${button.dataset.sheetDelete}`,{method:"DELETE"});toast("Calculation sheet deleted.");await renderCalculationSheetsWorkspace()}
      catch(error){button.disabled=false;toast(error.message)}
    });
  }catch(error){$("sectionContent").innerHTML=workspaceEmpty("⚠️","Calculation sheets unavailable",error.message)}
}

async function uploadCalculationSheet(event){
  event.preventDefault();
  const file=$("calculationFile").files?.[0];
  if(!file)return;
  const button=$("calculationUploadBtn"),result=$("calculationResult");
  try{
    button.disabled=true;button.textContent="Uploading…";result.textContent="";
    const form=new FormData();
    form.append("sheet",file);form.append("title",$("calculationTitle").value.trim());form.append("description",$("calculationDescription").value.trim());
    if(me.isAdmin){
      const scope=$("calculationAccessScope")?.value||"all";
      form.append("accessScope",scope);
      const selected=[...document.querySelectorAll("#calculationSelectedUsers input:checked")].map(input=>Number(input.value));
      form.append("allowedUserIds",JSON.stringify(selected));
    }
    await api("/api/calculation-sheets",{method:"POST",body:form});
    toast("Calculation sheet shared.");await renderCalculationSheetsWorkspace();
  }catch(error){result.textContent=error.message}
  finally{button.disabled=false;button.textContent="Upload sheet"}
}

async function renderCallsWorkspace(){
  $("sectionContent").innerHTML=`<div class="workspace-loading">Loading call history…</div>`;
  try{
    const calls=await api("/api/calls");
    const missedCount=(calls||[]).filter(c=>String(c.status).toLowerCase()==="missed"&&Number(c.receiver_id)===Number(me.id)).length;
    const history=calls.length?`<div class="workspace-list call-history-list">${calls.map(c=>{
      const incoming=Number(c.receiver_id)===Number(me.id);
      const missed=String(c.status).toLowerCase()==="missed"&&incoming;
      const other=Number(c.caller_id)===Number(me.id)?c.receiver:c.caller;
      const type=c.mode==="video"?"Video":"Voice";
      const status=missed?`Missed ${type.toLowerCase()} call`:String(c.status||"Call");
      return `<article class="call-history-item${missed?" missed-call-item":""}"><div class="workspace-list-icon call-symbol">${c.mode==="video"?VIDEO_ICON_SVG:PHONE_ICON_SVG}</div><div><h3>${sectionEscape(other?.username||"User")}</h3><p class="call-history-status">${sectionEscape(status)} · ${sectionEscape(time(c.started_at))}</p></div></article>`
    }).join("")}</div>`:workspaceEmpty(PHONE_ICON_SVG,"No calls yet","Voice and video calls will appear here.");
    $("sectionContent").innerHTML=`<div class="workspace-toolbar"><div><h2>Calls${missedCount?` <span class="missed-call-heading-count">${missedCount} missed</span>`:""}</h2><p>Call history and quick calling with approved contacts.</p></div>${calls.length?'<button id="clearCallHistoryBtn" type="button" class="danger-link">🗑 Clear call history</button>':""}</div>${renderPeopleCards("Call","call")}<h2 class="workspace-subtitle">Recent call history</h2>${history}`;
    bindWorkspaceUserActions();
    await refreshCallsBadge();
    if($("clearCallHistoryBtn"))$("clearCallHistoryBtn").onclick=async()=>{
      if(!confirm("Clear your complete call history? This cannot be undone."))return;
      const button=$("clearCallHistoryBtn");
      try{
        button.disabled=true;button.textContent="Clearing…";
        const result=await api("/api/calls",{method:"DELETE"});
        toast(`${Number(result.deleted||0)} call record${Number(result.deleted||0)===1?"":"s"} cleared.`);
        await renderCallsWorkspace();
      }catch(error){
        button.disabled=false;button.textContent="🗑 Clear call history";toast(error.message);
      }
    };
  }catch(error){$("sectionContent").innerHTML=workspaceEmpty("⚠️","Calls unavailable",error.message)}
}

function renderSettingsWorkspace(){
  const appearance=loadAppearance();
  $("sectionContent").innerHTML=`
    <div class="settings-workspace-grid settings-whatsapp">
      <section class="settings-mobile-identity">
        <button id="settingsProfileBtn" type="button" class="settings-identity-button">
          <span class="settings-profile-avatar">${avatarHtml(me,initials(me.username))}</span>
          <span><b>${sectionEscape(me.displayName||me.username)}</b><small>@${sectionEscape(me.username)}</small><em>${me.isAdmin?"Administrator":"Workspace member"}</em></span>
          <i>›</i>
        </button>
      </section>
      <section class="settings-mobile-card">
        <button id="settingsStatusBtn" type="button" class="settings-mobile-row"><span>💬</span><span><b>Status</b><small>View or post an update</small></span><i>›</i></button>
        <button id="settingsNotificationsBtn" type="button" class="settings-mobile-row"><span>🔔</span><span><b>Message notifications</b><small id="settingsNotificationStatus">${sectionEscape(notificationPermissionText())}</small></span><i>›</i></button>
        <button id="settingsSignInBtn" type="button" class="settings-mobile-row"><span>📱</span><span><b>Sign-in options</b><small>Add an email address or phone number</small></span><i>›</i></button>
        <button id="settingsRecoveryBtn" type="button" class="settings-mobile-row"><span>🔑</span><span><b>Account recovery</b><small>Show your recovery code</small></span><i>›</i></button>
        <button id="settingsAppearanceBtn" type="button" class="settings-mobile-row"><span>🎨</span><span><b>Appearance</b><small>Layout, text, icons and message controls</small></span><i>›</i></button>
      </section>
      <section id="settingsSignInPanel" class="settings-signin-panel hidden">
        <h2>Email or phone sign-in</h2>
        <p>Add either option now. Your existing username and password will continue working.</p>
        <form id="settingsSignInForm">
          <label>Email address<input id="settingsEmail" type="email" maxlength="254" autocomplete="email" placeholder="name@example.com" value="${sectionEscape(me.email||"")}"></label>
          <label>Phone with country code<input id="settingsPhone" type="tel" maxlength="20" autocomplete="tel" inputmode="tel" placeholder="+971501234567" value="${sectionEscape(me.phone||"")}"></label>
          <button id="settingsSaveSignIn" type="submit" class="primary">Save sign-in options</button>
          <small id="settingsSignInResult">${me.signInOptionsMigrationRequired?"Run the included Supabase migration before saving.":""}</small>
        </form>
      </section>
      <section class="appearance-settings"><h2>My page appearance</h2><p>These settings belong to your account on this device.</p>
        <label>Layout density<select id="appearanceDensity"><option value="compact">Compact</option><option value="comfortable">Comfortable</option></select></label>
        <label>Text size<select id="appearanceText"><option value="small">Small</option><option value="standard">Standard</option><option value="large">Large</option></select></label>
        <label>Icon size<select id="appearanceIcons"><option value="compact">Compact</option><option value="standard">Standard</option></select></label>
        <label>Conversation sidebar<select id="appearanceSidebar"><option value="narrow">Narrow</option><option value="standard">Standard</option></select></label>
        <label>Overview panel<select id="appearanceInsights"><option value="show">Show</option><option value="hide">Hide</option></select></label>
        <label>Message-bar icons<select id="appearanceComposer"><option value="essential">Hide extra icons</option><option value="all">Show all icons</option></select></label>
        <label>Profile-photo display<select id="appearanceAvatarFit"><option value="cover">Crop to fill</option><option value="contain">Fit full photo</option></select></label>
        <div class="settings-button-row"><button id="settingsThemeBtn">Toggle theme</button><button id="settingsAccentBtn">Change accent</button><button id="appearanceResetBtn">Reset layout</button></div>
      </section>
      <section class="settings-mobile-card settings-account-card">
        <button id="settingsSwitchBtn" type="button" class="settings-mobile-row"><span>💻</span><span><b>Switch account</b><small>Use a different account</small></span><i>›</i></button>
        ${me.isAdmin?`<button id="settingsAdminBtn" type="button" class="settings-mobile-row"><span>👥</span><span><b>Administration</b><small>Approve and manage users</small></span><i>›</i></button>`:""}
        <button id="settingsDeleteAccountBtn" type="button" class="settings-mobile-row settings-logout-row"><span>🗑</span><span><b>Delete my account</b><small>Permanently remove this account and its data</small></span><i>›</i></button>
        <button id="settingsLogoutBtn" type="button" class="settings-mobile-row settings-logout-row"><span>↪</span><span><b>Logout</b><small>Sign out of ConnectChat</small></span><i>›</i></button>
      </section>
      <section class="license-information-card">
        <div class="license-information-head"><span>🛡️</span><div><h2>Licence information</h2><p>ConnectChat Pro v6.7.3</p></div></div>
        <dl>
          <div><dt>Edition</dt><dd>Trial Version</dd></div>
          <div><dt>Licensor</dt><dd>Aboassad</dd></div>
          <div><dt>Status</dt><dd class="license-active">Active for evaluation</dd></div>
        </dl>
        <small>All Rights Reserved © 2026</small>
      </section>
    </div>`;
  $("settingsProfileBtn").onclick=()=>openProfilePage(me);
  $("settingsNotificationsBtn").onclick=requestMessageNotifications;
  $("settingsSignInBtn").onclick=()=>{
    $("settingsSignInPanel").classList.toggle("hidden");
    if(!$("settingsSignInPanel").classList.contains("hidden"))$("settingsSignInPanel").scrollIntoView({block:"center"});
  };
  $("settingsSignInForm").onsubmit=async event=>{
    event.preventDefault();
    const button=$("settingsSaveSignIn"),result=$("settingsSignInResult");
    try{
      button.disabled=true;button.textContent="Saving…";result.textContent="";
      const data=await api("/api/account/sign-in-options",{method:"PATCH",body:JSON.stringify({email:$("settingsEmail").value,phone:$("settingsPhone").value})});
      me.email=data.email;me.phone=data.phone;me.signInOptionsMigrationRequired=false;
      result.textContent="Saved. You can now log in using your username, email or phone.";
    }catch(error){result.textContent=error.message}
    finally{button.disabled=false;button.textContent="Save sign-in options"}
  };
  $("settingsAppearanceBtn").onclick=()=>$("appearanceDensity")?.closest(".appearance-settings")?.scrollIntoView({block:"start"});
  $("settingsThemeBtn").onclick=()=>$("themeBtn")?.click();
  $("settingsAccentBtn").onclick=()=>$("accentBtn")?.click();
  const controls={appearanceDensity:"density",appearanceText:"text",appearanceIcons:"icons",appearanceSidebar:"sidebar",appearanceInsights:"insights",appearanceComposer:"composer",appearanceAvatarFit:"avatarFit"};
  Object.entries(controls).forEach(([id,key])=>{
    $(id).value=appearance[key];
    $(id).onchange=()=>{const next=loadAppearance();next[key]=$(id).value;saveAppearance(next)};
  });
  $("appearanceResetBtn").onclick=()=>{saveAppearance({...DEFAULT_APPEARANCE});renderSettingsWorkspace();toast("Your page layout was reset.")};
  $("settingsStatusBtn").onclick=()=>$("statusBtn").click();
  $("settingsRecoveryBtn").onclick=()=>$("recoveryBtn").click();
  $("settingsSwitchBtn").onclick=logoutAndReturn;
  $("settingsDeleteAccountBtn").onclick=async()=>{
    const password=prompt("Enter your password to delete your ConnectChat account:");
    if(password===null)return;
    if(!password)return toast("Your password is required.");
    if(!confirm("Permanently delete your ConnectChat account, messages and stored files? This cannot be undone."))return;
    try{
      $("settingsDeleteAccountBtn").disabled=true;
      await api("/api/account",{method:"DELETE",body:JSON.stringify({password,confirm:"DELETE MY ACCOUNT"})});
      alert("Your ConnectChat account was deleted.");
      location.reload();
    }catch(error){
      $("settingsDeleteAccountBtn").disabled=false;toast(error.message);
    }
  };
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
  currentWorkspaceSection=section;
  if(usersRenderFrame){cancelAnimationFrame(usersRenderFrame);usersRenderFrame=0}
  $("sectionPage").dataset.section=section;
  if(section==="settings"){
    $("workspaceHeading").textContent="Settings";
    $("sectionTitle").textContent="Settings";
    $("sectionDescription").textContent="Profile, appearance, privacy, account and administration.";
    setMainWorkspaceVisible(false);
    // Change to the Settings screen before constructing its controls. This
    // gives mobile browsers an immediate visual response instead of leaving
    // the previous chat visible while the settings DOM is being created.
    $("sectionContent").innerHTML=`<div class="workspace-loading">Opening Settings…</div>`;
    await new Promise(resolve=>requestAnimationFrame(resolve));
    if(currentWorkspaceSection==="settings")renderSettingsWorkspace();
    return;
  }
  setMainWorkspaceVisible(false);
  const titles={
    ai:["AI Assistant","Ask questions, translate text and work with documents."],
    groups:["Groups","Multi-user private conversations."],
    channels:["Channels","Organized project and announcement spaces."],
    files:["Files","All attachments shared in your conversations."],
    calculations:["Calculation Sheets","Preview shared engineering results; administrator originals are download-protected."],
    calls:["Calls","Voice and video calling workspace."],
    settings:["Settings","Profile, appearance, privacy, account and administration."]
  };
  const [title,description]=titles[section]||["Workspace",""];
  $("workspaceHeading").textContent=title;
  $("sectionTitle").textContent=title;
  $("sectionDescription").textContent=description;
  $("sectionContent").innerHTML=`<div class="workspace-loading">Opening ${sectionEscape(title)}…</div>`;
  // Let the browser paint the selected tab and loading state immediately.
  // This keeps mobile navigation responsive while a workspace requests data.
  await new Promise(resolve=>requestAnimationFrame(resolve));
  if(currentWorkspaceSection!==section)return;
  if(section==="ai")renderAIWorkspace();
  if(section==="groups")await renderGroupsWorkspace();
  if(section==="channels")await renderChannelsWorkspace();
  if(section==="files")await renderFilesWorkspace();
  if(section==="calculations")await renderCalculationSheetsWorkspace();
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
