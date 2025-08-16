const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname)));

let users = {}; // socket.id => nickname
let groups = {}; // groupName => [nicknames]
let messages = []; // historial completo

io.on("connection", socket => {
  console.log("✅ Usuario conectado:", socket.id);

  socket.on("set nickname", name => {
    users[socket.id] = name;
    io.emit("user list", Object.values(users));
    socket.emit("chat history", messages);
    socket.emit("group list", Object.keys(groups));
  });

  socket.on("chat public", text => {
    const msg = { type: "public", text, name: users[socket.id], time: Date.now() };
    messages.push(msg);
    io.emit("chat message", msg);
  });

  socket.on("chat private", ({ target, text }) => {
    const msg = { type: "private", text, name: users[socket.id], target, time: Date.now() };
    messages.push(msg);
    io.emit("chat message", msg);
  });

  socket.on("chat group", ({ groupName, text }) => {
    if(groups[groupName]){
      const msg = { type:"group", text, name:users[socket.id], target:groupName, time:Date.now() };
      messages.push(msg);
      io.emit("chat message", msg);
    }
  });

  socket.on("create group", ({ groupName, members }) => {
    groups[groupName] = members;
    io.emit("group list", Object.keys(groups));
  });

  socket.on("typing", data => {
    socket.broadcast.emit("typing", users[socket.id]);
  });

  socket.on("chat image", ({data, target})=>{
    const type = target ? (groups[target] ? "group" : "private") : "public";
    const msg = { type, data, name: users[socket.id], target, time: Date.now() };
    messages.push(msg);
    io.emit("chat message", msg);
  });

  socket.on("disconnect", () => {
    delete users[socket.id];
    io.emit("user list", Object.values(users));
    console.log("❌ Usuario desconectado:", socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, ()=>console.log(`✅ Servidor chat listo en puerto ${PORT}`));
