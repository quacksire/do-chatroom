import { ChatRoom } from "./ChatRoom";

export { ChatRoom };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/room/")) {
      // Expecting /api/room/:roomId/websocket
      const parts = url.pathname.split("/");
      const roomId = parts[3];
      const action = parts[4];

      if (!roomId || action !== "websocket") {
        return new Response("Invalid URL", { status: 400 });
      }

      const id = env.CHAT_ROOM.idFromName(roomId);
      const stub = env.CHAT_ROOM.get(id);

      // Forward the request to the Durable Object
      // We need to rewrite the URL to match what the DO expects
      const newUrl = new URL(request.url);
      newUrl.pathname = "/websocket";

      return stub.fetch(new Request(newUrl.toString(), request));
    }

    // Serve static frontend
    return new Response(html, {
      headers: { "Content-Type": "text/html" },
    });
  },
};

interface Env {
  CHAT_ROOM: DurableObjectNamespace;
}

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Chat</title>
  <style>
    * { box-sizing: border-box; }
    body { 
      font-family: system-ui, -apple-system, sans-serif; 
      margin: 0; 
      padding: 0; 
      height: 100vh; 
      display: flex; 
      flex-direction: column; 
      background-color: #fff;
    }
    #chat { 
      flex-grow: 1; 
      overflow-y: auto; 
      padding: 10px; 
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    #message-form { 
      display: flex; 
      gap: 8px; 
      padding: 10px; 
      border-top: 1px solid #eee; 
      background: #fff;
    }
    #message-input { 
      flex-grow: 1; 
      padding: 8px 12px; 
      border: 1px solid #ddd; 
      border-radius: 20px; 
      outline: none;
      font-size: 14px;
    }
    #message-input:focus {
      border-color: #007aff;
    }
    button { 
      padding: 8px 16px; 
      background-color: #007aff; 
      color: white; 
      border: none; 
      border-radius: 20px; 
      cursor: pointer; 
      font-weight: 500;
      font-size: 14px;
    }
    button:hover { background-color: #0056b3; }
    button:disabled { background-color: #ccc; cursor: default; }
    
    .message-container {
      display: flex;
      flex-direction: column;
      max-width: 80%;
    }
    .my-message-container {
      align-self: flex-end;
      align-items: flex-end;
    }
    .other-message-container {
      align-self: flex-start;
      align-items: flex-start;
    }
    .username {
      font-size: 11px;
      color: #888;
      margin-bottom: 2px;
      margin-left: 4px;
      margin-right: 4px;
    }
    .message { 
      padding: 8px 12px; 
      border-radius: 16px; 
      font-size: 14px; 
      line-height: 1.4;
      word-wrap: break-word;
    }
    .my-message { 
      background-color: #007aff; 
      color: white; 
      border-bottom-right-radius: 4px;
    }
    .other-message { 
      background-color: #f0f0f0; 
      color: black; 
      border-bottom-left-radius: 4px;
    }
    .system-message { 
      align-self: center; 
      color: #888; 
      font-size: 12px; 
      font-style: italic; 
      margin: 4px 0;
      background: none;
      padding: 0;
    }
    #user-count {
      position: absolute;
      top: 10px;
      right: 10px;
      font-size: 12px;
      color: #888;
      background: rgba(255, 255, 255, 0.8);
      padding: 4px 8px;
      border-radius: 12px;
      border: 1px solid #eee;
    }
  </style>
</head>
<body>
  <div id="user-count">0 users chatting</div>
  <div id="chat"></div>
  <form id="message-form">
    <input type="text" id="message-input" placeholder="Type a message... (/nick to change name)" autocomplete="off">
    <button type="submit">Send</button>
  </form>

  <script>
    const roomId = "default-room";
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = \`\${protocol}//\${window.location.host}/api/room/\${roomId}/websocket\`;
    
    const chatDiv = document.getElementById("chat");
    const form = document.getElementById("message-form");
    const input = document.getElementById("message-input");
    const button = form.querySelector("button");
    const userCountDiv = document.getElementById("user-count");

    let ws;
    let reconnectInterval;
    let username = localStorage.getItem("chat_username");

    if (!username) {
      username = "User" + Math.floor(Math.random() * 10000).toString().padStart(4, '0');
      localStorage.setItem("chat_username", username);
    }

    function connect() {
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        addSystemMessage(\`Connected as \${username}\`);
        button.disabled = false;
        clearInterval(reconnectInterval);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "count") {
            userCountDiv.textContent = \`\${data.count} user\${data.count === 1 ? '' : 's'} chatting\`;
          } else if (data.type === "chat") {
            addMessage(data.user, data.text, false);
          }
        } catch (e) {
          console.error("Failed to parse message", e);
        }
      };

      ws.onclose = () => {
        button.disabled = true;
        addSystemMessage("Disconnected. Reconnecting...");
        if (!reconnectInterval) {
            reconnectInterval = setInterval(connect, 3000);
        }
      };

      ws.onerror = (error) => {
        console.error("WebSocket error:", error);
      };
    }

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;

      if (text.startsWith("/nick ")) {
        const newName = text.substring(6).trim();
        if (newName) {
          username = newName;
          localStorage.setItem("chat_username", username);
          addSystemMessage(\`Username changed to \${username}\`);
        }
        input.value = "";
        return;
      }

      if (ws && ws.readyState === WebSocket.OPEN) {
        const message = { user: username, text: text };
        ws.send(JSON.stringify(message));
        addMessage(username, text, true);
        input.value = "";
      }
    });

    function addMessage(user, text, isMe) {
      const container = document.createElement("div");
      container.className = \`message-container \${isMe ? 'my-message-container' : 'other-message-container'}\`;

      if (!isMe) {
        const userDiv = document.createElement("div");
        userDiv.className = "username";
        userDiv.textContent = user;
        container.appendChild(userDiv);
      }

      const msgDiv = document.createElement("div");
      msgDiv.className = \`message \${isMe ? 'my-message' : 'other-message'}\`;
      msgDiv.textContent = text;
      
      container.appendChild(msgDiv);
      chatDiv.appendChild(container);
      chatDiv.scrollTop = chatDiv.scrollHeight;
    }

    function addSystemMessage(text) {
      const msgDiv = document.createElement("div");
      msgDiv.className = "system-message";
      msgDiv.textContent = text;
      chatDiv.appendChild(msgDiv);
      chatDiv.scrollTop = chatDiv.scrollHeight;
    }

    connect();
  </script>
</body>
</html>
`;
