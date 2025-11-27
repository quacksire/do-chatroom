import { DurableObject } from "cloudflare:workers";

export class ChatRoom extends DurableObject {
    sessions: Set<WebSocket>;

    constructor(ctx: DurableObjectState, env: Env) {
        super(ctx, env);
        this.sessions = new Set();
    }

    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);

        if (url.pathname === "/websocket") {
            if (request.headers.get("Upgrade") !== "websocket") {
                return new Response("Expected Upgrade: websocket", { status: 426 });
            }

            const pair = new WebSocketPair();
            const [client, server] = Object.values(pair);

            this.handleSession(server);

            return new Response(null, {
                status: 101,
                webSocket: client,
            });
        }

        return new Response("Not found", { status: 404 });
    }

    handleSession(webSocket: WebSocket) {
        webSocket.accept();
        this.sessions.add(webSocket);
        this.broadcastCount();

        webSocket.addEventListener("message", async (msg) => {
            try {
                // Broadcast the message to all other connected clients
                const data = JSON.parse(msg.data as string);
                this.broadcast({ type: "chat", ...data }, webSocket);
            } catch (err) {
                // Handle legacy or malformed messages
                this.broadcast({ type: "chat", user: "Anonymous", text: msg.data as string }, webSocket);
            }
        });

        webSocket.addEventListener("close", () => {
            this.sessions.delete(webSocket);
            this.broadcastCount();
        });

        webSocket.addEventListener("error", () => {
            this.sessions.delete(webSocket);
            this.broadcastCount();
        });
    }

    broadcast(message: any, sender?: WebSocket) {
        const stringified = JSON.stringify(message);
        for (const session of this.sessions) {
            if (session !== sender) {
                try {
                    session.send(stringified);
                } catch (err) {
                    this.sessions.delete(session);
                }
            }
        }
    }

    broadcastCount() {
        this.broadcast({ type: "count", count: this.sessions.size });
    }
}

interface Env {
    CHAT_ROOM: DurableObjectNamespace;
}
