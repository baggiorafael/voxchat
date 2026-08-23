# VoxChat

Chat de texto, voz, vídeo e compartilhamento de tela em tempo real (estilo Discord),
feito com Flask + Socket.IO (backend) e WebRTC puro (mídia peer-to-peer no navegador).

## Rodar localmente

```bash
pip install -r requirements.txt
python app.py
```

Abra `http://localhost:5000` no navegador. Abra em outra aba (ou peça para outra
pessoa na mesma rede acessar `http://SEU-IP-LOCAL:5000`) para testar com mais de
um usuário.

## Colocar online (grátis) — Render.com

1. Crie uma conta em https://render.com (pode usar login do GitHub).
2. Suba esta pasta para um repositório no GitHub.
3. No painel do Render: **New > Web Service**, conecte o repositório.
4. Configure:
   - **Build Command:** `pip install -r requirements.txt`
   - **Start Command:** `python app.py`
5. Clique em **Create Web Service**. Em alguns minutos o Render te dá uma URL
   pública tipo `https://voxchat.onrender.com` — é isso que você compartilha.

Alternativas equivalentes: Railway.app, Fly.io — todas suportam Python +
WebSockets nativamente e têm plano grátis.

## Limitações conhecidas (importante)

- **Mesh WebRTC**: cada participante se conecta diretamente aos outros. Funciona
  bem para chamadas pequenas (2–8 pessoas), mas não escala para centenas como o
  Discord real, que usa servidores de mídia dedicados (SFU).
- **TURN server**: por padrão só há servidores STUN públicos (Google). Em redes
  com NAT restritivo/firewall corporativo a chamada pode não conectar. Para
  resolver isso de vez, adicione um servidor TURN (ex: conta grátis em
  metered.ca ou Twilio) na lista `ICE_SERVERS` em `static/app.js`.
- **HTTPS obrigatório em produção**: navegadores só liberam câmera/microfone em
  `localhost` ou em páginas servidas via HTTPS. Render/Railway/Fly já servem
  com HTTPS automaticamente, então isso não é problema após o deploy.
