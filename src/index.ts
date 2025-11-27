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
      cursor: default;
    }
    #user-list {
      display: none;
      position: absolute;
      top: 35px;
      right: 10px;
      background: white;
      border: 1px solid #eee;
      border-radius: 8px;
      padding: 8px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
      font-size: 12px;
      max-height: 200px;
      overflow-y: auto;
      z-index: 100;
    }
    #user-count:hover + #user-list, #user-list:hover {
      display: block;
    }
    .user-list-item {
      padding: 2px 4px;
      color: #333;
    }
    .message {
      overflow-wrap: anywhere;
    }
    .message a {
      color: white;
      text-decoration: underline;
    }
    .other-message a {
      color: #007aff;
    }
  </style>
</head>
<body>
  <div id="user-count">0 users</div>
  <div id="user-list"></div>
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
    const userListDiv = document.getElementById("user-list");

    let ws;
    let reconnectInterval;
    let username = localStorage.getItem("chat_username");
    let lastSender = null;

    if (!username) {
      username = "User" + Math.floor(Math.random() * 10000).toString().padStart(4, '0');
      localStorage.setItem("chat_username", username);
    }

    function connect() {
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        // Send identity immediately
        ws.send(JSON.stringify({ type: "identify", username: username }));
        button.disabled = false;
        clearInterval(reconnectInterval);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "user_list") {
            updateUserList(data.users);
          } else if (data.type === "chat") {
            addMessage(data.user, data.text, false);
          } else if (data.type === "identity") {
            username = data.username;
            localStorage.setItem("chat_username", username);
            addSystemMessage(\`You are now known as \${username}\`);
          } else if (data.type === "error") {
            addSystemMessage(\`Error: \${data.message}\`);
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

    function updateUserList(users) {
      userCountDiv.textContent = \`\${users.length} user\${users.length === 1 ? '' : 's'}\`;
      userListDiv.innerHTML = users.map(u => \`<div class="user-list-item">\${escapeHtml(u)}</div>\`).join('');
    }

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;

      if (text.startsWith("/nick ")) {
        const newName = text.substring(6).trim();
        if (newName) {
          ws.send(JSON.stringify({ type: "nick", username: newName }));
        }
        input.value = "";
        return;
      }

      if (ws && ws.readyState === WebSocket.OPEN) {
        const message = { type: "chat", text: text };
        ws.send(JSON.stringify(message));
        addMessage(username, text, true);
        input.value = "";
      }
    });

    function addMessage(user, text, isMe) {
      const container = document.createElement("div");
      container.className = \`message-container \${isMe ? 'my-message-container' : 'other-message-container'}\`;

      // Only show username if different from last sender or if it's been a while (simplified to just sender check)
      if (!isMe && user !== lastSender) {
        const userDiv = document.createElement("div");
        userDiv.className = "username";
        userDiv.textContent = user;
        container.appendChild(userDiv);
      }
      
      lastSender = user;

      const msgDiv = document.createElement("div");
      msgDiv.className = \`message \${isMe ? 'my-message' : 'other-message'}\`;
      msgDiv.innerHTML = linkify(escapeHtml(text));
      
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
      lastSender = null; // Reset grouping on system message
    }

    function linkify(text) {
      const urlRegex = /(https?:\\/\\/[^\\s]+)/g;
      return text.replace(urlRegex, '<a href="$1" target="_blank">$1</a>');
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    connect();
  </script>
</body>
</html>
`;
