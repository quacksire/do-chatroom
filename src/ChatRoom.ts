import { DurableObject } from "cloudflare:workers";

export class ChatRoom extends DurableObject {
    sessions: Map<WebSocket, { username: string }>;

    constructor(ctx: DurableObjectState, env: Env) {
        super(ctx, env);
        this.sessions = new Map();
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
        // Temporary placeholder until identified
        this.sessions.set(webSocket, { username: "Anonymous" });

        webSocket.addEventListener("message", async (msg) => {
            try {
                const data = JSON.parse(msg.data as string);

                if (data.type === "identify") {
                    const username = this.ensureUniqueName(data.username);
                    this.sessions.set(webSocket, { username });
                    webSocket.send(JSON.stringify({ type: "identity", username }));
                    this.broadcastUserList();
                } else if (data.type === "nick") {
                    const newName = data.username;
                    if (this.isNameTaken(newName)) {
                        webSocket.send(JSON.stringify({ type: "error", message: "Username is taken" }));
                    } else {
                        this.sessions.set(webSocket, { username: newName });
                        webSocket.send(JSON.stringify({ type: "identity", username: newName }));
                        this.broadcastUserList();
                    }
                } else if (data.type === "chat") {
                    const user = this.sessions.get(webSocket)?.username || "Anonymous";
                    this.broadcast({ type: "chat", user, text: data.text }, webSocket);
                }
            } catch (err) {
                console.error(err);
            }
        });

        webSocket.addEventListener("close", () => {
            this.sessions.delete(webSocket);
            this.broadcastUserList();
        });

        webSocket.addEventListener("error", () => {
            this.sessions.delete(webSocket);
            this.broadcastUserList();
        });
    }

    broadcast(message: any, sender?: WebSocket) {
        const stringified = JSON.stringify(message);
        for (const [session, _] of this.sessions) {
            if (session !== sender) {
                try {
                    session.send(stringified);
                } catch (err) {
                    this.sessions.delete(session);
                }
            }
        }
    }

    broadcastUserList() {
        const users = Array.from(this.sessions.values()).map(u => u.username);
        const message = JSON.stringify({ type: "user_list", users });
        for (const session of this.sessions.keys()) {
            try {
                session.send(message);
            } catch (err) {
                this.sessions.delete(session);
            }
        }
    }

    ensureUniqueName(name: string): string {
        let newName = name;
        let counter = 1;
        while (this.isNameTaken(newName)) {
            newName = `${name}${counter} `;
            counter++;
        }
        return newName;
    }

    isNameTaken(name: string): boolean {
        for (const user of this.sessions.values()) {
            if (user.username === name) return true;
        }
        return false;
    }
}

interface Env {
    CHAT_ROOM: DurableObjectNamespace;
}
