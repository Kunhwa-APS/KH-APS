const express = require('express');
const session = require('express-session');
const { PORT, SERVER_SESSION_SECRET } = require('./config.js');

let app = express();

// 정적 파일 서빙
app.use(express.static('wwwroot'));

// express-session 미들웨어 (서버 메모리에 세션 저장 - 토큰 크기 제한 없음)
app.use(session({
    secret: SERVER_SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 // 24시간
    }
}));

// API 라우트
app.use(require('./routes/auth.js'));
app.use(require('./routes/hubs.js'));
const { geocodeRouter } = require('./routes/tiles.js');
app.use(require('./routes/tiles.js'));
app.use(geocodeRouter);

// 에러 핸들링 미들웨어
app.use((err, req, res, next) => {
    console.error('Server error:', err.message || err);
    res.status(err.statusCode || 500).json({
        error: err.message || 'Internal Server Error'
    });
});

app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}...`);
    console.log(`Open http://localhost:${PORT} in your browser`);
});
