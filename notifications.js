// notifications.js

// URL del sonido de notificación
const notificationSound = new Audio("assets/notification.mp3");

// Escuchar nuevos mensajes del socket
if (typeof socket !== "undefined") {
  socket.on("chat message", msg => {
    // Reproducir sonido solo si el mensaje NO es tuyo
    // y la pestaña está en segundo plano
    if (msg.name !== nickname && document.hidden) {
      notificationSound.play().catch(() => {});
    }
  });
}
