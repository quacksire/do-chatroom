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
    
    .message { 
      max-width: 80%; 
      padding: 8px 12px; 
      border-radius: 16px; 
      font-size: 14px; 
      line-height: 1.4;
      word-wrap: break-word;
    }
    .my-message { 
      align-self: flex-end; 
      background-color: #007aff; 
      color: white; 
      border-bottom-right-radius: 4px;
    }
    .other-message { 
      align-self: flex-start; 
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
  </style>
</head>
<body>
  <div id="chat"></div>
  <form id="message-form">
    <input type="text" id="message-input" placeholder="Type a message..." autocomplete="off">
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

    let ws;
    let reconnectInterval;

    function connect() {
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        addMessage("System", "Connected", "system-message");
        button.disabled = false;
        clearInterval(reconnectInterval);
      };

      ws.onmessage = (event) => {
        addMessage("Stranger", event.data, "other-message");
      };

      ws.onclose = () => {
        button.disabled = true;
        addMessage("System", "Disconnected. Reconnecting...", "system-message");
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
      const message = input.value.trim();
      if (message && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(message);
        addMessage("Me", message, "my-message");
        input.value = "";
      }
    });

    function addMessage(sender, text, className) {
      const msgDiv = document.createElement("div");
      msgDiv.className = \`message \${className}\`;
      // Don't show sender name for chat bubbles to keep it clean, except maybe system
      if (className === 'system-message') {
          msgDiv.textContent = text;
      } else {
          msgDiv.textContent = text;
      }
      chatDiv.appendChild(msgDiv);
      chatDiv.scrollTop = chatDiv.scrollHeight;
    }

    connect();
  </script>
</body>
</html>
`;
