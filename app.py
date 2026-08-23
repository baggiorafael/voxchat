import os
import time
from flask import Flask, render_template, request
from flask_socketio import SocketIO, join_room, leave_room, emit

app = Flask(__name__)
app.config['SECRET_KEY'] = 'dev-secret-change-me'
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")

ROOM_PASSWORD = os.environ.get("ROOM_PASSWORD", "123456789")

# room_id -> { sid: {"name": str, "muted": bool, "camera_off": bool} }
rooms = {}


def room_user_list(room_id):
    return [
        {"sid": sid, **info}
        for sid, info in rooms.get(room_id, {}).items()
    ]


@app.route("/")
def index():
    return render_template("index.html")


@socketio.on("connect")
def on_connect():
    print(f"Client connected: {request.sid}")


@socketio.on("disconnect")
def on_disconnect():
    sid = request.sid
    for room_id, members in list(rooms.items()):
        if sid in members:
            name = members[sid].get("name", "Alguém")
            del members[sid]
            leave_room(room_id)
            emit("user-left", {"sid": sid, "name": name}, room=room_id)
            emit("room-users", room_user_list(room_id), room=room_id)
            if not members:
                del rooms[room_id]
    print(f"Client disconnected: {sid}")


@socketio.on("join-room")
def on_join_room(data):
    password = data.get("password") or ""
    if password != ROOM_PASSWORD:
        emit("join-error", {"message": "Senha incorreta."})
        return

    room_id = data.get("room", "geral").strip() or "geral"
    name = (data.get("name") or "Anônimo").strip()[:32]
    sid = request.sid

    join_room(room_id)
    rooms.setdefault(room_id, {})
    rooms[room_id][sid] = {"name": name, "muted": False, "camera_off": True}

    existing = [u for u in room_user_list(room_id) if u["sid"] != sid]

    emit("joined", {"sid": sid, "room": room_id, "users": existing})
    emit(
        "user-joined",
        {"sid": sid, "name": name},
        room=room_id,
        include_self=False,
    )
    emit("room-users", room_user_list(room_id), room=room_id)
    emit(
        "chat-message",
        {
            "sid": "system",
            "name": "Sistema",
            "text": f"{name} entrou na sala.",
            "system": True,
            "ts": time.time(),
        },
        room=room_id,
    )


@socketio.on("leave-room")
def on_leave_room(data):
    room_id = data.get("room")
    sid = request.sid
    members = rooms.get(room_id, {})
    if sid in members:
        name = members[sid].get("name", "Alguém")
        del members[sid]
        leave_room(room_id)
        emit("user-left", {"sid": sid, "name": name}, room=room_id)
        emit("room-users", room_user_list(room_id), room=room_id)
        if not members:
            del rooms[room_id]


@socketio.on("chat-message")
def on_chat_message(data):
    room_id = data.get("room")
    text = (data.get("text") or "").strip()[:1000]
    if not text or not room_id:
        return
    members = rooms.get(room_id, {})
    name = members.get(request.sid, {}).get("name", "Anônimo")
    emit(
        "chat-message",
        {"sid": request.sid, "name": name, "text": text, "system": False, "ts": time.time()},
        room=room_id,
    )


@socketio.on("update-status")
def on_update_status(data):
    room_id = data.get("room")
    members = rooms.get(room_id, {})
    sid = request.sid
    if sid not in members:
        return
    if "muted" in data:
        members[sid]["muted"] = bool(data["muted"])
    if "camera_off" in data:
        members[sid]["camera_off"] = bool(data["camera_off"])
    emit("room-users", room_user_list(room_id), room=room_id)


# ---- WebRTC signaling relay (mesh topology) ----

@socketio.on("webrtc-offer")
def on_webrtc_offer(data):
    emit(
        "webrtc-offer",
        {"sdp": data["sdp"], "from": request.sid},
        room=data["to"],
    )


@socketio.on("webrtc-answer")
def on_webrtc_answer(data):
    emit(
        "webrtc-answer",
        {"sdp": data["sdp"], "from": request.sid},
        room=data["to"],
    )


@socketio.on("webrtc-ice-candidate")
def on_webrtc_ice_candidate(data):
    emit(
        "webrtc-ice-candidate",
        {"candidate": data["candidate"], "from": request.sid},
        room=data["to"],
    )


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    debug = os.environ.get("FLASK_DEBUG", "0") == "1"
    print(f"Servidor rodando em http://0.0.0.0:{port}")
    socketio.run(app, host="0.0.0.0", port=port, debug=debug, allow_unsafe_werkzeug=True)
