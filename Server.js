// server.js — Express + Socket.IO server for Cartoon Chess multiplayer
// Simple matchmaking by user-provided ID and room broadcasting for moves

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Static files সার্ভ করুন - Render এর environment এর জন্য
app.use(express.static(__dirname));

// Socket.IO setup
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Root route যোগ করুন
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});


// Simple in-memory maps: id -> socketId, socketId -> id
const idToSocket = new Map();
const socketToId = new Map();

io.on('connection', (socket) => {
  console.log('socket connected', socket.id);

  socket.on('mp:register', (data) => {
    try{
      const id = (data && data.id) ? String(data.id).toUpperCase() : null;
      if(!id) return;
      idToSocket.set(id, socket.id);
      socketToId.set(socket.id, id);
      console.log(`registered id ${id} -> ${socket.id}`);
      socket.emit('mp:registered', { ok:true, id });
    }catch(e){ console.warn('mp:register error', e); }
  });

  // peer requests: forward to target if online
  socket.on('mp:request', (data) => {
    try{
      const { from, to } = data || {};
      if(!from || !to) return;
      const targetSocketId = idToSocket.get(String(to).toUpperCase());
      if(targetSocketId){
        io.to(targetSocketId).emit('mp:request', { from, to });
        socket.emit('mp:requestSent', { to });
      } else {
        socket.emit('mp:requestRejected', { to, reason: 'offline' });
      }
    }catch(e){ console.warn('mp:request error', e); }
  });

  // peer accepted: notify original requester
  socket.on('mp:accept', (data) => {
    try{
      const { from, to, room } = data || {};
      if(!from || !to) return;
      const requesterSocketId = idToSocket.get(String(to).toUpperCase());
      if(requesterSocketId){
        io.to(requesterSocketId).emit('mp:accepted', { from, to, room });
      }
    }catch(e){ console.warn('mp:accept error', e); }
  });

  // join/leave room
  socket.on('mp:join', (data) => {
    try{
      const { room, id } = data || {};
      if(!room) return;
      socket.join(room);
      io.to(room).emit('mp:joined', { room, id });
      console.log(`${socket.id} joined ${room}`);
    }catch(e){ console.warn('mp:join error', e); }
  });

  socket.on('mp:leave', (data) => {
    try{
      const { room, id } = data || {};
      if(room) socket.leave(room);
      io.to(room).emit('mp:left', { room, id });
    }catch(e){ console.warn('mp:leave error', e); }
  });

  // move and sync events — broadcast to the room except the sender
  socket.on('mp:move', (data) => {
    try{
      const room = (data && data.room) ? data.room : null;
      if(room){
        socket.to(room).emit('mp:move', data);
      }
    }catch(e){ console.warn('mp:move error', e); }
  });

  socket.on('mp:sync', (data) => {
    try{
      const room = (data && data.room) ? data.room : null;
      if(room){
        socket.to(room).emit('mp:sync', data);
      }
    }catch(e){ console.warn('mp:sync error', e); }
  });

  socket.on('disconnect', () => {
    const id = socketToId.get(socket.id);
    if(id){
      idToSocket.delete(id);
      console.log(`cleaned mapping for ${id}`);
    }
    socketToId.delete(socket.id);
    console.log('socket disconnected', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Multiplayer server running on port ${PORT}`));