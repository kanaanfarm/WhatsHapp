let authMode="login", me=null, users=[], activeUser=null, socket=null;
let typingTimer=null, deferredPrompt=null, mediaRecorder=null, audioChunks=[], isRecording=false;
let peer=null, localStream=null, callPeerId=null, callMode="video", pendingCall=null, iceConfig=null, pendingIce=[];
const $=id=>document.getElementById(id);

function toast(text){
  $("toast").textContent=text;$("toast").classList.remove("hidden");
  setTimeout(()=>$("toast").classList.add("hidden"),2200);
}
function setMode(mode){
  authMode=mode;
  $("loginTab").classList.toggle("active",mode==="login");
  $("registerTab").classList.toggle("active",mode==="register");
  $("authSubmit").textContent=mode==="login"?"Login":"Create account";
  $("authError").textContent="";
}
$("loginTab").onclick=()=>setMode("login");
$("registerTab").onclick=()=>setMode("register");

async function api(url,options={}){
  const res=await fetch(url,{...options,headers:options.body instanceof FormData?{}:{"Content-Type":"application/json",...(options.headers||{})}});
  const data=await res.json().catch(()=>({}));
  if(!res.ok)throw new Error(data.error||"Request failed");
  return data;
}

$("authSubmit").onclick=async()=>{
  try{
    $("authError").textContent="";
    me=await api(`/api/${authMode}`,{method:"POST",body:JSON.stringify({username:$("authUsername").value.trim(),password:$("authPassword").value})});
    await startApp();
  }catch(e){$("authError").textContent=e.message}
};
$("authPassword").onkeydown=e=>{if(e.key==="Enter")$("authSubmit").click()};

async function startApp(){
  $("authView").classList.add("hidden");$("appView").classList.remove("hidden");
  $("meName").textContent="@"+me.username;
  users=await api("/api/users");
  renderUsers();connectSocket();
  if(window.innerWidth<=760){$("chatPanel").classList.add("mobile-hidden")}
}

function connectSocket(){
  socket=io();
  socket.on("privateMessage",msg=>{
    const relevant=activeUser&&(msg.sender_id===activeUser.id||msg.receiver_id===activeUser.id);
    if(relevant)addMessage(msg);
    refreshUsers();
  });
  socket.on("presence",p=>{
    const u=users.find(x=>x.id===p.userId);
    if(u){u.online=p.online;renderUsers();updateHeader()}
  });
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
}
async function refreshUsers(){try{users=await api("/api/users");renderUsers()}catch{}}

function initials(name){return name.split(/\s+/).map(x=>x[0]).join("").slice(0,2).toUpperCase()}
function escapeHtml(v=""){return String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}
function time(v){return new Date(v.replace(" ","T")+"Z").toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}

function renderUsers(){
  const q=$("userSearch").value.toLowerCase();
  $("usersList").innerHTML="";
  users.filter(u=>u.username.toLowerCase().includes(q)).forEach(u=>{
    const d=document.createElement("div");
    d.className=`user-item ${activeUser&&activeUser.id===u.id?"active":""}`;
    d.innerHTML=`<div class="avatar">${initials(u.username)}</div><div class="user-info"><strong>${escapeHtml(u.username)}</strong><span>${escapeHtml(u.lastPreview||"Start a conversation")}</span></div><div class="dot ${u.online?"online":""}"></div>`;
    d.onclick=()=>selectUser(u);$("usersList").appendChild(d);
  });
}
$("userSearch").oninput=renderUsers;

async function selectUser(u){
  activeUser=u;renderUsers();updateHeader();
  $("messageInput").disabled=false;$("sendBtn").disabled=false;
  $("audioCallBtn").disabled=false;$("videoCallBtn").disabled=false;
  $("messages").classList.remove("empty-state");$("messages").innerHTML="";
  const history=await api(`/api/messages/${u.id}`);history.forEach(addMessage);
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
  $("endCallBtn").classList.toggle("hidden",incoming);
}

async function startCall(mode){
  if(!activeUser||peer)return;
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
  if(peer||pendingCall){socket.emit("call:reject",{receiverId:data.callerId});return}
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

function finishCall(message="Call ended",notify=true){
  if(notify&&callPeerId&&socket)socket.emit("call:end",{receiverId:callPeerId});
  if(peer){peer.onconnectionstatechange=null;peer.close();peer=null}
  if(localStream){localStream.getTracks().forEach(t=>t.stop());localStream=null}
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
$("cameraToggleBtn").onclick=()=>{
  const track=localStream?.getVideoTracks()[0];if(!track)return;
  track.enabled=!track.enabled;$("cameraToggleBtn").textContent=track.enabled?"📹 Camera":"🚫 Camera";
};
function updateHeader(){
  if(!activeUser)return;
  $("chatName").textContent=activeUser.username;
  $("chatStatus").textContent=activeUser.online?"Online":"Offline";
  $("activeAvatar").textContent=initials(activeUser.username);
}

function messageContent(msg){
  const caption=msg.body?`<div class="caption">${escapeHtml(msg.body)}</div>`:"";
  if(msg.kind==="image")return `<a href="${msg.file_url}" target="_blank"><img class="chat-image" src="${msg.file_url}" alt="Shared image"></a>${caption}`;
  if(msg.kind==="voice")return `<audio class="voice-note" controls preload="metadata" src="${msg.file_url}"></audio>${caption}`;
  if(msg.kind==="file")return `<a class="file-link" href="${msg.file_url}" target="_blank">📎 ${escapeHtml(msg.file_name||"Download file")}</a>${caption}`;
  return escapeHtml(msg.body||"");
}
function addMessage(msg){
  const own=msg.sender_id===me.id;
  const row=document.createElement("div");
  row.className=`msg ${own?"own":"other"}`;
  row.innerHTML=`<div class="meta">${own?"You":escapeHtml(msg.sender_name)} · ${time(msg.created_at)}</div><div class="bubble">${messageContent(msg)}</div>`;
  $("messages").appendChild(row);$("messages").scrollTop=$("messages").scrollHeight;
}

function send(){
  const body=$("messageInput").value.trim();
  if(!body||!activeUser)return;
  socket.emit("privateMessage",{receiverId:activeUser.id,body});
  $("messageInput").value="";updateComposer();
  socket.emit("typing",{receiverId:activeUser.id,isTyping:false});
}
$("sendBtn").onclick=send;
$("messageInput").onkeydown=e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send()}};
$("messageInput").oninput=()=>{
  updateComposer();
  if(!activeUser)return;
  socket.emit("typing",{receiverId:activeUser.id,isTyping:true});
  clearTimeout(typingTimer);typingTimer=setTimeout(()=>socket.emit("typing",{receiverId:activeUser.id,isTyping:false}),700);
};
function updateComposer(){$("messageInput").closest(".composer").classList.toggle("has-text",Boolean($("messageInput").value.trim()))}

async function uploadFile(file,kind){
  if(!activeUser)return toast("Select a user first.");
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
$("logoutBtn").onclick=async()=>{await api("/api/logout",{method:"POST"});location.reload()};

window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();deferredPrompt=e;$("installBtn").classList.remove("hidden")});
$("installBtn").onclick=async()=>{if(!deferredPrompt)return;deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null;$("installBtn").classList.add("hidden")};

if("serviceWorker" in navigator)navigator.serviceWorker.register("/sw.js").catch(()=>{});
(async()=>{try{me=await api("/api/me");await startApp()}catch{}})();
