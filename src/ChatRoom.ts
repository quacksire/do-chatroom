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

        webSocket.addEventListener("message", async (msg) => {
            try {
                // Broadcast the message to all other connected clients
                const data = msg.data;
                this.broadcast(data as string, webSocket);
            } catch (err) {
                console.error(err);
            }
        });

        webSocket.addEventListener("close", () => {
            this.sessions.delete(webSocket);
        });

        webSocket.addEventListener("error", () => {
            this.sessions.delete(webSocket);
        });
    }

    broadcast(message: string, sender: WebSocket) {
        for (const session of this.sessions) {
            if (session !== sender) {
                try {
                    session.send(message);
                } catch (err) {
                    this.sessions.delete(session);
                }
            }
        }
    }
}

interface Env {
    CHAT_ROOM: DurableObjectNamespace;
}
