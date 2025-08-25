const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname)));
app.use(express.json()); // Para parsear JSON en POST

const HISTORY_FILE = path.join(__dirname, "chatHistory.json");

// Cargar historial
let chatHistory = [];
if (fs.existsSync(HISTORY_FILE)) {
  try {
    chatHistory = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8"));
  } catch (err) {
    console.error("Error al leer historial:", err);
  }
}

// Usuarios y grupos
let users = {}; // socket.id -> nickname
let groups = {}; // groupName -> [nicknames]

function saveHistory() {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(chatHistory, null, 2));
}

// Ruta para resetear todo el historial y grupos
app.post("/reset", (req, res) => {
  // Vaciar historial
  chatHistory = [];
  saveHistory();

  // Vaciar grupos
  groups = {};

  // Actualizar listas de usuarios y grupos a los clientes
  io.emit("user list", Object.values(users));
  io.emit("group list", Object.keys(groups));

  console.log("Ã¢Å¡ Ã¯Â¸Â Chat reseteado manualmente");
  res.sendStatus(200);
});

io.on("connection", (socket) => {
  console.log("Ã¢Å“â€ Usuario conectado:", socket.id);

  // Establecer nickname
  socket.on("set nickname", (nickname) => {
    users[socket.id] = nickname;
    io.emit("user list", Object.values(users));
    socket.emit("chat history", chatHistory); // enviar historial
    socket.emit("group list", Object.keys(groups));
  });

// Mensajes pÃƒÂºblicos
socket.on("chat public", (msg) => {
  const isImage = typeof msg === "object" && msg.type === "image";
  const message = {
    id: socket.id,
    name: users[socket.id],
    text: isImage ? "" : msg,
    image: isImage ? msg.data : null,
    time: Date.now(),
    type: "public",
    target: null,
  };
  chatHistory.push(message);
  saveHistory();
  io.emit("chat message", message);
});


// Mensajes privados
socket.on("chat private", (msg) => {
  const target = msg.target;
  const targetId = Object.keys(users).find((id) => users[id] === target);
  if (targetId) {
    const isImage = msg.type === "image";
    const message = {
      id: socket.id,
      name: users[socket.id],
      text: isImage ? "" : msg.text,
      image: isImage ? msg.data : null,
      time: Date.now(),
      type: "private",
      target,
    };
    chatHistory.push(message);
    saveHistory();
    socket.emit("chat message", message); // tÃƒÂº ves tu mensaje
    io.to(targetId).emit("chat message", message); // destinatario
  }
});


// Mensajes de grupo
socket.on("chat group", (msg) => {
  const groupName = msg.groupName;
  if (groups[groupName] && groups[groupName].includes(users[socket.id])) {
    const isImage = msg.type === "image";
    const message = {
      id: socket.id,
      name: users[socket.id],
      text: isImage ? "" : msg.text,
      image: isImage ? msg.data : null,
      time: Date.now(),
      type: "group",
      target: groupName,
    };
    chatHistory.push(message);
    saveHistory();

    Object.entries(users).forEach(([sid, nick]) => {
      if (groups[groupName].includes(nick)) {
        io.to(sid).emit("chat message", message);
      }
    });
  }
});


  // Crear grupo
  socket.on("create group", ({ groupName, members }) => {
    if (!groups[groupName]) {
      groups[groupName] = members;
      io.emit("group list", Object.keys(groups));
    }
  });

  // Indicador escribiendo
  socket.on("typing", ({ type, target }) => {
    if (type === "public") {
      socket.broadcast.emit("typing", { name: users[socket.id], type, target: null });
    } else if (type === "private" && target) {
      const targetId = Object.keys(users).find((id) => users[id] === target);
      if (targetId) io.to(targetId).emit("typing", { name: users[socket.id], type, target });
    } else if (type === "group" && target) {
      groups[target].forEach((nick) => {
        const sid = Object.keys(users).find((id) => users[id] === nick);
        if (sid && sid !== socket.id) io.to(sid).emit("typing", { name: users[socket.id], type, target });
      });
    }
  });

  // DesconexiÃƒÂ³n
  socket.on("disconnect", () => {
    console.log("Ã¢Å“â€“ Usuario desconectado:", socket.id);
    delete users[socket.id];
    io.emit("user list", Object.values(users));
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Ã¢Å“â€ Servidor chat listo en puerto ${PORT}`));
