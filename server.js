const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname)));

let chatHistory = []; // historial en memoria

io.on("connection", (socket) => {
  console.log("✅ Usuario conectado:", socket.id);

  // Enviar historial al nuevo usuario
  socket.emit("chat history", chatHistory);

  socket.on("chat message", (msg) => {
    const message = { id: socket.id, name: msg.name, text: msg.text, time: Date.now() };
    chatHistory.push(message);
    io.emit("chat message", message);
  });

  socket.on("typing", (name) => {
    socket.broadcast.emit("typing", name);
  });

  socket.on("disconnect", () => {
    console.log("❌ Usuario desconectado:", socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`✅ Servidor chat listo en puerto ${PORT}`));
