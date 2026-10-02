const { SoopClient, SoopChatEvent } = require("soop-extension");
let chat;
process.on("message", async (m) => {
  try {
    if (m.type === "connect") {
      chat = new SoopClient().chat({ streamerId: m.streamerId });
      chat.on(SoopChatEvent.CHAT, (e) =>
        process.send?.({
          type: "CHAT",
          data: {
            platform: "soop",
            channel: m.streamerId,
            author: e.userId,
            name: e.username,
            text: e.comment,
          },
        }),
      );
      chat.on(SoopChatEvent.DISCONNECT, () => process.exit(1));
      chat.on(SoopChatEvent.ENTER_CHAT_ROOM, () =>
        process.send?.({ type: "ready" }),
      );
      await chat.connect();
    } else if (m.type === "stop") {
      await chat?.disconnect();
      process.exit(0);
    }
  } catch {
    process.exit(1);
  }
});
process.on("disconnect", () => process.exit(0));
