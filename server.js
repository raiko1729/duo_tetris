const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

// ミノのランダムシード（両プレイヤーに同じミノ順を保証）
function mulberry32(seed) {
  return function() {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function generateBag(rng) {
  const pieces = ['I','O','T','S','Z','J','L'];
  for (let i = pieces.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pieces[i], pieces[j]] = [pieces[j], pieces[i]];
  }
  return pieces;
}

// ゲーム状態
const rooms = {};

function createRoom(roomId) {
  const seed = Math.floor(Math.random() * 1000000);
  const rng = mulberry32(seed);
  const bag = [...generateBag(rng), ...generateBag(rng), ...generateBag(rng)];

  return {
    roomId,
    players: [],     // [socket.id, socket.id]
    currentTurn: 0,  // 0 or 1 (index of players)
    board: Array(20).fill(null).map(() => Array(10).fill(0)),
    pieceQueue: bag,
    pieceIndex: 0,
    seed,
    rng,
    score: 0,
    gameOver: false,
    turnTimeLimit: 15000, // 15秒
    turnTimer: null,
  };
}

function getNextPiece(room) {
  if (room.pieceIndex >= room.pieceQueue.length - 5) {
    room.pieceQueue.push(...generateBag(room.rng));
  }
  return room.pieceQueue[room.pieceIndex++];
}

function startTurnTimer(room) {
  clearTimeout(room.turnTimer);
  room.turnTimer = setTimeout(() => {
    // 時間切れ → 自動ハードドロップをサーバーが通知
    io.to(room.roomId).emit('turnTimeout', {
      playerIndex: room.currentTurn
    });
  }, room.turnTimeLimit);
}

function nextTurn(room) {
  room.currentTurn = 1 - room.currentTurn;
  const nextPiece = getNextPiece(room);
  const previewPiece = room.pieceQueue[room.pieceIndex]; // 次の次

  io.to(room.roomId).emit('turnChanged', {
    currentTurn: room.currentTurn,
    activePlayerId: room.players[room.currentTurn],
    currentPiece: nextPiece,
    previewPiece,
    board: room.board,
    score: room.score,
    turnTimeLimit: room.turnTimeLimit,
  });

  startTurnTimer(room);
}

// ライン消去処理
function clearLines(board) {
  let cleared = 0;
  for (let r = board.length - 1; r >= 0; r--) {
    if (board[r].every(cell => cell !== 0)) {
      board.splice(r, 1);
      board.unshift(Array(10).fill(0));
      cleared++;
      r++; // 再チェック
    }
  }
  return cleared;
}

const SCORES = [0, 100, 300, 500, 800];

io.on('connection', (socket) => {
  console.log('connected:', socket.id);

  // マッチング（簡易: 待機中のルームに入れる）
  socket.on('joinGame', () => {
    let room = Object.values(rooms).find(r => r.players.length === 1 && !r.gameOver);

    if (!room) {
      const roomId = 'room_' + socket.id;
      room = createRoom(roomId);
      rooms[roomId] = room;
    }

    room.players.push(socket.id);
    socket.join(room.roomId);
    socket.data.roomId = room.roomId;
    socket.data.playerIndex = room.players.length - 1;

    socket.emit('joined', {
      playerIndex: socket.data.playerIndex,
      roomId: room.roomId,
    });

    if (room.players.length === 2) {
      // ゲーム開始
      const firstPiece = getNextPiece(room);
      const previewPiece = room.pieceQueue[room.pieceIndex];

      io.to(room.roomId).emit('gameStart', {
        currentTurn: room.currentTurn,
        activePlayerId: room.players[room.currentTurn],
        currentPiece: firstPiece,
        previewPiece,
        board: room.board,
        score: room.score,
        turnTimeLimit: room.turnTimeLimit,
      });

      startTurnTimer(room);
    }
  });
  // 相手の操縦しているミノの位置を送る
  socket.on('pieceMove', (data) => {
    const room = rooms[socket.data.roomId];
    if (!room) return;
    // 相手だけに送る
    const opponentId = room.players.find(id => id !== socket.id);
    if (opponentId) io.to(opponentId).emit('opponentPieceMove', data);
  });
  
  socket.on('pieceMove', (data) => {
    const room = rooms[socket.data.roomId];
    if (!room) return;
    const opponentId = room.players.find(id => id !== socket.id);
    if (opponentId) io.to(opponentId).emit('opponentPieceMove', data);
  });
  // ミノが確定したとき（ハードドロップ完了）
  socket.on('piecePlaced', ({ board }) => {
    const room = rooms[socket.data.roomId];
    if (!room) return;
    if (room.players[room.currentTurn] !== socket.id) return; // 自分のターンか確認

    clearTimeout(room.turnTimer);

    // サーバーの盤面を更新
    room.board = board;

    // ライン消去
    const linesCleared = clearLines(room.board);
    room.score += SCORES[linesCleared] || 0;

    // ゲームオーバー判定（一番上の行にブロックがあるか）
    const isGameOver = room.board[0].some(cell => cell !== 0);

    if (isGameOver) {
      room.gameOver = true;
      io.to(room.roomId).emit('gameOver', { score: room.score, board: room.board });
      return;
    }

    nextTurn(room);
  });

  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms[roomId]) return;
    const room = rooms[roomId];
    clearTimeout(room.turnTimer);
    io.to(roomId).emit('opponentLeft');
    delete rooms[roomId];
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
