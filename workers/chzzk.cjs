const io = require("socket.io-client-v2");
let socket;
process.on("message", (m) => {
  if (m.type === "connect") {
    socket = io.connect(m.url, {
      reconnection: false,
      "force new connection": true,
      "connect timeout": 3000,
      transports: ["websocket"],
    });
    for (const event of ["SYSTEM", "CHAT"])
      socket.on(event, (data) => {
        if (JSON.stringify(data).length <= 65536)
          process.send?.({ type: event, data });
      });
    socket.on("disconnect", () => process.exit(1));
    socket.on("connect_error", () => process.exit(1));
    socket.on("error", () => process.exit(1));
  } else if (m.type === "stop") {
    socket?.disconnect();
    process.exit(0);
  }
});
process.on("disconnect", () => process.exit(0));
