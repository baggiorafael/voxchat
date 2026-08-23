(() => {
  const ICE_SERVERS = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ];

  const loginScreen = document.getElementById("login-screen");
  const appScreen = document.getElementById("app-screen");
  const nameInput = document.getElementById("name-input");
  const roomInput = document.getElementById("room-input");
  const joinBtn = document.getElementById("join-btn");
  const roomNameLabel = document.getElementById("room-name-label");
  const memberList = document.getElementById("member-list");
  const memberCount = document.getElementById("member-count");
  const videoGrid = document.getElementById("video-grid");
  const chatMessages = document.getElementById("chat-messages");
  const chatForm = document.getElementById("chat-form");
  const chatInput = document.getElementById("chat-input");
  const micBtn = document.getElementById("mic-btn");
  const camBtn = document.getElementById("cam-btn");
  const screenBtn = document.getElementById("screen-btn");
  const leaveBtn = document.getElementById("leave-btn");

  let socket = null;
  let localStream = null;
  let screenStream = null;
  let myName = "";
  let myRoom = "";
  let mySid = null;
  let micOn = true;
  let camOn = false;
  let sharingScreen = false;

  const peers = {}; // sid -> RTCPeerConnection
  const remoteNames = {}; // sid -> name

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function initials(name) {
    return (name || "?").trim().slice(0, 2).toUpperCase();
  }

  async function ensureLocalStream() {
    if (localStream) return localStream;
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      localStream.getVideoTracks().forEach((t) => (t.enabled = false));
    } catch (err) {
      console.warn("Sem acesso a microfone, entrando somente com chat de texto.", err);
      localStream = null;
      micBtn.disabled = true;
      camBtn.disabled = true;
      micBtn.classList.remove("active");
      micBtn.classList.add("off");
    }
    return localStream;
  }

  function upsertVideoTile(sid, stream, name, isLocal = false) {
    let tile = document.getElementById("tile-" + sid);
    if (!tile) {
      tile = document.createElement("div");
      tile.className = "video-tile";
      tile.id = "tile-" + sid;
      tile.innerHTML = `
        <video autoplay playsinline ${isLocal ? "muted" : ""}></video>
        <div class="placeholder-avatar">${initials(name)}</div>
        <div class="name-tag"><span>${escapeHtml(name)}${isLocal ? " (você)" : ""}</span></div>
      `;
      videoGrid.appendChild(tile);
    }
    const video = tile.querySelector("video");
    const placeholder = tile.querySelector(".placeholder-avatar");
    if (stream && stream.getVideoTracks().some((t) => t.enabled)) {
      video.srcObject = stream;
      video.style.display = "block";
      placeholder.style.display = "none";
    } else {
      video.style.display = "none";
      placeholder.style.display = "flex";
    }
    return tile;
  }

  function removeVideoTile(sid) {
    const tile = document.getElementById("tile-" + sid);
    if (tile) tile.remove();
  }

  function addChatMessage({ name, text, system, ts }) {
    const el = document.createElement("div");
    el.className = "chat-msg" + (system ? " system" : "");
    const time = new Date((ts || Date.now() / 1000) * 1000).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    if (system) {
      el.textContent = text;
    } else {
      el.innerHTML = `<span class="author">${escapeHtml(name)}</span>${escapeHtml(text)}<span class="time">${time}</span>`;
    }
    chatMessages.appendChild(el);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function renderMemberList(users) {
    memberCount.textContent = users.length;
    memberList.innerHTML = "";
    users.forEach((u) => {
      const li = document.createElement("li");
      const isMe = u.sid === mySid;
      li.innerHTML = `
        <div class="avatar">${initials(u.name)}</div>
        <span class="member-name">${escapeHtml(u.name)}${isMe ? " (você)" : ""}</span>
        <span class="member-status">${u.muted ? "🔇" : ""}${!u.camera_off ? "📹" : ""}</span>
      `;
      memberList.appendChild(li);
    });
  }

  function createPeerConnection(remoteSid) {
    if (peers[remoteSid]) return peers[remoteSid];
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    peers[remoteSid] = pc;

    const streamToSend = sharingScreen ? screenStream : localStream;
    if (streamToSend) {
      streamToSend.getTracks().forEach((track) => pc.addTrack(track, streamToSend));
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit("webrtc-ice-candidate", { to: remoteSid, candidate: event.candidate });
      }
    };

    pc.ontrack = (event) => {
      const [stream] = event.streams;
      upsertVideoTile(remoteSid, stream, remoteNames[remoteSid] || "Usuário");
    };

    pc.onconnectionstatechange = () => {
      if (["failed", "closed", "disconnected"].includes(pc.connectionState)) {
        // leave cleanup handled elsewhere
      }
    };

    return pc;
  }

  async function callPeer(remoteSid) {
    const pc = createPeerConnection(remoteSid);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit("webrtc-offer", { to: remoteSid, sdp: pc.localDescription });
  }

  function closePeer(sid) {
    const pc = peers[sid];
    if (pc) {
      pc.close();
      delete peers[sid];
    }
    delete remoteNames[sid];
    removeVideoTile(sid);
  }

  function replaceOutgoingTracks(newStream) {
    Object.values(peers).forEach((pc) => {
      const senders = pc.getSenders();
      newStream.getTracks().forEach((track) => {
        const sender = senders.find((s) => s.track && s.track.kind === track.kind);
        if (sender) {
          sender.replaceTrack(track);
        } else {
          pc.addTrack(track, newStream);
        }
      });
    });
  }

  async function joinRoom() {
    myName = nameInput.value.trim() || "Anônimo";
    myRoom = roomInput.value.trim() || "geral";

    await ensureLocalStream();

    loginScreen.classList.add("hidden");
    appScreen.classList.remove("hidden");
    roomNameLabel.textContent = "# " + myRoom;

    socket = io();

    socket.on("connect", () => {
      mySid = socket.id;
      socket.emit("join-room", { name: myName, room: myRoom });
    });

    socket.on("joined", async ({ users }) => {
      upsertVideoTile(mySid, localStream, myName, true);
      for (const u of users) {
        remoteNames[u.sid] = u.name;
        await callPeer(u.sid);
      }
    });

    socket.on("user-joined", ({ sid, name }) => {
      remoteNames[sid] = name;
    });

    socket.on("user-left", ({ sid, name }) => {
      closePeer(sid);
      addChatMessage({ text: `${name} saiu da sala.`, system: true });
    });

    socket.on("room-users", (users) => renderMemberList(users));

    socket.on("chat-message", (msg) => addChatMessage(msg));

    socket.on("webrtc-offer", async ({ sdp, from }) => {
      const pc = createPeerConnection(from);
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit("webrtc-answer", { to: from, sdp: pc.localDescription });
    });

    socket.on("webrtc-answer", async ({ sdp, from }) => {
      const pc = peers[from];
      if (pc) await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    });

    socket.on("webrtc-ice-candidate", async ({ candidate, from }) => {
      const pc = peers[from];
      if (pc) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
          console.warn("Erro ao adicionar ICE candidate", e);
        }
      }
    });
  }

  joinBtn.addEventListener("click", joinRoom);
  [nameInput, roomInput].forEach((el) =>
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter") joinRoom();
    })
  );

  chatForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text) return;
    socket.emit("chat-message", { room: myRoom, text });
    chatInput.value = "";
  });

  micBtn.addEventListener("click", () => {
    if (!localStream) return;
    micOn = !micOn;
    localStream.getAudioTracks().forEach((t) => (t.enabled = micOn));
    micBtn.classList.toggle("active", micOn);
    micBtn.classList.toggle("off", !micOn);
    socket.emit("update-status", { room: myRoom, muted: !micOn });
  });

  camBtn.addEventListener("click", async () => {
    if (!localStream) return;
    camOn = !camOn;

    if (camOn) {
      try {
        const camStream = await navigator.mediaDevices.getUserMedia({ video: true });
        const camTrack = camStream.getVideoTracks()[0];
        const oldTrack = localStream.getVideoTracks()[0];
        if (oldTrack) {
          localStream.removeTrack(oldTrack);
          oldTrack.stop();
        }
        localStream.addTrack(camTrack);
      } catch (err) {
        alert("Não foi possível acessar a câmera: " + err.message);
        camOn = false;
        return;
      }
    } else {
      localStream.getVideoTracks().forEach((t) => (t.enabled = false));
    }

    if (!sharingScreen) replaceOutgoingTracks(localStream);
    upsertVideoTile(mySid, localStream, myName, true);
    camBtn.classList.toggle("active", camOn);
    camBtn.classList.toggle("off", !camOn);
    socket.emit("update-status", { room: myRoom, camera_off: !camOn });
  });

  screenBtn.addEventListener("click", async () => {
    if (!sharingScreen) {
      try {
        screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      } catch (err) {
        return; // user cancelled
      }
      sharingScreen = true;
      screenBtn.classList.add("active");
      replaceOutgoingTracks(screenStream);
      upsertVideoTile(mySid, screenStream, myName, true);

      screenStream.getVideoTracks()[0].addEventListener("ended", stopScreenShare);
    } else {
      stopScreenShare();
    }
  });

  function stopScreenShare() {
    if (screenStream) {
      screenStream.getTracks().forEach((t) => t.stop());
      screenStream = null;
    }
    sharingScreen = false;
    screenBtn.classList.remove("active");
    replaceOutgoingTracks(localStream);
    upsertVideoTile(mySid, localStream, myName, true);
  }

  leaveBtn.addEventListener("click", () => {
    if (confirm("Deseja sair da sala?")) {
      window.location.reload();
    }
  });

  window.addEventListener("beforeunload", () => {
    if (socket) socket.emit("leave-room", { room: myRoom });
  });
})();
