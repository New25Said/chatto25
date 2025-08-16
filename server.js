const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname)));

const HISTORY_FILE = path.join(__dirname, "chatHistory.json");

// Cargar historial
let chatHistory = [];
if(fs.existsSync(HISTORY_FILE)){
  try {
    chatHistory = JSON.parse(fs.readFileSync(HISTORY_FILE,"utf8"));
  } catch(err){
    console.error("Error al leer historial:", err);
  }
}

// Usuarios conectados
let users = {}; // socket.id -> nickname
let groups = {}; // groupName -> [nicknames]

function saveHistory(){
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(chatHistory,null,2));
}

io.on("connection", (socket) => {
  console.log("✅ Usuario conectado:", socket.id);

  // Registrar nickname al conectarse
  socket.on("set nickname", (nickname) => {
    users[socket.id] = nickname;
    io.emit("user list", Object.values(users)); // actualizar lista de usuarios
  });

  // Enviar historial filtrado
  socket.on("get history", () => {
    socket.emit("chat history", chatHistory);
  });

  // Chat público
  socket.on("chat public", (msg) => {
    const message = { id: socket.id, name: users[socket.id], text: msg, time: Date.now(), type: "public", target: null };
    chatHistory.push(message);
    saveHistory();
    io.emit("chat message", message);
  });

  // Chat privado
  socket.on("chat private", ({target, text}) => {
    const targetSocketId = Object.keys(users).find(id => users[id] === target);
    if(targetSocketId){
      const message = { id: socket.id, name: users[socket.id], text, time: Date.now(), type:"private", target };
      chatHistory.push(message);
      saveHistory();
      socket.emit("chat message", message);
      io.to(targetSocketId).emit("chat message", message);
    }
  });

  // Chat grupo
  socket.on("chat group", ({groupName, text}) => {
    if(groups[groupName] && groups[groupName].includes(users[socket.id])){
      const message = { id: socket.id, name: users[socket.id], text, time: Date.now(), type:"group", target: groupName };
      chatHistory.push(message);
      saveHistory();
      // Enviar solo a miembros del grupo
      Object.entries(users).forEach(([sid,nick])=>{
        if(groups[groupName].includes(nick)){
          io.to(sid).emit("chat message", message);
        }
      });
    }
  });

  // Crear grupo
  socket.on("create group", ({groupName, members}) => {
    if(!groups[groupName]){
      groups[groupName] = members;
      io.emit("group list", Object.keys(groups));
    }
  });

  // Indicador "está escribiendo"
  socket.on("typing", ({type, target}) => {
    if(type === "public"){
      socket.broadcast.emit("typing", users[socket.id]);
    } else if(type === "private" && target){
      const targetSocketId = Object.keys(users).find(id => users[id] === target);
      if(targetSocketId) io.to(targetSocketId).emit("typing", users[socket.id]);
    } else if(type === "group" && target){
      groups[target].forEach(nick => {
        const sid = Object.keys(users).find(id => users[id] === nick);
        if(sid && sid !== socket.id) io.to(sid).emit("typing", users[socket.id]);
      });
    }
  });

  socket.on("disconnect", () => {
    console.log("❌ Usuario desconectado:", socket.id);
    delete users[socket.id];
    io.emit("user list", Object.values(users));
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`✅ Servidor chat listo en puerto ${PORT}`));
