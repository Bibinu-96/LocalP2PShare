const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

const peers = new Map();

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  
  peers.set(socket.id, { id: socket.id, socket });
  
  const peerList = Array.from(peers.keys()).filter(id => id !== socket.id);
  socket.emit('peers', peerList);
  
  socket.broadcast.emit('peer-joined', socket.id);
  
  socket.on('offer', ({ offer, to }) => {
    console.log(`Offer from ${socket.id} to ${to}`);
    io.to(to).emit('offer', {
      offer,
      from: socket.id
    });
  });
  
  socket.on('answer', ({ answer, to }) => {
    console.log(`Answer from ${socket.id} to ${to}`);
    io.to(to).emit('answer', {
      answer,
      from: socket.id
    });
  });
  
  socket.on('ice-candidate', ({ candidate, to }) => {
    io.to(to).emit('ice-candidate', {
      candidate,
      from: socket.id
    });
  });
  
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    peers.delete(socket.id);
    socket.broadcast.emit('peer-left', socket.id);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`✅ Signaling server running on http://localhost:${PORT}`);
});