# DevConnect Backend

**DevConnect** is a social media platform backend tailored for developers to collaborate, share code, and communicate in real-time. This backend is built using the MERN stack components with Node.js, Express.js, MongoDB, and Firebase integration.

---

## Table of Contents
//wip

## Features

- User registration and login with secure password hashing using bcrypt  
- JWT-based authentication with short-lived access tokens and refresh tokens stored as HttpOnly cookies  
- Real-time messaging support (via Firebase)  
- Profile management including skills, bio, and avatar uploads  
- Search and social networking features (follow/connect users)  
- Notifications and privacy controls  
- RESTful API design with proper error handling and input validation  

---

## Tech Stack

- Node.js  
- Express.js  
- MongoDB with Mongoose  
- Firebase (Authentication, Realtime Database, Cloud Storage)  
- JWT for authentication tokens  
- bcrypt for password hashing  
- Helmet, CORS, Morgan for security, CORS, and logging  

---

## Getting Started

### Prerequisites

- Node.js (v16+)  
- MongoDB instance (local or cloud)  
- Firebase project with credentials  

### Installation

1. Clone the repository:  
   ```bash
   git clone https://github.com/phyoewaiaung/devnexus-api.git
   cd devconnect-backend
