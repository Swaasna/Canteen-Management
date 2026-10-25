# Canteen Counter (DBuild)
Node.js + Express backend, MySQL on a remote host, plain HTML/JS frontend served by the same server.

## Run locally (still talking to the REMOTE database)
1. Install Node.js 18+
2. `npm install`
3. Copy `.env.example` to `.env` and fill in your hosted MySQL details
4. `npm start`  ->  open http://localhost:3000

Tables and sample menu items are created automatically on first start.

## CRUD map
| Operation | Menu | Orders |
|-----------|------|--------|
| Create | POST /api/menu | POST /api/orders |
| Read   | GET /api/menu  | GET /api/orders |
| Update | PUT /api/menu/:id | PUT /api/orders/:id/status |
| Delete | DELETE /api/menu/:id | DELETE /api/orders/:id |
