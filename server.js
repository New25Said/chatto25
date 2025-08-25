// server.js (corregido)
// Chat con grupos privados y selección por nickname
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname)));
app.use(express.json());

const HISTORY_FILE = path.join(__dirname, "chatHistory.json");

// Cargar historial (si existe)
let chatHistory = [];
if (fs.existsSync(HISTORY_FILE)) {
  try {
    chatHistory = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8"));
  } catch (err) {
    console.error("Error al leer historial:", err);
    chatHistory = [];
  }
}

// Mapeos
let users = {};   // socketId -> nickname
let groups = {};  // groupName -> [nickname, nickname, ...]

// Utilidades
function saveHistory() {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(chatHistory, null, 2));
  } catch (err) {
    console.error("Error guardando historial:", err);
  }
}

function nicknameToSocketId(nickname) {
  return Object.entries(users).find(([sid, nick]) => nick === nickname)?.[0] || null;
}

// Filtrar historial para enviar solo los mensajes que corresponde ver a `nickname`
function filterHistoryForNickname(nickname) {
  return chatHistory.filter(msg => {
    if (msg.type === "public") return true;
    if (msg.type === "private") {
      return msg.name === nickname || msg.target === nickname;
    }
    if (msg.type === "group") {
      const gname = msg.target;
      const members = groups[gname] || [];
      return members.includes(nickname);
    }
    return false;
  });
}

// Servir archivo estático y endpoint de reset
app.post("/reset", (req, res) => {
  chatHistory = [];
  saveHistory();
  groups = {};
  // Notificar actualización de usuarios y grupos (cada usuario solo verá sus grupos)
  io.emit("user list", Object.values(users));
  // Para cada socket, enviar su lista de grupos (vacía)
  Object.keys(users).forEach(sid => {
    io.to(sid).emit("group list", []);
    // También enviar historial filtrado (vacío)
    io.to(sid).emit("chat history", filterHistoryForNickname(users[sid]));
  });
  console.log("Chat reseteado manualmente");
  res.sendStatus(200);
});

io.on("connection", (socket) => {
  console.log("Usuario conectado:", socket.id);

  // Cuando un socket establece un nickname
  socket.on("set nickname", (nickname) => {
    // Guardar nickname
    users[socket.id] = nickname;

    // Enviar lista de usuarios (todos los nicknames)
    io.emit("user list", Object.values(users));

    // Enviar historial filtrado para este nickname
    socket.emit("chat history", filterHistoryForNickname(nickname));

    // Enviar lista de grupos a los que pertenece este nickname (no todos los grupos)
    const myGroups = Object.keys(groups).filter(g => (groups[g] || []).includes(nickname));
    socket.emit("group list", myGroups);
  });

  // Mensajes públicos (texto o imagen)
  socket.on("chat public", (msg) => {
    const isImage = typeof msg === "object" && msg.type === "image";
    const message = {
      id: socket.id,
      name: users[socket.id] || "Desconocido",
      text: isImage ? "" : (typeof msg === "string" ? msg : (msg.text || "")),
      image: isImage ? msg.data : null,
      time: Date.now(),
      type: "public",
      target: null
    };
    chatHistory.push(message);
    saveHistory();
    io.emit("chat message", message);
  });

  // Mensajes privados
  socket.on("chat private", (msg) => {
    const targetNickname = msg.target;
    const targetId = nicknameToSocketId(targetNickname);
    if (!targetId) {
      // Opcional: avisar al emisor que el target no existe
      socket.emit("system message", { text: `Usuario "${targetNickname}" no está conectado.` });
      return;
    }

    const isImage = msg.type === "image";
    const message = {
      id: socket.id,
      name: users[socket.id] || "Desconocido",
      text: isImage ? "" : (msg.text || ""),
      image: isImage ? msg.data : null,
      time: Date.now(),
      type: "private",
      target: targetNickname
    };

    chatHistory.push(message);
    saveHistory();

    // Emitir: al emisor y al destinatario (solo ellos dos)
    socket.emit("chat message", message);
    io.to(targetId).emit("chat message", message);
  });

  // Mensajes de grupo
  socket.on("chat group", (msg) => {
    const groupName = msg.groupName;
    if (!groupName || !groups[groupName]) {
      socket.emit("system message", { text: `El grupo "${groupName}" no existe.` });
      return;
    }

    const senderNick = users[socket.id];
    if (!senderNick || !groups[groupName].includes(senderNick)) {
      socket.emit("system message", { text: `No tienes permiso para enviar mensajes a "${groupName}".` });
      return;
    }

    const isImage = msg.type === "image";
    const message = {
      id: socket.id,
      name: senderNick,
      text: isImage ? "" : (msg.text || ""),
      image: isImage ? msg.data : null,
      time: Date.now(),
      type: "group",
      target: groupName
    };

    chatHistory.push(message);
    saveHistory();

    // Enviar sólo a sockets de los miembros del grupo
    groups[groupName].forEach(memberNick => {
      const sid = nicknameToSocketId(memberNick);
      if (sid) io.to(sid).emit("chat message", message);
    });
  });

  // Crear grupo (recibe { groupName, members: [nick1, nick2, ...] })
  socket.on("create group", ({ groupName, members }) => {
    if (!groupName || !Array.isArray(members) || members.length === 0) {
      socket.emit("system message", { text: "Nombre de grupo inválido o sin miembros." });
      return;
    }

    if (groups[groupName]) {
      socket.emit("system message", { text: `El grupo "${groupName}" ya existe.` });
      return;
    }

    // Filtrar miembros para que existan como nicknames actualmente conectados
    const connectedNicknames = new Set(Object.values(users));
    const validMembers = members.filter(n => connectedNicknames.has(n));
    // Asegurarse de que al menos el creador (nickname) esté incluido
    const creatorNick = users[socket.id];
    if (creatorNick && !validMembers.includes(creatorNick)) validMembers.push(creatorNick);

    if (validMembers.length === 0) {
      socket.emit("system message", { text: "Ninguno de los miembros está conectado." });
      return;
    }

    // Guardar grupo
    groups[groupName] = validMembers;

    // Notificar a cada miembro solo de su lista de grupos (no al resto)
    validMembers.forEach(nick => {
      const sid = nicknameToSocketId(nick);
      if (sid) {
        const myGroups = Object.keys(groups).filter(g => (groups[g] || []).includes(nick));
        io.to(sid).emit("group list", myGroups);
      }
    });

    // (Opcional) enviar confirmación al creador
    socket.emit("system message", { text: `Grupo "${groupName}" creado con ${validMembers.length} miembro(s).` });
  });

  // Indicador "typing" — se envía solo a quien corresponda
  socket.on("typing", ({ type, target }) => {
    const senderNick = users[socket.id];
    if (type === "public") {
      socket.broadcast.emit("typing", { name: senderNick, type, target: null });
    } else if (type === "private" && target) {
      const targetId = nicknameToSocketId(target);
      if (targetId) io.to(targetId).emit("typing", { name: senderNick, type, target });
    } else if (type === "group" && target) {
      if (!groups[target]) return;
      groups[target].forEach(memberNick => {
        const sid = nicknameToSocketId(memberNick);
        if (sid && sid !== socket.id) io.to(sid).emit("typing", { name: senderNick, type, target });
      });
    }
  });

  socket.on("disconnect", () => {
    console.log("Usuario desconectado:", socket.id);
    // Guardar nickname antes de eliminar
    const nick = users[socket.id];
    delete users[socket.id];

    // Actualizar lista de usuarios para todos
    io.emit("user list", Object.values(users));

    // Actualizar grupos: opcional mantener grupos aunque miembro desconecte
    // En este diseño los grupos permanecen por nickname.
    // Pero cada socket necesita recibir su propia group list (los conectados)
    Object.keys(users).forEach(sid => {
      const myNick = users[sid];
      const myGroups = Object.keys(groups).filter(g => (groups[g] || []).includes(myNick));
      io.to(sid).emit("group list", myGroups);
    });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor chat listo en puerto ${PORT}`));
