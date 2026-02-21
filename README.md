# DUO TETRIS - 2人交互操作テトリス

## 構成

```
server/
  server.js       # Node.js + Socket.io サーバー
  package.json
client/
  index.html      # フロントエンド（単一ファイル）
```

## ローカルでの起動方法

### サーバー
```bash
cd server
npm install
npm run dev   # nodemon使用（開発時）
# または
npm start
```

### クライアント
`client/index.html` をブラウザで2タブ開く。  
（サーバーのCORSはすべて許可しているので、file://で開いてもOK）

デフォルトのサーバーURL: `http://localhost:3001`

---

## アーキテクチャの概要

### サーバーが管理するもの
- 盤面 (`board`) ← **Source of Truth**
- ターン管理 (`currentTurn`)
- ミノのキュー（シードベースで両者に同じ順番）
- スコア・ライン消去処理
- タイムアウト（15秒）

### クライアントが担うもの
- キー入力受け付け（自分のターン時のみ）
- ミノの移動・回転・ゴースト表示
- ハードドロップ → `piecePlaced` イベントで盤面をサーバーへ送信
- 受信した盤面を描画

### イベントフロー
```
Client A                    Server                    Client B
  |                           |                           |
  |-- joinGame -------------->|                           |
  |                           |<------------- joinGame ---|
  |<-- joined (P1) -----------|                           |
  |                           |--- joined (P2) ---------->|
  |<-- gameStart (turn=P1) ---|--- gameStart (turn=P1) -->|
  |                           |                           |
  | [P1操作中]                |                           |
  |-- piecePlaced(board) ---->|                           |
  |                           |--- turnChanged(turn=P2) ->|
  |<-- turnChanged(turn=P2) --|                           |
  |                           |                           |
  |                           |          [P2操作中]       |
  |                           |<------- piecePlaced(board)|
  |<-- turnChanged(turn=P1) --|--- turnChanged(turn=P1) ->|
  ...
```

---

## 今後の拡張ポイント

- **SRS (Super Rotation System)**: 現在は単純な回転。壁蹴りを実装するとよりテトリスらしくなる
- **ルームコード**: 現在は先着2人マッチング。友達と遊ぶためのルームID共有機能
- **重力**: ソフトドロップのみで自然落下なし。タイマー切れで落下する仕様に変更可
- **スコア表示の工夫**: ライン消去時のアニメーション
- **デプロイ**: RenderやRailwayにサーバーをデプロイし、クライアントのSERVER_URLを修正する
