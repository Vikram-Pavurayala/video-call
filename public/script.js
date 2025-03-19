// DOM elements
const homeScreen = document.getElementById('home-screen');
const callScreen = document.getElementById('call-screen');
const createRoomBtn = document.getElementById('create-room-btn');
const joinRoomBtn = document.getElementById('join-room-btn');
const roomCodeInput = document.getElementById('room-code-input');
const usernameInput = document.getElementById('username-input');
const roomIdDisplay = document.getElementById('room-id-display');
const localUsernameDisplay = document.getElementById('local-username-display');
const copyRoomBtn = document.getElementById('copy-room-btn');
const leaveRoomBtn = document.getElementById('leave-room-btn');
const localVideo = document.getElementById('local-video');
const remoteVideos = document.getElementById('remote-videos');
const muteBtn = document.getElementById('mute-btn');
const videoBtn = document.getElementById('video-btn');
const notification = document.getElementById('notification');

// Global variables
let socket;
let localStream;
let currentRoom;
let username = '';
let peerConnections = {}; // Key: socketId, Value: RTCPeerConnection
let peerUsernames = {}; // Key: socketId, Value: username

// WebRTC configuration
const peerConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' }
  ]
};

// Initialize the application
async function init() {
  try {
    console.log('Initializing application');
    
    // Connect to the Socket.io server
    socket = io();
    console.log('Socket.io connected');
    
    // Setup Socket.io event listeners
    setupSocketListeners();
    
    // Get local media stream with constraints
    const constraints = {
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 }
      },
      audio: true
    };
    
    console.log('Requesting media with constraints:', constraints);
    localStream = await navigator.mediaDevices.getUserMedia(constraints);
    console.log('Local media stream acquired:', localStream.getTracks().map(t => t.kind).join(', '));
    
    // Set local video
    localVideo.srcObject = localStream;
    localVideo.play().catch(error => {
      console.warn(`Error playing local video: ${error}`);
    });
    
    // Setup UI event listeners
    setupUIListeners();
    
    // Pre-populate with a placeholder username
    if (!usernameInput.value) {
      usernameInput.value = `User${Math.floor(Math.random() * 1000)}`;
    }
    
    console.log('Initialization complete');
  } catch (error) {
    console.error('Error initializing the app:', error);
    showNotification(`Error accessing camera/microphone: ${error.message}. Please ensure your camera is not in use by another application and you've granted permissions.`);
  }
}

// Set up Socket.io event listeners
function setupSocketListeners() {
  socket.on('user-joined', async (userId, remoteUsername) => {
    console.log(`User joined: ${remoteUsername} (${userId})`);
    showNotification(`${remoteUsername} has joined the room`);
    peerUsernames[userId] = remoteUsername;
    await createPeerConnection(userId);
    await sendOffer(userId);
  });
  
  socket.on('user-left', (userId) => {
    console.log(`User left: ${userId}`);
    const username = peerUsernames[userId] || 'A user';
    handleUserLeft(userId);
    showNotification(`${username} has left the room`);
    delete peerUsernames[userId];
  });
  
  socket.on('offer', async (userId, offer, remoteUsername) => {
    console.log(`Received offer from ${remoteUsername} (${userId})`);
    peerUsernames[userId] = remoteUsername;
    await handleOffer(userId, offer);
  });
  
  socket.on('answer', (userId, answer, remoteUsername) => {
    console.log(`Received answer from ${remoteUsername} (${userId})`);
    peerUsernames[userId] = remoteUsername;
    handleAnswer(userId, answer);
  });
  
  socket.on('ice-candidate', (userId, candidate) => {
    handleIceCandidate(userId, candidate);
  });
}

// Set up UI event listeners
function setupUIListeners() {
  createRoomBtn.addEventListener('click', createRoom);
  joinRoomBtn.addEventListener('click', joinRoom);
  copyRoomBtn.addEventListener('click', copyRoomCode);
  leaveRoomBtn.addEventListener('click', leaveRoom);
  muteBtn.addEventListener('click', toggleMute);
  videoBtn.addEventListener('click', toggleVideo);
  
  // Enable Enter key for inputs
  usernameInput.addEventListener('keyup', (event) => {
    if (event.key === 'Enter') {
      createRoom();
    }
  });
  
  roomCodeInput.addEventListener('keyup', (event) => {
    if (event.key === 'Enter') {
      joinRoom();
    }
  });
}

// Create a new room
async function createRoom() {
  username = usernameInput.value.trim() || `User${Math.floor(Math.random() * 1000)}`;
  
  socket.emit('create-room', username, (response) => {
    if (response.error) {
      showNotification(response.error);
      return;
    }
    
    currentRoom = response.roomId;
    roomIdDisplay.textContent = currentRoom;
    localUsernameDisplay.textContent = username;
    switchToCallScreen();
    showNotification(`Room created: ${currentRoom}`);
  });
}

// Join an existing room
async function joinRoom() {
  const roomId = roomCodeInput.value.trim().toUpperCase();
  username = usernameInput.value.trim() || `User${Math.floor(Math.random() * 1000)}`;
  
  if (!roomId) {
    showNotification('Please enter a room code');
    return;
  }
  
  socket.emit('join-room', roomId, username, async (response) => {
    if (response.error) {
      showNotification(response.error);
      return;
    }
    
    currentRoom = response.roomId;
    roomIdDisplay.textContent = currentRoom;
    localUsernameDisplay.textContent = username;
    switchToCallScreen();
    showNotification(`Joined room: ${currentRoom}`);
    
    // Create peer connections with existing participants
    for (const participant of response.participants) {
      peerUsernames[participant.id] = participant.username;
      await createPeerConnection(participant.id);
      await sendOffer(participant.id);
    }
  });
}

// Modify the createPeerConnection function to properly handle remote streams
async function createPeerConnection(userId) {
  try {
    console.log(`Creating peer connection for user: ${peerUsernames[userId]} (${userId})`);
    const peerConnection = new RTCPeerConnection(peerConfig);
    peerConnections[userId] = peerConnection;
    
    // Add local tracks to the peer connection
    localStream.getTracks().forEach(track => {
      console.log(`Adding local track to peer connection: ${track.kind}`);
      peerConnection.addTrack(track, localStream);
    });
    
    // Handle ICE candidates
    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        console.log(`Sending ICE candidate to ${userId}`);
        socket.emit('ice-candidate', userId, event.candidate);
      }
    };
    
    // Log ICE connection state changes
    peerConnection.oniceconnectionstatechange = (event) => {
      console.log(`ICE connection state with ${userId}: ${peerConnection.iceConnectionState}`);
    };
    
    // Handle remote tracks
    peerConnection.ontrack = (event) => {
      console.log(`Received remote track from ${userId}`, event.streams[0]);
      
      // Create or update the remote video element
      const remoteVideoId = `remote-video-${userId}`;
      let remoteVideo = document.getElementById(remoteVideoId);
      let remoteVideoContainer = document.getElementById(`remote-video-container-${userId}`);
      
      if (!remoteVideo) {
        console.log(`Creating new video element for ${userId}`);
        remoteVideoContainer = document.createElement('div');
        remoteVideoContainer.id = `remote-video-container-${userId}`;
        remoteVideoContainer.className = 'video-wrapper';
        
        remoteVideo = document.createElement('video');
        remoteVideo.id = remoteVideoId;
        remoteVideo.autoplay = true;
        remoteVideo.playsInline = true;
        
        const videoLabel = document.createElement('div');
        videoLabel.className = 'video-label';
        videoLabel.textContent = peerUsernames[userId] || `User ${userId.substr(0, 5)}...`;
        
        remoteVideoContainer.appendChild(remoteVideo);
        remoteVideoContainer.appendChild(videoLabel);
        remoteVideos.appendChild(remoteVideoContainer);
      }
      
      // Important: Set the srcObject even if we've already created the video element
      // This ensures we update the video if the stream changes
      if (remoteVideo.srcObject !== event.streams[0]) {
        console.log(`Setting srcObject for ${userId}`);
        remoteVideo.srcObject = event.streams[0];
        
        // Force video to play
        remoteVideo.play().catch(error => {
          console.warn(`Error playing remote video: ${error}`);
        });
      }
    };
    
    return peerConnection;
  } catch (error) {
    console.error(`Error creating peer connection with ${userId}:`, error);
    showNotification('Error connecting to the remote user');
  }
}

// Update the sendOffer function to be more robust
async function sendOffer(userId) {
  try {
    console.log(`Preparing to send offer to ${userId}`);
    let peerConnection = peerConnections[userId];
    
    if (!peerConnection) {
      console.log(`No existing peer connection for ${userId}, creating one`);
      peerConnection = await createPeerConnection(userId);
      peerConnections[userId] = peerConnection;
    }
    
    // Check if we're in a state where we can create an offer
    if (peerConnection.signalingState === 'stable') {
      console.log(`Creating offer for ${userId}`);
      const offer = await peerConnection.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      });
      
      console.log(`Setting local description for ${userId}`);
      await peerConnection.setLocalDescription(offer);
      
      // Wait a moment to ensure ICE gathering is complete or has started
      await new Promise(resolve => setTimeout(resolve, 500));
      
      console.log(`Sending offer to ${userId}`);
      socket.emit('offer', userId, peerConnection.localDescription || offer);
    } else {
      console.warn(`Cannot create offer in state: ${peerConnection.signalingState}`);
      // If we're not in stable state, reset the connection
      await resetPeerConnection(userId);
    }
  } catch (error) {
    console.error(`Error sending offer to ${userId}:`, error);
    showNotification(`Connection error: ${error.message}`);
  }
}

// Update the handleOffer function for better signaling state handling
async function handleOffer(userId, offer) {
  try {
    console.log(`Handling offer from ${peerUsernames[userId] || userId}`);
    let peerConnection = peerConnections[userId];
    
    if (!peerConnection) {
      console.log(`Creating new peer connection for ${userId} after offer`);
      peerConnection = await createPeerConnection(userId);
      peerConnections[userId] = peerConnection;
    }
    
    // If we're not in stable state, we need special handling
    if (peerConnection.signalingState !== "stable") {
      console.log(`Signaling state is ${peerConnection.signalingState}, handling carefully`);
      
      // If we have a local description and remote description pending, we need to rollback
      const pendingLocal = peerConnection.pendingLocalDescription !== null;
      const pendingRemote = peerConnection.pendingRemoteDescription !== null;
      
      // If we're the polite peer (the one who received the offer second), we rollback
      const isPolite = socket.id > userId; // Simple way to determine politeness
      
      if (pendingLocal || pendingRemote) {
        if (isPolite) {
          console.log(`We're the polite peer, rolling back`);
          await peerConnection.setLocalDescription({type: "rollback"});
        } else {
          console.log(`We're the impolite peer, ignoring the offer`);
          return; // Ignore this offer
        }
      }
    }
    
    console.log(`Setting remote description for ${userId}`);
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    
    console.log(`Creating answer for ${userId}`);
    const answer = await peerConnection.createAnswer();
    
    console.log(`Setting local description for ${userId}`);
    await peerConnection.setLocalDescription(answer);
    
    // Wait a moment to ensure ICE gathering is complete or has started
    await new Promise(resolve => setTimeout(resolve, 500));
    
    console.log(`Sending answer to ${userId}`);
    socket.emit('answer', userId, peerConnection.localDescription || answer);
  } catch (error) {
    console.error(`Error handling offer from ${userId}:`, error);
    showNotification(`Connection error: ${error.message}`);
  }
}

// Update the handleAnswer function to check signaling state
function handleAnswer(userId, answer) {
  try {
    console.log(`Handling answer from ${peerUsernames[userId] || userId}`);
    const peerConnection = peerConnections[userId];
    
    if (!peerConnection) {
      console.warn(`No peer connection found for ${userId}`);
      return;
    }
    
    // Only set remote description if we're in the right state
    if (peerConnection.signalingState === 'have-local-offer') {
      console.log(`Setting remote description for ${userId} after answer`);
      peerConnection.setRemoteDescription(new RTCSessionDescription(answer))
        .then(() => {
          console.log(`Successfully set remote description for ${userId}`);
        })
        .catch(error => {
          console.error(`Error setting remote description: ${error.message}`);
        });
    } else {
      console.warn(`Cannot set remote description in state: ${peerConnection.signalingState}`);
      // We may need to reset this peer connection
      resetPeerConnection(userId);
    }
  } catch (error) {
    console.error(`Error handling answer from ${userId}:`, error);
  }
}

// Add a function to reset problematic peer connections
async function resetPeerConnection(userId) {
  try {
    console.log(`Resetting peer connection for ${userId}`);
    
    // Close the existing connection
    if (peerConnections[userId]) {
      peerConnections[userId].close();
      delete peerConnections[userId];
    }
    
    // Remove the video element
    const videoContainer = document.getElementById(`remote-video-container-${userId}`);
    if (videoContainer) {
      videoContainer.remove();
    }
    
    // Create a new connection and send a new offer
    await createPeerConnection(userId);
    await sendOffer(userId);
    
    console.log(`Peer connection reset for ${userId}`);
  } catch (error) {
    console.error(`Error resetting peer connection: ${error}`);
  }
}

// Handle an ICE candidate from a remote user
function handleIceCandidate(userId, candidate) {
  try {
    const peerConnection = peerConnections[userId];
    
    if (peerConnection) {
      peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    }
  } catch (error) {
    console.error(`Error handling ICE candidate from ${userId}:`, error);
  }
}

// Handle a user leaving the room
function handleUserLeft(userId) {
  const remoteVideoContainer = document.getElementById(`remote-video-container-${userId}`);
  
  if (remoteVideoContainer) {
    remoteVideoContainer.remove();
  }
  
  if (peerConnections[userId]) {
    peerConnections[userId].close();
    delete peerConnections[userId];
  }
}

// Copy the room code to the clipboard
function copyRoomCode() {
  navigator.clipboard.writeText(currentRoom)
    .then(() => {
      showNotification('Room code copied to clipboard');
    })
    .catch(err => {
      console.error('Failed to copy room code:', err);
      showNotification('Failed to copy room code');
    });
}

// Leave the current room
function leaveRoom() {
  if (!currentRoom) {
    return; // No room to leave
  }

  // Inform the server that we're leaving the room
  socket.emit('leave-room', currentRoom, () => {
    console.log(`Left room: ${currentRoom}`);
    
    // Close all peer connections
    for (const userId in peerConnections) {
      if (peerConnections[userId]) {
        peerConnections[userId].close();
      }
    }
    
    // Reset variables
    peerConnections = {};
    peerUsernames = {};
    currentRoom = null;
    
    // Clear the remote videos
    remoteVideos.innerHTML = '';
    
    // Reset the UI
    switchToHomeScreen();
    
    showNotification('You have left the room');
  });
}

// Toggle mute/unmute
function toggleMute() {
  const audioTrack = localStream.getAudioTracks()[0];
  
  if (audioTrack) {
    audioTrack.enabled = !audioTrack.enabled;
    muteBtn.textContent = audioTrack.enabled ? 'Mute' : 'Unmute';
  }
}

// Toggle video on/off
function toggleVideo() {
  const videoTrack = localStream.getVideoTracks()[0];
  
  if (videoTrack) {
    videoTrack.enabled = !videoTrack.enabled;
    videoBtn.textContent = videoTrack.enabled ? 'Stop Video' : 'Start Video';
  }
}

// Switch to the call screen
function switchToCallScreen() {
  homeScreen.classList.add('hidden');
  callScreen.classList.remove('hidden');
}

// Switch to the home screen
function switchToHomeScreen() {
  callScreen.classList.add('hidden');
  homeScreen.classList.remove('hidden');
}

// Show a notification
function showNotification(message) {
  notification.textContent = message;
  notification.classList.remove('hidden');
  
  setTimeout(() => {
    notification.classList.add('hidden');
  }, 3000);
}

async function checkMediaDevices() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter(device => device.kind === 'videoinput');
    const audioDevices = devices.filter(device => device.kind === 'audioinput');
    
    console.log(`Available video devices: ${videoDevices.length}`);
    console.log(`Available audio devices: ${audioDevices.length}`);
    
    videoDevices.forEach((device, index) => {
      console.log(`Video device ${index + 1}: ${device.label}`);
    });
    
    return { videoDevices, audioDevices };
  } catch (error) {
    console.error('Error checking media devices:', error);
    return { videoDevices: [], audioDevices: [] };
  }
}

// Call this function during init
document.addEventListener('DOMContentLoaded', () => {
  checkMediaDevices().then(() => {
    init();
  });
});
