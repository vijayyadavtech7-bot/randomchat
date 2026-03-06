# Random Chat Web App

A real-time random chat application built with React and Node.js/Express.

## Features

- Connect with random users instantly
- Real-time messaging using WebSockets (Socket.IO)
- Clean, modern UI with smooth animations
- Responsive design for mobile and desktop
- User pairing system with waiting queue

## Project Structure

```
random-chat-app/
├── server/              # Node.js/Express backend
│   ├── server.js       # Main server with Socket.IO
│   └── package.json    # Dependencies
└── client/             # React frontend
    ├── public/         # Static files
    ├── src/
    │   ├── App.js      # Main React component
    │   ├── App.css     # Styling
    │   ├── index.js    # React entry point
    │   └── index.css   # Global styles
    └── package.json    # Dependencies
```

## Getting Started

### Prerequisites
- Node.js (v14 or higher)
- npm

### Installation

1. **Install server dependencies:**
   ```bash
   cd server
   npm install
   ```

2. **Install client dependencies:**
   ```bash
   cd ../client
   npm install
   ```

### Running the App

1. **Start the backend server:**
   ```bash
   cd server
   npm start
   ```
   Server will run on `http://localhost:5000`

2. **In a new terminal, start the frontend:**
   ```bash
   cd client
   npm start
   ```
   App will open at `http://localhost:3000`

## How to Use

1. Open the app in your browser
2. Click "Start Chatting" button
3. Wait for a random user to connect
4. Once connected, you can start chatting!
5. Click "End Chat" to disconnect and find another user

## Technologies Used

### Backend
- **Express.js** - Web server framework
- **Socket.IO** - Real-time bidirectional communication
- **Node.js** - JavaScript runtime

### Frontend
- **React** - UI library
- **Socket.IO Client** - WebSocket client
- **CSS3** - Styling with animations and gradients

## How It Works

1. Users connect to the server
2. When a user clicks "Start Chatting", they're added to a waiting queue
3. When two users are available, they're paired together
4. Messages are sent in real-time via WebSocket
5. When either user ends the chat, the connection is closed and they can find a new partner

## Features to Add (Future)

- User authentication
- Chat history
- User profiles with avatars
- Typing indicators
- Emojis support
- Block users functionality
- Report inappropriate content
- Chat rooms

Enjoy chatting! 🎲
# randomchat
