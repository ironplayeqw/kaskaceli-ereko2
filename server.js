const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const QRCode = require("qrcode");
const os = require("os");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const rooms = new Map();

const words = [
    "Pizza",
    "Beach",
    "School",
    "Airport",
    "Football",
    "Computer",
    "Hospital",
    "Restaurant",
    "Cinema",
    "Mountain",
    "Car",
    "Phone",
    "Robot",
    "Summer",
    "Winter",
    "Birthday",
    "Coffee",
    "Music",
    "Game",
    "Internet",
    "Library",
    "Hotel",
    "Space",
    "Doctor",
    "University",
    "Concert",
    "Train",
    "Family",
    "Vacation"
];

function createRoomCode() {
    let code;

    do {
        code = Math.random()
            .toString(36)
            .substring(2, 6)
            .toUpperCase();
    } while (rooms.has(code));

    return code;
}

function getLocalIP() {
    const interfaces = os.networkInterfaces();

    for (const name of Object.keys(interfaces)) {
        for (const network of interfaces[name]) {
            if (
                network.family === "IPv4" &&
                !network.internal
            ) {
                return network.address;
            }
        }
    }

    return "localhost";
}

function publicPlayers(room) {
    return room.players.map(player => ({
        id: player.id,
        name: player.name,
        score: player.score,
        connected: player.connected
    }));
}

function sendRoomState(room) {
    io.to(room.code).emit("roomState", {
        code: room.code,
        phase: room.phase,
        players: publicPlayers(room),
        round: room.round
    });
}

io.on("connection", socket => {

    socket.on("createRoom", ({ name }) => {

        const code = createRoomCode();

        const room = {
            code,
            host: socket.id,
            players: [],
            phase: "lobby",
            round: 0,
            spyId: null,
            secretWord: null,
            votes: {},
            hostName: name || "Host"
        };

        rooms.set(code, room);

        socket.join(code);

        room.players.push({
            id: socket.id,
            name: name || "Host",
            score: 0,
            connected: true
        });

        socket.emit("roomCreated", {
            code,
            host: true
        });

        sendRoomState(room);
    });


    socket.on("joinRoom", ({ code, name }) => {

        code = String(code || "").toUpperCase();

        const room = rooms.get(code);

        if (!room) {
            socket.emit("errorMessage", "Room not found.");
            return;
        }

        if (room.phase !== "lobby") {
            socket.emit(
                "errorMessage",
                "The game has already started."
            );
            return;
        }

        if (!name || !name.trim()) {
            socket.emit(
                "errorMessage",
                "Enter your name."
            );
            return;
        }

        socket.join(code);

        room.players.push({
            id: socket.id,
            name: name.trim(),
            score: 0,
            connected: true
        });

        socket.emit("joinedRoom", {
            code,
            host: false
        });

        sendRoomState(room);
    });


    socket.on("startGame", ({ code }) => {

        const room = rooms.get(code);

        if (!room) return;

        if (socket.id !== room.host) return;

        if (room.players.length < 4) {

            socket.emit(
                "errorMessage",
                "At least 4 players are required."
            );

            return;
        }

        room.round++;

        room.phase = "roles";

        room.spyId =
            room.players[
                Math.floor(
                    Math.random() * room.players.length
                )
            ].id;

        room.secretWord =
            words[
                Math.floor(
                    Math.random() * words.length
                )
            ];

        room.votes = {};

        room.players.forEach(player => {

            player.connected = true;

            io.to(player.id).emit("role", {
                spy: player.id === room.spyId,
                word:
                    player.id === room.spyId
                        ? null
                        : room.secretWord
            });

        });

        sendRoomState(room);

        setTimeout(() => {

            room.phase = "discussion";

            sendRoomState(room);

        }, 1000);
    });


    socket.on("startVoting", ({ code }) => {

        const room = rooms.get(code);

        if (!room) return;

        if (socket.id !== room.host) return;

        room.phase = "voting";
        room.votes = {};

        sendRoomState(room);
    });


    socket.on("vote", ({ code, targetId }) => {

        const room = rooms.get(code);

        if (!room) return;

        if (room.phase !== "voting") return;

        room.votes[socket.id] = targetId;

        io.to(code).emit("voteUpdate", {
            count: Object.keys(room.votes).length,
            total: room.players.length
        });

        if (
            Object.keys(room.votes).length >=
            room.players.length
        ) {
            finishRound(room);
        }
    });


    socket.on("nextRound", ({ code }) => {

        const room = rooms.get(code);

        if (!room) return;

        if (socket.id !== room.host) return;

        room.round++;

        room.phase = "roles";

        room.spyId =
            room.players[
                Math.floor(
                    Math.random() *
                    room.players.length
                )
            ].id;

        room.secretWord =
            words[
                Math.floor(
                    Math.random() *
                    words.length
                )
            ];

        room.votes = {};

        room.players.forEach(player => {

            io.to(player.id).emit("role", {
                spy: player.id === room.spyId,
                word:
                    player.id === room.spyId
                        ? null
                        : room.secretWord
            });

        });

        sendRoomState(room);

        setTimeout(() => {

            room.phase = "discussion";

            sendRoomState(room);

        }, 1000);
    });


    socket.on("disconnect", () => {

        for (const room of rooms.values()) {

            const player =
                room.players.find(
                    p => p.id === socket.id
                );

            if (!player) continue;

            player.connected = false;

            sendRoomState(room);

            break;
        }
    });

});


function finishRound(room) {

    const voteCounts = {};

    for (const targetId of Object.values(room.votes)) {

        voteCounts[targetId] =
            (voteCounts[targetId] || 0) + 1;
    }

    let mostVoted = null;
    let maxVotes = 0;

    for (const [id, count] of Object.entries(voteCounts)) {

        if (count > maxVotes) {

            maxVotes = count;
            mostVoted = id;

        }
    }

    const spyFound =
        mostVoted === room.spyId;

    if (spyFound) {

        room.players.forEach(player => {

            if (player.id !== room.spyId) {
                player.score++;
            }

        });

    } else {

        const spy =
            room.players.find(
                p => p.id === room.spyId
            );

        if (spy) {
            spy.score += 2;
        }
    }

    room.phase = "result";

    io.to(room.code).emit("result", {

        spyId: room.spyId,

        spyName:
            room.players.find(
                p => p.id === room.spyId
            )?.name,

        word: room.secretWord,

        selectedId: mostVoted,

        selectedName:
            room.players.find(
                p => p.id === mostVoted
            )?.name,

        spyFound,

        players: publicPlayers(room)
    });

    sendRoomState(room);
}


const PORT = 3000;
const IP = getLocalIP();

server.listen(PORT, "0.0.0.0", async () => {

    const url = `http://${IP}:${PORT}`;

    console.log("");
    console.log("================================");
    console.log("   KASKACELI EREKO");
    console.log("================================");
    console.log("");
    console.log(`Host: ${url}`);
    console.log("");
    console.log(
        "Open this address on the host computer."
    );
    console.log(
        "Phones must be connected to the same Wi-Fi."
    );
    console.log("");

});