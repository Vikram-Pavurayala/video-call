const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Store active rooms
const rooms = new Map();

// Socket.io connection handler
io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);
  
  // Store username when provided
  socket.on('set-username', (username) => {
    socket.username = username;
    console.log(`User ${socket.id} set username: ${username}`);
  });

  // Create a new room
  socket.on('create-room', (username, callback) => {
    try {
      const roomId = generateRoomCode();
      socket.username = username || 'Anonymous';
      
      rooms.set(roomId, {
        id: roomId,
        participants: new Map([[socket.id, socket.username]]),
        creator: socket.id
      });
      
      socket.join(roomId);
      socket.roomId = roomId;
      
      console.log(`Room created: ${roomId} by user ${socket.username} (${socket.id})`);
      callback({ roomId });
    } catch (error) {
      console.error('Error creating room:', error);
      callback({ error: 'Failed to create room' });
    }
  });

  socket.on('leave-room', (roomId, callback) => {
  try {
    if (!roomId || !socket.roomId) {
      return callback && callback();
    }
    
    console.log(`User ${socket.username} (${socket.id}) is leaving room ${roomId}`);
    
    const room = rooms.get(roomId);
    if (room) {
      // Remove user from room participants
      room.participants.delete(socket.id);
      
      // Notify other participants about the user leaving
      socket.to(roomId).emit('user-left', socket.id);
      
      console.log(`User ${socket.username} (${socket.id}) removed from room ${roomId}`);
      console.log(`Room ${roomId} has ${room.participants.size} participants left`);
      
      // If the room is empty, delete it
      if (room.participants.size === 0) {
        rooms.delete(roomId);
        console.log(`Room ${roomId} deleted (empty)`);
      }
    }
    
    // Leave the socket.io room
    socket.leave(roomId);
    socket.roomId = null;
    
    if (callback) callback();
  } catch (error) {
    console.error('Error handling leave-room:', error);
    if (callback) callback({ error: 'Failed to leave room' });
  }
});

  // Join an existing room
  socket.on('join-room', (roomId, username, callback) => {
    try {
      const room = rooms.get(roomId);
      
      if (!room) {
        return callback({ error: 'Room not found' });
      }
      
      socket.username = username || 'Anonymous';
      socket.join(roomId);
      socket.roomId = roomId;
      room.participants.set(socket.id, socket.username);
      
      console.log(`User ${socket.username} (${socket.id}) joined room ${roomId}`);
      
      // Notify other participants in the room with the username
      socket.to(roomId).emit('user-joined', socket.id, socket.username);
      
      // Return the list of participants already in the room with their usernames
      const participants = [];
      room.participants.forEach((username, id) => {
        if (id !== socket.id) {
          participants.push({ id, username });
        }
      });
      
      callback({ roomId, participants });
    } catch (error) {
      console.error('Error joining room:', error);
      callback({ error: 'Failed to join room' });
    }
  });

  // WebRTC signaling with improved error handling
  socket.on('offer', (targetId, offer) => {
    try {
      console.log(`Relaying offer from ${socket.username} (${socket.id}) to ${targetId}`);
      socket.to(targetId).emit('offer', socket.id, offer, socket.username);
    } catch (error) {
      console.error('Error relaying offer:', error);
    }
  });

  socket.on('answer', (targetId, answer) => {
    try {
      console.log(`Relaying answer from ${socket.username} (${socket.id}) to ${targetId}`);
      socket.to(targetId).emit('answer', socket.id, answer, socket.username);
    } catch (error) {
      console.error('Error relaying answer:', error);
    }
  });

  socket.on('ice-candidate', (targetId, candidate) => {
    try {
      socket.to(targetId).emit('ice-candidate', socket.id, candidate);
    } catch (error) {
      console.error('Error relaying ICE candidate:', error);
    }
  });

  // Handle disconnection with improved cleanup
  socket.on('disconnect', () => {
    try {
      console.log(`User disconnected: ${socket.username} (${socket.id})`);
      
      if (socket.roomId) {
        const room = rooms.get(socket.roomId);
        
        if (room) {
          room.participants.delete(socket.id);
          
          // Notify other participants about the user leaving
          socket.to(socket.roomId).emit('user-left', socket.id);
          
          console.log(`User ${socket.username} (${socket.id}) removed from room ${socket.roomId}`);
          console.log(`Room ${socket.roomId} has ${room.participants.size} participants left`);
          
          // If the room is empty, delete it
          if (room.participants.size === 0) {
            rooms.delete(socket.roomId);
            console.log(`Room ${socket.roomId} deleted (empty)`);
          }
        }
      }
    } catch (error) {
      console.error('Error handling disconnect:', error);
    }
  });
});





// Generate a 6-character room code
function generateRoomCode() {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
}

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
