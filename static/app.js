(() => {
  const ICE_SERVERS = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ];

  const loginScreen = document.getElementById("login-screen");
  const appScreen = document.getElementById("app-screen");
  const nameInput = document.getElementById("name-input");
  const serverPicker = document.getElementById("server-picker");
  const serverRail = document.getElementById("server-rail");
  const passwordInput = document.getElementById("password-input");
  const loginError = document.getElementById("login-error");
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
  const soundsBtn = document.getElementById("sounds-btn");
  const soundboardPanel = document.getElementById("soundboard-panel");
  const volumeBtn = document.getElementById("volume-btn");
  const volumePanel = document.getElementById("volume-panel");
  const callVolumeSlider = document.getElementById("call-volume-slider");
  const callVolumeValue = document.getElementById("call-volume-value");
  const leaveBtn = document.getElementById("leave-btn");

  const SERVERS = [
    { id: "geral", name: "Geral" },
    { id: "resenhas", name: "RESENHAS" },
    { id: "vava", name: "VAVA" },
  ];

  function serverInitials(name) {
    return name.trim().slice(0, 2).toUpperCase();
  }

  let socket = null;
  let localStream = null;
  let screenStream = null;
  let myName = "";
  let myRoom = "";
  let myPassword = "";
  let selectedServer = SERVERS[0].id;
  let mySid = null;
  let micOn = true;
  let camOn = false;
  let sharingScreen = false;
  let callVolume = Number(localStorage.getItem("voxchat-call-volume") ?? 1);

  const peers = {}; // sid -> RTCPeerConnection
  const remoteNames = {}; // sid -> name
  const remoteStatus = {}; // sid -> { muted, camera_off }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function initials(name) {
    return (name || "?").trim().slice(0, 2).toUpperCase();
  }

  const MIC_MUTED_ICON =
    '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 .32 1.36" fill="currentColor"/>' +
    '<path d="M19 11a7 7 0 0 1-14 0M12 18v3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
    '<path d="M3 3l18 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
    "</svg>";

  const CAM_ON_ICON =
    '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<rect x="2" y="6" width="14" height="12" rx="2" fill="currentColor"/>' +
    '<path d="M16 10.5 21.4 7a1 1 0 0 1 1.6.8v8.4a1 1 0 0 1-1.6.8L16 13.5v-3Z" fill="currentColor"/>' +
    "</svg>";

  // ---- Soundboard: sons de meme gerados na hora via Web Audio API. Tocam só
  // no alto-falante local de cada um (não entram no áudio da chamada em si),
  // sincronizados entre a sala via um evento simples pelo socket.

  let audioCtx = null;
  function getAudioCtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
  }

  function tone(ctx, { freq, start, dur, type = "sine", gain = 0.25, endFreq, ramp = "exponential" }) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (endFreq) {
      if (ramp === "linear") osc.frequency.linearRampToValueAtTime(endFreq, start + dur);
      else osc.frequency.exponentialRampToValueAtTime(Math.max(endFreq, 1), start + dur);
    }
    g.gain.setValueAtTime(gain, start);
    g.gain.exponentialRampToValueAtTime(0.001, start + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + dur + 0.02);
  }

  function noiseBurst(ctx, { start, dur, gain = 0.25, filterFreq = 2000 }) {
    const bufferSize = Math.ceil(ctx.sampleRate * dur);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = filterFreq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, start);
    g.gain.exponentialRampToValueAtTime(0.001, start + dur);

    src.connect(filter).connect(g).connect(ctx.destination);
    src.start(start);
    src.stop(start + dur + 0.02);
  }

  function playFileSound(src) {
    new Audio(src).play().catch((e) => console.warn("Não deu pra tocar o áudio", e));
  }

  const SOUNDS = {
    airhorn: {
      label: "📯 Buzina",
      play() {
        const ctx = getAudioCtx();
        const now = ctx.currentTime;
        for (let i = 0; i < 3; i++) {
          tone(ctx, { freq: 320, start: now + i * 0.32, dur: 0.3, type: "sawtooth", gain: 0.28 });
        }
      },
    },
    applause: {
      label: "👏 Aplausos",
      play() {
        const ctx = getAudioCtx();
        const now = ctx.currentTime;
        for (let i = 0; i < 18; i++) {
          noiseBurst(ctx, {
            start: now + i * 0.07 + Math.random() * 0.02,
            dur: 0.1,
            gain: 0.15,
            filterFreq: 2500 + Math.random() * 2000,
          });
        }
      },
    },
    buzzer: {
      label: "❌ Errou",
      play() {
        const ctx = getAudioCtx();
        const now = ctx.currentTime;
        tone(ctx, { freq: 180, endFreq: 60, start: now, dur: 0.55, type: "sawtooth", gain: 0.3, ramp: "linear" });
      },
    },
    tada: {
      label: "🎉 Vitória",
      play() {
        const ctx = getAudioCtx();
        const now = ctx.currentTime;
        [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
          tone(ctx, { freq, start: now + i * 0.11, dur: 0.35, type: "triangle", gain: 0.22 });
        });
      },
    },
    rimshot: {
      label: "🥁 Rufar",
      play() {
        const ctx = getAudioCtx();
        const now = ctx.currentTime;
        [0, 0.18, 0.36].forEach((t, i) => {
          tone(ctx, { freq: 200, start: now + t, dur: 0.08, type: "triangle", gain: 0.25 });
          noiseBurst(ctx, { start: now + t, dur: 0.06, gain: 0.2, filterFreq: 4000 });
        });
        noiseBurst(ctx, { start: now + 0.55, dur: 0.4, gain: 0.28, filterFreq: 5000 });
      },
    },
    trombone: {
      label: "😂 Womp Womp",
      play() {
        const ctx = getAudioCtx();
        const now = ctx.currentTime;
        [0, 0.45, 0.9].forEach((t, i) => {
          tone(ctx, {
            freq: 300 - i * 20,
            endFreq: 180 - i * 20,
            start: now + t,
            dur: 0.4,
            type: "sawtooth",
            gain: 0.22,
            ramp: "linear",
          });
        });
      },
    },
    custom1: {
      label: "🔥 Zoeira",
      src: "/static/sounds/custom1.m4a",
      play() {
        playFileSound(this.src);
      },
    },
    custom2: {
      label: "🔥 Zoeira 2",
      src: "/static/sounds/custom2.mp3",
      play() {
        playFileSound(this.src);
      },
    },
    custom3: {
      label: "🔥 Zoeira 3",
      src: "/static/sounds/custom3.mp3",
      play() {
        playFileSound(this.src);
      },
    },
    custom4: {
      label: "🔥 Zoeira 4",
      src: "/static/sounds/custom4.mp3",
      play() {
        playFileSound(this.src);
      },
    },
    custom5: {
      label: "🔥 Zoeira 5",
      src: "/static/sounds/custom5.m4a",
      play() {
        playFileSound(this.src);
      },
    },
    custom6: {
      label: "🔥 Zoeira 6",
      src: "/static/sounds/custom6.ogg",
      play() {
        playFileSound(this.src);
      },
    },
    custom7: {
      label: "🔥 Zoeira 7",
      src: "/static/sounds/custom7.mp3",
      play() {
        playFileSound(this.src);
      },
    },
  };

  function playSound(key) {
    if (SOUNDS[key]) SOUNDS[key].play();
  }

  function buildSoundboard() {
    soundboardPanel.innerHTML = "";
    Object.entries(SOUNDS).forEach(([key, { label }]) => {
      const btn = document.createElement("button");
      btn.textContent = label;
      btn.addEventListener("click", () => {
        playSound(key);
        if (socket) socket.emit("play-sound", { room: myRoom, sound: key });
      });
      soundboardPanel.appendChild(btn);
    });
  }
  buildSoundboard();

  soundsBtn.addEventListener("click", () => {
    soundboardPanel.classList.toggle("hidden");
    volumePanel.classList.add("hidden");
  });

  callVolumeSlider.value = Math.round(callVolume * 100);
  callVolumeValue.textContent = callVolumeSlider.value + "%";

  volumeBtn.addEventListener("click", () => {
    volumePanel.classList.toggle("hidden");
    soundboardPanel.classList.add("hidden");
  });

  callVolumeSlider.addEventListener("input", () => {
    callVolume = Number(callVolumeSlider.value) / 100;
    callVolumeValue.textContent = callVolumeSlider.value + "%";
    localStorage.setItem("voxchat-call-volume", callVolume);
    applyCallVolume();
  });

  function buildServerPicker() {
    serverPicker.innerHTML = "";
    SERVERS.forEach((server) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "server-option" + (server.id === selectedServer ? " selected" : "");
      btn.innerHTML = `<span class="server-dot">${serverInitials(server.name)}</span><span>${escapeHtml(server.name)}</span>`;
      btn.addEventListener("click", () => {
        selectedServer = server.id;
        [...serverPicker.children].forEach((el) => el.classList.remove("selected"));
        btn.classList.add("selected");
      });
      serverPicker.appendChild(btn);
    });
  }
  buildServerPicker();

  function buildServerRail() {
    serverRail.innerHTML = "";
    SERVERS.forEach((server) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "server-icon" + (server.id === myRoom ? " active" : "");
      btn.title = server.name;
      btn.textContent = serverInitials(server.name);
      btn.addEventListener("click", () => switchServer(server.id));
      serverRail.appendChild(btn);
    });
  }

  function switchServer(newRoom) {
    if (!socket || newRoom === myRoom) return;

    socket.emit("leave-room", { room: myRoom });

    Object.keys(peers).forEach(closePeer);
    videoGrid.innerHTML = "";
    chatMessages.innerHTML = "";
    memberList.innerHTML = "";
    memberCount.textContent = "0";
    Object.keys(remoteStatus).forEach((k) => delete remoteStatus[k]);
    Object.keys(remoteNames).forEach((k) => delete remoteNames[k]);

    myRoom = newRoom;

    const attempt = () => socket.emit("join-room", { name: myName, room: myRoom, password: myPassword });
    if (socket.connected) attempt();
    else socket.once("connect", attempt);
  }

  async function ensureLocalStream() {
    if (localStream) return localStream;

    // Pedimos áudio + vídeo já na entrada (mesmo que a câmera comece desligada)
    // para que a track de vídeo já exista na conexão WebRTC desde o início.
    // Ligar a câmera depois é só reativar essa track — sem isso, o outro lado
    // nunca recebe o vídeo porque a conexão não é renegociada automaticamente.
    const audioConstraints = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    };

    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints, video: true });
      localStream.getVideoTracks().forEach((t) => (t.enabled = false));
      return localStream;
    } catch (err) {
      console.warn("Sem câmera, tentando entrar só com áudio.", err);
      camBtn.disabled = true;
    }

    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints, video: false });
    } catch (err) {
      console.warn("Sem acesso a microfone, entrando somente com chat de texto.", err);
      localStream = null;
      micBtn.disabled = true;
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
    if (stream) video.srcObject = stream;
    if (!isLocal) video.volume = callVolume;
    updateTileVisibility(sid, isLocal);
    return tile;
  }

  function applyCallVolume() {
    videoGrid.querySelectorAll("video:not([muted])").forEach((v) => {
      v.volume = callVolume;
    });
  }

  // Track recebida via WebRTC não reflete se o outro lado desligou a câmera
  // (o "enabled" do MediaStreamTrack remoto é local e sempre fica true), então
  // usamos o status que o servidor propaga (evento room-users) como fonte da
  // verdade para decidir se mostramos o vídeo ou o avatar de espaço reservado.
  function updateTileVisibility(sid, isLocal = sid === mySid) {
    const tile = document.getElementById("tile-" + sid);
    if (!tile) return;
    const video = tile.querySelector("video");
    const placeholder = tile.querySelector(".placeholder-avatar");
    const cameraOff = isLocal ? (sharingScreen ? false : !camOn) : (remoteStatus[sid]?.camera_off ?? true);
    const hasVideo = video.srcObject && video.srcObject.getVideoTracks().length > 0;
    const showVideo = hasVideo && !cameraOff;
    video.style.display = showVideo ? "block" : "none";
    placeholder.style.display = showVideo ? "none" : "flex";
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
      if (u.sid !== mySid) {
        remoteStatus[u.sid] = { muted: u.muted, camera_off: u.camera_off };
      }
      const li = document.createElement("li");
      const isMe = u.sid === mySid;
      li.innerHTML = `
        <div class="avatar">${initials(u.name)}</div>
        <span class="member-name">${escapeHtml(u.name)}${isMe ? " (você)" : ""}</span>
        <span class="member-status">${u.muted ? MIC_MUTED_ICON : ""}${!u.camera_off ? CAM_ON_ICON : ""}</span>
      `;
      memberList.appendChild(li);
      updateTileVisibility(u.sid, isMe);
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

  function initSocket() {
    if (socket) return socket;
    socket = io();

    socket.on("connect", () => {
      mySid = socket.id;
    });

    socket.on("join-error", ({ message }) => {
      loginError.textContent = message || "Não foi possível entrar na sala.";
      loginError.classList.remove("hidden");
      joinBtn.disabled = false;
    });

    socket.on("joined", async ({ users }) => {
      await ensureLocalStream();

      loginScreen.classList.add("hidden");
      appScreen.classList.remove("hidden");
      const server = SERVERS.find((s) => s.id === myRoom);
      roomNameLabel.textContent = "# " + (server ? server.name : myRoom);
      joinBtn.disabled = false;
      buildServerRail();

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

    socket.on("play-sound", ({ sound }) => playSound(sound));

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

    return socket;
  }

  function joinRoom() {
    myName = nameInput.value.trim() || "Anônimo";
    myRoom = selectedServer;
    myPassword = passwordInput.value;

    loginError.classList.add("hidden");
    joinBtn.disabled = true;

    initSocket();

    const attempt = () => socket.emit("join-room", { name: myName, room: myRoom, password: myPassword });
    if (socket.connected) attempt();
    else socket.once("connect", attempt);
  }

  joinBtn.addEventListener("click", joinRoom);
  [nameInput, passwordInput].forEach((el) =>
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

    let videoTrack = localStream.getVideoTracks()[0];

    // Câmera não foi concedida na entrada (usuário negou ou não tinha):
    // pede agora e, como a conexão já está de pé, precisa renegociar com
    // cada peer manualmente pra eles passarem a receber essa track nova.
    if (!videoTrack) {
      try {
        const camStream = await navigator.mediaDevices.getUserMedia({ video: true });
        videoTrack = camStream.getVideoTracks()[0];
        localStream.addTrack(videoTrack);

        for (const [sid, pc] of Object.entries(peers)) {
          pc.addTrack(videoTrack, localStream);
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socket.emit("webrtc-offer", { to: sid, sdp: pc.localDescription });
        }
      } catch (err) {
        alert("Não foi possível acessar a câmera: " + err.message);
        return;
      }
    }

    camOn = !camOn;
    videoTrack.enabled = camOn;

    if (sharingScreen) {
      // enquanto compartilha tela, a câmera fica só "reservada" (não é o que
      // é enviado); replaceOutgoingTracks vai recolocá-la quando parar.
    } else {
      replaceOutgoingTracks(localStream);
    }

    updateTileVisibility(mySid, true);
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
