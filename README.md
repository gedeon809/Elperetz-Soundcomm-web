# SoundComm – A↔B Volume Control Panel

**SoundComm** is a **real-time volume control** application designed for two panels: **Stage (A)** and **Sound Desk (B)**. It enables multi-device communication using **Socket.IO** to control volume levels and send messages between two panels. This application is ideal for live events where the stage (A) needs to control the sound desk (B) remotely.

## Features:
- **Two Panels**: Stage (A) and Sound Desk (B).
- **Multi-device support**: Connect multiple devices using Socket.IO.
- **Real-time Volume Control**: Both panels can adjust volume levels (Volume Low/High).
- **Notifications**: Plays a notification sound and shows browser notifications when messages are received.
- **Message Log**: Tracks and displays messages in real-time.

## Tech Stack:
- **Frontend**: Next.js (React)
- **Backend**: Node.js with Socket.IO
- **State Management**: React Hooks (`useState`, `useEffect`, `useRef`)
- **WebSockets**: Socket.IO for real-time communication
- **UI**: TailwindCSS for styling
- **Notifications**: Browser Notifications API

## Prerequisites

Before running the project, ensure you have the following installed on your local machine:

- **Node.js**: Version 16 or higher
- **npm**: Version 7 or higher

## Setup and Installation

### 1. Clone the Repository

```bash
git clone https://github.com/your-username/soundcomm.git
cd soundcomm
