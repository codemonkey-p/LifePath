const http = require('http');
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const cookie = require('cookie');
const cookieSignature = require('cookie-signature');
const { WebSocketServer } = require('ws');

const config = require('./config');
const { loadUser, COOKIE_NAME } = require('./middleware/session');
const userStore = require('./services/userStore');
const { attachRealtimeBridge } = require('./services/realtimeSessionService');

const authRoutes = require('./routes/auth');
const wizardRoutes = require('./routes/wizard');
const quizRoutes = require('./routes/quiz');
const companionRoutes = require('./routes/companion');
const profileRoutes = require('./routes/profile');
const shoppingRoutes = require('./routes/shopping');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser(config.session.secret));
app.use(loadUser);

app.use('/api', authRoutes);
app.use('/api/wizard', wizardRoutes);
app.use('/api/quiz', quizRoutes);
app.use('/api/companion', companionRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/shopping', shoppingRoutes);

app.use(express.static(path.join(__dirname, 'public')));

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Something went wrong. Please try again in a moment.' });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

function userIdFromRequest(request) {
  const cookies = cookie.parse(request.headers.cookie || '');
  const raw = cookies[COOKIE_NAME];
  if (!raw) return null;
  const unsigned = cookieSignature.unsign(decodeURIComponent(raw).slice(2), config.session.secret);
  return unsigned || null;
}

server.on('upgrade', (request, socket, head) => {
  const { pathname } = new URL(request.url, `http://${request.headers.host}`);
  const modeByPath = { '/ws/wizard': 'wizard', '/ws/companion': 'companion' };
  const mode = modeByPath[pathname];
  if (!mode) {
    socket.destroy();
    return;
  }

  const userId = userIdFromRequest(request);
  const user = userId && userStore.findById(userId);
  if (!user) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    attachRealtimeBridge(ws, { mode, userId });
  });
});

server.listen(config.server.port, config.server.host, () => {
  console.log(`LifePath running at http://localhost:${config.server.port}`);
});
